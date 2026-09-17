-- Pre-computed Contract Performance row set (the `base` aggregate of getLatePerformanceData).
--
-- Why: measured 2026-09-04, the cold load spent ~182s recomputing per-contract values that only
-- change when SAP data changes - dominated by the qty_move live path for current-year Open
-- contracts (~62s) and the SAP GR-status expression (~68s). Tuning those in place was tried and
-- rejected: consolidating GR status' repeated latest-import lookup into a LATERAL produced
-- identical output but ran 67% slower, because the inlined form sits inside EXISTS and
-- short-circuits. Precomputing is the route that actually reaches the <3s target.
--
-- Stored WITHOUT any user filter or date range so one snapshot serves every filter combination
-- and every date range: per-contract values are date-independent (qty_move / latest_spd / sto_agg
-- are per-contract lookups, and the sibling set was verified to satisfy
-- scoped == unscoped INTERSECT scope). Filters and the B2B-child / PO-placeholder exclusions stay
-- on the read path, exactly as they are today.
--
-- The filterable values are real columns rather than JSON extractions precisely so they can be
-- indexed - deriving Region/Site from sap_processed_data JSON per row is what makes that filter
-- slow on Contracts, Trucking, Shipments and Oil Loss too, so those pages can eventually read
-- this same shape.

CREATE TABLE IF NOT EXISTS contract_performance_snapshot (
  contract_id TEXT PRIMARY KEY,
  id UUID,
  contract_date DATE,
  product TEXT,
  group_name TEXT,
  supplier TEXT,
  incoterm TEXT,
  quantity_ordered NUMERIC,
  transport_mode TEXT,
  source_type TEXT,
  status TEXT,
  plant_code TEXT,
  plant_site TEXT,
  company_name TEXT,
  import_status TEXT,
  delivery_end_date DATE,
  cargo_readiness_date DATE,
  latest_spd_data JSONB,
  total_sto_quantity NUMERIC,
  quantity_delivery NUMERIC,
  quantity_receive NUMERIC,
  quantity_delivery_sap NUMERIC,
  outstanding_quantity NUMERIC,
  last_trucking_daily_deliverable_date DATE,
  last_trucking_completion_date DATE,
  last_trucking_wb_actuals_date DATE,
  last_ata_vessel_complete_discharge DATE,
  last_eta_vessel_complete_discharge DATE,
  open_standard_eta_trucking DATE,
  open_standard_eta_vessel_loading DATE,
  in_logistics_open_os BOOLEAN,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- contract_date leads every read (the page always scopes by date range), so it carries the
-- composite indexes for the two filters users change most often.
CREATE INDEX IF NOT EXISTS idx_cp_snapshot_contract_date
  ON contract_performance_snapshot (contract_date);
CREATE INDEX IF NOT EXISTS idx_cp_snapshot_date_product
  ON contract_performance_snapshot (contract_date, product);
CREATE INDEX IF NOT EXISTS idx_cp_snapshot_date_plant_site
  ON contract_performance_snapshot (contract_date, plant_site);
CREATE INDEX IF NOT EXISTS idx_cp_snapshot_id
  ON contract_performance_snapshot (id);
-- product is filtered with ILIKE '%value%' (a tab like "POME" must match "WASTE OIL (POME)"),
-- which no btree index can serve - mirrors idx_contracts_product_trgm.
CREATE INDEX IF NOT EXISTS idx_cp_snapshot_product_trgm
  ON contract_performance_snapshot USING gin (product gin_trgm_ops);

CREATE TABLE IF NOT EXISTS contract_performance_snapshot_meta (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT
);

INSERT INTO contract_performance_snapshot_meta (id, is_stale)
VALUES ('global', TRUE)
ON CONFLICT (id) DO NOTHING;
