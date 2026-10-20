const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const DB_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ----------------- DATABASE HELPERS -----------------
function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = {
        requesters: [],
        inventory: [
          { id: 'IT-001', name: 'Dell Inspiron 15 Laptop', category: 'Laptops', available: 5, total: 5, status: 'Available' },
          { id: 'IT-002', name: 'Epson LCD Projector', category: 'Projectors', available: 3, total: 3, status: 'Available' },
          { id: 'IT-003', name: 'HDMI to VGA Adapter Cable', category: 'Accessories', available: 10, total: 10, status: 'Available' },
          { id: 'IT-004', name: 'Wireless Presenter Clicker', category: 'Accessories', available: 4, total: 4, status: 'Available' },
          { id: 'IT-005', name: 'Cat6 Ethernet Cable (15m)', category: 'Cables', available: 8, total: 8, status: 'Available' }
        ],
        requests: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[DB Load Error]:', err.message);
    return { requesters: [], inventory: [], requests: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[DB Save Error]:', err.message);
  }
}

// ----------------- NODEMAILER TRANSPORTER -----------------
const SMTP_USER = (process.env.GMAIL_USER || process.env.EMAIL_USER || '').trim();
const SMTP_PASS = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').trim().replace(/\s+/g, '');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// ----------------- HEALTH CHECK -----------------
app.get('/', (req, res) => {
  res.json({ success: true, message: 'SmartTrack Core API running smoothly.' });
});

// ----------------- BORROWER REGISTRATION -----------------
app.post(['/api/borrowers/register', '/api/borrower/register', '/api/public/signup'], async (req, res) => {
  try {
    const { full_name, identifier, email, department, password } = req.body;

    if (!full_name || !identifier || !password || !email) {
      return res.status(400).json({ success: false, error: 'All registration fields are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanId = identifier.trim().toLowerCase();
    const db = loadDb();

    if (!Array.isArray(db.requesters)) {
      db.requesters = [];
    }

    const existingIndex = db.requesters.findIndex(
      u => (u.identifier || '').toLowerCase() === cleanId || (u.email || '').toLowerCase() === cleanEmail
    );

    if (existingIndex !== -1) {
      return res.status(400).json({ success: false, error: 'An account with that ID or Email already exists.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const newBorrower = {
      identifier: identifier.trim(),
      full_name: full_name.trim(),
      name: full_name.trim(),
      email: cleanEmail,
      department: department ? department.trim() : 'BSIT',
      password: password,
      is_active: false,
      activation_token: token,
      created_at: new Date().toISOString()
    };

    const backendUrl = (process.env.RENDER_BASE_URL || 'https://smarttrack-backend-v6l4.onrender.com').replace(/\/+$/, '');
    const activationLink = `${backendUrl}/api/borrowers/verify-email?token=${token}`;

    try {
      await transporter.sendMail({
        from: `"CDM SmartTrack" <${SMTP_USER}>`,
        to: cleanEmail,
        subject: 'Verify your CDM SmartTrack Account',
        text: `Hello ${full_name.trim()},\n\nPlease activate your CDM SmartTrack account by opening this URL:\n${activationLink}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #059669; margin-top: 0;">CDM SmartTrack Verification</h2>
            <p style="font-size: 15px; color: #334155;">Hello <b>${full_name.trim()}</b>,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Your borrower account has been registered for Colegio de Montalban Asset Tracking. Please click below to verify your email address and activate your account.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${activationLink}" style="background-color: #059669; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px; display: inline-block;">
                Activate My Account &rarr;
              </a>
            </div>
          </div>
        `
      });

      db.requesters.push(newBorrower);
      saveDb(db);

      return res.status(201).json({
        success: true,
        message: 'Activation link sent! Please check your email inbox to activate your account.'
      });
    } catch (mailErr) {
      console.error('[SMTP Send Error]:', mailErr.message);
      return res.status(500).json({
        success: false,
        error: `Email delivery failed: ${mailErr.message}`,
        code: mailErr.code || 'ESMTP'
      });
    }
  } catch (err) {
    console.error('[Registration Error]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- BORROWER VERIFY EMAIL -----------------
app.get('/api/borrowers/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('<h1>Invalid activation link</h1>');
  }

  const db = loadDb();
  const user = (db.requesters || []).find(u => u.activation_token === token);

  if (!user) {
    return res.status(400).send('<h1>Invalid or expired activation link.</h1>');
  }

  user.is_active = true;
  user.activation_token = null;
  saveDb(db);

  return res.send(`
    <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px 20px;">
      <h1 style="color: #059669;">&#10004; Account Activated!</h1>
      <p style="font-size: 16px; color: #333;">Your CDM SmartTrack borrower account has been verified.</p>
      <p style="color: #666;">You can now open the mobile application and log in with your credentials.</p>
    </div>
  `);
});

// ----------------- BORROWER LOGIN -----------------
app.post(['/api/borrowers/login', '/api/borrower/login'], (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'ID and password are required.' });
    }

    const cleanId = identifier.trim().toLowerCase();
    const db = loadDb();
    const user = (db.requesters || []).find(
      u => (u.identifier || '').toLowerCase() === cleanId || (u.email || '').toLowerCase() === cleanId
    );

    if (!user) {
      return res.status(401).json({ success: false, error: 'User account not found.' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid password.' });
    }

    if (user.is_active === false) {
      return res.status(403).json({
        success: false,
        error: 'Your account is not activated yet. Please click the activation link sent to your email.'
      });
    }

    return res.json({
      success: true,
      message: 'Login successful.',
      user: {
        identifier: user.identifier,
        full_name: user.full_name || user.name,
        email: user.email,
        department: user.department || 'BSIT',
        is_active: true
      }
    });
  } catch (err) {
    console.error('[Login Error]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- INVENTORY & REQUESTS -----------------
app.get('/api/public/inventory', (req, res) => {
  try {
    const db = loadDb();
    return res.json({ success: true, inventory: db.inventory || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/public/requests', '/api/requests'], (req, res) => {
  try {
    const { itemId, requesterId, requesterName, quantity, purpose } = req.body;
    if (!itemId || !requesterId) {
      return res.status(400).json({ success: false, error: 'Item ID and Requester ID are required.' });
    }

    const db = loadDb();
    if (!Array.isArray(db.requests)) db.requests = [];

    const item = (db.inventory || []).find(i => i.id === itemId);
    const newRequest = {
      id: 'REQ-' + Date.now().toString(36).toUpperCase(),
      itemId,
      itemName: item ? item.name : 'Unknown Equipment',
      requesterId,
      requesterName: requesterName || 'Borrower',
      quantity: parseInt(quantity, 10) || 1,
      purpose: purpose || 'Academic Class Activity',
      status: 'Pending',
      created_at: new Date().toISOString()
    };

    db.requests.unshift(newRequest);
    saveDb(db);

    return res.status(201).json({
      success: true,
      message: 'Borrow request submitted successfully.',
      request: newRequest
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get(['/api/public/requests', '/api/requests'], (req, res) => {
  try {
    const { requesterId } = req.query;
    const db = loadDb();
    let requests = db.requests || [];

    if (requesterId) {
      const cleanId = requesterId.trim().toLowerCase();
      requests = requests.filter(r => (r.requesterId || '').toLowerCase() === cleanId);
    }

    return res.json({ success: true, requests });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SmartTrack Core API running smoothly on port ${PORT}`);
});
