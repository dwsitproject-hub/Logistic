-- One row per run of the ME2N auto-load (the scheduled run, or an administrator's "Check now" on the COD dashboard).
-- Like sap_auto_import_runs, so "nothing happened at 06:30" is never a mystery: the row says whether the file was new, unchanged, missing,
-- or failed, and which file it was.

CREATE TABLE IF NOT EXISTS commercial_po_creator_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source VARCHAR(20) NOT NULL,                  -- 'cron' | 'manual'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  -- loaded | unchanged | no_file | source_missing | failed
  outcome       VARCHAR(20) NOT NULL,
  file_name     TEXT,
  file_hash     TEXT,
  file_mtime    TIMESTAMPTZ,
  rows_loaded   INTEGER,
  creators      INTEGER,
  conflicts     INTEGER,
  skipped       INTEGER,
  detail        TEXT,
  started_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_commercial_po_creator_runs_started ON commercial_po_creator_runs (started_at DESC);
