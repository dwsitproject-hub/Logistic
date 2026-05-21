-- Migration 059: Add UNPLANNED to shipments status check constraint
-- 
-- deriveShipmentStatus() returns 'UNPLANNED' for shipments with no ETA/ATA milestones.
-- The prior constraint did not include this value, causing 500 import rows to fail.

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;

ALTER TABLE shipments ADD CONSTRAINT shipments_status_check 
  CHECK (status IN (
    'PLANNED',
    'UNPLANNED',
    'IN_PROGRESS',
    'LOADING',
    'IN_TRANSIT',
    'ARRIVED',
    'UNLOADING',
    'COMPLETED',
    'CANCELLED',
    'CANCELED'
  ));
