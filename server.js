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
  console.error("CRITICAL: SUPABASE_KEY is missing! Supabase queries will fail.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Root Health Check
app.get('/', (req, res) => {
  res.json({ message: "SmartTrack Core API connected to Supabase PostgreSQL." });
});

// Admin Database Diagnostic
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
    if (existing) return res.status(409).json({ error: "Username already registered in Supabase" });

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

    return res.json({
      success: true,
      message: "Admin registered successfully in Supabase",
      admin: { full_name: newAdmin.full_name, username: newAdmin.username }
    });
  } catch (err) {
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

    if (error || !admin) return res.status(401).json({ error: "Invalid username or password" });

    return res.json({
      success: true,
      admin: { full_name: admin.full_name, username: admin.username }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// PUBLIC (STUDENT/FACULTY) AUTHENTICATION
// ==========================================
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
    if (existing) return res.status(409).json({ error: `${role === 'Student' ? 'Student Number' : 'Faculty ID'} is already registered` });

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

    if (error || !user) return res.status(401).json({ error: "Invalid ID number or password" });

    return res.json({
      success: true,
      user: { full_name: user.full_name, identifier: user.identifier, role: user.role, department: user.department }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// INVENTORY & RESTOCK ROUTES
// ==========================================
app.get('/api/public/inventory', async (req, res) => {
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .order('id', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin Restock / Ingest (Upsert)
// Admin Restock / Ingest (Case-Insensitive Upsert)
app.post('/api/admin/inventory', async (req, res) => {
  try {
    const { name, category, quantity, asset_code } = req.body;
    const parsedQty = parseInt(quantity, 10) || 1;
    const cleanCode = (asset_code || '').trim().toUpperCase();

    if (!name || !cleanCode) {
      return res.status(400).json({ error: "Item name and asset code are required" });
    }

    // 1. Look up existing item regardless of case sensitivity
    const { data: existing, error: findErr } = await supabase
      .from('inventory')
      .select('*')
      .ilike('asset_code', cleanCode)
      .maybeSingle();

    if (findErr) {
      return res.status(500).json({ error: findErr.message });
    }

    // 2. If it already exists, UPDATE the quantity (Restock)
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
        message: `Restocked ${name} (+${parsedQty} units). Total stock is now ${nextQty}.`, 
        id: data.id 
      });
    }

    // 3. If brand new, INSERT row
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
    return res.json({ 
      success: true, 
      message: `Registered and stocked new asset: ${name}.`, 
      id: data.id 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
