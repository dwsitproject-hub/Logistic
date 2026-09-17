-- SAP Data v3: currency suffixes for Trucking OA Budget / Actual
ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS oa_budget_currency VARCHAR(10),
  ADD COLUMN IF NOT EXISTS oa_actual_currency VARCHAR(10);
