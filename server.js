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

// Borrower Directory for Email Matching
app.get('/api/admin/borrowers', async (req, res) => {
  const { data, error } = await supabase.from('borrowers').select('identifier, full_name, email');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
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

app.get('/api/inventory/item', async (req, res) => {
  try {
    const { tag, name } = req.query;
    let query = supabase.from('inventory').select('*');

    if (tag) {
      query = query.or(`asset_code.eq.${tag},asset_tag.eq.${tag}`);
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

// Admin Add or Restock Equipment (Populates both asset_code and asset_tag)
app.post('/api/admin/inventory/add', async (req, res) => {
  try {
    const { asset_tag, asset_code, name, category, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    if (!name || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Item name and valid quantity are required.' });
    }

    const resolvedCode = (asset_code || asset_tag || '').trim() || `CDM-EQ-${Date.now().toString(36).toUpperCase()}`;

    const { data: existing } = await supabase
      .from('inventory')
      .select('*')
      .or(`asset_code.eq.${resolvedCode},asset_tag.eq.${resolvedCode}`)
      .maybeSingle();

    if (existing) {
      const updatedQty = (parseInt(existing.quantity, 10) || 0) + qty;
      const updatedAvail = (parseInt(existing.available_quantity, 10) || parseInt(existing.quantity, 10) || 0) + qty;

      const { data: updated, error: updateErr } = await supabase
        .from('inventory')
        .update({ 
          quantity: updatedQty, 
          available_quantity: updatedAvail,
          asset_code: existing.asset_code || resolvedCode
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return res.json({ success: true, item: updated, message: `Restocked ${qty} units of ${name}. New total: ${updatedQty}.` });
    }

    const { data: newItem, error: insertErr } = await supabase
      .from('inventory')
      .insert([{
        asset_code: resolvedCode,
        asset_tag: resolvedCode,
        name: name.trim(),
        category: category || 'Equipment',
        quantity: qty,
        available_quantity: qty,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertErr) throw insertErr;
    res.json({ success: true, item: newItem, message: `Successfully registered ${name} (Stock: ${qty}).` });
  } catch (err) {
    console.error('Inventory error:', err);
    res.status(500).json({ error: err.message || 'Failed to add item.' });
  }
});

// Deduct From Inventory Upon Dispatch
app.post('/api/admin/inventory/deduct', async (req, res) => {
  try {
    const { asset_tag, asset_code, item_name, item_id, quantity, ticket_id } = req.body;
    const qtyToDeduct = parseInt(quantity, 10) || 1;

    let targetItem = null;
    let resolvedItemId = item_id;

    if (ticket_id) {
      const { data: ticketRow } = await supabase
        .from('requests')
        .select('*')
        .eq('id', parseInt(ticket_id, 10))
        .maybeSingle();

      if (ticketRow && ticketRow.item_id) {
        resolvedItemId = ticketRow.item_id;
      }
    }

    if (resolvedItemId) {
      const { data: byId } = await supabase
        .from('inventory')
        .select('*')
        .eq('id', resolvedItemId)
        .maybeSingle();
      targetItem = byId;
    }

    const checkCode = asset_code || asset_tag;
    if (!targetItem && checkCode) {
      const { data: byTag } = await supabase
        .from('inventory')
        .select('*')
        .or(`asset_code.eq.${checkCode},asset_tag.eq.${checkCode}`)
        .maybeSingle();
      targetItem = byTag;
    }

    if (!targetItem && item_name) {
      const { data: byName } = await supabase
        .from('inventory')
        .select('*')
        .ilike('name', `%${item_name.trim()}%`)
        .limit(1);
      if (byName && byName.length > 0) targetItem = byName[0];
    }

    if (!targetItem) {
      return res.status(404).json({ error: 'Item not found in catalog.' });
    }

    const currentStock = parseInt(targetItem.quantity, 10) || 0;
    const newStock = Math.max(0, currentStock - qtyToDeduct);

    const { error: updateErr } = await supabase
      .from('inventory')
      .update({ 
        quantity: newStock,
        available_quantity: newStock 
      })
      .eq('id', targetItem.id);

    if (updateErr) throw updateErr;

    if (ticket_id) {
      await supabase
        .from('requests')
        .update({ 
          borrowed_at: new Date().toISOString(),
          status: 'CLAIMED' 
        })
        .eq('id', parseInt(ticket_id, 10));
    }

    return res.json({ 
      success: true, 
      message: `Dispatched ${qtyToDeduct} unit(s).`,
      remaining_stock: newStock 
    });

  } catch (err) {
    console.error('Deduction error:', err);
    return res.status(500).json({ error: 'Error updating inventory' });
  }
});

// -----------------------------------------------------------------
// 6. REQUISITIONS & ITEM TRACKING / AUDIT
// -----------------------------------------------------------------
app.post('/api/public/requests', async (req, res) => {
  const { item_id, item_name, quantity, purpose, requester_name, identifier, email, role, department } = req.body;
  const { data, error } = await supabase.from('requests').insert([{
    item_id, item_name, quantity: parseInt(quantity, 10), purpose, requester_name, identifier,
    email: email || '', role: role || 'Student', department: department || 'BSIT', status: 'PENDING', created_at: new Date().toISOString()
  }]).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, ticket: data });
});

app.get('/api/public/my-requests', async (req, res) => {
  const { identifier } = req.query;
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('identifier', identifier)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/admin/all-requests', async (req, res) => {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .order('created_at', { ascending: false });
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

  const { data, error } = await supabase
    .from('requests')
    .update(updateFields)
    .eq('id', parseInt(id, 10))
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, ticket: data });
});

// Permanently Delete Request
app.delete('/api/admin/requests/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    const ticketId = parseInt(rawId, 10);

    if (isNaN(ticketId)) {
      return res.status(400).json({ error: 'Invalid numeric ticket ID.' });
    }

    const { data, error } = await supabase
      .from('requests')
      .delete()
      .eq('id', ticketId)
      .select();

    if (error) {
      console.error('Supabase delete error:', error);
      throw error;
    }

    return res.json({ 
      success: true, 
      message: `Ticket #${ticketId} permanently removed.`,
      deleted: data
    });
  } catch (err) {
    console.error('Delete request error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete ticket.' });
  }
});

// PROCESS RETURN & RESTORE INVENTORY
app.post('/api/admin/requests/:id/return', async (req, res) => {
  try {
    const rawId = req.params.id;
    const ticketId = parseInt(rawId, 10);
    const { item_condition, admin_remarks } = req.body;

    const condition = item_condition || 'Good Condition';

    if (isNaN(ticketId)) {
      return res.status(400).json({ error: 'Invalid numeric ticket ID.' });
    }

    const { data: ticket, error: fetchErr } = await supabase
      .from('requests')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (fetchErr || !ticket) {
      return res.status(404).json({ error: `Ticket #${ticketId} not found.` });
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('requests')
      .update({
        status: 'RETURNED',
        returned_at: new Date().toISOString(),
        item_condition: condition,
        admin_remarks: admin_remarks || 'Item returned via Admin Desk'
      })
      .eq('id', ticketId)
      .select();

    if (updateErr) {
      console.error('Supabase update error:', updateErr);
      throw updateErr;
    }

    const updatedTicket = updatedRows && updatedRows.length > 0 ? updatedRows[0] : ticket;

    let restoredStock = null;
    if (condition.toLowerCase().includes('good')) {
      let targetInv = null;

      if (ticket.item_id) {
        const { data: invById } = await supabase.from('inventory').select('*').eq('id', ticket.item_id).maybeSingle();
        targetInv = invById;
      }
      if (!targetInv && ticket.item_name) {
        const { data: invByName } = await supabase.from('inventory').select('*').ilike('name', `%${ticket.item_name.trim()}%`).limit(1);
        if (invByName && invByName.length > 0) targetInv = invByName[0];
      }

      if (targetInv) {
        const returnQty = parseInt(ticket.quantity || 1, 10);
        restoredStock = (parseInt(targetInv.quantity, 10) || 0) + returnQty;

        await supabase.from('inventory')
          .update({ 
            quantity: restoredStock, 
            available_quantity: restoredStock 
          })
          .eq('id', targetInv.id);
      }
    }

    return res.json({ 
      success: true, 
      ticket: updatedTicket, 
      restored_stock: restoredStock,
      message: `Return recorded successfully. Ticket #${ticketId} is now RETURNED.` 
    });

  } catch (err) {
    console.error('Process return error:', err);
    return res.status(500).json({ error: err.message || 'Failed to complete return audit.' });
  }
});

// START SERVER
app.listen(PORT, () => console.log(`SmartTrack server active on port ${PORT}`));
