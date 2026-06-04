-- Speed up DISTINCT ON (shipment_id) picks for first load / discharge port (shipments list ATA columns)
CREATE INDEX IF NOT EXISTS idx_vlp_shipment_first_load
  ON vessel_loading_ports (shipment_id)
  WHERE COALESCE(is_discharge_port, false) = false AND port_sequence = 1;

CREATE INDEX IF NOT EXISTS idx_vlp_shipment_discharge
  ON vessel_loading_ports (shipment_id)
  WHERE COALESCE(is_discharge_port, false) = true;
