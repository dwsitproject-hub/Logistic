-- Tug (TB) and barge (BG) vessels, and the pairs they form.
--
-- SAP often sends one vessel name for a tug and a barge together ("TB. ARGO 10 / BG. SOLID 10") under one vessel code. KLIP knows the
-- barge, Podium (the map integration) knows the tug and recognises vessels by name proximity. Both are master vessel rows now, told apart by
-- vessel_role, and vessel_pairs says which tug pulled which barge - a deterministic map between the two names.
--
-- Additive and idempotent: existing vessels keep vessel_role NULL. Nothing is loaded here; the vessels and pairs come from
-- docs/scripts/load-vessel-master-bersih.cjs (dry run by default), so SIT can be tested before production.

ALTER TABLE master_vessels ADD COLUMN IF NOT EXISTS vessel_role VARCHAR(10);

ALTER TABLE master_vessels DROP CONSTRAINT IF EXISTS chk_master_vessels_role;
ALTER TABLE master_vessels
  ADD CONSTRAINT chk_master_vessels_role CHECK (vessel_role IS NULL OR vessel_role IN ('TB', 'BG'));

CREATE INDEX IF NOT EXISTS idx_master_vessels_role ON master_vessels (vessel_role) WHERE vessel_role IS NOT NULL;

CREATE TABLE IF NOT EXISTS vessel_pairs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_code             VARCHAR(20) NOT NULL UNIQUE,                       -- TBG-001 ...
  tb_master_vessel_id   UUID NOT NULL REFERENCES master_vessels(id) ON DELETE CASCADE,
  bg_master_vessel_id   UUID NOT NULL REFERENCES master_vessels(id) ON DELETE CASCADE,
  first_contract_date   DATE,
  last_contract_date    DATE,
  sap_rows_2026         INTEGER,
  note                  TEXT,
  source                VARCHAR(30) NOT NULL DEFAULT 'workbook_v2',
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_vessel_pairs_tb_bg UNIQUE (tb_master_vessel_id, bg_master_vessel_id)
);

CREATE INDEX IF NOT EXISTS idx_vessel_pairs_tb ON vessel_pairs (tb_master_vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_pairs_bg ON vessel_pairs (bg_master_vessel_id);

-- The names SAP actually sends for a pair ("TB. ARGO 10/BG SOLID 10"), kept as text: SAP cuts them at 35 characters, sometimes puts the
-- barge first, and one code can stand for several pairs, so a pair is found by this name and never by the vessel code.
CREATE TABLE IF NOT EXISTS vessel_pair_sap_names (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id               UUID NOT NULL REFERENCES vessel_pairs(id) ON DELETE CASCADE,
  sap_vessel_name       TEXT NOT NULL,
  normalized_sap_name   TEXT NOT NULL,                                     -- upper-case letters and digits only
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_vessel_pair_sap_names UNIQUE (pair_id, normalized_sap_name)
);

CREATE INDEX IF NOT EXISTS idx_vessel_pair_sap_names_norm ON vessel_pair_sap_names (normalized_sap_name);
