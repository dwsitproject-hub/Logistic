-- One row per run of the SAP folder auto-import, whether the cron or the Sync button started it.
--
-- Until now a run that imported nothing left no trace outside the container log: "no new file", "an import is already
-- running", "the folder is not there" and "the newest file was already imported" all read the same from the outside. Which
-- of them happened at 06:00 is exactly the question that was unanswerable when a fresh file in the share was not pulled.

CREATE TABLE IF NOT EXISTS sap_auto_import_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source      VARCHAR(20)  NOT NULL,                 -- 'cron' | 'manual'
  started_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  -- running | imported | no_new_file | skipped_in_flight | already_running | source_missing | failed
  outcome             VARCHAR(30)  NOT NULL DEFAULT 'running',
  newest_file         TEXT,
  newest_file_mtime   TIMESTAMPTZ,
  files_scanned       INTEGER,
  files_processed     INTEGER,
  files_skipped       INTEGER,
  import_id           UUID,
  detail              TEXT,
  started_by          UUID
);

CREATE INDEX IF NOT EXISTS idx_sap_auto_import_runs_started
  ON sap_auto_import_runs (started_at DESC);
