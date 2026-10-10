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

// 1. Send OTP / Verification Code to Gmail
app.post('/api/auth/send-otp', async (req, res) => {
  const { email, roleType } = req.body; // roleType: 'admin' or 'requester'
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

  const table = roleType === 'admin' ? 'admins' : 'requesters';
  await supabase.from(table).update({ otp_code: otp, otp_expires_at: expiresAt }).eq('email', email.trim());

  try {
    await transporter.sendMail({
      from: '"CDM SmartTrack Security" <no-reply@cdm.edu.ph>',
      to: email,
      subject: 'CDM SmartTrack Verification Code',
      html: `<h3>Your Verification Code</h3><p>Use code <b>${otp}</b> to verify your access. Valid for 10 minutes.</p>`
    });
    res.json({ message: 'Verification code sent to your Gmail.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// 2. Return Item & Condition Assessment (Used by Desktop Dispatcher)
app.post('/api/dispatcher/return', async (req, res) => {
  const { log_id, item_condition, remarks, custodian_id } = req.body;
  try {
    const { data: log, error: fetchErr } = await supabase.from('borrow_logs').select('*').eq('id', log_id).single();
    if (fetchErr || !log) return res.status(404).json({ error: 'Log entry not found.' });

    // Mark as RETURNED
    const { error: updateErr } = await supabase.from('borrow_logs').update({
      status: 'RETURNED',
      returned_at: new Date().toISOString(),
      item_condition: item_condition || 'Good',
      remarks: remarks || 'Returned on schedule',
      custodian_id: custodian_id || 'Desktop-Dispatcher'
    }).eq('id', log_id);

    if (updateErr) throw updateErr;

    // Increment inventory quantity back
    const { data: inv } = await supabase.from('inventory').select('quantity').eq('asset_code', log.asset_code).single();
    if (inv) {
      await supabase.from('inventory').update({ quantity: inv.quantity + (log.quantity || 1) }).eq('asset_code', log.asset_code);
    }

    res.json({ message: `Asset ${log.asset_code} successfully returned and restocked.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Statistic Tracking & Analysis Endpoint (For Admin Website)
app.get('/api/admin/statistics', async (req, res) => {
  try {
    const { data: logs } = await supabase.from('borrow_logs').select('*').order('id', { ascending: false });
    const { data: items } = await supabase.from('inventory').select('*');

    const totalBorrowed = logs ? logs.filter(l => l.status === 'BORROWED').length : 0;
    const totalReturned = logs ? logs.filter(l => l.status === 'RETURNED').length : 0;
    const damagedCount = logs ? logs.filter(l => l.item_condition === 'Damaged').length : 0;

    res.json({
      totalBorrowed,
      totalReturned,
      damagedCount,
      recentLogs: logs || [],
      inventorySummary: items || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
