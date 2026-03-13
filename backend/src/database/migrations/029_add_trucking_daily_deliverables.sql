-- Add JSONB field for daily planning deliverables on trucking operations
-- Safe to re-run.

ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS daily_deliverables JSONB DEFAULT '[]'::jsonb;

