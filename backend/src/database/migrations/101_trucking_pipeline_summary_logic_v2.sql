-- Trucking pipeline COMPLETED = GR Close + OS Qty tolerance (v2 logic).
ALTER TABLE pipeline_summary_refresh_meta
  ADD COLUMN IF NOT EXISTS logic_version INTEGER NOT NULL DEFAULT 1;

UPDATE pipeline_summary_refresh_meta
SET is_stale = TRUE,
    logic_version = 1
WHERE module = 'trucking';
