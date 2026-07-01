-- Migration 093: Allow granular SEA shipment statuses in shipments.status
--
-- deriveShipmentStatus() persists ARRIVED_LP, SAILED, BERTHED_DP, etc.
-- Migration 059 only allowed legacy values (IN_TRANSIT, ARRIVED, …),
-- causing SAP import INSERT failures e.g. status = 'SAILED'.

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;

ALTER TABLE shipments ADD CONSTRAINT shipments_status_check CHECK (
  status IN (
    'UNPLANNED',
    'PLANNED',
    'ARRIVED_LP',
    'BERTHED_LP',
    'LOADING',
    'COMPLETED_LOADING',
    'SAILED',
    'ARRIVED_DP',
    'BERTHED_DP',
    'UNLOADING',
    'COMPLETED',
    'CANCELLED',
    'CANCELED',
    -- Legacy aliases retained for existing rows
    'IN_PROGRESS',
    'IN_TRANSIT',
    'ARRIVED'
  )
);
