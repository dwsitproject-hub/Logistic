-- Add cargo_readiness_date to contracts table for editable Contract Readiness Date
-- Safe to re-run.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS cargo_readiness_date DATE;

