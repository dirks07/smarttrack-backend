require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------
// 1. SUPABASE CLIENT INITIALIZATION
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

// In-memory token stores for verification links (15 min lifespan)
const pendingBorrowerTokens = new Map();
const pendingAdminTokens = new Map();

// Universal EmailJS HTTPS REST Dispatcher
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

  console.log(`[EmailJS] Dispatching to ${toEmail} for ${portalType}`);

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[EmailJS Failure]:', errorText);
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
// 3. BORROWER FLOW (Mobile App)
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
      return res.status(400).json({ error: 'A borrower account with this ID or Email already exists.' });
    }

    const token = 'b_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    pendingBorrowerTokens.set(token, {
      full_name,
      identifier,
      email,
      role: role || 'Student',
      department: department || 'BSIT',
      password,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const verificationUrl = `https://smarttrack-backend-v6l4.onrender.com/api/public/verify-email?token=${token}`;
    await sendVerificationEmail({
      toEmail: email,
      fullName: full_name,
      verificationUrl,
      portalType: 'Student Borrower'
    });

    res.json({ success: true, message: `Verification email sent to ${email}.` });
  } catch (error) {
    console.error('Borrower registration error:', error);
    res.status(500).json({ error: error.message || 'Borrower registration failed.' });
  }
});

app.get('/api/public/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || !pendingBorrowerTokens.has(token)) {
      return res.status(400).send(`<h2>Link Expired or Invalid</h2><p>Please register again from the mobile app.</p>`);
    }

    const pending = pendingBorrowerTokens.get(token);
    if (Date.now() > pending.expiresAt) {
      pendingBorrowerTokens.delete(token);
      return res.status(400).send(`<h2>Token Expired</h2><p>The 15-minute verification window has passed.</p>`);
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

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Account Activated</title></head>
      <body style="font-family: Arial, sans-serif; background-color: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
        <div style="background-color: #111827; border: 1px solid #1f293d; border-radius: 20px; padding: 36px; max-width: 440px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <div style="font-size: 48px; color: #10b981; margin-bottom: 12px;">✓</div>
          <h2 style="color: #10b981; margin: 0 0 10px 0;">Borrower Activated!</h2>
          <p style="color: #cbd5e1; font-size: 15px; margin-bottom: 20px;">Welcome, <strong>${pending.full_name}</strong>. Your account has been verified.</p>
          <div style="background-color: #1e293b; padding: 12px; border-radius: 8px; border: 1px dashed #10b981; font-size: 13px; color: #38bdf8;">
            You can now open the CDM SmartTrack mobile app and log in.
          </div>
        </div>
      </body>
      </html>
    `);
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
// 4. ADMIN WORKSTATION FLOW (Desktop App)
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
      return res.status(400).json({ error: 'An admin account with this Staff ID or Gmail already exists.' });
    }

    const token = 'a_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    pendingAdminTokens.set(token, {
      full_name,
      identifier,
      email,
      role: role || 'Admin',
      department: department || 'Staff',
      password,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    const verificationUrl = `https://smarttrack-backend-v6l4.onrender.com/api/admin/verify-email?token=${token}`;
    await sendVerificationEmail({
      toEmail: email,
      fullName: full_name,
      verificationUrl,
      portalType: 'Staff Administrator'
    });

    res.json({ success: true, message: `Admin activation link sent to ${email}.` });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: error.message || 'Admin registration failed.' });
  }
});

app.get('/api/admin/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || !pendingAdminTokens.has(token)) {
      return res.status(400).send(`<h2>Link Expired or Invalid</h2><p>Please re-register from the desktop portal.</p>`);
    }

    const pending = pendingAdminTokens.get(token);
    if (Date.now() > pending.expiresAt) {
      pendingAdminTokens.delete(token);
      return res.status(400).send(`<h2>Token Expired</h2><p>The 15-minute verification window has passed.</p>`);
    }

    // Supports both 'identifier' and 'username' schema constraints
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

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin Activated</title></head>
      <body style="font-family: Arial, sans-serif; background-color: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
        <div style="background-color: #111827; border: 1px solid #1f293d; border-radius: 20px; padding: 36px; max-width: 440px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <div style="font-size: 48px; color: #38bdf8; margin-bottom: 12px;">🛡️</div>
          <h2 style="color: #38bdf8; margin: 0 0 10px 0;">Administrator Activated!</h2>
          <p style="color: #cbd5e1; font-size: 15px; margin-bottom: 20px;">Welcome, <strong>${pending.full_name}</strong>. Your staff credentials are ready.</p>
          <div style="background-color: #1e293b; padding: 12px; border-radius: 8px; border: 1px dashed #38bdf8; font-size: 13px; color: #67e8f9;">
            Return to the CDM SmartTrack Desktop Application to sign in.
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Admin activation failed: ${error.message}`);
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Checks identifier or legacy username
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
// 5. INVENTORY & REQUISITIONS ENDPOINTS
// -----------------------------------------------------------------
app.get('/api/public/inventory', async (req, res) => {
  const { data, error } = await supabase.from('inventory').select('*').order('id', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/public/requests', async (req, res) => {
  const { item_id, item_name, quantity, purpose, requester_name, identifier, role, department } = req.body;
  const { data, error } = await supabase.from('requests').insert([{
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
  const { data, error } = await supabase.from('requests').update({ status: status.toUpperCase() }).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, ticket: data });
});

app.listen(PORT, () => console.log(`SmartTrack backend running on port ${PORT}`));
