-- 041_create_claim_mutu_tables.sql
-- Claim Mutu: store uploaded SAP quality claim outstanding (OSCLAIM) excel rows.

CREATE TABLE IF NOT EXISTS claim_mutu_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name TEXT NOT NULL,
  sheet_name TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_rows INT DEFAULT 0,
  inserted_rows INT DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_claim_mutu_imports_uploaded_at
  ON claim_mutu_imports (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS claim_mutu_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID NOT NULL REFERENCES claim_mutu_imports(id) ON DELETE CASCADE,

  vendor_code TEXT,
  vendor_name TEXT,
  group_name TEXT,
  cargo_source TEXT,
  created_by TEXT,
  sta TEXT,
  crno TEXT,
  cr_date DATE,
  os_days INT,
  dest TEXT,
  po_number TEXT,
  contract_ext_no TEXT,
  comm TEXT,
  product TEXT,
  uom TEXT,
  currency TEXT,
  company_code TEXT,

  mutu_klaim_ffa NUMERIC,
  mutu_klaim_mi NUMERIC,
  mutu_klaim_dns NUMERIC,
  mutu_klaim_dobi NUMERIC,
  mutu_klaim_stone NUMERIC,

  qty_claim_kg NUMERIC,
  amount_after_tax_idr NUMERIC,

  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claim_mutu_rows_import
  ON claim_mutu_rows (import_id);

CREATE INDEX IF NOT EXISTS idx_claim_mutu_rows_vendor_code
  ON claim_mutu_rows (vendor_code);

CREATE INDEX IF NOT EXISTS idx_claim_mutu_rows_po
  ON claim_mutu_rows (po_number);

CREATE INDEX IF NOT EXISTS idx_claim_mutu_rows_contract_ext
  ON claim_mutu_rows (contract_ext_no);

