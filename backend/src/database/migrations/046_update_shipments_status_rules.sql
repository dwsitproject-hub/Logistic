-- 046_update_shipments_status_rules.sql
-- Allow additional SEA shipment statuses used by KLIP UI + auto-derivation.

BEGIN;

-- Drop legacy check constraint (name may vary across environments)
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;

-- Recreate with expanded set
ALTER TABLE shipments
  ADD CONSTRAINT shipments_status_check CHECK (
    status IN (
      'PLANNED',
      'IN_PROGRESS',
      'LOADING',
      'IN_TRANSIT',
      'ARRIVED',
      'UNLOADING',
      'COMPLETED',
      'CANCELLED',
      'CANCELED'
    )
  );

-- Optional backfill: update status for existing shipments based on ATA milestone dates.
-- Uses shipment-level ATA columns only (ports are used to populate these via SAP refresh).
UPDATE shipments s
SET status = CASE
  WHEN s.ata_arrival IS NOT NULL
    AND s.ata_berthed IS NOT NULL
    AND s.ata_loading_start IS NOT NULL
    AND s.ata_loading_complete IS NOT NULL
    AND s.ata_sailed IS NOT NULL
    AND s.ata_discharge_arrival IS NOT NULL
    AND s.ata_discharge_berthed IS NOT NULL
    AND s.ata_discharge_start IS NOT NULL
    AND s.ata_discharge_complete IS NOT NULL
    THEN 'COMPLETED'
  WHEN s.ata_arrival IS NOT NULL
    AND s.ata_berthed IS NOT NULL
    AND s.ata_loading_start IS NOT NULL
    AND s.ata_loading_complete IS NOT NULL
    AND s.ata_sailed IS NOT NULL
    AND s.ata_discharge_arrival IS NOT NULL
    AND s.ata_discharge_berthed IS NOT NULL
    THEN 'UNLOADING'
  WHEN s.ata_arrival IS NOT NULL
    AND s.ata_berthed IS NOT NULL
    AND s.ata_loading_start IS NOT NULL
    AND s.ata_loading_complete IS NOT NULL
    AND s.ata_sailed IS NOT NULL
    AND s.ata_discharge_arrival IS NOT NULL
    THEN 'ARRIVED'
  WHEN s.ata_arrival IS NOT NULL
    AND s.ata_berthed IS NOT NULL
    AND s.ata_loading_start IS NOT NULL
    AND s.ata_loading_complete IS NOT NULL
    AND s.ata_sailed IS NOT NULL
    THEN 'IN_TRANSIT'
  WHEN s.ata_arrival IS NOT NULL
    AND s.ata_loading_start IS NOT NULL
    THEN 'LOADING'
  WHEN s.ata_arrival IS NOT NULL
    THEN 'IN_PROGRESS'
  ELSE 'PLANNED'
END
WHERE COALESCE(UPPER(TRIM(s.status)), '') NOT IN ('CANCELLED', 'CANCELED');

COMMIT;

