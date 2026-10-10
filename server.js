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

// In-memory token storage for pending registrations
const pendingTokens = new Map();

// Helper to send email via EmailJS HTTPS REST API (Port 443 - Bypasses Render SMTP Block)
async function sendVerificationViaEmailJS(toEmail, fullName, verificationUrl) {
  const serviceId = (process.env.EMAILJS_SERVICE_ID || '').trim();
  const templateId = (process.env.EMAILJS_TEMPLATE_ID || '').trim();
  const publicKey = (process.env.EMAILJS_PUBLIC_KEY || '').trim();

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EmailJS environment keys missing on Render dashboard.');
  }

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_email: toEmail,
      to_name: fullName,
      verification_url: verificationUrl
    }
  };

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
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    supabase_configured: !!rawUrl && !!rawKey
  });
});

// -----------------------------------------------------------------
// 3. BORROWER AUTHENTICATION & EMAIL ACTIVATION
// -----------------------------------------------------------------

// A. Registration submission
app.post('/api/public/register', async (req, res) => {
  try {
    const { full_name, identifier, email, role, department, password } = req.body;

    if (!full_name || !identifier || !email || !password) {
      return res.status(400).json({ error: 'All registration fields are required.' });
    }

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

    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

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

    await sendVerificationViaEmailJS(email, full_name, verificationUrl);
    console.log(`✓ Verification email sent to ${email}`);

    return res.json({
      success: true,
      message: `A verification link has been sent to ${email}.`
    });
  } catch (error) {
    console.error('Email dispatch failure:', error);
    return res.status(500).json({ error: error.message || 'Email delivery failed.' });
  }
});

// B. Account activation link handler
app.get('/api/public/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || !pendingTokens.has(token)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Link Expired • CDM SmartTrack</title>
          <style>
            body { margin: 0; background: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
            .card { background: #131b2e; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 24px; padding: 40px 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
            h2 { color: #f87171; margin: 0 0 10px; font-size: 22px; font-weight: 800; }
            p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Link Invalid or Expired</h2>
            <p>This verification link has expired or has already been used. Please register again from the mobile app.</p>
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
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Expired • CDM SmartTrack</title>
          <style>
            body { margin: 0; background: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
            .card { background: #131b2e; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 24px; padding: 40px 32px; max-width: 440px; text-align: center; }
            h2 { color: #f87171; margin: 0 0 10px; font-size: 22px; }
            p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Verification Expired</h2>
            <p>The 15-minute verification window has lapsed. Please submit registration again from the app.</p>
          </div>
        </body>
        </html>
      `);
    }

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
      return res.status(500).send(`Database error: ${insertError.message}`);
    }

    pendingTokens.delete(token);

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Verified • CDM SmartTrack</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background-color: #090d16;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px 16px;
          }
          .card {
            background-color: #111827;
            border: 1px solid #1f293d;
            border-radius: 24px;
            padding: 44px 32px;
            max-width: 440px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
            position: relative;
            overflow: hidden;
          }
          .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 5px;
            background: linear-gradient(90deg, #10b981, #06b6d4);
          }
          .icon-container {
            width: 76px;
            height: 76px;
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.3);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
          }
          h2 { font-size: 24px; font-weight: 800; color: #f8fafc; margin-bottom: 8px; }
          .subtitle { font-size: 14px; color: #94a3b8; margin-bottom: 24px; }
          .user-badge { background: #1a2234; border: 1px solid #28354d; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left; }
          .user-name { font-size: 16px; font-weight: 700; color: #38bdf8; }
          .user-meta { font-size: 13px; color: #94a3b8; margin-top: 2px; }
          .instructions {
            font-size: 13px;
            color: #10b981;
            background: rgba(16, 185, 129, 0.08);
            border: 1px dashed rgba(16, 185, 129, 0.4);
            border-radius: 10px;
            padding: 12px 16px;
            line-height: 1.5;
            margin-bottom: 28px;
          }
          .footer-text { font-size: 11px; color: #475569; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-container">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h2>Account Activated!</h2>
          <p class="subtitle">Your borrower credentials have been verified.</p>
          <div class="user-badge">
            <div class="user-name">${pending.full_name}</div>
            <div class="user-meta">ID: ${pending.identifier} • Dept: ${pending.department}</div>
          </div>
          <div class="instructions">
            ✓ Setup complete. Return to the <strong>CDM SmartTrack</strong> app and sign in with your ID number and password.
          </div>
          <p class="footer-text">Colegio de Montalban • SmartTrack Borrower Portal</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Email verification error:', error);
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
// 4. INVENTORY CATALOG & REQUISITIONS
// -----------------------------------------------------------------
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
