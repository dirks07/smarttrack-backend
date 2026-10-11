require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');

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

app.get('/api/public/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || !pendingBorrowerTokens.has(token)) {
      return res.status(400).send(`<h2>Link Expired or Invalid</h2>`);
    }

    const pending = pendingBorrowerTokens.get(token);
    if (Date.now() > pending.expiresAt) {
      pendingBorrowerTokens.delete(token);
      return res.status(400).send(`<h2>Token Expired</h2>`);
    }

    const { error: insertError } = await supabase.from('borrowers').insert([{
      full_name: pending.full_name,
      identifier: pending.identifier,
      email: pending.email,
      role: pending.role,
      department: pending.department,
      password: pending.password,
      created_at: new Date().toISOString()
    }]);

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
// 5. INVENTORY & DEDUCTION / RESTOCK
// -----------------------------------------------------------------
app.get('/api/public/inventory', async (req, res) => {
  const { data, error } = await supabase.from('inventory').select('*').order('id', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Single Equipment Item Query
app.get('/api/inventory/item', async (req, res) => {
  try {
    const { tag, name } = req.query;
    let query = supabase.from('inventory').select('*');

    if (tag) {
      query = query.or(`asset_tag.eq.${tag},asset_code.eq.${tag}`);
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

    return res.json(data[0]);
  } catch (err) {
    console.error('Fetch live inventory error:', err);
    return res.status(500).json({ error: 'Failed to retrieve item stock' });
  }
});

// Admin Add or Restock Equipment
app.post('/api/admin/inventory/add', async (req, res) => {
  try {
    const { asset_tag, name, category, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    if (!name || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Item name and valid quantity are required.' });
    }

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

// DEDUCT FROM INVENTORY UPON DISPATCH
app.post('/api/admin/inventory/deduct', async (req, res) => {
  try {
    const { asset_tag, item_name, item_id, quantity, ticket_id } = req.body;
    const qtyToDeduct = parseInt(quantity, 10) || 1;

    let targetItem = null;

    // 1. Locate item in database
    if (item_id) {
      const { data: byId } = await supabase.from('inventory').select('*').eq('id', item_id).maybeSingle();
      targetItem = byId;
    }
    if (!targetItem && asset_tag) {
      const { data: byTag } = await supabase.from('inventory').select('*')
        .or(`asset_tag.eq.${asset_tag},asset_code.eq.${asset_tag}`)
        .maybeSingle();
      targetItem = byTag;
    }
    if (!targetItem && item_name) {
      const { data: byName } = await supabase.from('inventory').select('*')
        .ilike('name', `%${item_name.trim()}%`)
        .limit(1);
      if (byName && byName.length > 0) targetItem = byName[0];
    }

    if (!targetItem) {
      return res.status(404).json({ error: 'Item not found in catalog.' });
    }

    // 2. Compute stock
    const currentStock = parseInt(targetItem.quantity, 10) || 0;
    const newStock = Math.max(0, currentStock - qtyToDeduct);

    // 3. Update inventory catalog
    const { error: updateErr } = await supabase
      .from('inventory')
      .update({ 
        quantity: newStock,
        available_quantity: newStock 
      })
      .eq('id', targetItem.id);

    if (updateErr) throw updateErr;

    // 4. Update request status to CLAIMED
    if (ticket_id) {
      await supabase
        .from('requests')
        .update({ 
          borrowed_at: new Date().toISOString(),
          status: 'CLAIMED' 
        })
        .eq('id', ticket_id);
    }

    return res.json({ 
      success: true, 
      message: `Dispatched ${qtyToDeduct} unit(s).`,
      remaining_stock: newStock 
    });

  } catch (err) {
    console.error('Deduction error:', err);
    return res.status(500).json({ error: 'Server error deducting catalog quantity.' });
  }
});

// -----------------------------------------------------------------
// 6. REQUISITIONS & ITEM TRACKING / AUDIT
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

app.get('/api/admin/all-requests', async (req, res) => {
  const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

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
    const { item_condition, admin_remarks } = req.body;

    if (!item_condition) {
      return res.status(400).json({ error: 'Please specify if the item is in good or bad condition.' });
    }

    const { data: ticket, error: fetchErr } = await supabase.from('requests').select('*').eq('id', id).single();
    if (fetchErr || !ticket) return res.status(404).json({ error: 'Ticket not found.' });

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

    // Restore inventory stock if item is returned in good condition
    if (ticket.item_id && item_condition.includes('Good')) {
      const { data: inv } = await supabase.from('inventory').select('*').eq('id', ticket.item_id).maybeSingle();
      if (inv) {
        const restored = (parseInt(inv.quantity, 10) || 0) + parseInt(ticket.quantity || 1, 10);
        await supabase.from('inventory')
          .update({ 
            quantity: restored, 
            available_quantity: restored 
          })
          .eq('id', inv.id);
      }
    }

    res.json({ success: true, ticket: updatedTicket, message: 'Item returned and stock updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to complete return audit.' });
  }
});

// PDF Report Generator
app.get('/api/admin/records-pdf', async (req, res) => {
  try {
    const { data: tickets, error } = await supabase.from('requests').select('*').order('id', { ascending: false });
    if (error) throw error;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="SmartTrack_Audit_Records.pdf"');

    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    doc.pipe(res);

    doc.rect(0, 0, 595.28, 65).fill('#0b111e');
    doc.fillColor('#ffffff').fontSize(16).text('SmartTrack Command Center', 36, 22);
    doc.fillColor('#34d399').fontSize(10).text('Live Database Inventory & Audit Report', 36, 42);
    doc.fillColor('#94a3b8').fontSize(8).text(`Date: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`, 380, 42);

    doc.moveDown(3);

    let totalBorrowed = 0, totalReturned = 0, totalPending = 0;
    (tickets || []).forEach(t => {
      const qty = parseInt(t.quantity || 1, 10);
      if (t.status === 'APPROVED' || t.status === 'CLAIMED' || t.status === 'RETURNED') totalBorrowed += qty;
      if (t.status === 'RETURNED') totalReturned += qty;
      if (t.status === 'PENDING') totalPending += qty;
    });

    doc.fillColor('#0f172a').fontSize(11).text('EQUIPMENT SUMMARY:', 36, 85);
    doc.fontSize(9)
       .text(`• Total Dispatched (Claimed/Returned): ${totalBorrowed}`, 46, 102)
       .text(`• Total Returned (Good/Audited): ${totalReturned}`, 46, 116)
       .text(`• Currently in Custody: ${totalBorrowed - totalReturned}`, 46, 130)
       .text(`• Pending Requests: ${totalPending}`, 46, 144);

    let y = 175;
    doc.rect(36, y - 5, 523, 20).fill('#1e293b');
    doc.fillColor('#ffffff').fontSize(8);
    doc.text('ID', 42, y);
    doc.text('BORROWER', 75, y);
    doc.text('ITEM', 190, y);
    doc.text('QTY', 315, y);
    doc.text('DATE BORROWED', 345, y);
    doc.text('DATE RETURNED', 445, y);
    doc.text('STATUS', 525, y);

    y += 24;

    const formatDate = (raw) => {
      if (!raw) return '—';
      const d = new Date(raw);
      return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    (tickets || []).forEach(t => {
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

// HTML Records Viewer
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
    .status-APPROVED, .status-CLAIMED { background: #064e3b; color: #34d399; }
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
      <div class="metric-card"><div class="metric-label">Dispatched Items</div><div class="metric-val" style="color:#f59e0b;" id="count-borrowed">0</div></div>
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
          if (t.status === 'APPROVED' || t.status === 'CLAIMED' || t.status === 'RETURNED') borrowed += q;
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

// START SERVER
app.listen(PORT, () => console.log(`SmartTrack server active on port ${PORT}`));
