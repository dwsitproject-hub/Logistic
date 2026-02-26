-- 016_add_status_to_trucking_operations.sql
-- Add a status column to trucking_operations so dashboard and trucking pages
-- can classify operations as PLANNED / IN_PROGRESS / COMPLETED.

ALTER TABLE trucking_operations
ADD COLUMN IF NOT EXISTS status VARCHAR(50);

-- Backfill status for existing rows based on available dates
UPDATE trucking_operations
SET status = CASE
  WHEN trucking_completion_date IS NOT NULL THEN 'COMPLETED'
  WHEN trucking_start_date IS NOT NULL THEN 'IN_PROGRESS'
  ELSE 'PLANNED'
END
WHERE status IS NULL;

