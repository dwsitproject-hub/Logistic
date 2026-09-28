-- Claim Susut: keep REAL_CLAIM (claims approved in the period) next to the outstanding rows.
--
-- The SAP export is one workbook - PIVOT, OS_CLAIM, REAL_CLAIM. OS_CLAIM stays the main data and
-- is mandatory. REAL_CLAIM is read from the same upload when present, for the Section 1 realisation
-- dashboard, because it cannot be derived from OS_CLAIM: an approved claim leaves the outstanding
-- list. In the 31 Aug 2026 file none of the 5 realised CRs appears in OS_CLAIM, and two of them were
-- opened and approved inside the same month, so no month-end OS snapshot ever contained them.
--
-- Rows belong to the upload that brought them (import_id), exactly like claim_susut_rows, so the
-- page's "active import" shows the outstanding and the realisation of the same file.

ALTER TABLE claim_susut_imports
  ADD COLUMN IF NOT EXISTS os_period_label TEXT,
  ADD COLUMN IF NOT EXISTS real_sheet_name TEXT,
  ADD COLUMN IF NOT EXISTS real_period_label TEXT,
  ADD COLUMN IF NOT EXISTS real_total_rows INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS real_inserted_rows INT NOT NULL DEFAULT 0;

-- The current export has MATERIAL DESCRIPTION; the old one did not, so it was only ever in raw.
ALTER TABLE claim_susut_rows
  ADD COLUMN IF NOT EXISTS material_description TEXT;

CREATE TABLE IF NOT EXISTS claim_susut_real_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID NOT NULL REFERENCES claim_susut_imports(id) ON DELETE CASCADE,

  vendor_code TEXT,
  vendor_name TEXT,
  cargo_source TEXT,
  cr_no TEXT NOT NULL,
  claim_date DATE,
  cm_date DATE,
  po_cn_date DATE,
  po_number TEXT,
  comm TEXT,
  commodity TEXT,
  material_description TEXT,
  dest TEXT,
  status_claim TEXT,
  company_code TEXT,
  type_of_claim TEXT,
  currency TEXT,
  qty_approved NUMERIC,
  uom TEXT,
  amount_before_tax_idr NUMERIC,
  tax NUMERIC,
  amount_after_tax_idr NUMERIC,
  remarks TEXT,
  -- SURVEYOR / TRUCKING / VESSEL VOYAGE / VESSEL TC: the part of KETERANGAN before the first "//".
  -- REAL_CLAIM has no GROUP column; OS_CLAIM writes the same word first in its KETERANGAN too.
  transport_group TEXT,

  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claim_susut_real_rows_import ON claim_susut_real_rows (import_id);
