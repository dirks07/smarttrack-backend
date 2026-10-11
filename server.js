require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------
// 1. SUPABASE INITIALIZATION
// -----------------------------------------------------------------
let rawUrl = (process.env.SUPABASE_URL || 'https://imjdhuczyqaxhifyucbo.supabase.co').trim().replace(/^["']|["']$/g, '');
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

const pendingBorrowerTokens = new Map();
const pendingAdminTokens = new Map();

// Helper: EmailJS HTTPS Dispatcher
async function sendVerificationEmail({ toEmail, fullName, verificationUrl, portalType }) {
  const serviceId = (process.env.EMAILJS_SERVICE_ID || '').replace(/^["']|["']$/g, '').trim();
  const templateId = (process.env.EMAILJS_TEMPLATE_ID || '').replace(/^["']|["']$/g, '').trim();
  const publicKey = (process.env.EMAILJS_PUBLIC_KEY || '').replace(/^["']|["']$/g, '').trim();
  const privateKey = (process.env.EMAILJS_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').trim();

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EmailJS keys are missing on Render dashboard environment.');
  }

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_email: toEmail,
      to_name: `${fullName} (${portalType})`,
      verification_url: verificationUrl
    }
  };

  if (privateKey) {
    payload.accessToken = privateKey;
  }

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`EmailJS Error: ${errorText}`);
  }
}

// -----------------------------------------------------------------
// 2. HEALTH CHECK
// -----------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// -----------------------------------------------------------------
// 3. BORROWER AUTHENTICATION (Mobile)
// -----------------------------------------------------------------
app.post('/api/public/register', async (req, res) => {
  try {
    const { full_name, identifier, email, role, department, password } = req.body;
    if (!full_name || !identifier || !email || !password) {
      return res.status(400).json({ error: 'All fields including email are required.' });
    }

    const { data: existingUser } = await supabase
      .from('borrowers')
      .select('id')
      .or(`identifier.eq.${identifier},email.eq.${email}`)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ error: 'Borrower ID or Email already exists.' });
    }

    const token = 'b_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    pendingBorrowerTokens.set(token, {
      full_name, identifier, email, role: role || 'Student', department: department || 'BSIT', password,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const verificationUrl = `https://smarttrack-backend-v6l4.onrender.com/api/public/verify-email?token=${token}`;
    await sendVerificationEmail({ toEmail: email, fullName: full_name, verificationUrl, portalType: 'Student Borrower' });

    res.json({ success: true, message: `Verification email sent to ${email}.` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Registration failed.' });
  }
});
// POST /api/admin/inventory/deduct
app.post('/api/admin/inventory/deduct', async (req, res) => {
  try {
    const { asset_tag, item_name, quantity, ticket_id } = req.body;
    const qtyToDeduct = parseInt(quantity, 10) || 1;

    // 1. Fetch current equipment from database by asset_tag or name
    let query = supabase.from('inventory').select('*');
    if (asset_tag) {
      query = query.eq('asset_tag', asset_tag);
    } else {
      query = query.ilike('name', `%${item_name}%`);
    }

    const { data: items, error: fetchErr } = await query;
    if (fetchErr || !items || items.length === 0) {
      return res.status(404).json({ error: 'Item not found in catalog.' });
    }

    const currentItem = items[0];
    const currentStock = parseInt(currentItem.quantity, 10) || 0;

    if (currentStock < qtyToDeduct) {
      return res.status(400).json({ 
        error: `Insufficient stock! Catalog only has ${currentStock} available.` 
      });
    }

    const newStock = currentStock - qtyToDeduct;

    // 2. Deduct quantity in inventory catalog
    const { error: updateErr } = await supabase
      .from('inventory')
      .update({ quantity: newStock })
      .eq('id', currentItem.id);

    if (updateErr) throw updateErr;

    // 3. (Optional) Record the borrowed_at timestamp on the ticket
    if (ticket_id) {
      await supabase
        .from('requests')
        .update({ 
          borrowed_at: new Date().toISOString(),
          status: 'APPROVED' // or 'DISPATCHED'
        })
        .eq('id', ticket_id);
    }

    return res.json({ 
      success: true, 
      message: `Successfully dispatched. Catalog updated: ${currentItem.name} stock reduced from ${currentStock} to ${newStock}.`,
      remaining_stock: newStock 
    });

  } catch (err) {
    console.error('Deduction error:', err);
    return res.status(500).json({ error: 'Server error deducting catalog quantity.' });
  }
});
// GET /api/inventory/item?tag=... or ?name=...
app.get('/api/inventory/item', async (req, res) => {
  try {
    const { tag, name } = req.query;
    let query = supabase.from('inventory').select('*');

    if (tag) {
      query = query.eq('asset_tag', tag);
    } else if (name) {
      query = query.ilike('name', `%${name}%`);
    } else {
      return res.status(400).json({ error: 'Provide tag or name' });
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Item not found in catalog' });
    }

    // Return the single matched equipment row
    return res.json(data[0]);
  } catch (err) {
    console.error('Fetch live inventory error:', err);
    return res.status(500).json({ error: 'Failed to retrieve item stock' });
  }
});

    if (insertError) throw insertError;
    pendingBorrowerTokens.delete(token);

    res.send(`<body style="font-family:sans-serif;background:#0b0f19;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;">
      <div style="background:#131b2e;padding:36px;border-radius:16px;text-align:center;">
        <h2 style="color:#10b981;">Account Activated!</h2>
        <p>You can now sign in on the mobile app.</p>
      </div>
    </body>`);
  } catch (error) {
    res.status(500).send(`Activation failed: ${error.message}`);
  }
});

