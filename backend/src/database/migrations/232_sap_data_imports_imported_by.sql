-- SAP Data > Import History shows who started each import. Until now sap_data_imports recorded only "manual" or "scheduler", not the person,
-- so imports made before this migration stay NULL (shown as a dash); new manual uploads and Sync-button runs store the user's id.
-- A scheduled run has no person and stays NULL. The name is read from users when the list is shown; deleting a user leaves the import.
ALTER TABLE sap_data_imports
  ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN sap_data_imports.imported_by IS
  'User who started the import (manual upload or the Sync button). NULL for scheduled runs and for imports made before migration 232.';
