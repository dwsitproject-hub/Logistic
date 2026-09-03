-- Persist the original uploaded Excel file name on each sap_data_imports row so
-- SAP Data > Import History can show "File Name" (e.g. "CPO 3 Sep 2026").

ALTER TABLE sap_data_imports
  ADD COLUMN IF NOT EXISTS file_name varchar(512);

COMMENT ON COLUMN sap_data_imports.file_name IS
  'Original uploaded workbook name (basename). Shown on the SAP Data import history table.';
