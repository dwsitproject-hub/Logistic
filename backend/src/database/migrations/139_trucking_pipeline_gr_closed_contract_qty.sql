-- Trucking daily snapshot: contract qty for GR-Close POs (Completed / Cancelled).
-- Live summaryOnly then expands only GR-Open POs (WB can still move those).
-- Bump TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION when applying.

ALTER TABLE trucking_pipeline_daily_summary
  ADD COLUMN IF NOT EXISTS completed_gr_closed_contract_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_gr_closed_contract_qty NUMERIC NOT NULL DEFAULT 0;

UPDATE pipeline_summary_refresh_meta
   SET is_stale = TRUE
 WHERE module = 'trucking';
