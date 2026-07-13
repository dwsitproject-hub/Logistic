-- Per-STO pipeline stage snapshot for fast status-filtered Shipments list pages.
--
-- Shipment status is derived in SQL (ATA ladder + SAP-closed flags), so a status
-- filter used to force the full derivation across every STO group before paging
-- (multi-second page loads on status-card clicks). This snapshot stores the derived
-- stage per STO key with its toolbar-scope dimensions, refreshed together with
-- shipment_pipeline_daily_summary (same freshness/staleness cycle as the status
-- cards the user clicks). The list read path pages STO keys from here and runs the
-- expensive row enrichment only for the visible page.
CREATE TABLE IF NOT EXISTS shipment_list_stage_snapshot (
  sto_key TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  group_plant TEXT NOT NULL,
  contract_date DATE NOT NULL,
  product TEXT NOT NULL DEFAULT 'Blank',
  incoterm TEXT NOT NULL DEFAULT 'Blank',
  last_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shipment_list_stage_snapshot_stage_order
  ON shipment_list_stage_snapshot (stage, last_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_shipment_list_stage_snapshot_dims
  ON shipment_list_stage_snapshot (contract_date, product, incoterm);

-- Force a refresh on next backend start so the new (empty) snapshot is populated
-- before the list read path uses it.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'shipment';
