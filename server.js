require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const brevo = require('@getbrevo/brevo');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'data.json');
const BASE_URL = process.env.RENDER_BASE_URL || 'https://smarttrack-backend-v614.onrender.com';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'dirkshaned@gmail.com';

// Initialize Brevo Transactional Email Client
const apiInstance = new brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
  );
}

const initialData = {
  admins: [{ id: 1, full_name: "Lead Custodian", username: "admin", password: "password123" }],
  requesters: [],
  inventory: [
    { id: 1, name: "Epson Projector EB-X06", category: "Equipment", quantity: 17, status: "Available", asset_code: "CDM-EQ-001" },
    { id: 2, name: "Soldering Iron Kit", category: "Laboratory", quantity: 13, status: "Available", asset_code: "CDM-LB-045" },
    { id: 3, name: "HDMI Cable 5m", category: "Audio/Visual", quantity: 7, status: "Available", asset_code: "CDM-PR-022" },
    { id: 4, name: "Digital Multimeter Fluke 101", category: "Laboratory", quantity: 8, status: "Available", asset_code: "DMM-004" },
    { id: 5, name: "Presentation Clicker", category: "Audio/Visual", quantity: 1, status: "Available", asset_code: "CDM-ER-012" }
  ],
  requests: [],
  borrow_logs: []
};

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.admins) data.admins = initialData.admins;
    if (!data.requesters) data.requesters = initialData.requesters;
    if (!data.inventory) data.inventory = initialData.inventory;
    if (!data.requests) data.requests = initialData.requests;
    if (!data.borrow_logs) data.borrow_logs = initialData.borrow_logs;
    return data;
  } catch (e) {
    return initialData;
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ----------------- ROOT HEALTH CHECK -----------------
app.get('/', (req, res) => {
  res.json({ message: "SmartTrack Core API running smoothly." });
});

// ----------------- BORROWER REGISTRATION -----------------
app.post(['/api/borrowers/register', '/api/borrower/register', '/api/public/signup'], async (req, res) => {
  const { full_name, identifier, email, department, password } = req.body;
  if (!full_name || !identifier || !password || !email) {
    return res.status(400).json({ error: "All registration fields are required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanId = identifier.trim().toLowerCase();
  const db = loadDb();

  if (db.requesters.find(u => (u.identifier || '').toLowerCase() === cleanId)) {
    return res.status(409).json({ error: "Student / Faculty ID is already registered." });
  }
  if (db.requesters.find(u => (u.email || '').toLowerCase() === cleanEmail)) {
    return res.status(409).json({ error: "Gmail address is already registered." });
  }

  const activationToken = crypto.randomBytes(24).toString('hex');
  const newRequester = {
    id: db.requesters.length + 1,
    full_name: full_name.trim(),
    identifier: identifier.trim(),
    email: cleanEmail,
    role: 'Student',
    department: department ? department.trim() : 'BSIT',
    password,
    is_active: false,
    activation_token: activationToken
  };

  db.requesters.push(newRequester);
  saveDb(db);

  const activationLink = `${BASE_URL}/api/borrowers/verify-email?token=${activationToken}`;

  // Brevo Transactional Email Dispatch with Dark-Theme Button Card
  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: "CDM SmartTrack", email: SENDER_EMAIL };
    sendSmtpEmail.to = [{ email: cleanEmail, name: newRequester.full_name }];
    sendSmtpEmail.subject = "Verify your CDM SmartTrack Account";
    sendSmtpEmail.htmlContent = `
      <!DOCTYPE html>
      <html>
      <body style="margin: 0; padding: 20px; background-color: #0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 480px; margin: 0 auto; background-color: #161b22; border-radius: 16px; border: 1px solid #30363d; overflow: hidden; color: #ffffff;">
          <div style="height: 4px; background: linear-gradient(90deg, #10b981, #06b6d4);"></div>
          <div style="padding: 32px 24px; text-align: center;">
            <div style="font-size: 38px; margin-bottom: 12px;">📦</div>
            <h2 style="color: #ffffff; margin: 0 0 4px 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">CDM SMARTTRACK</h2>
            <p style="color: #8b949e; font-size: 13px; margin: 0 0 24px 0;">Colegio de Montalban Borrower Portal</p>
            <div style="border-top: 1px solid #21262d; margin: 0 0 24px 0;"></div>
            
            <p style="text-align: left; color: #f0f6fc; font-size: 15px; font-weight: 700; margin: 0 0 12px 0;">
              Hello ${newRequester.full_name} (Student Borrower),
            </p>
            <p style="text-align: left; color: #8b949e; font-size: 14px; line-height: 1.5; margin: 0 0 28px 0;">
              Your account registration has been initialized. Tap the button below to verify your email and activate your access to laboratory equipment borrowing.
            </p>

            <a href="${activationLink}" target="_blank" style="background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block; width: 80%;">
              Activate My Account &rarr;
            </a>

            <div style="margin-top: 28px; border: 1px dashed #30363d; border-radius: 10px; padding: 12px; background-color: #0d1117;">
              <p style="color: #8b949e; font-size: 12px; margin: 0;">
                ⏳ This link expires in <strong>15 minutes</strong>. If you did not initiate this request, you can safely ignore this email.
              </p>
            </div>
          </div>
          <div style="background-color: #0d1117; padding: 12px; text-align: center; border-top: 1px solid #21262d;">
            <p style="color: #484f58; font-size: 11px; margin: 0;">Colegio de Montalban • Laboratory & Equipment Management</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Brevo] Activation email sent successfully to: ${cleanEmail}`);
  } catch (err) {
    console.error('[Brevo Error]:', err?.response?.body || err?.message || err);
  }

  res.json({
    success: true,
    requires_activation: true,
    email: cleanEmail,
    message: "Activation Link Sent!"
  });
});

// ----------------- EMAIL LINK VERIFICATION -----------------
app.get(['/api/borrowers/verify-email', '/api/borrower/verify-email'], (req, res) => {
  const { token } = req.query;
  const db = loadDb();
  const user = db.requesters.find(u => u.activation_token === token);

  if (!user) {
    return res.status(404).send(`
      <body style="background:#0d1117;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:80vh;text-align:center;">
        <div style="background:#161b22;padding:32px;border-radius:12px;border:1px solid #30363d;">
          <h2 style="color:#f85149;">Invalid or Expired Link</h2>
          <p style="color:#8b949e;">Your account may already be activated. Return to the app and sign in.</p>
        </div>
      </body>
    `);
  }

  user.is_active = true;
  user.activation_token = null;
  saveDb(db);

  return res.send(`
    <!DOCTYPE html>
    <html>
      <body style="background-color: #0d1117; color: #ffffff; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 90vh; margin: 0; padding: 16px;">
        <div style="background-color: #161b22; max-width: 420px; width: 100%; padding: 36px 24px; border-radius: 16px; border: 1px solid #30363d; text-align: center;">
          <div style="font-size: 40px; margin-bottom: 12px; color: #10b981;">✔</div>
          <h2 style="margin: 0 0 8px 0; font-size: 20px;">Account Activated!</h2>
          <p style="color: #8b949e; font-size: 14px; margin-bottom: 24px;">
            Hello <strong>${user.full_name}</strong>, your account has been successfully verified.
          </p>
          <div style="background-color: #0d1117; border-radius: 8px; padding: 14px; border: 1px solid #21262d;">
            <p style="margin: 0; color: #10b981; font-weight: 600; font-size: 14px;">You can now open CDM SmartTrack and Sign In.</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// ----------------- BORROWER LOGIN -----------------
app.post(['/api/borrowers/login', '/api/borrower/login', '/api/public/login'], (req, res) => {
  const { identifier, password } = req.body;
  const db = loadDb();
  const user = db.requesters.find(
    u => (u.identifier || '').toLowerCase() === (identifier || '').trim().toLowerCase() && u.password === password
  );

  if (!user) return res.status(401).json({ error: "Invalid ID or password." });
  if (user.is_active === false) {
    return res.status(403).json({
      error: "Account not activated. Please open your Gmail and tap the activation button.",
      requires_activation: true
    });
  }

  res.json({
    success: true,
    user: {
      full_name: user.full_name,
      identifier: user.identifier,
      email: user.email,
      role: user.role,
      department: user.department
    }
  });
});

// ----------------- CATALOG / INVENTORY -----------------
app.get('/api/public/inventory', (req, res) => {
  res.json(loadDb().inventory);
});

// ----------------- BORROW REQUESTS & TICKETS -----------------
app.post('/api/public/requests', (req, res) => {
  const { requester_name, identifier, item_name, quantity, purpose } = req.body;
  const db = loadDb();

  const ticketNumber = db.requests.length + 33;
  const newTicket = {
    id: ticketNumber,
    requester_name,
    identifier,
    item_name,
    quantity: parseInt(quantity) || 1,
    purpose: purpose || 'Academic Laboratory Project',
    status: 'PENDING',
    created_at: new Date().toLocaleDateString('en-US')
  };

  db.requests.unshift(newTicket);
  saveDb(db);
  res.json({ success: true, ticket_id: newTicket.id });
});

app.get(['/api/public/requests', '/api/admin/requests'], (req, res) => {
  const db = loadDb();
  const { identifier } = req.query;
  if (identifier) {
    return res.json(db.requests.filter(r => (r.identifier || '').toLowerCase() === identifier.trim().toLowerCase()));
  }
  res.json(db.requests);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`SmartTrack Core API running smoothly on port ${PORT}`);
});
