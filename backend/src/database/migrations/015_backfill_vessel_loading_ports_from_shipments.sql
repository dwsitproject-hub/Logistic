-- Backfill initial vessel_loading_ports rows from existing shipments
-- so that the Vessel Loading Ports view always has at least
-- one loading port and (optionally) one discharge port per shipment.
--
-- This migration is safe to run once on production data.
-- It only inserts rows for shipments that currently have *no*
-- vessel_loading_ports rows at all.

-- 1) Create a loading port row (sequence 1) for shipments that have
--    port_of_loading set but no existing loading/discharge ports.
INSERT INTO vessel_loading_ports (
    shipment_id,
    port_name,
    port_sequence,
    quantity_at_loading_port,
    eta_vessel_arrival,
    ata_vessel_arrival,
    eta_vessel_berthed,
    ata_vessel_berthed,
    eta_loading_start,
    ata_loading_start,
    eta_loading_completed,
    ata_loading_completed,
    eta_vessel_sailed,
    ata_vessel_sailed,
    eta_vessel_berthed_at_loading_port,
    loading_rate,
    is_discharge_port
)
SELECT
    s.id                         AS shipment_id,
    s.port_of_loading            AS port_name,
    1                            AS port_sequence,
    s.actual_vessel_qty_receive  AS quantity_at_loading_port,
    NULL::timestamp              AS eta_vessel_arrival,
    s.ata_arrival                AS ata_vessel_arrival,
    NULL::timestamp              AS eta_vessel_berthed,
    s.ata_berthed                AS ata_vessel_berthed,
    NULL::timestamp              AS eta_loading_start,
    s.ata_loading_start          AS ata_loading_start,
    NULL::timestamp              AS eta_loading_completed,
    s.ata_loading_complete       AS ata_loading_completed,
    NULL::timestamp              AS eta_vessel_sailed,
    s.ata_sailed                 AS ata_vessel_sailed,
    NULL::timestamp              AS eta_vessel_berthed_at_loading_port,
    NULL::numeric                AS loading_rate,
    false                        AS is_discharge_port
FROM shipments s
WHERE s.port_of_loading IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM vessel_loading_ports vlp
    WHERE vlp.shipment_id = s.id
  );

-- 2) Create a discharge port row (sequence 999) for shipments that have
--    port_of_discharge set but still have no discharge port row.
INSERT INTO vessel_loading_ports (
    shipment_id,
    port_name,
    port_sequence,
    quantity_at_loading_port,
    eta_vessel_arrival,
    ata_vessel_arrival,
    eta_vessel_berthed,
    ata_vessel_berthed,
    eta_loading_start,
    ata_loading_start,
    eta_loading_completed,
    ata_loading_completed,
    eta_vessel_sailed,
    ata_vessel_sailed,
    eta_vessel_arrive_at_discharge_port,
    eta_vessel_berthed_at_discharge_port,
    eta_vessel_start_discharging,
    eta_vessel_complete_discharge,
    is_discharge_port
)
SELECT
    s.id                         AS shipment_id,
    s.port_of_discharge          AS port_name,
    999                          AS port_sequence,
    0::numeric                   AS quantity_at_loading_port,
    NULL::timestamp              AS eta_vessel_arrival,
    s.ata_discharge_arrival      AS ata_vessel_arrival,
    NULL::timestamp              AS eta_vessel_berthed,
    s.ata_discharge_berthed      AS ata_vessel_berthed,
    NULL::timestamp              AS eta_loading_start,
    s.ata_discharge_start        AS ata_loading_start,
    NULL::timestamp              AS eta_loading_completed,
    s.ata_discharge_complete     AS ata_loading_completed,
    NULL::timestamp              AS eta_vessel_sailed,
    NULL::timestamp              AS ata_vessel_sailed,
    NULL::timestamp              AS eta_vessel_arrive_at_discharge_port,
    NULL::timestamp              AS eta_vessel_berthed_at_discharge_port,
    NULL::timestamp              AS eta_vessel_start_discharging,
    NULL::timestamp              AS eta_vessel_complete_discharge,
    true                         AS is_discharge_port
FROM shipments s
WHERE s.port_of_discharge IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM vessel_loading_ports vlp
    WHERE vlp.shipment_id = s.id
      AND vlp.is_discharge_port = true
  );

