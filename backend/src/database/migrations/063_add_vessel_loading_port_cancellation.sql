-- Soft-cancel support for vessel loading port activities
ALTER TABLE vessel_loading_ports
  ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancel_remark TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vessel_loading_ports_active
  ON vessel_loading_ports (shipment_id)
  WHERE is_cancelled = FALSE;
