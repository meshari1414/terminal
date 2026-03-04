const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'terminal.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  paid REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  members_json TEXT NOT NULL,
  expenses_json TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const memberCount = db.prepare('SELECT COUNT(*) AS count FROM members').get().count;
if (memberCount === 0) {
  const seedNames = ['مشاري', 'ابو بدر', 'ابو ريان', 'وليد', 'خالد', 'مشعل', 'سلمان'];
  const insertSeed = db.prepare('INSERT INTO members (name, paid) VALUES (?, 0)');
  const seedTx = db.transaction((names) => {
    for (const name of names) insertSeed.run(name);
  });
  seedTx(seedNames);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOriginPattern.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/members', (req, res) => {
  const rows = db.prepare('SELECT id, name, paid FROM members ORDER BY id ASC').all();
  res.json(rows);
});

app.post('/api/members', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare('INSERT INTO members (name, paid) VALUES (?, 0)').run(name);
  const row = db.prepare('SELECT id, name, paid FROM members WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.patch('/api/members/:id/paid', (req, res) => {
  const id = Number(req.params.id);
  const paid = Number(req.body?.paid);

  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  if (!Number.isFinite(paid) || paid < 0) return res.status(400).json({ error: 'invalid paid value' });

  const result = db.prepare('UPDATE members SET paid = ? WHERE id = ?').run(paid, id);
  if (result.changes === 0) return res.status(404).json({ error: 'member not found' });

  const row = db.prepare('SELECT id, name, paid FROM members WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/api/members/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

  const result = db.prepare('DELETE FROM members WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'member not found' });

  res.status(204).send();
});

app.get('/api/expenses', (req, res) => {
  const rows = db
    .prepare('SELECT id, description AS desc, amount, created_at AS createdAt FROM expenses ORDER BY id DESC')
    .all();
  res.json(rows);
});

app.post('/api/expenses', (req, res) => {
  const desc = String(req.body?.desc || '').trim();
  const amount = Number(req.body?.amount);

  if (!desc) return res.status(400).json({ error: 'description is required' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'invalid amount' });

  const result = db.prepare('INSERT INTO expenses (description, amount) VALUES (?, ?)').run(desc, amount);
  const row = db
    .prepare('SELECT id, description AS desc, amount, created_at AS createdAt FROM expenses WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.delete('/api/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'expense not found' });

  res.status(204).send();
});

app.get('/api/archive/latest', (req, res) => {
  const row = db
    .prepare('SELECT archived_at AS archivedAt FROM archives ORDER BY id DESC LIMIT 1')
    .get();
  res.json({ archivedAt: row ? row.archivedAt : null });
});

app.post('/api/archive', (req, res) => {
  const membersRows = db.prepare('SELECT id, name, paid FROM members ORDER BY id ASC').all();
  const expensesRows = db
    .prepare('SELECT id, description AS desc, amount, created_at AS createdAt FROM expenses ORDER BY id DESC')
    .all();

  const tx = db.transaction(() => {
    const insert = db.prepare(
      'INSERT INTO archives (members_json, expenses_json) VALUES (?, ?)'
    );
    const result = insert.run(JSON.stringify(membersRows), JSON.stringify(expensesRows));

    db.prepare('DELETE FROM members').run();
    db.prepare('DELETE FROM expenses').run();

    return db
      .prepare('SELECT id, archived_at AS archivedAt FROM archives WHERE id = ?')
      .get(result.lastInsertRowid);
  });

  const archiveRecord = tx();
  res.status(201).json(archiveRecord);
});

app.get('/api/archives', (req, res) => {
  const rows = db
    .prepare('SELECT id, members_json AS membersJson, expenses_json AS expensesJson, archived_at AS archivedAt FROM archives ORDER BY id DESC')
    .all();

  const mapped = rows.map((row) => {
    let membersCount = 0;
    let expensesCount = 0;
    let members = [];
    let expenses = [];

    try {
      const parsedMembers = JSON.parse(row.membersJson);
      const parsedExpenses = JSON.parse(row.expensesJson);
      membersCount = Array.isArray(parsedMembers) ? parsedMembers.length : 0;
      expensesCount = Array.isArray(parsedExpenses) ? parsedExpenses.length : 0;
      members = Array.isArray(parsedMembers)
        ? parsedMembers
            .map((member) => ({
              name: String(member?.name || '').trim(),
              paid: Number(member?.paid) || 0
            }))
            .filter((member) => member.name)
        : [];
      expenses = Array.isArray(parsedExpenses)
        ? parsedExpenses
            .map((expense) => ({
              desc: String(expense?.desc || expense?.description || '').trim(),
              amount: Number(expense?.amount) || 0
            }))
            .filter((expense) => expense.desc)
        : [];
    } catch (_) {}

    return {
      id: row.id,
      archivedAt: row.archivedAt,
      membersCount,
      expensesCount,
      members,
      expenses
    };
  });

  res.json(mapped);
});

app.post('/api/archives/:id/restore', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

  const archive = db
    .prepare('SELECT members_json AS membersJson, expenses_json AS expensesJson, archived_at AS archivedAt FROM archives WHERE id = ?')
    .get(id);

  if (!archive) return res.status(404).json({ error: 'archive not found' });

  let members;
  let expenses;
  try {
    members = JSON.parse(archive.membersJson);
    expenses = JSON.parse(archive.expensesJson);
  } catch (_) {
    return res.status(500).json({ error: 'archive data is corrupted' });
  }

  if (!Array.isArray(members) || !Array.isArray(expenses)) {
    return res.status(500).json({ error: 'archive data is invalid' });
  }

  const restoreTx = db.transaction(() => {
    db.prepare('DELETE FROM members').run();
    db.prepare('DELETE FROM expenses').run();

    const insertMember = db.prepare('INSERT INTO members (name, paid) VALUES (?, ?)');
    const insertExpense = db.prepare('INSERT INTO expenses (description, amount) VALUES (?, ?)');

    for (const member of members) {
      const name = String(member?.name || '').trim();
      const paid = Number(member?.paid);
      if (!name) continue;
      insertMember.run(name, Number.isFinite(paid) && paid >= 0 ? paid : 0);
    }

    for (const expense of expenses) {
      const desc = String(expense?.desc || expense?.description || '').trim();
      const amount = Number(expense?.amount);
      if (!desc) continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      insertExpense.run(desc, amount);
    }
  });

  restoreTx();
  res.json({ restored: true, archiveId: id, archivedAt: archive.archivedAt });
});

app.delete('/api/archives/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

  const result = db.prepare('DELETE FROM archives WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'archive not found' });

  res.status(204).send();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'terminal.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
