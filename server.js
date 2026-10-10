require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Initialization
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('CRITICAL: SUPABASE_URL and SUPABASE_KEY environment variables must be defined.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Gmail Transporter Setup (Nodemailer)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASS
  }
});

// Root Healthcheck
app.get('/', (req, res) => {
  res.send('CDM SmartTrack Backend API is Live and Operational.');
});

// ==========================================
// 1. PUBLIC & BORROWER AUTHENTICATION
// ==========================================

// Borrower Registration & Automated Gmail OTP Dispatch
app.post('/api/public/register', async (req, res) => {
  const { full_name, identifier, email, role, department, password } = req.body;

  if (!full_name || !identifier || !email || !password) {
    return res.status(400).json({ error: 'All registration fields are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanId = identifier.trim().toUpperCase();

  // Generate a random 6-digit verification code & 10-minute validity
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiryTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    const { data: existingUser } = await supabase
      .from('requesters')
      .select('id, is_verified')
      .or(`identifier.eq.${cleanId},email.eq.${cleanEmail}`)
      .maybeSingle();

    if (existingUser && existingUser.is_verified) {
      return res.status(400).json({ error: 'An account with this ID or Gmail address is already registered and verified.' });
    }

    if (existingUser && !existingUser.is_verified) {
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

    // Deliver OTP code to applicant Gmail
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
          <p style="font-size: 14px; color: #cbd5e1;">Your authentication code to complete your borrower registration is:</p>
          <div style="background-color: #1e293b; border: 1px solid #38bdf8; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #38bdf8;">${generatedOtp}</span>
          </div>
          <p style="font-size: 12px; color: #94a3b8;">This code will automatically expire in <strong>10 minutes</strong>.</p>
          <p style="font-size: 11px; color: #64748b; margin-top: 24px;">If you did not request this account, please disregard this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: `Authentication code successfully sent to ${cleanEmail}.`
    });
  } catch (error) {
    console.error('Registration/OTP error:', error);
    return res.status(500).json({ error: 'Failed to process registration: ' + error.message });
  }
});

// Verify OTP & Activate Borrower Account
app.post('/api/public/verify-otp', async (req, res) => {
  const { identifier, email, otp } = req.body;

  try {
    const { data: user, error: findErr } = await supabase
      .from('requesters')
      .select('*')
      .or(`identifier.eq.${(identifier || '').trim().toUpperCase()},email.eq.${(email || '').trim().toLowerCase()}`)
      .single();

    if (findErr || !user) {
      return res.status(404).json({ error: 'Registration record not found.' });
    }

    if (user.otp_code !== (otp || '').trim()) {
      return res.status(400).json({ error: 'Invalid authentication code.' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'Verification code has expired. Please register again for a new code.' });
    }

    const { error: verifyErr } = await supabase
      .from('requesters')
      .update({ is_verified: true, otp_code: null, otp_expires_at: null })
      .eq('id', user.id);

    if (verifyErr) throw verifyErr;

    return res.status(200).json({
      success: true,
      message: 'Account verified successfully. You may now sign in.',
      user
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Borrower Login
app.post('/api/public/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'ID number and password are required.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('requesters')
      .select('*')
      .eq('identifier', identifier.trim().toUpperCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'No borrower account found with this ID.' });
    }

    if (user.password !== password.trim()) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    if (user.is_verified === false) {
      return res.status(403).json({ error: 'Account not yet verified. Please complete your Gmail OTP verification.' });
    }

    return res.status(200).json({ message: 'Login successful.', user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. INVENTORY & REQUISITIONS (MOBILE & WEB)
// ==========================================

// Browse Public Inventory Catalog
app.get('/api/public/inventory', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borrower Submits Requisition Request
app.post('/api/public/requests', async (req, res) => {
  const { item_id, item_name, quantity, purpose, requester_name, identifier, role, department } = req.body;

  if (!item_name || !requester_name || !identifier) {
    return res.status(400).json({ error: 'Missing required request parameters.' });
  }

  try {
    const { data, error } = await supabase
      .from('requisition_requests')
      .insert([{
        item_id: item_id || null,
        item_name,
        quantity: parseInt(quantity, 10) || 1,
        purpose: purpose || 'Academic Class Activity',
        requester_name,
        identifier: identifier.trim().toUpperCase(),
        role: role || 'Student',
        department: department || 'BSIT',
        status: 'PENDING',
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw error;
    res.status(201).json({ message: 'Request submitted successfully.', request: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borrower Fetches Their Own Submitted Tickets
app.get('/api/public/my-requests', async (req, res) => {
  const { identifier } = req.query;

  if (!identifier) {
    return res.status(400).json({ error: 'User identifier is required.' });
  }

  try {
    const { data, error } = await supabase
      .from('requisition_requests')
      .select('*')
      .eq('identifier', identifier.trim().toUpperCase())
      .order('id', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. ADMIN PORTAL WORKFLOW & STATISTICS
// ==========================================

// Get All Requisition Requests
app.get('/api/admin/requests', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('requisition_requests')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Evaluates Request (APPROVE / REJECT)
app.patch('/api/admin/requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['APPROVED', 'REJECTED', 'PENDING'].includes((status || '').toUpperCase())) {
    return res.status(400).json({ error: 'Invalid status update provided.' });
  }

  try {
    const { data, error } = await supabase
      .from('requisition_requests')
      .update({ status: status.toUpperCase() })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ message: `Request #${id} marked as ${status.toUpperCase()}.`, request: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Inventory Restock / Upsert
app.post('/api/admin/restock', async (req, res) => {
  const { asset_code, name, category, quantity } = req.body;

  if (!asset_code || !name) {
    return res.status(400).json({ error: 'Asset code and title are required.' });
  }

  const addQty = parseInt(quantity, 10) || 1;

  try {
    const { data: existingItem } = await supabase
      .from('inventory')
      .select('*')
      .eq('asset_code', asset_code.trim().toUpperCase())
      .maybeSingle();

    if (existingItem) {
      const { data, error } = await supabase
        .from('inventory')
        .update({
          name: name.trim(),
          category: category || existingItem.category,
          quantity: existingItem.quantity + addQty
        })
        .eq('id', existingItem.id)
        .select();

      if (error) throw error;
      return res.json({ message: `Incremented ${existingItem.name} stock.`, item: data[0] });
    } else {
      const { data, error } = await supabase
        .from('inventory')
        .insert([{
          asset_code: asset_code.trim().toUpperCase(),
          name: name.trim(),
          category: category || 'General Asset',
          quantity: addQty
        }])
        .select();

      if (error) throw error;
      return res.status(201).json({ message: 'New equipment registered.', item: data[0] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live Statistics & Telemetry Summary
app.get('/api/admin/statistics', async (req, res) => {
  try {
    const { data: logs, error: logsErr } = await supabase
      .from('borrow_logs')
      .select('*')
      .order('id', { ascending: false });

    if (logsErr) throw logsErr;

    const { data: inventory, error: invErr } = await supabase
      .from('inventory')
      .select('*');

    if (invErr) throw invErr;

    const totalBorrowed = (logs || []).filter(l => (l.status || '').toUpperCase() === 'BORROWED').length;
    const totalReturned = (logs || []).filter(l => (l.status || '').toUpperCase() === 'RETURNED').length;
    const damagedCount = (logs || []).filter(l => l.item_condition === 'Damaged').length;

    res.json({
      totalBorrowed,
      totalReturned,
      damagedCount,
      recentLogs: logs || [],
      inventorySummary: inventory || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. DESKTOP CUSTODIAN TERMINAL (DISPATCH/RETURN)
// ==========================================

// Custodian Physical Dispatch Handover
app.post('/api/dispatcher/handover', async (req, res) => {
  const { ticket_id, asset_code, borrower_name, quantity, custodian_id } = req.body;

  if (!asset_code || !borrower_name) {
    return res.status(400).json({ error: 'Asset tag and borrower identification required.' });
  }

  const outQty = parseInt(quantity, 10) || 1;

  try {
    const { data: item, error: itemErr } = await supabase
      .from('inventory')
      .select('*')
      .eq('asset_code', asset_code.trim().toUpperCase())
      .single();

    if (itemErr || !item) {
      return res.status(404).json({ error: 'Equipment tag not found in inventory.' });
    }

    if (item.quantity < outQty) {
      return res.status(400).json({ error: `Insufficient physical stock (Available: ${item.quantity}).` });
    }

    // Decrement inventory stock
    await supabase
      .from('inventory')
      .update({ quantity: item.quantity - outQty })
      .eq('id', item.id);

    // Record borrow audit log
    const { data: log, error: logErr } = await supabase
      .from('borrow_logs')
      .insert([{
        ticket_id: ticket_id || null,
        asset_code: item.asset_code,
        borrower_name,
        quantity: outQty,
        status: 'BORROWED',
        released_at: new Date().toISOString(),
        custodian_id: custodian_id || 'Counter-Custodian'
      }])
      .select();

    if (logErr) throw logErr;

    // Update requisition ticket if associated
    if (ticket_id) {
      await supabase
        .from('requisition_requests')
        .update({ status: 'CLAIMED' })
        .eq('id', ticket_id);
    }

    res.status(201).json({ message: `Physical dispatch completed for ${item.name}.`, log: log[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Custodian Return Processing & Condition Grading
app.post('/api/dispatcher/return', async (req, res) => {
  const { log_id, item_condition, remarks, custodian_id } = req.body;

  if (!log_id) {
    return res.status(400).json({ error: 'Log ID is required to process return.' });
  }

  try {
    const { data: log, error: logErr } = await supabase
      .from('borrow_logs')
      .select('*')
      .eq('id', log_id)
      .single();

    if (logErr || !log) {
      return res.status(404).json({ error: 'Active borrow record not found.' });
    }

    if ((log.status || '').toUpperCase() === 'RETURNED') {
      return res.status(400).json({ error: 'This equipment has already been marked as returned.' });
    }

    // Update log entry status to RETURNED
    const { error: updateLogErr } = await supabase
      .from('borrow_logs')
      .update({
        status: 'RETURNED',
        returned_at: new Date().toISOString(),
        item_condition: item_condition || 'Good',
        remarks: remarks || 'Returned on schedule',
        custodian_id: custodian_id || 'Counter-Custodian'
      })
      .eq('id', log_id);

    if (updateLogErr) throw updateLogErr;

    // Increment inventory quantity back
    const { data: inv } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('asset_code', log.asset_code)
      .single();

    if (inv) {
      await supabase
        .from('inventory')
        .update({ quantity: inv.quantity + (log.quantity || 1) })
        .eq('asset_code', log.asset_code);
    }

    res.json({ message: `Asset ${log.asset_code} successfully returned and restocked.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server Initialization
app.listen(PORT, () => {
  console.log(`SmartTrack Backend server listening on port ${PORT}`);
});
