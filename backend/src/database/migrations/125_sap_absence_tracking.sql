-- SAP absence tracking (Phase 1: observe only).
--
-- The daily SAP Report is a full snapshot. A PO stays in the report while it is Open and
-- after it is Closed; it drops out only when cancelled or deleted. KLIP never noticed that
-- absence, so cancelled POs lived on forever (37 ghost POs / 23,103 MT measured 2026-07-28).
--
-- These columns record snapshot membership. Nothing reads them yet: no query filters on
-- them and no total changes. Phase 2 acts on them.

-- 1. Failed import rows survive the per-row SAVEPOINT rollback that currently erases them.
--    Without this an import can drop 1,250 rows (as on 2026-07-27) leaving only a count,
--    and those rows are indistinguishable from cancelled POs.
CREATE TABLE IF NOT EXISTS sap_import_failures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id     uuid REFERENCES sap_data_imports(id) ON DELETE CASCADE,
  row_number    integer,
  po_number     varchar(100),
  sto_number    varchar(100),
  error_message text,
  created_at    timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sap_import_failures_import
  ON sap_import_failures (import_id);
CREATE INDEX IF NOT EXISTS idx_sap_import_failures_po
  ON sap_import_failures (TRIM(po_number));

-- 2. Per-row snapshot membership.
--
--    last_seen_at is deliberately NOT updated_at. updated_at is a generic audit column driven
--    by an ON UPDATE trigger, so any maintenance write to this table silently rewrites it -
--    which would erase the absence history. Only the SAP importer sets last_seen_at.
ALTER TABLE sap_processed_data
  ADD COLUMN IF NOT EXISTS last_seen_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS consecutive_misses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_since timestamp without time zone,
  ADD COLUMN IF NOT EXISTS last_seen_import_id uuid;

-- Seed last_seen_at from the history currently held in updated_at. The trigger is suspended
-- for the backfill: without this the UPDATE below fires update_sap_processed_data_updated_at
-- and stamps every row with today's date, destroying the very history being copied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'sap_processed_data'::regclass
      AND tgname = 'update_sap_processed_data_updated_at'
  ) THEN
    ALTER TABLE sap_processed_data DISABLE TRIGGER update_sap_processed_data_updated_at;
    UPDATE sap_processed_data
       SET last_seen_at = updated_at,
           last_seen_import_id = COALESCE(last_seen_import_id, import_id)
     WHERE last_seen_at IS NULL;
    ALTER TABLE sap_processed_data ENABLE TRIGGER update_sap_processed_data_updated_at;
  ELSE
    UPDATE sap_processed_data
       SET last_seen_at = updated_at,
           last_seen_import_id = COALESCE(last_seen_import_id, import_id)
     WHERE last_seen_at IS NULL;
  END IF;
END $$;

-- Partial index: only absent rows are ever scanned by the absence report.
CREATE INDEX IF NOT EXISTS idx_spd_consecutive_misses
  ON sap_processed_data (consecutive_misses)
  WHERE consecutive_misses > 0;

-- 3. Import trustworthiness. An import that failed a material share of its rows must never
--    be treated as evidence that a PO was cancelled.
ALTER TABLE sap_data_imports
  ADD COLUMN IF NOT EXISTS is_trusted boolean,
  ADD COLUMN IF NOT EXISTS absence_applied boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sap_data_imports.is_trusted IS
  'NULL until evaluated. False when the failure rate exceeded the threshold, in which case the import updates data normally but is not used for absence detection.';
COMMENT ON COLUMN sap_processed_data.last_seen_at IS
  'Last time this (po_number, sto_number) appeared in an uploaded SAP Report. Set only by the importer - do not derive from updated_at, which any write mutates.';
COMMENT ON COLUMN sap_processed_data.consecutive_misses IS
  'Clean imports in a row that did not contain this (po_number, sto_number). Reset to 0 on reappearance.';
