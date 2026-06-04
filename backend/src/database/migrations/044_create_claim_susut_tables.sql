-- 044_create_claim_susut_tables.sql
-- Claim Susut: store uploaded SAP claim susut outstanding excel rows.

CREATE TABLE IF NOT EXISTS claim_susut_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name TEXT NOT NULL,
  sheet_name TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_rows INT DEFAULT 0,
  inserted_rows INT DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_claim_susut_imports_uploaded_at
  ON claim_susut_imports (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS claim_susut_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID NOT NULL REFERENCES claim_susut_imports(id) ON DELETE CASCADE,

  vendor_code TEXT,
  vendor_name TEXT,
  vendor_type TEXT,
  created_by TEXT,
  sta TEXT,
  crno TEXT,
  cr_date DATE,
  os_days INT,
  group_of_transport TEXT,
  payment_method TEXT,
  dest TEXT,
  po_number TEXT,
  contract_ext_no TEXT,
  comm TEXT,
  commodity TEXT,
  uom TEXT,
  currency TEXT,
  company_code TEXT,
  remarks TEXT,
  type TEXT,
  qty_claim NUMERIC,
  amount_before_tax_idr NUMERIC,
  tax NUMERIC,
  amount_after_tax_idr NUMERIC,

  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claim_susut_rows_import
  ON claim_susut_rows (import_id);

CREATE INDEX IF NOT EXISTS idx_claim_susut_rows_vendor_code
  ON claim_susut_rows (vendor_code);

CREATE INDEX IF NOT EXISTS idx_claim_susut_rows_po
  ON claim_susut_rows (po_number);

CREATE INDEX IF NOT EXISTS idx_claim_susut_rows_contract_ext
  ON claim_susut_rows (contract_ext_no);

