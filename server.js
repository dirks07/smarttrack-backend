// server.js - Unified SmartTrack API
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const JWT_SECRET = 'smarttrack_secret_key_cdm_2026';

app.use(cors());
app.use(express.json());

// 1. Initialize SQLite Database
const db = new sqlite3.Database('./smarttrack.db', (err) => {
  if (err) console.error('DB Connection Failed:', err.message);
  else console.log('Connected to SmartTrack SQLite DB.');
});

// 2. Auto-seed tables & initial mock data
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT UNIQUE,
    name TEXT,
    category TEXT,
    quantity INTEGER,
    status TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_name TEXT,
    requester_dept TEXT,
    item_name TEXT,
    quantity INTEGER,
    purpose TEXT,
    status TEXT DEFAULT 'PENDING'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS borrow_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT,
    borrower_name TEXT,
    dispatched_by TEXT,
    status TEXT DEFAULT 'DISPATCHED',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert starter items if empty
  db.get('SELECT COUNT(*) as count FROM assets', (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO assets (asset_code, name, category, quantity, status) VALUES 
        ('CDM-EQ-001', 'Epson Projector EB-X06', 'Equipment', 5, 'Available'),
        ('CDM-EQ-002', 'Dell Latitude 3420 Laptop', 'Equipment', 12, 'Available'),
        ('CDM-SP-101', 'A4 Ream Copy Paper 80gsm', 'Supplies', 150, 'Available'),
        ('CDM-EQ-003', 'HDMI 10m Cable Roll', 'Equipment', 20, 'Available')`);
      console.log('Seeded initial mock inventory.');
    }
  });
});

// --- PUBLIC WEBSITE ENDPOINTS ---
app.get('/api/public/inventory', (req, res) => {
  db.all('SELECT asset_code, name, category, quantity, status FROM assets', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/public/requests', (req, res) => {
  const { requester_name, requester_dept, item_name, quantity, purpose } = req.body;
  if (!requester_name || !item_name || !quantity) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const query = `INSERT INTO requests (requester_name, requester_dept, item_name, quantity, purpose) VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [requester_name, requester_dept, item_name, quantity, purpose], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ message: 'Request submitted successfully', requestId: this.lastID });
  });
});

// --- ADMIN WEB APP ENDPOINTS ---
app.get('/api/admin/requests', (req, res) => {
  db.all('SELECT * FROM requests ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.patch('/api/admin/requests/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.run('UPDATE requests SET status = ? WHERE id = ?', [status, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Request #${id} updated to ${status}` });
  });
});

app.post('/api/admin/inventory', (req, res) => {
  const { asset_code, name, category, quantity, status } = req.body;
  db.run(`INSERT INTO assets (asset_code, name, category, quantity, status) VALUES (?, ?, ?, ?, ?)`,
    [asset_code, name, category, quantity, status], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, asset_code });
    });
});

// --- MOBILE COMPANION APP ENDPOINTS ---
app.get('/api/mobile/item/:asset_code', (req, res) => {
  const { asset_code } = req.params;
  db.get('SELECT * FROM assets WHERE asset_code = ?', [asset_code], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Asset tag not found' });
    res.json(row);
  });
});

app.post('/api/mobile/dispatch', (req, res) => {
  const { asset_code, borrower_name, custodian_id } = req.body;
  db.serialize(() => {
    db.run('UPDATE assets SET status = "Borrowed", quantity = quantity - 1 WHERE asset_code = ? AND quantity > 0', [asset_code]);
    db.run('INSERT INTO borrow_logs (asset_code, borrower_name, dispatched_by) VALUES (?, ?, ?)',
      [asset_code, borrower_name, custodian_id || 'Mobile-Custodian'], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Asset ${asset_code} successfully dispatched to ${borrower_name}` });
      });
  });
});

app.listen(PORT, () => {
  console.log(`SmartTrack Core API running on http://localhost:${PORT}`);
});