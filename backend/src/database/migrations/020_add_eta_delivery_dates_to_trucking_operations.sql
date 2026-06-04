-- 020_add_eta_delivery_dates_to_trucking_operations.sql
-- Add ETA Due Date Delivery fields to trucking_operations so they can be edited per trucking operation.

ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS eta_delivery_start_date DATE,
  ADD COLUMN IF NOT EXISTS eta_delivery_end_date DATE;

