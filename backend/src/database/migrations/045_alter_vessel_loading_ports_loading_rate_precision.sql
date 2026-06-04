-- Widen loading_rate precision to avoid overflow.
-- loading_rate is currently used as kg/day in shipment.controller upsert logic,
-- and can exceed DECIMAL(10,4) for large quantities / short durations.

ALTER TABLE vessel_loading_ports
  ALTER COLUMN loading_rate TYPE DECIMAL(18, 4);

COMMENT ON COLUMN vessel_loading_ports.loading_rate IS 'Calculated loading rate (kg/day) derived from quantity_at_loading_port and ATA loading duration.';

