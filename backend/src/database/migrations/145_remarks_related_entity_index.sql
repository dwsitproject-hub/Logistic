-- Speed remarks_count on Contracts / Shipping Performance list rows.
-- Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_remarks_related_entity
  ON remarks (related_entity_type, related_entity_id);
