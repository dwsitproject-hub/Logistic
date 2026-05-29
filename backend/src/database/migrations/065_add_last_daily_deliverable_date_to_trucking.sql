-- Denormalize last_daily_deliverable_date onto trucking_operations to avoid
-- expensive CROSS JOIN LATERAL jsonb_array_elements(daily_deliverables) in
-- the late-performance query (was ~283ms for full table scan on every request).

ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS last_daily_deliverable_date DATE;

-- Backfill from existing daily_deliverables JSON arrays
UPDATE trucking_operations
SET last_daily_deliverable_date = (
  SELECT MAX((dd->>'date')::date)
  FROM jsonb_array_elements(COALESCE(daily_deliverables, '[]'::jsonb)) AS dd
  WHERE (dd->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
)
WHERE daily_deliverables IS NOT NULL
  AND jsonb_array_length(COALESCE(daily_deliverables, '[]'::jsonb)) > 0;

-- Index for fast contract_id lookup (joins to this column in late-performance query)
CREATE INDEX IF NOT EXISTS idx_trucking_contract_id_last_dd_date
  ON trucking_operations (contract_id, last_daily_deliverable_date DESC NULLS LAST)
  WHERE last_daily_deliverable_date IS NOT NULL;
