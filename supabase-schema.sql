-- ============================================================
-- AuditFlow AI — Complete Supabase Schema
-- Supabase Dashboard → SQL Editor mein poora paste karo
-- ============================================================

-- 1. Clients table
CREATE TABLE IF NOT EXISTS clients (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  entity_type         TEXT,
  nature_of_business  TEXT,
  business_model      TEXT,
  custom_columns      TEXT DEFAULT '[]',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Procedures table
CREATE TABLE IF NOT EXISTS procedures (
  id                     TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sr_no                  TEXT,
  area                   TEXT,
  procedure_text         TEXT,
  risk_flag              TEXT,
  allotted_to            TEXT,
  status                 TEXT DEFAULT 'Pending',
  document_path          TEXT,
  document_original_name TEXT,
  ai_result              TEXT,
  client_remarks         TEXT,
  team_remarks           TEXT,
  custom_fields          TEXT DEFAULT '{}',
  parent_id              TEXT REFERENCES procedures(id) ON DELETE CASCADE,
  category               TEXT DEFAULT 'Audit Procedures',
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  -- Audit Trail
  status_changed_by      TEXT,
  status_changed_at      TIMESTAMPTZ,
  status_history         TEXT DEFAULT '[]',
  status_flags           TEXT DEFAULT '[]'
);

-- 3. Settings table
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Seed default settings
INSERT INTO settings (key, value)
VALUES ('team_members', '["Alice", "Bob", "Charlie"]')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_clients"    ON clients    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_procedures" ON procedures FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_settings"   ON settings   FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- MIGRATION — Agar table pehle se exist karti hai to yeh run karo
-- (Safe hai — column already hai to kuch nahi karega)
-- ============================================================
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS status_changed_by TEXT;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS status_changed_at  TIMESTAMPTZ;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS status_history     TEXT DEFAULT '[]';
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS status_flags       TEXT DEFAULT '[]';
