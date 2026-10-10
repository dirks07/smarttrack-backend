const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Supabase Configuration
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://imjdhuczyqaxhifyucbo.supabase.co').trim();
const SUPABASE_KEY = (process.env.SUPABASE_KEY || '').trim();

if (!SUPABASE_KEY) {
  console.warn("WARNING: SUPABASE_KEY is missing from environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Root Health Check
app.get('/', (req, res) => {
  res.json({ message: "SmartTrack Core API running smoothly with Supabase." });
});

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================
app.post('/api/admin/signup', async (req, res) => {
  try {
    const { full_name, username, password } = req.body;
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const { data: existing, error: checkError } = await supabase
      .from('admins')
      .select('id')
      .ilike('username', username.trim())
      .maybeSingle();

    if (checkError) return res.status(500).json({ error: checkError.message });
    if (existing) return res.status(409).json({ error: "Username already registered" });

    const { data: newAdmin, error: insertError } = await supabase
      .from('admins')
      .insert([{
        full_name: full_name.trim(),
        username: username.trim(),
        password: password
      }])
      .select()
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });

    res.json({
      success: true,
      message: "Admin registered successfully",
      admin: { full_name: newAdmin.full_name, username: newAdmin.username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Enter username and password" });

    const { data: admin, error } = await supabase
      .from('admins')
      .select('*')
      .ilike('username', username.trim())
      .eq('password', password)
      .maybeSingle();

    if (error || !admin) return res.status(401).json({ error: "Invalid username or password" });

    res.json({
      success: true,
      admin: { full_name: admin.full_name, username: admin.username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// PUBLIC AUTHENTICATION
// ==========================================
app.post('/api/public/signup', async (req, res) => {
  try {
    const { full_name, identifier, role, department, password } = req.body;
    if (!full_name || !identifier || !role || !department || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const { data: existing, error: checkError } = await supabase
      .from('requesters')
      .select('id')
      .ilike('identifier', identifier.trim())
      .maybeSingle();

    if (checkError) return res.status(500).json({ error: checkError.message });
    if (existing) return res.status(409).json({ error: "Identifier already registered" });

    const { data, error: insertError } = await supabase
      .from('requesters')
      .insert([{
        full_name: full_name.trim(),
        identifier: identifier.trim(),
        role,
        department: department.trim(),
        password
      }])
      .select()
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });

    res.json({
      success: true,
      user: { full_name: data.full_name, identifier: data.identifier, role: data.role, department: data.department }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/public/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: "Enter ID number and password" });

    const { data: user, error } = await supabase
      .from('requesters')
      .select('*')
      .ilike('identifier', identifier.trim())
      .eq('password', password)
      .maybeSingle();

    if (error || !user) return res.status(401).json({ error: "Invalid ID number or password" });

    res.json({
      success: true,
      user: { full_name: user.full_name, identifier: user.identifier, role: user.role, department: user.department }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// INVENTORY & RESTOCK
// ==========================================
app.get('/api/public/inventory', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .order('id', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restock endpoint with case-insensitive check and clean upsert
app.post('/api/admin/inventory', async (req, res) => {
  try {
    const { name, category, quantity, asset_code } = req.body;
    const parsedQty = parseInt(quantity, 10) || 1;
    const cleanCode = (asset_code || '').trim().toUpperCase();

    if (!name || !cleanCode) {
      return res.status(400).json({ error: "Item name and asset code are required" });
    }

    const { data: existing, error: findErr } = await supabase
      .from('inventory')
      .select('*')
      .ilike('asset_code', cleanCode)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    if (existing) {
      const nextQty = (parseInt(existing.quantity, 10) || 0) + parsedQty;
      const { data, error } = await supabase
        .from('inventory')
        .update({
          name: name.trim(),
          category: category || existing.category,
          quantity: nextQty,
          status: nextQty > 0 ? "Available" : "Out of Stock"
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json({
        success: true,
        message: `Restocked ${name} (+${parsedQty} units). Total count: ${nextQty}`,
        id: data.id
      });
    }

    const { data, error } = await supabase
      .from('inventory')
      .insert([{
        name: name.trim(),
        category: category || 'Equipment',
        quantity: parsedQty,
        status: parsedQty > 0 ? "Available" : "Out of Stock",
        asset_code: cleanCode
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({
      success: true,
      message: `Created and stocked ${name}.`,
      id: data.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// REQUESTS WORKFLOW
// ==========================================
app.post('/api/public/requests', async (req, res) => {
  try {
    const { requester_name, department, item_name, quantity, purpose, role, identifier } = req.body;
    if (!requester_name || !item_name || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from('requests')
      .insert([{
        requester_name,
        identifier: identifier || 'N/A',
        role: role || 'Requester',
        department: department || '',
        item_name,
        quantity: parseInt(quantity, 10) || 1,
        purpose: purpose || '',
        status: 'PENDING'
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, ticket_id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/requests', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const { error } = await supabase
      .from('requests')
      .update({ status })
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// MOBILE ENDPOINTS
// ==========================================
app.get('/api/mobile/approved-requests', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('status', 'APPROVED')
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mobile/item/:code', async (req, res) => {
  try {
    const { data: item, error } = await supabase
      .from('inventory')
      .select('*')
      .ilike('asset_code', req.params.code.trim())
      .maybeSingle();

    if (error || !item) {
      return res.status(404).json({ error: "Item not found in inventory" });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mobile/dispatch', async (req, res) => {
  try {
    const { asset_code, borrower_name, custodian_id, request_id, quantity } = req.body;
    const releaseQty = parseInt(quantity, 10) || 1;

    if (!asset_code || !borrower_name) {
      return res.status(400).json({ error: "Missing barcode or borrower name" });
    }

    const { data: item, error: fetchErr } = await supabase
      .from('inventory')
      .select('*')
      .ilike('asset_code', asset_code.trim())
      .maybeSingle();

    if (fetchErr || !item) {
      return res.status(404).json({ error: "Item not registered in inventory" });
    }

    if (item.quantity < releaseQty) {
      return res.status(400).json({ error: `Not enough stock. Available: ${item.quantity}` });
    }

    const nextQty = item.quantity - releaseQty;
    const nextStatus = nextQty === 0 ? "Out of Stock" : item.status;

    await supabase
      .from('inventory')
      .update({ quantity: nextQty, status: nextStatus })
      .eq('id', item.id);

    await supabase
      .from('borrow_logs')
      .insert([{
        asset_code: asset_code.trim().toUpperCase(),
        borrower_name: borrower_name.trim(),
        custodian_id: custodian_id || "Mobile-Terminal"
      }]);

    if (request_id) {
      await supabase
        .from('requests')
        .update({ status: 'DISPATCHED' })
        .eq('id', request_id);
    }

    res.json({
      success: true,
      message: `Dispatched ${releaseQty} unit(s) of ${item.name} to ${borrower_name}`,
      remaining_quantity: nextQty
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/mobile/requests/:id/cancel', async (req, res) => {
  try {
    const { error } = await supabase
      .from('requests')
      .update({ status: 'UNAVAILABLE_CANCELLED' })
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: "Ticket marked unavailable and removed." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
// Fetch ticket requests belonging to a specific student/faculty member
app.get('/api/public/requests/user/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .ilike('identifier', identifier.trim())
      .order('id', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`SmartTrack Core API running smoothly on port ${PORT}`);
});

const nodemailer = require('nodemailer');

// Setup Gmail Transporter (Use Gmail App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // e.g., your official email
    pass: process.env.GMAIL_APP_PASS // 16-character Google App Password
  }
});

const nodemailer = require('nodemailer');

// Configure Gmail Transporter (Use your Google App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,       // e.g. 'cdm.smarttrack.notifier@gmail.com'
    pass: process.env.GMAIL_APP_PASS   // 16-character Google App Password
  }
});
const nodemailer = require('nodemailer');

// 1. Configure the automated Gmail mailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,       // Your designated Gmail address
    pass: process.env.GMAIL_APP_PASS    // 16-character Google App Password
  }
});

// 2. Automated Registration + Instant OTP Dispatch Route
app.post('/api/public/register', async (req, res) => {
  const { full_name, identifier, email, role, department, password } = req.body;

  if (!full_name || !identifier || !email || !password) {
    return res.status(400).json({ error: 'Please provide all required registration fields.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanId = identifier.trim().toUpperCase();

  // Automatically generate a random 6-digit numeric verification code
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  // Valid for 10 minutes from now
  const expiryTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('requesters')
      .select('id, is_verified')
      .or(`identifier.eq.${cleanId},email.eq.${cleanEmail}`)
      .maybeSingle();

    if (existingUser && existingUser.is_verified) {
      return res.status(400).json({ error: 'An account with this ID or Gmail address is already verified and active.' });
    }

    if (existingUser && !existingUser.is_verified) {
      // Re-registering / requesting new code: overwrite code and details
      const { error: updateErr } = await supabase
        .from('requesters')
        .update({
          full_name,
          role: role || 'Student',
          department: department || 'BSIT',
          password,
          otp_code: generatedOtp,
          otp_expires_at: expiryTime
        })
        .eq('id', existingUser.id);

      if (updateErr) throw updateErr;
    } else {
      // Brand new registration: insert record with pending verification status
      const { error: insertErr } = await supabase
        .from('requesters')
        .insert([{
          full_name,
          identifier: cleanId,
          email: cleanEmail,
          role: role || 'Student',
          department: department || 'BSIT',
          password,
          otp_code: generatedOtp,
          otp_expires_at: expiryTime,
          is_verified: false
        }]);

      if (insertErr) throw insertErr;
    }

    // AUTOMATICALLY SEND THE CODE TO THE GMAIL ADDRESS
    const mailOptions = {
      from: `"CDM SmartTrack Security" <${process.env.GMAIL_USER}>`,
      to: cleanEmail,
      subject: `Your CDM SmartTrack Verification Code: ${generatedOtp}`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0b1120; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 500px; margin: auto;">
          <h2 style="color: #10b981; margin-bottom: 4px;">Colegio de Montalban</h2>
          <p style="font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-top: 0; letter-spacing: 1px;">SmartTrack Borrower Registration</p>
          <hr style="border: 0; border-top: 1px solid #334155; margin: 16px 0;" />
          <p style="font-size: 14px; color: #cbd5e1;">Hello <strong>${full_name}</strong>,</p>
          <p style="font-size: 14px; color: #cbd5e1;">Use the authentication code below to activate your account:</p>
          
          <div style="background-color: #1e293b; border: 1px solid #38bdf8; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #38bdf8;">${generatedOtp}</span>
          </div>

          <p style="font-size: 12px; color: #94a3b8;">This code will automatically expire in <strong>10 minutes</strong>.</p>
          <p style="font-size: 11px; color: #64748b; margin-top: 24px;">If you did not request this registration, please disregard this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({ 
      success: true, 
      message: `Verification code automatically sent to ${cleanEmail}.` 
    });

  } catch (error) {
    console.error('Email dispatch error:', error);
    return res.status(500).json({ 
      error: 'Failed to send automatic verification email: ' + error.message 
    });
  }
});

// 3. Endpoint to Verify the Code
app.post('/api/public/verify-otp', async (req, res) => {
  const { identifier, email, otp } = req.body;

  try {
    const { data: user, error: findErr } = await supabase
      .from('requesters')
      .select('*')
      .or(`identifier.eq.${identifier.trim().toUpperCase()},email.eq.${email.trim().toLowerCase()}`)
      .single();

    if (findErr || !user) {
      return res.status(404).json({ error: 'No matching account registration found.' });
    }

    if (user.otp_code !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'This verification code has expired. Please register again to get a fresh code.' });
    }

    // Mark as verified and remove one-time code
    await supabase
      .from('requesters')
      .update({ is_verified: true, otp_code: null, otp_expires_at: null })
      .eq('id', user.id);

    return res.status(200).json({ 
      success: true, 
      message: 'Account verified successfully! You can now log in.' 
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// 1. Borrower Registration - Saves Pending Account & Sends OTP via Gmail
app.post('/api/public/register', async (req, res) => {
  const { full_name, identifier, email, role, department, password } = req.body;

  if (!full_name || !identifier || !email || !password) {
    return res.status(400).json({ error: 'All registration fields are required.' });
  }

  // Generate 6-digit numeric OTP and 10-minute expiry
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    // Check if ID or Email already exists
    const { data: existingUser } = await supabase
      .from('requesters')
      .select('id, is_verified')
      .or(`identifier.eq.${identifier},email.eq.${email.trim().toLowerCase()}`)
      .maybeSingle();

    if (existingUser && existingUser.is_verified) {
      return res.status(400).json({ error: 'An account with this ID or Email is already registered.' });
    }

    if (existingUser && !existingUser.is_verified) {
      // Update pending record with fresh OTP
      await supabase.from('requesters').update({
        full_name,
        role: role || 'Student',
        department: department || 'BSIT',
        password,
        otp_code: otp,
        otp_expires_at: expiresAt
      }).eq('id', existingUser.id);
    } else {
      // Insert new unverified record
      const { error: insertErr } = await supabase.from('requesters').insert([{
        full_name,
        identifier: identifier.trim().toUpperCase(),
        email: email.trim().toLowerCase(),
        role: role || 'Student',
        department: department || 'BSIT',
        password,
        otp_code: otp,
        otp_expires_at: expiresAt,
        is_verified: false
      }]);
      if (insertErr) throw insertErr;
    }

    // Send the authentication code to Gmail
    await transporter.sendMail({
      from: '"CDM SmartTrack Verification" <no-reply@cdm.edu.ph>',
      to: email.trim().toLowerCase(),
      subject: 'CDM SmartTrack Registration Code',
      html: `
        <div style="font-family: sans-serif; background-color: #0b1120; color: #f8fafc; padding: 24px; border-radius: 12px; max-width: 480px;">
          <h2 style="color: #10b981; margin-top: 0;">Colegio de Montalban</h2>
          <p style="font-size: 14px; color: #94a3b8;">Use the authentication code below to complete your borrower registration:</p>
          <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #38bdf8;">${otp}</span>
          </div>
          <p style="font-size: 12px; color: #64748b;">This code will expire in 10 minutes. If you did not make this request, disregard this email.</p>
        </div>
      `
    });

    res.json({ message: 'Verification code sent to your Gmail.' });
  } catch (err) {
    console.error('Registration/OTP Error:', err);
    res.status(500).json({ error: 'Failed to process registration: ' + err.message });
  }
});

// 2. Verify OTP & Finalize Account
app.post('/api/public/verify-otp', async (req, res) => {
  const { identifier, email, otp } = req.body;

  try {
    const { data: user, error: findErr } = await supabase
      .from('requesters')
      .select('*')
      .or(`identifier.eq.${identifier},email.eq.${email.trim().toLowerCase()}`)
      .single();

    if (findErr || !user) {
      return res.status(404).json({ error: 'Account record not found.' });
    }

    if (user.otp_code !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid authentication code.' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'Authentication code has expired. Please request a new one.' });
    }

    // Mark account active and clear OTP
    const { error: verifyErr } = await supabase
      .from('requesters')
      .update({ is_verified: true, otp_code: null, otp_expires_at: null })
      .eq('id', user.id);

    if (verifyErr) throw verifyErr;

    res.json({ message: 'Email verified successfully! You can now sign in.', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
