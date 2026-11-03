-- 252_claim_data.sql
-- "Claim Data": one SAP export pair (OSCLAIM = outstanding, REALCLAIM = realised/paid) that carries
-- both MUTU (quality) and SUSUT (shortage) claims, split by TYPE OF CLAIM, and feeds Quality Claim
-- and Shortage Claim. It replaces the per-page monthly workbook uploads.
--
-- - claim_*_imports.source_kind: 'legacy' (the old monthly workbooks, kept as an archive and no
--   longer read once a claim_data import exists) | 'claim_data'.
-- - claim_*_imports.data_as_of: the "data as of" date the uploader states for the OS file.
-- - b2b_status on every claim row: B2B / DIRECT / UNMATCHED, from the Logistics Report (SAP master
--   `contract_latest_spd_snapshot.b2b_flag_raw`, matched on the claim's PO). NULL on legacy rows.
-- - claim_data_uploads: one row per uploaded file (OS or Real), for the Claim Data page's history.
-- - page.claim_data permission: ADMIN only.

ALTER TABLE claim_susut_imports
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS data_as_of DATE;

ALTER TABLE claim_mutu_imports
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS data_as_of DATE;

CREATE INDEX IF NOT EXISTS idx_claim_susut_imports_source ON claim_susut_imports (source_kind, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_mutu_imports_source ON claim_mutu_imports (source_kind, uploaded_at DESC);

ALTER TABLE claim_susut_rows ADD COLUMN IF NOT EXISTS b2b_status TEXT;
ALTER TABLE claim_susut_real_rows ADD COLUMN IF NOT EXISTS b2b_status TEXT;
ALTER TABLE claim_mutu_rows ADD COLUMN IF NOT EXISTS b2b_status TEXT;
ALTER TABLE claim_mutu_real_rows ADD COLUMN IF NOT EXISTS b2b_status TEXT;

-- The realised upsert deletes by CR number across imports.
CREATE INDEX IF NOT EXISTS idx_claim_susut_real_rows_cr_no ON claim_susut_real_rows (cr_no);
CREATE INDEX IF NOT EXISTS idx_claim_mutu_real_rows_cr_no ON claim_mutu_real_rows (cr_no);

CREATE TABLE IF NOT EXISTS claim_data_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL CHECK (kind IN ('os', 'real')),
  file_name TEXT NOT NULL,
  data_as_of DATE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  susut_import_id UUID REFERENCES claim_susut_imports(id) ON DELETE SET NULL,
  mutu_import_id UUID REFERENCES claim_mutu_imports(id) ON DELETE SET NULL,
  total_rows INT NOT NULL DEFAULT 0,
  susut_rows INT NOT NULL DEFAULT 0,
  mutu_rows INT NOT NULL DEFAULT 0,
  inserted_rows INT NOT NULL DEFAULT 0,
  replaced_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  b2b_rows INT NOT NULL DEFAULT 0,
  direct_rows INT NOT NULL DEFAULT 0,
  unmatched_rows INT NOT NULL DEFAULT 0,
  total_qty NUMERIC,
  total_amount_idr NUMERIC,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_data_uploads_kind_at ON claim_data_uploads (kind, uploaded_at DESC);

-- Permission (no unique constraint is assumed on permission_key; see 045).
UPDATE permissions
SET
  permission_name = COALESCE(permission_name, 'Claim Data'),
  description = COALESCE(description, 'Import SAP claim data (OSCLAIM / REALCLAIM)'),
  category = COALESCE(category, 'page')
WHERE permission_key = 'page.claim_data';

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT 'page.claim_data', 'Claim Data', 'Import SAP claim data (OSCLAIM / REALCLAIM)', 'page'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'page.claim_data'
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.claim_data'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- SAP Data is now called Logistics Data in the UI; keep the permission key.
UPDATE permissions SET permission_name = 'Logistics Data' WHERE permission_key = 'page.sap' AND permission_name <> 'Logistics Data';
