const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'data.json');

// Initial seed database structure
const initialData = {
  admins: [
    { id: 1, full_name: "Lead Custodian", username: "admin", password: "password123" }
  ],
  requesters: [
    { id: 1, full_name: "Sample Student", identifier: "2023-0001", role: "Student", department: "Institute of Computing Studies", password: "password123" },
    { id: 2, full_name: "Prof. Juan Dela Cruz", identifier: "FAC-901", role: "Teacher", department: "Institute of Computing Studies", password: "password123" }
  ],
  inventory: [
    { id: 1, name: "Epson Projector EB-X06", category: "Equipment", quantity: 5, status: "Available", asset_code: "CDM-EQ-001" },
    { id: 2, name: "A4 Copy Paper (Box)", category: "Consumable", quantity: 42, status: "In Stock", asset_code: "CDM-CS-101" },
    { id: 3, name: "Whiteboard Marker Black", category: "Consumable", quantity: 120, status: "In Stock", asset_code: "CDM-CS-102" },
    { id: 4, name: "Soldering Iron Kit", category: "Laboratory Tool", quantity: 15, status: "Available", asset_code: "CDM-LB-045" },
    { id: 5, name: "HDMI Cable 5m", category: "Peripheral", quantity: 8, status: "Available", asset_code: "CDM-PR-022" }
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

// ----------------- HEALTH CHECK ROUTE -----------------
app.get('/', (req, res) => {
  res.json({ message: "SmartTrack Core API running smoothly." });
});

// ----------------- FULL DATABASE ROUTE -----------------
// Endpoint accessed by the "View Live Database" button
app.get('/api/admin/database', (req, res) => {
  const db = loadDb();
  res.json(db);
});

// ----------------- ADMIN AUTH ROUTES -----------------
app.post('/api/admin/signup', (req, res) => {
  const { full_name, username, password } = req.body;
  if (!full_name || !username || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const db = loadDb();
  if (db.admins.find(a => a.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already registered" });
  }

  const newAdmin = { id: db.admins.length + 1, full_name, username, password };
  db.admins.push(newAdmin);
  saveDb(db);
  res.json({ success: true, admin: { full_name, username } });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDb();
  const admin = db.admins.find(a => a.username.toLowerCase() === username.toLowerCase() && a.password === password);
  if (!admin) return res.status(401).json({ error: "Invalid username or password" });

  res.json({ success: true, admin: { full_name: admin.full_name, username: admin.username } });
});

// ----------------- PUBLIC (STUDENT & TEACHER) AUTH -----------------
app.post('/api/public/signup', (req, res) => {
  const { full_name, identifier, role, department, password } = req.body;
  if (!full_name || !identifier || !role || !department || !password) {
    return res.status(400).json({ error: "All registration fields are required" });
  }

  const db = loadDb();
  const exists = db.requesters.find(u => u.identifier.toLowerCase() === identifier.trim().toLowerCase());
  if (exists) {
    return res.status(409).json({ error: `${role === 'Student' ? 'Student Number' : 'Faculty ID'} is already registered` });
  }

  const newRequester = {
    id: db.requesters.length + 1,
    full_name: full_name.trim(),
    identifier: identifier.trim(),
    role,
    department: department.trim(),
    password
  };

  db.requesters.push(newRequester);
  saveDb(db);

  res.json({
    success: true,
    user: { full_name: newRequester.full_name, identifier: newRequester.identifier, role: newRequester.role, department: newRequester.department }
  });
});

app.post('/api/public/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: "Enter ID and password" });

  const db = loadDb();
  const user = db.requesters.find(u => u.identifier.toLowerCase() === identifier.trim().toLowerCase() && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "Invalid ID number or password" });
  }

  res.json({
    success: true,
    user: { full_name: user.full_name, identifier: user.identifier, role: user.role, department: user.department }
  });
});

// ----------------- INVENTORY ROUTES -----------------
app.get('/api/public/inventory', (req, res) => {
  const db = loadDb();
  res.json(db.inventory);
});

app.post('/api/admin/inventory', (req, res) => {
  const { name, category, quantity, asset_code } = req.body;
  const db = loadDb();
  const newItem = {
    id: db.inventory.length + 1,
    name,
    category,
    quantity: parseInt(quantity),
    status: parseInt(quantity) > 0 ? "Available" : "Out of Stock",
    asset_code
  };
  db.inventory.push(newItem);
  saveDb(db);
  res.json({ success: true, id: newItem.id });
});

// ----------------- REQUISITION REQUEST ROUTES -----------------
app.post('/api/public/requests', (req, res) => {
  const { requester_name, department, item_name, quantity, purpose, role, identifier } = req.body;
  if (!requester_name || !item_name || !quantity) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const db = loadDb();
  const newTicket = {
    id: db.requests.length + 1,
    requester_name,
    identifier: identifier || 'N/A',
    role: role || 'Requester',
    department: department || '',
    item_name,
    quantity: parseInt(quantity),
    purpose: purpose || '',
    status: 'PENDING',
    created_at: new Date().toISOString()
  };
  db.requests.unshift(newTicket);
  saveDb(db);
  res.json({ success: true, ticket_id: newTicket.id });
});

app.get('/api/admin/requests', (req, res) => {
  const db = loadDb();
  res.json(db.requests);
});

app.patch('/api/admin/requests/:id', (req, res) => {
  const { status } = req.body;
  const db = loadDb();
  const ticket = db.requests.find(r => r.id === parseInt(req.params.id));
  if (ticket) {
    ticket.status = status;
    saveDb(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Ticket not found" });
  }
});

// ----------------- MOBILE SCANNER & DISPATCH ROUTES -----------------
app.get('/api/mobile/item/:code', (req, res) => {
  const db = loadDb();
  const item = db.inventory.find(i => i.asset_code === req.params.code);
  if (item) res.json(item);
  else res.status(404).json({ error: "Asset tag not found" });
});

app.post('/api/mobile/dispatch', (req, res) => {
  const { asset_code, borrower_name, custodian_id } = req.body;
  const db = loadDb();
  const item = db.inventory.find(i => i.asset_code === asset_code);

  if (!item) return res.status(404).json({ error: "Item not registered" });
  if (item.quantity <= 0) return res.status(400).json({ error: "Item currently out of stock" });

  item.quantity -= 1;
  if (item.quantity === 0) item.status = "Out of Stock";

  db.borrow_logs.unshift({
    id: db.borrow_logs.length + 1,
    asset_code,
    borrower_name,
    custodian_id: custodian_id || "Desk-Custodian",
    released_at: new Date().toISOString()
  });

  saveDb(db);
  res.json({ success: true, message: `Dispatched ${item.name} to ${borrower_name}` });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`SmartTrack Core API running smoothly on port ${PORT}`);
});
