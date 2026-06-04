-- Add daily planning deliverables to SEA shipments
-- Stored as [{ date: 'YYYY-MM-DD', quantity_delivered: number }, ...]

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS daily_deliverables JSONB DEFAULT '[]'::jsonb;

