-- 017_add_operation_id_to_trucking_operations.sql
-- Add operation_id column used by trucking API and dashboards.

ALTER TABLE trucking_operations
ADD COLUMN IF NOT EXISTS operation_id VARCHAR(100);

