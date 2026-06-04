-- Add ETA trucking date fields to trucking_operations

ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS eta_trucking_start_date DATE,
  ADD COLUMN IF NOT EXISTS eta_trucking_completion_date DATE,
  ADD COLUMN IF NOT EXISTS eta_truck_loading_date DATE,
  ADD COLUMN IF NOT EXISTS eta_truck_unloading_date DATE;


