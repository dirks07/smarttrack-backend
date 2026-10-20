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
const BASE_URL = process.env.RENDER_BASE_URL || 'https://smarttrack-backend.onrender.com';
const SENDER_EMAIL = process.env.SENDER_EMAIL;

// Initialize Brevo Transactional Email Client (HTTPS Port 443)
const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ''
);

// Initial seed database structure
const initialData = {
  admins: [
    { id: 1, full_name: "Lead Custodian", username: "admin", password: "password123" }
  ],
  requesters: [
    { 
      id: 1, 
      full_name: "Sample Student", 
      email: "aaronjustine242@gmail.com", 
      identifier: "2023-0001", 
      role: "Student", 
      department: "Institute of Computing Studies", 
      password: "password123",
      is_active: true,
      activation_token: null
    }
  ],
  inventory: [
    { id: 1, name: "Epson Projector EB-X06", category: "Equipment", quantity: 5, status: "Available", asset_code: "CDM-EQ-001" }
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

// ----------------- AUTOMATIC REGISTRATION WITH ACTIVATION BUTTON -----------------
app.post(['/api/public/signup', '/api/borrower/register', '/api/borrowers/register'], async (req, res) => {
  const { full_name, identifier, email, role, department, password } = req.body;
  if (!full_name || !identifier || !password || !email) {
    return res.status(400).json({ error: "All registration fields including email are required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanId = identifier.trim().toLowerCase();
  const db = loadDb();

  const idExists = db.requesters.find(u => u.identifier.toLowerCase() === cleanId);
  if (idExists) {
    return res.status(409).json({ error: `${role === 'Student' ? 'Student Number' : 'Faculty ID'} is already registered.` });
  }

  const emailExists = db.requesters.find(u => (u.email || '').toLowerCase() === cleanEmail);
  if (emailExists) {
    return res.status(409).json({ error: "This Gmail address is already registered." });
  }

  // Token for activation button URL
  const activationToken = crypto.randomBytes(24).toString('hex');

  const newRequester = {
    id: db.requesters.length + 1,
    full_name: full_name.trim(),
    identifier: identifier.trim(),
    email: cleanEmail,
    role: role || 'Student',
    department: department ? department.trim() : 'BSIT',
    password,
    is_active: false,
    activation_token: activationToken
  };

  db.requesters.push(newRequester);
  saveDb(db);

  const activationLink = `${BASE_URL}/api/borrowers/verify-email?token=${activationToken}`;

  // Automatically dispatch email to whatever email was registered
  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { 
      name: "CDM SmartTrack", 
      email: SENDER_EMAIL || "dirkshaned@gmail.com" 
    };
    sendSmtpEmail.to = [{ email: cleanEmail, name: newRequester.full_name }];
    sendSmtpEmail.subject = "Activate Your CDM SmartTrack Account";
    sendSmtpEmail.htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">Welcome to CDM SmartTrack</h2>
        <p style="color: #475569; font-size: 15px;">Hello <strong>${newRequester.full_name}</strong>,</p>
        <p style="color: #475569; font-size: 15px;">Thank you for registering. Please tap the button below to activate your account:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${activationLink}" target="_blank" style="background-color: #16a34a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
            Activate My Account
          </a>
        </div>
        <p style="color: #94a3b8; font-size: 13px;">Or open this link directly:<br/><a href="${activationLink}" style="color: #2563eb;">${activationLink}</a></p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px; margin: 0;">If you did not register, please ignore this email.</p>
      </div>
    `;

    const apiResponse = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`Automatic activation email successfully sent to ${cleanEmail}:`, apiResponse?.body || apiResponse);
  } catch (err) {
    console.error('Brevo Email Activation Error:', err?.response?.body || err?.message || err);
  }

  res.json({
    success: true,
    requires_activation: true,
    message: "Registration successful! An activation link has been sent to your Gmail inbox.",
    user: {
      full_name: newRequester.full_name,
      identifier: newRequester.identifier,
      email: newRequester.email,
      role: newRequester.role,
      department: newRequester.department,
      is_active: false
    }
  });
});

// ----------------- ACTIVATION BUTTON CLICK HANDLER -----------------
app.get(['/api/borrowers/verify-email', '/api/borrower/verify-email'], (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc2626;">Invalid Activation Link</h2>
        <p style="color: #475569;">No activation token was provided.</p>
      </div>
    `);
  }

  const db = loadDb();
  const user = db.requesters.find(u => u.activation_token === token);

  if (!user) {
    return res.status(404).send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc2626;">Activation Link Expired or Already Used</h2>
        <p style="color: #475569;">This account is already active. You can now log in to the mobile app.</p>
      </div>
    `);
  }

  user.is_active = true;
  user.activation_token = null;
  saveDb(db);

  return res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Account Activated - CDM SmartTrack</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 80vh; margin: 0; padding: 20px;">
        <div style="background-color: #ffffff; max-width: 480px; width: 100%; padding: 36px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); text-align: center;">
          <div style="width: 56px; height: 56px; background-color: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto;">
            <span style="font-size: 28px; color: #16a34a;">✔</span>
          </div>
          <h2 style="color: #0f172a; margin: 0 0 12px 0;">Account Activated!</h2>
          <p style="color: #475569; font-size: 15px; margin-bottom: 24px;">
            Hello <strong>${user.full_name}</strong>, your account has been successfully verified.
          </p>
          <div style="background-color: #f1f5f9; border-radius: 8px; padding: 12px;">
            <p style="margin: 0; color: #334155; font-size: 14px;">You can now open the <strong>CDM SmartTrack</strong> app and sign in.</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// ----------------- LOGIN CHECK (BLOCKS UNACTIVATED ACCOUNTS) -----------------
app.post(['/api/public/login', '/api/borrower/login', '/api/borrowers/login'], (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: "Enter ID and password" });

  const db = loadDb();
  const user = db.requesters.find(
    u => u.identifier.toLowerCase() === identifier.trim().toLowerCase() && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Invalid ID number or password." });
  }

  if (user.is_active === false) {
    return res.status(403).json({ 
      error: "Account not activated. Please open your Gmail inbox and tap the activation button.",
      requires_activation: true
    });
  }

  res.json({
    success: true,
    user: {
      full_name: user.full_name,
      identifier: user.identifier,
      email: user.email || '',
      role: user.role,
      department: user.department
    }
  });
});

// ----------------- PASSWORD RECOVERY -----------------
app.post(['/api/borrowers/forgot-password', '/api/borrower/forgot-password', '/api/forgot-password'], async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Gmail address is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const db = loadDb();
  const user = db.requesters.find(u => (u.email || '').toLowerCase() === cleanEmail);
  if (!user) {
    return res.status(404).json({ error: 'No account found registered with this Gmail address.' });
  }

  const tempPassword = Math.random().toString(36).substring(2, 8).toUpperCase();
  user.password = tempPassword;
  saveDb(db);

  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: "CDM SmartTrack", email: SENDER_EMAIL || "dirkshaned@gmail.com" };
    sendSmtpEmail.to = [{ email: cleanEmail, name: user.full_name || 'Borrower' }];
    sendSmtpEmail.subject = "CDM SmartTrack - Password Recovery & Credentials";
    sendSmtpEmail.htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">CDM SmartTrack</h2>
        <p style="color: #475569; font-size: 15px;">Hello <strong>${user.full_name || 'Borrower'}</strong>,</p>
        <p style="color: #475569; font-size: 15px;">Your temporary password for CDM SmartTrack is below:</p>
        <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 6px 0; color: #334155;"><strong>Borrower ID:</strong> ${user.identifier}</p>
          <p style="margin: 6px 0; color: #334155;"><strong>Temporary Password:</strong> <code style="font-size: 16px; color: #2563eb; font-weight: bold;">${tempPassword}</code></p>
        </div>
      </div>
    `;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    return res.status(200).json({ message: 'Temporary password sent to your Gmail inbox.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send recovery email.' });
  }
});

// ----------------- INVENTORY & OTHER ROUTES -----------------
app.get('/api/public/inventory', (req, res) => res.json(loadDb().inventory));
app.get(['/api/admin/requests', '/api/public/requests'], (req, res) => res.json(loadDb().requests));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`SmartTrack Core API running on port ${PORT}`));
