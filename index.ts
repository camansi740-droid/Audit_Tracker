import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve('auditflow.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS procedures (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    sr_no TEXT,
    area TEXT,
    procedure_text TEXT,
    risk_flag TEXT,
    allotted_to TEXT,
    status TEXT DEFAULT 'Pending',
    document_path TEXT,
    document_original_name TEXT,
    ai_result TEXT,
    client_remarks TEXT,
    team_remarks TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migration: Add area column if it doesn't exist
try {
  db.exec("ALTER TABLE procedures ADD COLUMN area TEXT;");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add updated_at column if it doesn't exist
try {
  db.exec("ALTER TABLE procedures ADD COLUMN updated_at TEXT;");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add custom_columns to clients
try {
  db.exec("ALTER TABLE clients ADD COLUMN custom_columns TEXT DEFAULT '[]';");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add custom_fields to procedures
try {
  db.exec("ALTER TABLE procedures ADD COLUMN custom_fields TEXT DEFAULT '{}';");
} catch (e) {
  // Column already exists, ignore
}

// Seed default settings if not exists
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
if (!getSetting.get('team_members')) {
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('team_members', JSON.stringify(['Alice', 'Bob', 'Charlie']));
}

// Migration: Add parent_id column if it doesn't exist
try {
  db.exec("ALTER TABLE procedures ADD COLUMN parent_id TEXT REFERENCES procedures(id) ON DELETE CASCADE;");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add category column if it doesn't exist
try {
  db.exec("ALTER TABLE procedures ADD COLUMN category TEXT DEFAULT 'Audit Procedures';");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add client background fields
try {
  db.exec("ALTER TABLE clients ADD COLUMN entity_type TEXT;");
} catch (e) {}
try {
  db.exec("ALTER TABLE clients ADD COLUMN nature_of_business TEXT;");
} catch (e) {}
try {
  db.exec("ALTER TABLE clients ADD COLUMN business_model TEXT;");
} catch (e) {}

export default db;