app.post('/api/public/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const { data: user, error } = await supabase
      .from('borrowers')
      .select('*')
      .eq('identifier', identifier)
      .eq('password', password)
      .maybeSingle();

    if (error || !user) return res.status(401).json({ error: 'Invalid ID Number or Password.' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------
// 4. ADMIN AUTHENTICATION (Desktop)
// -----------------------------------------------------------------
app.post('/api/admin/register', async (req, res) => {
  try {
    const { full_name, identifier, email, role, department, password } = req.body;
    if (!full_name || !identifier || !email || !password) {
      return res.status(400).json({ error: 'All fields including email are required.' });
    }

    const { data: existingAdmin } = await supabase
      .from('admins')
      .select('id')
      .or(`identifier.eq.${identifier},email.eq.${email}`)
      .maybeSingle();

    if (existingAdmin) {
      return res.status(400).json({ error: 'Admin Staff ID or Email already exists.' });
    }

    const token = 'a_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    pendingAdminTokens.set(token, {
      full_name, identifier, email, role: role || 'Admin', department: department || 'Custodian', password,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const verificationUrl = `https://smarttrack-backend-v6l4.onrender.com/api/admin/verify-email?token=${token}`;
    await sendVerificationEmail({ toEmail: email, fullName: full_name, verificationUrl, portalType: 'Administrator' });

    res.json({ success: true, message: `Admin activation link sent to ${email}.` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Admin registration failed.' });
  }
});

app.get('/api/admin/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || !pendingAdminTokens.has(token)) {
      return res.status(400).send(`<h2>Link Expired or Invalid</h2>`);
    }

    const pending = pendingAdminTokens.get(token);
    if (Date.now() > pending.expiresAt) {
      pendingAdminTokens.delete(token);
      return res.status(400).send(`<h2>Token Expired</h2>`);
    }

    const { error: insertError } = await supabase.from('admins').insert([{
      full_name: pending.full_name,
      identifier: pending.identifier,
      username: pending.identifier,
      email: pending.email,
      role: pending.role,
      department: pending.department,
      password: pending.password,
      created_at: new Date().toISOString()
    }]);

    if (insertError) throw insertError;
    pendingAdminTokens.delete(token);

    res.send(`<body style="font-family:sans-serif;background:#0b0f19;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;">
      <div style="background:#131b2e;padding:36px;border-radius:16px;text-align:center;">
        <h2 style="color:#38bdf8;">Administrator Activated!</h2>
        <p>You can now sign in to the Desktop Command Center.</p>
      </div>
    </body>`);
  } catch (error) {
    res.status(500).send(`Admin activation failed: ${error.message}`);
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const { data: admin, error } = await supabase
      .from('admins')
      .select('*')
      .or(`identifier.eq.${identifier},username.eq.${identifier}`)
      .eq('password', password)
      .maybeSingle();

    if (error || !admin) return res.status(401).json({ error: 'Invalid Administrator Credentials.' });
    res.json({ success: true, user: admin });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------
// 5. INVENTORY & ADD/RESTOCK ITEMS
// -----------------------------------------------------------------
app.get('/api/public/inventory', async (req, res) => {
  const { data, error } = await supabase.from('inventory').select('*').order('id', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Admin Add or Restock Equipment
app.post('/api/admin/inventory/add', async (req, res) => {
  try {
    const { asset_tag, name, category, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    if (!name || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Item name and valid quantity are required.' });
    }

    // Check if asset tag already exists to restock counts
    if (asset_tag) {
      const { data: existing } = await supabase
        .from('inventory')
        .select('*')
        .eq('asset_tag', asset_tag)
        .maybeSingle();

      if (existing) {
        const updatedQty = existing.quantity + qty;
        const updatedAvail = (existing.available_quantity || existing.quantity) + qty;

        const { data: updated, error: updateErr } = await supabase
          .from('inventory')
          .update({ quantity: updatedQty, available_quantity: updatedAvail })
          .eq('id', existing.id)
          .select()
          .single();

        if (updateErr) throw updateErr;
        return res.json({ success: true, item: updated, message: `Restocked ${qty} units of ${name}.` });
      }
    }

    // Insert as new inventory item
    const { data: newItem, error: insertErr } = await supabase
      .from('inventory')
      .insert([{
        asset_tag: asset_tag || `TAG-${Date.now().toString(36).toUpperCase()}`,
        name,
        category: category || 'Equipment',
        quantity: qty,
        available_quantity: qty,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertErr) throw insertErr;
    res.json({ success: true, item: newItem, message: `Successfully added ${name} to inventory.` });
  } catch (err) {
    console.error('Inventory error:', err);
    res.status(500).json({ error: err.message || 'Failed to add item.' });
  }
});

// -----------------------------------------------------------------
// 6. REQUISITIONS & ITEM TRACKING / CONDITION AUDIT
// -----------------------------------------------------------------
app.post('/api/public/requests', async (req, res) => {
  const { item_id, item_name, quantity, purpose, requester_name, identifier, role, department } = req.body;
  const { data, error } = await supabase.from('requests').insert([{
    item_id, item_name, quantity: parseInt(quantity, 10), purpose, requester_name, identifier,
    role: role || 'Student', department: department || 'BSIT', status: 'PENDING', created_at: new Date().toISOString()
  }]).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, ticket: data });
});

app.get('/api/public/my-requests', async (req, res) => {
  const { identifier } = req.query;
  const { data, error } = await supabase.from('requests').select('*').eq('identifier', identifier).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Admin get all requisitions and tracking records
app.get('/api/admin/all-requests', async (req, res) => {
  const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Admin Approve / Reject (Sets borrowed timestamp upon approval)
app.patch('/api/admin/requests/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const updateFields = { status: status.toUpperCase() };
  if (status.toUpperCase() === 'APPROVED') {
    updateFields.borrowed_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from('requests').update(updateFields).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, ticket: data });
});

// Admin Return Inspection & Condition Audit
app.post('/api/admin/requests/:id/return', async (req, res) => {
  try {
    const { id } = req.params;
    const { item_condition, admin_remarks } = req.body; // 'Good Condition' or 'Bad Condition / Damaged'

    if (!item_condition) {
      return res.status(400).json({ error: 'Please specify if the item is in good or bad condition.' });
    }

    const { data: ticket, error: fetchErr } = await supabase.from('requests').select('*').eq('id', id).single();
    if (fetchErr || !ticket) return res.status(404).json({ error: 'Ticket not found.' });

    // Update the request with return timestamp and manual condition inspection
    const { data: updatedTicket, error: updateErr } = await supabase
      .from('requests')
      .update({
        status: 'RETURNED',
        returned_at: new Date().toISOString(),
        item_condition,
        admin_remarks: admin_remarks || ''
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Restore available inventory quantity if condition is good
    if (ticket.item_id && item_condition.includes('Good')) {
      const { data: inv } = await supabase.from('inventory').select('*').eq('id', ticket.item_id).maybeSingle();
      if (inv) {
        await supabase.from('inventory')
          .update({ available_quantity: (inv.available_quantity || inv.quantity) + ticket.quantity })
          .eq('id', inv.id);
      }
    }

    res.json({ success: true, ticket: updatedTicket, message: 'Item returned and condition logged.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to complete return audit.' });
  }
});
const PDFDocument = require('pdfkit');

app.get('/api/admin/records-pdf', async (req, res) => {
  try {
    // 1. Kuhanin ang totoong data mula sa database
    let tickets = [];
    if (typeof supabase !== 'undefined') {
      const { data, error } = await supabase.from('requests').select('*').order('id', { ascending: false });
      if (error) throw error;
      tickets = data || [];
    }

    // 2. HTTP Headers para mismong PDF ang kilalanin ng cellphone browser
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="SmartTrack_Audit_Records.pdf"');

    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    doc.pipe(res);

    // Header Design
    doc.rect(0, 0, 595.28, 65).fill('#0b111e');
    doc.fillColor('#ffffff').fontSize(16).text('SmartTrack Command Center', 36, 22);
    doc.fillColor('#34d399').fontSize(10).text('Live Database Inventory & Audit Report', 36, 42);
    doc.fillColor('#94a3b8').fontSize(8).text(`Petsa: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`, 380, 42);

    doc.moveDown(3);

    // Kalkulasyon ng Summary Metrics
    let totalBorrowed = 0;
    let totalReturned = 0;
    let totalPending = 0;

    tickets.forEach(t => {
      const qty = parseInt(t.quantity || 1, 10);
      if (t.status === 'APPROVED' || t.status === 'RETURNED') totalBorrowed += qty;
      if (t.status === 'RETURNED') totalReturned += qty;
      if (t.status === 'PENDING') totalPending += qty;
    });

    // Summary Box
    doc.fillColor('#0f172a').fontSize(11).text('BUOD NG MGA KAGAMITAN:', 36, 85);
    doc.fontSize(9)
       .text(`• Kabuuang Nahiram (Approved & Returned): ${totalBorrowed}`, 46, 102)
       .text(`• Kabuuang Nabalik (Good / Audited): ${totalReturned}`, 46, 116)
       .text(`• Kasalukuyang Hawak Pa ng Humiram: ${totalBorrowed - totalReturned}`, 46, 130)
       .text(`• Nakabinbing Kahilingan (Pending): ${totalPending}`, 46, 144);

    // Table Header
    let y = 175;
    doc.rect(36, y - 5, 523, 20).fill('#1e293b');
    doc.fillColor('#ffffff').fontSize(8);
    doc.text('ID', 42, y);
    doc.text('HUMIRAM', 75, y);
    doc.text('ITEM', 190, y);
    doc.text('QTY', 315, y);
    doc.text('PETSA NAHIRAM', 345, y);
    doc.text('PETSA NABALIK', 445, y);
    doc.text('STATUS', 525, y);

    y += 24;

    const formatDate = (raw) => {
      if (!raw) return '—';
      const d = new Date(raw);
      return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    // Table Rows
    tickets.forEach(t => {
      if (y > 770) {
        doc.addPage();
        y = 40;
      }

      doc.fillColor('#0f172a').fontSize(8);
      doc.text(`#${t.id}`, 42, y);
      doc.text(String(t.requester_name || 'N/A').slice(0, 18), 75, y);
      doc.text(String(t.item_name || 'Item').slice(0, 22), 190, y);
      doc.text(String(t.quantity || 1), 315, y);
      doc.text(formatDate(t.borrowed_at), 345, y);
      doc.text(formatDate(t.returned_at), 445, y);
      doc.text(String(t.status || ''), 525, y);

      doc.moveTo(36, y + 12).lineTo(559, y + 12).stroke('#e2e8f0');
      y += 18;
    });

    doc.end();
  } catch (err) {
    res.status(500).send('Error generating PDF: ' + err.message);
  }
});
// Serves records.html directly from Render
app.get('/records', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SmartTrack Live Audit Records</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #070d1e; color: #e2e8f0; min-height: 100vh; padding: 20px 14px; }
    .container { max-width: 650px; margin: 0 auto; }
    .header-box { background: #0b1329; border: 1px solid #1e293b; border-radius: 18px; padding: 20px; text-align: center; margin-bottom: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.35); }
    .header-box h1 { font-size: 1.35rem; color: #fff; margin-bottom: 6px; }
    .header-box p { font-size: 0.8rem; color: #94a3b8; }
    .btn-export { background: #059669; border: none; color: #fff; padding: 10px 18px; border-radius: 10px; font-size: 0.82rem; font-weight: 700; cursor: pointer; margin-top: 14px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 20px; }
    .metric-card { background: #0b1329; border: 1px solid #1e293b; border-radius: 14px; padding: 14px; text-align: center; }
    .metric-label { font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
    .metric-val { font-size: 1.5rem; font-weight: 800; margin-top: 4px; }
    .record-card { background: #0b1329; border: 1px solid #1e293b; border-radius: 14px; padding: 16px; margin-bottom: 12px; }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    .borrower-name { font-size: 1rem; font-weight: 700; color: #fff; }
    .ticket-badge { background: #1e293b; border: 1px solid #334155; padding: 2px 7px; border-radius: 6px; font-size: 0.75rem; color: #cbd5e1; }
    .dates-box { background: #070d1e; border: 1px solid #1e293b; border-radius: 10px; padding: 10px; margin: 10px 0; font-size: 0.78rem; display: flex; flex-direction: column; gap: 6px; }
    .date-row { display: flex; justify-content: space-between; }
    .status-pill { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 0.7rem; font-weight: 700; }
    .status-APPROVED { background: #064e3b; color: #34d399; }
    .status-RETURNED { background: #1e3a8a; color: #93c5fd; }
    .status-PENDING { background: #78350f; color: #fde047; }
    .status-REJECTED { background: #7f1d1d; color: #fecaca; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-box">
      <h1>SmartTrack Live Audit Records</h1>
      <p id="time-label">Syncing directly with live database...</p>
      <button type="button" class="btn-export" onclick="downloadPdf()">Save Records as PDF</button>
    </div>

    <div class="metrics-grid">
      <div class="metric-card"><div class="metric-label">Borrowed Items</div><div class="metric-val" style="color:#f59e0b;" id="count-borrowed">0</div></div>
      <div class="metric-card"><div class="metric-label">Returned Items</div><div class="metric-val" style="color:#10b981;" id="count-returned">0</div></div>
      <div class="metric-card"><div class="metric-label">Active / In Custody</div><div class="metric-val" style="color:#38bdf8;" id="count-active">0</div></div>
      <div class="metric-card"><div class="metric-label">Total Transactions</div><div class="metric-val" style="color:#fff;" id="count-total">0</div></div>
    </div>

    <div id="records-list"><div style="text-align:center; color:#64748b; padding:40px 0;">Loading items...</div></div>
  </div>

  <script>
    let tickets = [];

    function formatTime(d) {
      if (!d) return '—';
      const parsed = new Date(d);
      return isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-PH', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    }

    async function loadData() {
      try {
        const res = await fetch('/api/admin/all-requests');
        tickets = await res.json();
        document.getElementById('time-label').innerText = 'As of: ' + new Date().toLocaleString('en-PH');

        let borrowed = 0, returned = 0;
        tickets.forEach(t => {
          const q = parseInt(t.quantity || 1, 10);
          if (t.status === 'APPROVED' || t.status === 'RETURNED') borrowed += q;
          if (t.status === 'RETURNED') returned += q;
        });

        document.getElementById('count-borrowed').innerText = borrowed;
        document.getElementById('count-returned').innerText = returned;
        document.getElementById('count-active').innerText = borrowed - returned;
        document.getElementById('count-total').innerText = tickets.length;

        const list = document.getElementById('records-list');
        if (tickets.length === 0) {
          list.innerHTML = '<div style="text-align:center; color:#64748b; padding:30px;">No transaction records found.</div>';
          return;
        }

        list.innerHTML = tickets.map(t => \`
          <div class="record-card">
            <div class="card-top">
              <div>
                <div class="borrower-name">\${t.requester_name || 'N/A'}</div>
                <div style="font-size:0.75rem; color:#94a3b8;">\${t.role || 'User'} • \${t.identifier || 'No ID'}</div>
              </div>
              <span class="ticket-badge">#\${t.id}</span>
            </div>
            <div style="font-size:0.85rem; margin:8px 0;">
              Item: <strong style="color:#fff;">\${t.item_name}</strong> (x\${t.quantity || 1})
            </div>
            <div class="dates-box">
              <div class="date-row"><span style="color:#94a3b8;">Date Borrowed:</span><strong style="color:#fff;">\${formatTime(t.borrowed_at)}</strong></div>
              <div class="date-row"><span style="color:#94a3b8;">Date Returned:</span><strong style="color:#fff;">\${formatTime(t.returned_at)}</strong></div>
            </div>
            <span class="status-pill status-\${t.status}">\${t.status}</span>
          </div>
        \`).join('');
      } catch (err) {
        document.getElementById('records-list').innerHTML = '<div style="color:#ef4444; text-align:center; padding:30px;">Failed to load records: ' + err.message + '</div>';
      }
    }

    function downloadPdf() {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      doc.setFillColor(11, 17, 30);
      doc.rect(0, 0, 612, 60, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.text('SmartTrack Inventory Audit Report', 30, 36);

      const rows = tickets.map(t => [
        '#' + t.id,
        t.requester_name || 'N/A',
        t.item_name,
        t.quantity || 1,
        formatTime(t.borrowed_at),
        formatTime(t.returned_at),
        t.status
      ]);

      doc.autoTable({
        startY: 85,
        margin: { left: 30, right: 30 },
        head: [['ID', 'Borrower', 'Item', 'Qty', 'Date Borrowed', 'Date Returned', 'Status']],
        body: rows,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
        styles: { fontSize: 8, cellPadding: 4 }
      });
      doc.save('SmartTrack_Records_' + Date.now() + '.pdf');
    }

    window.onload = loadData;
  </script>
</body>
</html>`);
});
app.listen(PORT, () => console.log(`SmartTrack server active on port ${PORT}`));
const PDFDocument = require('pdfkit');

// ENDPOINT PARA SA DIRECT PDF DOWNLOAD/VIEW PAG-SCAN NG QR CODE
app.get('/api/admin/records-pdf', async (req, res) => {
  try {
    // 1. Kuhanin ang totoong data mula sa iyong database (hal. Supabase / PostgreSQL)
    // Palitan ito base sa query method mo (hal. const { data: tickets } = await supabase.from('requests').select('*'))
    const { data: tickets, error } = await supabase
      .from('requests')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;

    // 2. I-set ang response headers para mismong PDF file ang mabuksan sa browser
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="SmartTrack_Item_Records.pdf"');

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    // 3. Header & Pamagat
    doc.fontSize(18).text('SmartTrack Command Center', { align: 'center' });
    doc.fontSize(11).fillColor('#64748b').text('Live Inventory & Custodian Item Audit Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Petsa ng Pagkagawa: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`, { align: 'right' });
    doc.moveDown();

    // 4. Kalkulahin ang eksaktong bilang mula sa database
    let totalBorrowed = 0;
    let totalReturned = 0;
    let totalPending = 0;

    (tickets || []).forEach(t => {
      const q = parseInt(t.quantity || 1, 10);
      if (t.status === 'APPROVED' || t.status === 'RETURNED') totalBorrowed += q;
      if (t.status === 'RETURNED') totalReturned += q;
      if (t.status === 'PENDING') totalPending += q;
    });

    // Summary Box
    doc.fillColor('#000').fontSize(11).text('BUOD NG MGA KAGAMITAN:', { underline: true });
    doc.fontSize(10)
       .text(`• Kabuuang Nahiram (Approved/Returned): ${totalBorrowed}`)
       .text(`• Kabuuang Nabalik (Good/Audited): ${totalReturned}`)
       .text(`• Kasalukuyang Hawak Pa ng Humiram: ${totalBorrowed - totalReturned}`)
       .text(`• Nakabinbing Kahilingan (Pending): ${totalPending}`);
    doc.moveDown();

    // 5. Talaan ng mga Transaksyon (Table Header)
    doc.fontSize(10).fillColor('#000').text('MGA DETALYE NG TRANSACTION:', { underline: true });
    doc.moveDown(0.5);

    const startX = 40;
    let currentY = doc.y;

    doc.fontSize(8).fillColor('#334155');
    doc.text('TICKET', startX, currentY);
    doc.text('HUMIRAM', startX + 50, currentY);
    doc.text('ITEM', startX + 150, currentY);
    doc.text('QTY', startX + 270, currentY);
    doc.text('PETSA NAHIRAM', startX + 300, currentY);
    doc.text('PETSA NABALIK', startX + 410, currentY);
    doc.text('STATUS', startX + 490, currentY);

    doc.moveTo(startX, currentY + 12).lineTo(560, currentY + 12).stroke('#cbd5e1');
    currentY += 18;

    // Helper formatter para sa tumpak na petsa
    const formatLiveDate = (d) => {
      if (!d) return '—';
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    // 6. Paglagay ng bawat row galing sa database
    (tickets || []).forEach(t => {
      if (currentY > 750) { // Page break kung mahaba ang listahan
        doc.addPage();
        currentY = 40;
      }

      doc.fillColor('#0f172a').fontSize(8);
      doc.text(`#${t.id}`, startX, currentY);
      doc.text(String(t.requester_name || 'N/A').slice(0, 18), startX + 50, currentY);
      doc.text(String(t.item_name || 'Item').slice(0, 22), startX + 150, currentY);
      doc.text(String(t.quantity || 1), startX + 270, currentY);
      doc.text(formatLiveDate(t.borrowed_at), startX + 300, currentY);
      doc.text(formatLiveDate(t.returned_at), startX + 410, currentY);
      doc.text(String(t.status || ''), startX + 490, currentY);

      currentY += 16;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Error sa pag-generate ng live database PDF report: ' + err.message);
  }
  // POST /api/admin/inventory/deduct
app.post('/api/admin/inventory/deduct', async (req, res) => {
  try {
    const { asset_tag, item_name, quantity, ticket_id } = req.body;
    const qtyToDeduct = parseInt(quantity, 10) || 1;

    // 1. Find equipment by asset tag or item name
    let query = supabase.from('inventory').select('*');
    if (asset_tag) {
      query = query.eq('asset_tag', asset_tag);
    } else if (item_name) {
      query = query.ilike('name', `%${item_name}%`);
    }

    const { data: items, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    let remainingStock = 'Updated';

    if (items && items.length > 0) {
      const currentItem = items[0];
      const currentStock = parseInt(currentItem.quantity, 10) || 0;
      remainingStock = Math.max(0, currentStock - qtyToDeduct);

      // Deduct quantity in catalog table
      await supabase
        .from('inventory')
        .update({ quantity: remainingStock })
        .eq('id', currentItem.id);
    }

    // 2. Mark ticket as DISPATCHED / APPROVED with borrow timestamp
    if (ticket_id) {
      await supabase
        .from('requests')
        .update({
          status: 'APPROVED',
          borrowed_at: new Date().toISOString()
        })
        .eq('id', ticket_id);
    }

    return res.json({
      success: true,
      remaining_stock: remainingStock
    });
  } catch (err) {
    console.error('Inventory deduct error:', err);
    return res.status(500).json({ error: err.message || 'Error updating inventory' });
  }
});
});
