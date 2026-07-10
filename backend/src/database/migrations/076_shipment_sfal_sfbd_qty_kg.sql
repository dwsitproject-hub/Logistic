-- SFAL/SFBD use kilograms in DB (consistent with quantity_shipped, actual_vessel_qty_receive, etc.).

COMMENT ON COLUMN shipments.sfal_qty IS 'Ship Figure After Loading quantity (Kg)';
COMMENT ON COLUMN shipments.sfbd_qty IS 'Ship Figure Before Discharge quantity (Kg)';

-- Backfill rows that were stored as MT before this change (heuristic: value much smaller than receive kg).
UPDATE shipments
SET sfal_qty = sfal_qty * 1000
WHERE sfal_qty IS NOT NULL
  AND sfal_qty > 0
  AND actual_vessel_qty_receive IS NOT NULL
  AND actual_vessel_qty_receive > 0
  AND sfal_qty < actual_vessel_qty_receive / 500;

UPDATE shipments
SET sfbd_qty = sfbd_qty * 1000
WHERE sfbd_qty IS NOT NULL
  AND sfbd_qty > 0
  AND actual_vessel_qty_receive IS NOT NULL
  AND actual_vessel_qty_receive > 0
  AND sfbd_qty < actual_vessel_qty_receive / 500;
