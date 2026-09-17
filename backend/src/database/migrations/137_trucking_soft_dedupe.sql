-- Soft dedupe metadata for trucking_operations (KLIP hygiene — not user Cancelled).
-- Losers stay out of list/matching via deduped_at IS NULL filters; status unchanged.

ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS deduped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deduped_into_operation_id UUID REFERENCES trucking_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deduped_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_trucking_operations_deduped_at
  ON trucking_operations (deduped_at)
  WHERE deduped_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trucking_operations_active_visible
  ON trucking_operations (contract_id)
  WHERE deduped_at IS NULL AND COALESCE(status, '') <> 'CANCELLED';
