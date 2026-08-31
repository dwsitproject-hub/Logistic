-- Scheduler auto-upload SAP MASTER v2 from Synology drop folder.
-- Distinguishes manual vs scheduler imports, keeps identity on failed rows for
-- Success/Failed workbooks, and records which Original files were already processed.

ALTER TABLE sap_data_imports
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

ALTER TABLE sap_data_imports
  DROP CONSTRAINT IF EXISTS sap_data_imports_source_check;

ALTER TABLE sap_data_imports
  ADD CONSTRAINT sap_data_imports_source_check
  CHECK (source IN ('manual', 'scheduler'));

COMMENT ON COLUMN sap_data_imports.source IS
  'How the import was started: manual (SAP Data UI upload) or scheduler (Synology Original folder).';

ALTER TABLE sap_import_failures
  ADD COLUMN IF NOT EXISTS contract_date TEXT,
  ADD COLUMN IF NOT EXISTS contract_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS contract_ext_no VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supplier VARCHAR(255);

CREATE TABLE IF NOT EXISTS sap_auto_import_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(512) NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  file_size BIGINT,
  processed_at TIMESTAMP WITHOUT TIME ZONE,
  import_id UUID REFERENCES sap_data_imports(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  success_file_name VARCHAR(512),
  failed_file_name VARCHAR(512),
  error_message TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sha256)
);

CREATE INDEX IF NOT EXISTS idx_sap_auto_import_files_status
  ON sap_auto_import_files (status);

COMMENT ON TABLE sap_auto_import_files IS
  'Original SAP files already processed by the folder scheduler (skip by SHA-256).';
