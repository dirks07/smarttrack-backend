require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------
// 1. SUPABASE CLIENT INITIALIZATION (Auto-sanitized)
// -----------------------------------------------------------------
let rawUrl = (process.env.SUPABASE_URL || 'https://imjdhuczyqaxhifyucbo.supabase.co').trim();
rawUrl = rawUrl.replace(/^["']|["']$/g, '');

try {
  const parsed = new URL(rawUrl);
  rawUrl = parsed.origin;
} catch (e) {
  rawUrl = 'https://imjdhuczyqaxhifyucbo.supabase.co';
}

const rawKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim().replace(/^["']|["']$/g, '');

const supabase = createClient(rawUrl, rawKey);

// -----------------------------------------------------------------
// 2. NODEMAILER GMAIL TRANSPORTER
// -----------------------------------------------------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: (process.env.EMAIL_USER || '').trim(),
    pass: (process.env.EMAIL_PASS || '').trim()
  }
});

// In-memory cache for temporary pending OTP verification
const pendingRegistrations = new Map();

// Helper to generate a 6-digit numeric verification code
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// -----------------------------------------------------------------
// 3. HEALTH & STATUS CHECK
// -----------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    supabase_configured: !!rawUrl && !!rawKey
  });
});

// -----------------------------------------------------------------
// 4. BORROWER AUTHENTICATION & GMAIL OTP WORKFLOW
// -----------------------------------------------------------------

