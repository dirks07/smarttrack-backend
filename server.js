const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'data.json');

// Initial seed data
const initialData = {
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

// Load or initialize JSON DB
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return initialData;
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------------- API ROUTES ----------------

// Root health check
app.get('/', (req, res) => {
  res.json({ message: "SmartTrack Core API running smoothly." });
});

// 1. PUBLIC PORTAL: Live inventory catalog
app.get('/api/public/inventory', (req, res) => {
  const db = loadDb();
  res.json(db.inventory);
});

// 2. PUBLIC PORTAL: Submit requisition ticket
app.post('/api/public/requests', (req, res) => {
  const { requester_name, department, item_name, quantity, purpose } = req.body;
  if (!requester_name || !item_name || !quantity) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const db = loadDb();
  const newTicket = {
    id: db.requests.length + 1,
    requester_name,
    department,
    item_name,
    quantity: parseInt(quantity),
    purpose,
    status: 'PENDING',
    created_at: new Date().toISOString()
  };
  db.requests.unshift(newTicket);
  saveDb(db);
  res.json({ success: true, ticket_id: newTicket.id });
});

// 3. ADMIN PORTAL: Get all pending & approved requests
app.get('/api/admin/requests', (req, res) => {
  const db = loadDb();
  res.json(db.requests);
});

// 4. ADMIN PORTAL: Update request ticket status
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

// 5. ADMIN PORTAL: Add inventory item
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

// 6. MOBILE APP: Quick barcode/asset lookup
app.get('/api/mobile/item/:code', (req, res) => {
  const db = loadDb();
  const item = db.inventory.find(i => i.asset_code === req.params.code);
  if (item) {
    res.json(item);
  } else {
    res.status(404).json({ error: "Asset tag not found" });
  }
});

// 7. MOBILE APP: Confirm warehouse dispatch & decrement stock
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
