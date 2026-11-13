-- One row per run of the Claim Data auto-import (the 07:00 schedule, or an administrator's Sync on the Import Claim Data page).
-- Same idea as sap_auto_import_runs and commercial_po_creator_runs: "nothing happened at 07:00" is never a mystery, because the row says whether
-- the file was new, unchanged, missing or failed, and which file it was.

CREATE TABLE IF NOT EXISTS claim_data_auto_import_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source VARCHAR(20) NOT NULL,                  -- 'cron' | 'manual'
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  -- imported | unchanged | no_file | source_missing | failed
  outcome        VARCHAR(20) NOT NULL,
  file_name      TEXT,
  file_hash      TEXT,
  file_mtime     TIMESTAMPTZ,
  upload_id      UUID,                                  -- claim_data_uploads.id of the import this run made
  total_rows     INTEGER,
  failed_rows    INTEGER,
  detail         TEXT,
  started_by     UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_data_auto_import_runs_started ON claim_data_auto_import_runs (started_at DESC);
