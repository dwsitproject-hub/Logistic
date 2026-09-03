-- SAP MASTER v2 import performance optimization, Phase 1.
--
-- Manual "Browse & Import File" uploads reprocess every row on every upload, even when a
-- daily file re-sends POs/STOs that are byte-identical to what KLIP already has, and even
-- when the exact same file is re-uploaded. Both cases pay for the full distributeToTables
-- fan-out (20-60+ queries per row) for zero actual change. See
-- backend/src/services/sapMasterV2Import.service.ts for how these columns are used.

-- 1. Row-level "did anything change" check. Compared against a SHA-256 of the row's
--    parsedData JSON on the next upload for the same PO+STO; an exact match skips the
--    distribution fan-out entirely for that row.
ALTER TABLE sap_processed_data
  ADD COLUMN IF NOT EXISTS content_hash varchar(64);

CREATE INDEX IF NOT EXISTS idx_spd_content_hash
  ON sap_processed_data (content_hash);

COMMENT ON COLUMN sap_processed_data.content_hash IS
  'SHA-256 of the row''s parsedData JSON as last written by the SAP importer. Used to skip
   re-running distributeToTables (contract/shipment/trucking/quality/payment upserts) when an
   uploaded row is byte-identical to what is already stored for the same PO+STO - the common
   case on daily re-uploads where most POs are unchanged. NULL for rows written before this
   column existed; they fall through to a full re-process once, which then backfills the hash.';

-- 2. File-level "is this the exact same file we already imported" check for manual uploads,
--    mirroring the scheduler folder auto-import's existing sap_auto_import_files dedupe
--    (migration 146_sap_auto_import.sql) which already does this for the Synology drop folder.
ALTER TABLE sap_data_imports
  ADD COLUMN IF NOT EXISTS file_sha256 varchar(64);

CREATE INDEX IF NOT EXISTS idx_sap_data_imports_file_sha256
  ON sap_data_imports (file_sha256);

COMMENT ON COLUMN sap_data_imports.file_sha256 IS
  'SHA-256 of the uploaded Excel file. Lets a manual "Browse & Import File" re-upload of an
   unchanged file short-circuit instantly (return the previous completed import''s result)
   instead of re-queuing a full import.';
