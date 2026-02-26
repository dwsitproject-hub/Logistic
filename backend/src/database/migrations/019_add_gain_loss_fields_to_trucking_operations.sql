-- 019_add_gain_loss_fields_to_trucking_operations.sql
-- Add gain_loss_percentage and gain_loss_amount to trucking_operations to support
-- trucking views and dashboard metrics.

ALTER TABLE trucking_operations
ADD COLUMN IF NOT EXISTS gain_loss_percentage NUMERIC(15,4),
ADD COLUMN IF NOT EXISTS gain_loss_amount NUMERIC(15,2);

-- Backfill for existing rows: treat existing gain_loss as amount and leave percentage null
UPDATE trucking_operations
SET gain_loss_amount = COALESCE(gain_loss_amount, gain_loss)
WHERE gain_loss_amount IS NULL;

