-- Claim Mutu: the OS and Real claims of the monthly SAP workbook, with the claim team's B2B marking.
--
-- The workbook carries OS and Real twice, Include B2B and Exclude B2B, plus four summary sheets.
-- The summaries are recomputed from the detail rows rather than imported - on the 31 Aug 2026 file
-- every cell of all four reproduces exactly (Summary Per Komoditi 96/96, Rekap Per Lokasi 28/28 and
-- Pivot 16/16 from the Exclude rows; Summary Per Unit 72/72 from the Include rows).
--
-- The Include rows are stored and each is marked is_b2b when the Exclude sheet of the same file does
-- not contain it. B2B here is the claim team's own classification: it follows from no column, and it
-- disagrees with SAP's B2B flag (3 of the 10 POs they treat as B2B are DIRECT in SAP), so it cannot
-- be recomputed from anything KLIP holds - only taken from the file.
--
-- period_month places an import on the Summary Per Unit trend, one point per month, read from the
-- file's own PERIODE label.

ALTER TABLE claim_mutu_imports
  ADD COLUMN IF NOT EXISTS os_period_label TEXT,
  ADD COLUMN IF NOT EXISTS period_month DATE,
  -- 'inc+exc' when both OS sheets were read and B2B is known; 'exc-only' / 'inc-only' / 'legacy'
  -- when it is not, so the page can say so instead of presenting a guess.
  ADD COLUMN IF NOT EXISTS b2b_source TEXT,
  ADD COLUMN IF NOT EXISTS real_sheet_name TEXT,
  ADD COLUMN IF NOT EXISTS real_period_label TEXT,
  ADD COLUMN IF NOT EXISTS real_total_rows INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS real_inserted_rows INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_claim_mutu_imports_period ON claim_mutu_imports (period_month);

ALTER TABLE claim_mutu_rows
  ADD COLUMN IF NOT EXISTS is_b2b BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS group_of_vendor TEXT,
  ADD COLUMN IF NOT EXISTS vendor_type TEXT,
  ADD COLUMN IF NOT EXISTS keterangan TEXT,
  ADD COLUMN IF NOT EXISTS metode_payment TEXT,
  -- 3RD PARTY (SUPPLIER) / (SURVEYOR) / (TRANSPORTIR) / INTERCO (...): the Pivot's rows.
  ADD COLUMN IF NOT EXISTS claim_group TEXT,
  ADD COLUMN IF NOT EXISTS type_of_comp TEXT,
  ADD COLUMN IF NOT EXISTS traders TEXT,
  ADD COLUMN IF NOT EXISTS material_description TEXT,
  -- DEST mapped to the discharge unit the summaries name (BTG -> BONTANG, KRG/KRW -> KARAWANG, ...).
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS claim_type TEXT,
  ADD COLUMN IF NOT EXISTS mutu_kontrak_ffa NUMERIC,
  ADD COLUMN IF NOT EXISTS mutu_kontrak_mi NUMERIC,
  ADD COLUMN IF NOT EXISTS mutu_kontrak_dns NUMERIC,
  ADD COLUMN IF NOT EXISTS mutu_kontrak_dobi NUMERIC,
  ADD COLUMN IF NOT EXISTS amount_before_tax_idr NUMERIC,
  ADD COLUMN IF NOT EXISTS tax NUMERIC;

CREATE TABLE IF NOT EXISTS claim_mutu_real_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID NOT NULL REFERENCES claim_mutu_imports(id) ON DELETE CASCADE,
  is_b2b BOOLEAN NOT NULL DEFAULT FALSE,

  vendor_code TEXT,
  vendor_name TEXT,
  group_key TEXT,
  vendor_type TEXT,
  cargo_source TEXT,
  traders TEXT,
  kebun TEXT,
  cr_no TEXT NOT NULL,
  claim_date DATE,
  cm_no TEXT,
  cm_date DATE,
  po_number TEXT,
  contract_ext_no TEXT,
  comm TEXT,
  commodity TEXT,
  material_description TEXT,
  dest TEXT,
  unit TEXT,
  status_claim TEXT,
  company_code TEXT,
  mutu_kontrak_ffa NUMERIC,
  mutu_kontrak_mi NUMERIC,
  mutu_kontrak_dns NUMERIC,
  mutu_kontrak_dobi NUMERIC,
  mutu_klaim_ffa NUMERIC,
  mutu_klaim_mi NUMERIC,
  mutu_klaim_dns NUMERIC,
  mutu_klaim_dobi NUMERIC,
  claim_type TEXT,
  qty_kg NUMERIC,
  uom TEXT,
  amount_before_tax_idr NUMERIC,
  tax NUMERIC,
  amount_after_tax_idr NUMERIC,

  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_claim_mutu_real_rows_import ON claim_mutu_real_rows (import_id);
