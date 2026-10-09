const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://imjdhuczyqaxhifyucbo.supabase.co';
// You can also paste your secret key directly inside quotes as fallback if Render env vars aren't set:
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_KEY) {
  console.error("CRITICAL: SUPABASE_KEY is missing! Registration will not save to Supabase.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Health check
app.get('/', (req, res) => {
  res.json({ message: "SmartTrack Core API connected to Supabase PostgreSQL." });
});

// View all database contents directly
app.get('/api/admin/database', async (req, res) => {
  try {
    const [admins, requesters, inventory, requests, logs] = await Promise.all([
      supabase.from('admins').select('*'),
      supabase.from('requesters').select('*'),
      supabase.from('inventory').select('*'),
      supabase.from('requests').select('*').order('id', { ascending: false }),
      supabase.from('borrow_logs').select('*').order('id', { ascending: false })
    ]);

    res.json({
      admins: admins.data || [],
      requesters: requesters.data || [],
      inventory: inventory.data || [],
      requests: requests.data || [],
      borrow_logs: logs.data || []
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch database records", details: err.message });
  }
});

// ==========================================================
// ADMIN AUTHENTICATION (Saves to Supabase `admins` table)
// ==========================================================
app.post('/api/admin/signup', async (req, res) => {
  try {
    const { full_name, username, password } = req.body;
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // 1. Check if username already exists in Supabase
    const { data: existing, error: checkError } = await supabase
      .from('admins')
      .select('id')
      .ilike('username', username.trim())
      .maybeSingle();

    if (checkError) {
      console.error("Supabase check error:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (existing) {
      return res.status(409).json({ error: "Username already registered in Supabase" });
    }

    // 2. Insert new admin directly into Supabase
    const { data: newAdmin, error: insertError } = await supabase
      .from('admins')
      .insert([
        {
          full_name: full_name.trim(),
          username: username.trim(),
          password: password
        }
      ])
      .select()
      .single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return res.status(500).json({ error: insertError.message });
    }

    console.log("Successfully registered admin to Supabase:", newAdmin);
    return res.json({
      success: true,
      message: "Admin registered successfully in Supabase",
      admin: { full_name: newAdmin.full_name, username: newAdmin.username }
    });
  } catch (err) {
    console.error("Catch error in signup:", err);
    return res.status(500).json({ error: err.message });
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

    if (error || !admin) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    return res.json({
      success: true,
      admin: { full_name: admin.full_name, username: admin.username }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// PUBLIC (STUDENT & TEACHER) AUTH (Saves to `requesters`)
// ==========================================================
app.post('/api/public/signup', async (req, res) => {
  try {
    const { full_name, identifier, role, department, password } = req.body;
    if (!full_name || !identifier || !role || !department || !password) {
      return res.status(400).json({ error: "All registration fields are required" });
    }

    const { data: existing, error: checkError } = await supabase
      .from('requesters')
      .select('id')
      .ilike('identifier', identifier.trim())
      .maybeSingle();

    if (checkError) return res.status(500).json({ error: checkError.message });
    if (existing) {
      return res.status(409).json({ error: `${role === 'Student' ? 'Student Number' : 'Faculty ID'} is already registered` });
    }

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

    return res.json({
      success: true,
      user: { full_name: data.full_name, identifier: data.identifier, role: data.role, department: data.department }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

    if (error || !user) {
      return res.status(401).json({ error: "Invalid ID number or password" });
    }

    return res.json({
      success: true,
      user: { full_name: user.full_name, identifier: user.identifier, role: user.role, department: user.department }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// INVENTORY & REQUESTS ROUTES
// ==========================================================
app.get('/api/public/inventory', async (req, res) => {
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .order('id', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/inventory', async (req, res) => {
  const { name, category, quantity, asset_code } = req.body;
  const parsedQty = parseInt(quantity, 10);

  const { data, error } = await supabase
    .from('inventory')
    .insert([{
      name,
      category,
      quantity: parsedQty,
      status: parsedQty > 0 ? "Available" : "Out of Stock",
      asset_code
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data.id });
});

app.post('/api/public/requests', async (req, res) => {
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
      quantity: parseInt(quantity, 10),
      purpose: purpose || '',
      status: 'PENDING'
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, ticket_id: data.id });
});

app.get('/api/admin/requests', async (req, res) => {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .order('id', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/admin/requests/:id', async (req, res) => {
  const { status } = req.body;
  const { error } = await supabase
    .from('requests')
    .update({ status })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
// ----------------- MOBILE: GET APPROVED REQUESTS -----------------
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

// ----------------- ADMIN: RETURN & RESTOCK ASSET -----------------
app.post('/api/admin/return-item', async (req, res) => {
  try {
    const { request_id, asset_code, quantity } = req.body;
    const restockQty = parseInt(quantity, 10) || 1;

    // 1. If linked to an asset code, increase inventory stock
    if (asset_code) {
      const { data: item, error: fetchErr } = await supabase
        .from('inventory')
        .select('*')
        .eq('asset_code', asset_code.trim())
        .maybeSingle();

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      if (item) {
        const updatedQty = item.quantity + restockQty;
        await supabase
          .from('inventory')
          .update({
            quantity: updatedQty,
            status: updatedQty > 0 ? 'Available' : 'Out of Stock'
          })
          .eq('id', item.id);
      }
    }

    // 2. Mark the requisition ticket as 'RETURNED'
    if (request_id) {
      await supabase
        .from('requests')
        .update({ status: 'RETURNED' })
        .eq('id', request_id);
    }

    res.json({ success: true, message: `Item restocked successfully (+${restockQty} units).` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`SmartTrack Core API running smoothly on port ${PORT}`);
});
// ----------------- MOBILE SCANNER: LOOKUP ITEM -----------------
app.get('/api/mobile/item/:code', async (req, res) => {
  try {
    const { data: item, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('asset_code', req.params.code.trim())
      .maybeSingle();

    if (error || !item) {
      return res.status(404).json({ error: "Item not found in database" });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- MOBILE SCANNER: DISPATCH & LOG -----------------
app.post('/api/mobile/dispatch', async (req, res) => {
  try {
    const { asset_code, borrower_name, custodian_id, request_id, quantity } = req.body;
    const releaseQty = parseInt(quantity, 10) || 1;

    if (!asset_code || !borrower_name) {
      return res.status(400).json({ error: "Missing barcode or borrower name" });
    }

    // 1. Fetch item from inventory
    const { data: item, error: fetchErr } = await supabase
      .from('inventory')
      .select('*')
      .eq('asset_code', asset_code.trim())
      .maybeSingle();

    if (fetchErr || !item) {
      return res.status(404).json({ error: "Item code not registered in inventory" });
    }

    if (item.quantity < releaseQty) {
      return res.status(400).json({ error: `Not enough stock. Requested: ${releaseQty}, Available: ${item.quantity}` });
    }

    const nextQty = item.quantity - releaseQty;
    const nextStatus = nextQty === 0 ? "Out of Stock" : item.status;

    // 2. Decrement inventory count in Supabase
    await supabase
      .from('inventory')
      .update({ quantity: nextQty, status: nextStatus })
      .eq('id', item.id);

    // 3. Write record into borrow_logs in Supabase
    await supabase
      .from('borrow_logs')
      .insert([{
        asset_code: asset_code.trim(),
        borrower_name: borrower_name.trim(),
        custodian_id: custodian_id || "Mobile-Terminal"
      }]);

    // 4. Update the request ticket status to 'DISPATCHED' so it leaves Ready to Pickup
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
