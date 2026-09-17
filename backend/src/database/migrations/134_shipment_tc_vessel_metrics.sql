-- Manually-entered performance metrics for Time Charter (T/C) vessels.
-- SAP does not feed these fields today, so they are captured per-shipment
-- via the Edit/View Shipment modal (KLIP Agent AI / SAP import never sets them).
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS fuel_consumption DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS freight DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS pump_rate DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS sailing_speed DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS shortage DECIMAL(14, 2);

COMMENT ON COLUMN shipments.fuel_consumption IS 'TC vessel fuel consumption, manually entered (T/C shipments only)';
COMMENT ON COLUMN shipments.freight IS 'TC vessel freight cost, manually entered (T/C shipments only)';
COMMENT ON COLUMN shipments.pump_rate IS 'TC vessel pump rate, manually entered (T/C shipments only)';
COMMENT ON COLUMN shipments.sailing_speed IS 'TC vessel sailing speed, manually entered (T/C shipments only) - distinct from SAP-sourced average_vessel_speed';
COMMENT ON COLUMN shipments.shortage IS 'TC vessel shortage, manually entered (T/C shipments only)';
