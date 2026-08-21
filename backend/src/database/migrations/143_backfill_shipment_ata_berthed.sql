-- Backfill shipment-level ATA berthed from vessel_loading_ports (SAP-sourced).
-- ETA columns are intentionally untouched (KLIP-only input).

UPDATE shipments s
SET ata_berthed = COALESCE(
  s.ata_berthed,
  (
    SELECT vlp.ata_vessel_berthed::date
    FROM vessel_loading_ports vlp
    WHERE vlp.shipment_id = s.id
      AND COALESCE(vlp.is_discharge_port, false) = false
      AND vlp.ata_vessel_berthed IS NOT NULL
    ORDER BY vlp.port_sequence ASC NULLS LAST, vlp.id ASC
    LIMIT 1
  )
)
WHERE s.ata_berthed IS NULL;

UPDATE shipments s
SET ata_discharge_berthed = COALESCE(
  s.ata_discharge_berthed,
  (
    SELECT vlp.ata_vessel_berthed::date
    FROM vessel_loading_ports vlp
    WHERE vlp.shipment_id = s.id
      AND vlp.is_discharge_port = true
      AND vlp.ata_vessel_berthed IS NOT NULL
    ORDER BY vlp.port_sequence ASC NULLS LAST, vlp.id ASC
    LIMIT 1
  )
)
WHERE s.ata_discharge_berthed IS NULL;
