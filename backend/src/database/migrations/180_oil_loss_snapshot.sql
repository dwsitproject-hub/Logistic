-- Pre-computed Oil Loss row set (the result of buildOilLossMainSql).
--
-- The page used to recompute this on a cold process: a full sap_processed_data scan on the
-- request, competing with the Shipments / Shipping Performance / Trucking warmers. Readers now
-- SELECT this table. A rebuild swaps rows in one transaction so the previous set stays visible
-- until commit. Filters and R1–R4 stay on the client, so the snapshot is unscoped.

CREATE TABLE IF NOT EXISTS oil_loss_snapshot (
  id UUID PRIMARY KEY,
  transport_mode TEXT,
  sto_type TEXT,
  operation_id TEXT,
  contract_number TEXT,
  contract_ext_no TEXT,
  sto_number TEXT,
  po_number TEXT,
  supplier TEXT,
  buyer TEXT,
  product TEXT,
  group_name TEXT,
  plant_site TEXT,
  vessel_name TEXT,
  contract_date TEXT,
  operation_date TEXT,
  incoterm TEXT,
  group_plant TEXT,
  quantity_contract NUMERIC,
  transporter TEXT,
  loading_location TEXT,
  unloading_location TEXT,
  status TEXT,
  quantity_delivery NUMERIC,
  quantity_received NUMERIC,
  quantity_sent NUMERIC,
  quantity_sfal NUMERIC,
  quantity_sfbd NUMERIC,
  gain_loss_amount NUMERIC,
  gain_loss_percentage NUMERIC
);

CREATE TABLE IF NOT EXISTS oil_loss_snapshot_meta (
  id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  refreshed_at TIMESTAMPTZ,
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT,
  logic_version INT NOT NULL DEFAULT 0,
  total_gain_kg NUMERIC NOT NULL DEFAULT 0,
  gain_count INT NOT NULL DEFAULT 0
);

INSERT INTO oil_loss_snapshot_meta (id, is_stale, logic_version)
VALUES ('global', TRUE, 0)
ON CONFLICT (id) DO NOTHING;
