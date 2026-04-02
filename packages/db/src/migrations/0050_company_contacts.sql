CREATE TABLE IF NOT EXISTS company_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'google',
  source_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_contact_source ON company_contacts (company_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_company_contacts_company ON company_contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_company_contacts_search ON company_contacts (company_id, name, email, phone);
