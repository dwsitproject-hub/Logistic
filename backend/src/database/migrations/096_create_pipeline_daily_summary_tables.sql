-- Daily pre-aggregated pipeline status counts for Trucking + Shipments pages.
-- Refreshed on schedule / after SAP import; read path uses date + group_plant rollups.

CREATE TABLE IF NOT EXISTS trucking_pipeline_daily_summary (
  group_plant TEXT NOT NULL,
  contract_date DATE NOT NULL,
  total_count BIGINT NOT NULL DEFAULT 0,
  unplanned_execution_count BIGINT NOT NULL DEFAULT 0,
  planned_count BIGINT NOT NULL DEFAULT 0,
  in_progress_count BIGINT NOT NULL DEFAULT 0,
  loading_count BIGINT NOT NULL DEFAULT 0,
  in_transit_count BIGINT NOT NULL DEFAULT 0,
  unloading_count BIGINT NOT NULL DEFAULT 0,
  completed_count BIGINT NOT NULL DEFAULT 0,
  cancelled_count BIGINT NOT NULL DEFAULT 0,
  unplanned_contract_backlog BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (group_plant, contract_date)
);

CREATE INDEX IF NOT EXISTS idx_trucking_pipeline_daily_summary_contract_date
  ON trucking_pipeline_daily_summary (contract_date);

CREATE TABLE IF NOT EXISTS shipment_pipeline_daily_summary (
  group_plant TEXT NOT NULL,
  contract_date DATE NOT NULL,
  total_count BIGINT NOT NULL DEFAULT 0,
  planned_count BIGINT NOT NULL DEFAULT 0,
  at_loading_port_count BIGINT NOT NULL DEFAULT 0,
  sailed_count BIGINT NOT NULL DEFAULT 0,
  at_discharge_port_count BIGINT NOT NULL DEFAULT 0,
  completed_count BIGINT NOT NULL DEFAULT 0,
  cancelled_count BIGINT NOT NULL DEFAULT 0,
  loading_port_arrived_count BIGINT NOT NULL DEFAULT 0,
  loading_port_berthed_count BIGINT NOT NULL DEFAULT 0,
  loading_port_loading_count BIGINT NOT NULL DEFAULT 0,
  loading_port_completed_loading_count BIGINT NOT NULL DEFAULT 0,
  discharge_port_arrived_count BIGINT NOT NULL DEFAULT 0,
  discharge_port_berthed_count BIGINT NOT NULL DEFAULT 0,
  discharge_port_unloading_count BIGINT NOT NULL DEFAULT 0,
  unplanned_contract_backlog BIGINT NOT NULL DEFAULT 0,
  unplanned_shipment_execution BIGINT NOT NULL DEFAULT 0,
  eta_loading_more_than_7d BIGINT NOT NULL DEFAULT 0,
  eta_loading_d_minus_2 BIGINT NOT NULL DEFAULT 0,
  eta_loading_d BIGINT NOT NULL DEFAULT 0,
  eta_loading_delay BIGINT NOT NULL DEFAULT 0,
  eta_loading_no_eta BIGINT NOT NULL DEFAULT 0,
  eta_discharge_more_than_7d BIGINT NOT NULL DEFAULT 0,
  eta_discharge_d_minus_2 BIGINT NOT NULL DEFAULT 0,
  eta_discharge_d BIGINT NOT NULL DEFAULT 0,
  eta_discharge_delay BIGINT NOT NULL DEFAULT 0,
  eta_discharge_no_eta BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (group_plant, contract_date)
);

CREATE INDEX IF NOT EXISTS idx_shipment_pipeline_daily_summary_contract_date
  ON shipment_pipeline_daily_summary (contract_date);

CREATE TABLE IF NOT EXISTS pipeline_summary_refresh_meta (
  module TEXT PRIMARY KEY CHECK (module IN ('trucking', 'shipment')),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  row_count BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT
);

INSERT INTO pipeline_summary_refresh_meta (module, is_stale)
VALUES ('trucking', TRUE), ('shipment', TRUE)
ON CONFLICT (module) DO NOTHING;
