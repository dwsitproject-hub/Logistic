-- Distinct vessels per Shipments-page pipeline stage, by toolbar-scope dimensions.
--
-- Companion to shipment_pipeline_daily_summary: distinct counts are not additive, so
-- instead of storing per-day counts we store the distinct (dims, stage, vessel) facts
-- and COUNT(DISTINCT vessel_key) at read time for whatever scope is requested.
CREATE TABLE IF NOT EXISTS shipment_pipeline_vessel_stage_daily (
  group_plant TEXT NOT NULL,
  contract_date DATE NOT NULL,
  product TEXT NOT NULL DEFAULT 'Blank',
  incoterm TEXT NOT NULL DEFAULT 'Blank',
  stage TEXT NOT NULL,
  vessel_key TEXT NOT NULL,
  PRIMARY KEY (group_plant, contract_date, product, incoterm, stage, vessel_key)
);

CREATE INDEX IF NOT EXISTS idx_shipment_pipeline_vessel_stage_daily_dims
  ON shipment_pipeline_vessel_stage_daily (contract_date, product, incoterm);

-- Force a refresh on next backend start so the new (empty) vessel table is populated
-- before the daily read path serves vessel counts.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'shipment';

