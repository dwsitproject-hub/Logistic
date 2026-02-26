-- 018_add_location_to_trucking_operations.sql
-- Add a generic location column for trucking operations, used by filters and dashboards.

ALTER TABLE trucking_operations
ADD COLUMN IF NOT EXISTS location VARCHAR(255);

-- Backfill existing rows: prefer unloading_location, fallback to loading_location
UPDATE trucking_operations
SET location = COALESCE(unloading_location, loading_location)
WHERE location IS NULL;

