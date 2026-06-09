-- Ship Figure After Loading / Before Discharge quantities (MT) for Oil Loss calculations.
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS sfal_qty DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS sfbd_qty DECIMAL(15, 2);

COMMENT ON COLUMN shipments.sfal_qty IS 'Ship Figure After Loading quantity (Kg)';
COMMENT ON COLUMN shipments.sfbd_qty IS 'Ship Figure Before Discharge quantity (Kg)';
