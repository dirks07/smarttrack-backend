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
// 2. UNIVERSAL GMAIL TRANSPORTER (PORT 587 / STARTTLS)
// -----------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  requireTLS: true,
  pool: true,
  maxConnections: 3,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  auth: {
    user: (process.env.EMAIL_USER || '').trim(),
    pass: (process.env.EMAIL_PASS || '').trim()
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Cache for pending borrower activations (Token -> User Data)
const pendingTokens = new Map();

// -----------------------------------------------------------------
// 3. HEALTH CHECK & KEEP-ALIVE
// -----------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    supabase_configured: !!rawUrl && !!rawKey
  });
});

// -----------------------------------------------------------------
// 4. BORROWER AUTHENTICATION & ONE-CLICK EMAIL ACTIVATION
// -----------------------------------------------------------------

// A. Step 1: Submit Registration -> Send Verification Link to Any Gmail Address
app.post('/api/public/register', async (req, res) => {
  try {
    const { full_name, identifier, email, role, department, password } = req.body;

    if (!full_name || !identifier || !email || !password) {
      return res.status(400).json({ error: 'All registration fields are required.' });
    }

    // Check if account already exists in Supabase
    const { data: existingUser, error: checkError } = await supabase
      .from('borrowers')
      .select('id, identifier, email')
      .or(`identifier.eq.${identifier},email.eq.${email}`)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Supabase lookup error:', checkError);
      return res.status(500).json({ error: 'Database check failed: ' + checkError.message });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this ID or Gmail address already exists.' });
    }

    // Generate unique verification token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

    // Save pending borrower data for 15 minutes
    pendingTokens.set(token, {
      full_name,
      identifier,
      email,
      role: role || 'Student',
      department: department || 'BSIT',
      password,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const verificationUrl = `https://smarttrack-backend-v6l4.onrender.com/api/public/verify-email?token=${token}`;

    const mailOptions = {
      from: `"CDM SmartTrack System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Verify your CDM SmartTrack Account',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 28px; border-radius: 12px; max-width: 520px; margin: auto; text-align: center;">
          <h2 style="color: #10b981; margin-bottom: 4px;">CDM SMARTTRACK</h2>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 0;">Colegio de Montalban Borrower Portal</p>
          <hr style="border: none; border-top: 1px solid #334155; margin: 20px 0;" />
          <p style="font-size: 15px; color: #e2e8f0; text-align: left;">Hello <strong>${full_name}</strong>,</p>
          <p style="font-size: 14px; color: #cbd5e1; text-align: left; line-height: 1.5;">
            Thank you for registering. Tap the button below to confirm your email and activate your borrower account:
          </p>
          <div style="margin: 28px 0;">
            <a href="${verificationUrl}" style="background-color: #10b981; color: #042f2e; padding: 14px 28px; text-decoration: none; font-size: 15px; font-weight: bold; border-radius: 8px; display: inline-block;">
              Activate My Account
            </a>
          </div>
          <p style="font-size: 12px; color: #64748b;">This link is valid for 15 minutes. If you did not create this account, please ignore this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✓ Verification email sent to ${email}`);

    return res.json({
      success: true,
      message: `A verification link has been sent to ${email}.`
    });
  } catch (error) {
    console.error('SMTP Delivery error:', error);
    return res.status(500).json({ error: 'Email delivery failed: ' + (error.message || 'Check server credentials.') });
  }
});

// B. Step 2: User Clicks Button in Gmail -> Account activated in Supabase
app.get('/api/public/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || !pendingTokens.has(token)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Link Expired</title></head>
        <body style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
          <div style="background-color: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px; max-width: 420px; text-align: center;">
            <div style="font-size: 48px; color: #ef4444; margin-bottom: 12px;">✕</div>
            <h2 style="color: #ef4444; margin: 0 0 10px 0;">Link Invalid or Expired</h2>
            <p style="color: #94a3b8; font-size: 14px; line-height: 1.5;">This verification link has expired or has already been used. Please register again from the mobile app.</p>
          </div>
        </body>
        </html>
      `);
    }

    const pending = pendingTokens.get(token);

    if (Date.now() > pending.expiresAt) {
      pendingTokens.delete(token);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Verification Expired</title></head>
        <body style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px;">
          <div style="background-color: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px; max-width: 420px; text-align: center;">
            <h2 style="color: #ef4444;">Verification Expired</h2>
            <p style="color: #94a3b8;">The 15-minute verification window has passed. Please submit registration again.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Insert user into Supabase borrowers table
    const { error: insertError } = await supabase.from('borrowers').insert([
      {
        full_name: pending.full_name,
        identifier: pending.identifier,
        email: pending.email,
        role: pending.role,
        department: pending.department,
        password: pending.password,
        created_at: new Date().toISOString()
      }
    ]);

    if (insertError) {
      console.error('Supabase borrower insert error:', insertError);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Database Error</title></head>
        <body style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px;">
          <div style="background-color: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px; max-width: 420px; text-align: center;">
            <h2 style="color: #ef4444;">Database Insert Failed</h2>
            <p style="color: #94a3b8;">${insertError.message}</p>
          </div>
        </body>
        </html>
      `);
    }

    pendingTokens.delete(token);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Verified</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
        <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size: 52px; color: #10b981; margin-bottom: 12px;">✓</div>
          <h2 style="color: #10b981; margin: 0 0 10px 0;">Account Activated!</h2>
          <p style="color: #cbd5e1; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            Your borrower account for <strong>${pending.full_name}</strong> is now active.
          </p>
          <div style="background-color: #0f172a; padding: 14px; border-radius: 8px; border: 1px dashed #10b981; font-size: 14px; color: #38bdf8;">
            You can return to the CDM SmartTrack mobile app and log in now.
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Email verification route error:', error);
    res.status(500).send('An unexpected server error occurred during verification.');
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

// Fetch inventory catalog
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

// Fetch user's own borrow requests (My Tickets)
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

app.listen(PORT, () => {
  console.log(`SmartTrack Backend server listening on port ${PORT}`);
});
