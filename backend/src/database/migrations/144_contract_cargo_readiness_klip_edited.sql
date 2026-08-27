-- Protect cargo readiness dates edited in KLIP (Contract Details) from Excel overwrite.
-- Missing Planning and Log Cycle both read contracts.cargo_readiness_date.
-- Safe to re-run.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS cargo_readiness_klip_edited BOOLEAN NOT NULL DEFAULT false;

UPDATE contracts c
SET cargo_readiness_klip_edited = true
WHERE c.cargo_readiness_klip_edited = false
  AND EXISTS (
    SELECT 1 FROM remarks r
    WHERE r.related_entity_type = 'CONTRACT'
      AND r.related_entity_id = c.id
      AND r.category = 'CARGO_READINESS'
  );
