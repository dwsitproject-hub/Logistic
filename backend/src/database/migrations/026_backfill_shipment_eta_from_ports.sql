-- Backfill shipments.eta_* fields from first loading port
-- so that shipment-level ETA dates match vessel_loading_ports
-- (port_sequence = 1, is_discharge_port = false).

UPDATE shipments s
SET
  eta_arrival = COALESCE(vlp.eta_vessel_arrival::date, s.eta_arrival),
  eta_berthed = COALESCE(vlp.eta_vessel_berthed_at_loading_port::date, s.eta_berthed),
  eta_loading_start = COALESCE(vlp.eta_loading_start::date, s.eta_loading_start),
  eta_loading_complete = COALESCE(vlp.eta_loading_completed::date, s.eta_loading_complete),
  eta_sailed = COALESCE(vlp.eta_vessel_sailed::date, s.eta_sailed),
  updated_at = CURRENT_TIMESTAMP
FROM vessel_loading_ports vlp
WHERE
  vlp.shipment_id = s.id
  AND vlp.port_sequence = 1
  AND COALESCE(vlp.is_discharge_port, false) = false
  AND (
    (vlp.eta_vessel_arrival IS NOT NULL AND s.eta_arrival IS DISTINCT FROM vlp.eta_vessel_arrival::date) OR
    (vlp.eta_vessel_berthed_at_loading_port IS NOT NULL AND s.eta_berthed IS DISTINCT FROM vlp.eta_vessel_berthed_at_loading_port::date) OR
    (vlp.eta_loading_start IS NOT NULL AND s.eta_loading_start IS DISTINCT FROM vlp.eta_loading_start::date) OR
    (vlp.eta_loading_completed IS NOT NULL AND s.eta_loading_complete IS DISTINCT FROM vlp.eta_loading_completed::date) OR
    (vlp.eta_vessel_sailed IS NOT NULL AND s.eta_sailed IS DISTINCT FROM vlp.eta_vessel_sailed::date)
  );

