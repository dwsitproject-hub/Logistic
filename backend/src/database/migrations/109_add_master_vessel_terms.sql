-- Master Vessel: add "Terms" (charter type). Two allowed values: V/C (voyage charter)
-- or T/C (time charter). Nullable so existing rows and partial uploads stay valid.
ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS terms VARCHAR(10);

-- Guard the allowed values (Postgres has no ADD CONSTRAINT IF NOT EXISTS, so drop-then-add
-- keeps this migration idempotent if it is ever re-run).
ALTER TABLE master_vessels
  DROP CONSTRAINT IF EXISTS master_vessels_terms_chk;
ALTER TABLE master_vessels
  ADD CONSTRAINT master_vessels_terms_chk CHECK (terms IS NULL OR terms IN ('V/C', 'T/C'));