// A. Step 1: Send Gmail OTP for Registration
app.post('/api/public/register', async (req, res) => {
  try {
    const { full_name, identifier, email, role, department, password } = req.body;

    if (!full_name || !identifier || !email || !password) {
      return res.status(400).json({ error: 'All registration fields are required.' });
    }

    // Check if identifier or email already exists in Supabase
    const { data: existingUser, error: checkError } = await supabase
      .from('borrowers')
      .select('id, identifier, email')
      .or(`identifier.eq.${identifier},email.eq.${email}`)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Supabase user lookup error:', checkError);
      return res.status(500).json({ error: 'Database query failed: ' + checkError.message });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this ID or Gmail address already exists.' });
    }

    // Generate 6-digit code
    const otp = generateOTP();

    // Cache registration details temporarily (expires in 10 minutes)
    pendingRegistrations.set(identifier, {
      full_name,
      identifier,
      email,
      role: role || 'Student',
      department: department || 'BSIT',
      password,
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    // Send email using Nodemailer
    const mailOptions = {
      from: `"CDM SmartTrack System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'CDM SmartTrack - Your Borrower Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 500px; margin: auto;">
          <h2 style="color: #10b981; margin-top: 0;">CDM SMARTTRACK</h2>
          <p style="font-size: 14px; color: #cbd5e1;">Colegio de Montalban Borrower Registration</p>
          <hr style="border: none; border-top: 1px solid #334155; margin: 16px 0;" />
          <p>Hello <strong>${full_name}</strong>,</p>
          <p style="color: #cbd5e1;">Use the following 6-digit verification code to complete your borrower account registration:</p>
          <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #38bdf8; border: 1px dashed #38bdf8; margin: 20px 0;">
            ${otp}
          </div>
          <p style="font-size: 12px; color: #94a3b8;">This code is valid for 10 minutes. If you did not initiate this request, you can safely ignore this message.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: `Verification OTP dispatched to ${email}.` });
  } catch (error) {
    console.error('Registration OTP dispatch failed:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch verification email.' });
  }
});

// B. Step 2: Verify OTP & Insert Borrower Record into Supabase
app.post('/api/public/verify-otp', async (req, res) => {
  try {
    const { identifier, email, otp } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Identifier and OTP code are required.' });
    }

    const pending = pendingRegistrations.get(identifier);

    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found for this ID. Please register again.' });
    }

    if (Date.now() > pending.expiresAt) {
      pendingRegistrations.delete(identifier);
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    if (pending.otp !== otp.toString().trim()) {
      return res.status(400).json({ error: 'Incorrect verification code. Please check your Gmail.' });
    }

    // Insert user into Supabase
    const { data: newUser, error: insertError } = await supabase
      .from('borrowers')
      .insert([
        {
          full_name: pending.full_name,
          identifier: pending.identifier,
          email: pending.email,
          role: pending.role,
          department: pending.department,
          password: pending.password,
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (insertError) {
      console.error('Supabase borrower insert error:', insertError);
      return res.status(500).json({ error: 'Failed to create borrower account: ' + insertError.message });
    }

    // Clean up cached pending registration
    pendingRegistrations.delete(identifier);

    res.json({
      success: true,
      message: 'Borrower verified and registered successfully.',
      user: {
        id: newUser.id,
        full_name: newUser.full_name,
        identifier: newUser.identifier,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department
      }
    });
  } catch (error) {
    console.error('Verify OTP route error:', error);
    res.status(500).json({ error: error.message || 'Server error verifying OTP.' });
  }
});

// C. Borrower Login
app.post('/api/public/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required.' });
    }

    const { data: user, error } = await supabase
      .from('borrowers')
      .select('*')
      .eq('identifier', identifier)
      .eq('password', password)
      .maybeSingle();

    if (error) {
      console.error('Supabase login query error:', error);
      return res.status(500).json({ error: 'Login query failed: ' + error.message });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid ID number or password.' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        identifier: user.identifier,
        email: user.email,
        role: user.role,
        department: user.department
      }
    });
  } catch (error) {
    console.error('Login route error:', error);
    res.status(500).json({ error: error.message || 'Server error during login.' });
  }
});

// -----------------------------------------------------------------
// 5. INVENTORY CATALOG & REQUISITIONS
// -----------------------------------------------------------------

// Get all inventory items
app.get('/api/public/inventory', async (req, res) => {
  try {
    const { data: inventory, error } = await supabase
      .from('inventory')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(inventory || []);
  } catch (error) {
    console.error('Fetch inventory error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch inventory.' });
  }
});

// Submit a new borrow requisition request
app.post('/api/public/requests', async (req, res) => {
  try {
    const { item_id, item_name, quantity, purpose, requester_name, identifier, role, department } = req.body;

    if (!item_id || !identifier || !quantity) {
      return res.status(400).json({ error: 'Missing required request fields.' });
    }

    const { data: newTicket, error } = await supabase
      .from('requests')
      .insert([
        {
          item_id,
          item_name,
          quantity: parseInt(quantity, 10),
          purpose,
          requester_name,
          identifier,
          role: role || 'Student',
          department: department || 'BSIT',
          status: 'PENDING',
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, ticket: newTicket });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ error: error.message || 'Failed to submit borrow requisition.' });
  }
});

// Get user's own borrow requests (My Tickets)
app.get('/api/public/my-requests', async (req, res) => {
  try {
    const { identifier } = req.query;

    if (!identifier) {
      return res.status(400).json({ error: 'Borrower identifier parameter is required.' });
    }

    const { data: tickets, error } = await supabase
      .from('requests')
      .select('*')
      .eq('identifier', identifier)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(tickets || []);
  } catch (error) {
    console.error('Fetch my-requests error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch tickets.' });
  }
});

// -----------------------------------------------------------------
// 6. ADMIN PORTAL ENDPOINTS
// -----------------------------------------------------------------

// Update ticket status (APPROVE, REJECT, CLAIM)
app.patch('/api/admin/requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    const { data: updatedTicket, error } = await supabase
      .from('requests')
      .update({ status: status.toUpperCase() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, ticket: updatedTicket });
  } catch (error) {
    console.error('Admin update ticket error:', error);
    res.status(500).json({ error: error.message || 'Failed to update ticket.' });
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`SmartTrack Backend server listening on port ${PORT}`);
});
