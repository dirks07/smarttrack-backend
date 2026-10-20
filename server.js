const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const DB_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
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
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (err) {
    return { requesters: [], inventory: [], requests: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('DB Write Error:', err.message);
  }
}

// Health check
app.get('/', (req, res) => res.json({ success: true, message: 'SmartTrack API operational.' }));

// Register
app.post(['/api/borrowers/register', '/api/public/signup'], (req, res) => {
  const { full_name, identifier, email, department, password } = req.body;
  if (!full_name || !identifier || !password || !email) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanId = identifier.trim().toLowerCase();
  const db = loadDb();

  const exists = (db.requesters || []).some(
    u => (u.identifier || '').toLowerCase() === cleanId || (u.email || '').toLowerCase() === cleanEmail
  );
  if (exists) {
    return res.status(400).json({ success: false, error: 'User already exists.' });
  }

  const newBorrower = {
    identifier: identifier.trim(),
    full_name: full_name.trim(),
    email: cleanEmail,
    department: department ? department.trim() : 'BSIT',
    password: password,
    is_active: true,
    created_at: new Date().toISOString()
  };

  db.requesters.push(newBorrower);
  saveDb(db);
  return res.status(201).json({ success: true, message: 'Account registered successfully.' });
});

// Login
app.post(['/api/borrowers/login', '/api/borrower/login'], (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, error: 'Credentials required.' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const db = loadDb();
  const user = (db.requesters || []).find(
    u => (u.identifier || '').toLowerCase() === cleanId || (u.email || '').toLowerCase() === cleanId
  );

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: 'Invalid ID or Password.' });
  }

  return res.json({
    success: true,
    user: {
      identifier: user.identifier,
      full_name: user.full_name,
      email: user.email,
      department: user.department,
      is_active: true
    }
  });
});

// Inventory
app.get('/api/public/inventory', (req, res) => {
  const db = loadDb();
  res.json({ success: true, inventory: db.inventory || [] });
});

// Requests / Loans
app.get(['/api/public/requests', '/api/requests'], (req, res) => {
  const { requesterId } = req.query;
  const db = loadDb();
  let list = db.requests || [];
  if (requesterId) {
    list = list.filter(r => (r.requesterId || '').toLowerCase() === requesterId.trim().toLowerCase());
  }
  res.json({ success: true, requests: list });
});

app.post(['/api/public/requests', '/api/requests'], (req, res) => {
  const { itemId, requesterId, requesterName, quantity, purpose } = req.body;
  const db = loadDb();
  const item = (db.inventory || []).find(i => i.id === itemId);
  const qty = parseInt(quantity, 10) || 1;

  if (item && item.available < qty) {
    return res.status(400).json({ success: false, error: 'Insufficient stock available.' });
  }

  const newReq = {
    id: 'REQ-' + Date.now().toString(36).toUpperCase(),
    itemId,
    itemName: item ? item.name : 'Asset',
    requesterId,
    requesterName,
    quantity: qty,
    purpose: purpose || 'Academic Class Activity',
    status: 'Pending',
    borrowed_at: null,
    returned_at: null,
    created_at: new Date().toISOString()
  };

  if (!Array.isArray(db.requests)) db.requests = [];
  db.requests.unshift(newReq);
  saveDb(db);
  res.status(201).json({ success: true, request: newReq });
});

// Approval / Status Update Endpoint
app.post('/api/requests/status', (req, res) => {
  const { requestId, status } = req.body; // 'Approved' | 'Active' | 'Returned' | 'Rejected'
  const db = loadDb();
  const request = (db.requests || []).find(r => r.id === requestId);

  if (!request) {
    return res.status(404).json({ success: false, error: 'Request not found.' });
  }

  const item = (db.inventory || []).find(i => i.id === request.itemId);

  if (status === 'Approved' || status === 'Active') {
    if (request.status !== 'Approved' && request.status !== 'Active') {
      if (item && item.available >= request.quantity) {
        item.available -= request.quantity;
      }
    }
    request.borrowed_at = new Date().toISOString();
  } else if (status === 'Returned') {
    if (request.status === 'Approved' || request.status === 'Active') {
      if (item) {
        item.available = Math.min(item.total, item.available + request.quantity);
      }
    }
    request.returned_at = new Date().toISOString();
  }

  request.status = status;
  saveDb(db);
  res.json({ success: true, request });
});

app.listen(PORT, '0.0.0.0', () => console.log(`SmartTrack API live on port ${PORT}`));
