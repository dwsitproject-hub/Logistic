-- Trucking daily actuals: optional STO grain for multi-STO POs.
-- Empty string = legacy / unknown STO (PO-level rollup from older WB uploads).
ALTER TABLE trucking_daily_actuals
  ADD COLUMN IF NOT EXISTS sto_number TEXT NOT NULL DEFAULT '';

ALTER TABLE trucking_daily_actuals
  DROP CONSTRAINT IF EXISTS trucking_daily_actuals_trucking_operation_id_progress_date_key;

ALTER TABLE trucking_daily_actuals
  DROP CONSTRAINT IF EXISTS trucking_daily_actuals_op_date_sto_key;

ALTER TABLE trucking_daily_actuals
  ADD CONSTRAINT trucking_daily_actuals_op_date_sto_key
  UNIQUE (trucking_operation_id, progress_date, sto_number);

CREATE INDEX IF NOT EXISTS idx_trucking_daily_actuals_op_sto
  ON trucking_daily_actuals (trucking_operation_id, sto_number);
