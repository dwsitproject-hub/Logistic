-- Add extended ETA fields to vessel_loading_ports
-- These fields are used by the Shipments -> Vessel detail page (frontend) and must persist after Save.

ALTER TABLE vessel_loading_ports
  ADD COLUMN IF NOT EXISTS eta_vessel_berthed_at_loading_port TIMESTAMP,
  ADD COLUMN IF NOT EXISTS eta_vessel_arrive_at_discharge_port TIMESTAMP,
  ADD COLUMN IF NOT EXISTS eta_vessel_berthed_at_discharge_port TIMESTAMP,
  ADD COLUMN IF NOT EXISTS eta_vessel_start_discharging TIMESTAMP,
  ADD COLUMN IF NOT EXISTS eta_vessel_complete_discharge TIMESTAMP;


