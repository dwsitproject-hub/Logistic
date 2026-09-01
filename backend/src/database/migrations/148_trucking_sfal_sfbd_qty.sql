-- SFAL/SFBD qty on trucking operations (Kg) — editable in Edit/View Trucking modal;
-- consumed by Oil Loss R1–R3 when SAP raw SFAL/SFBD is missing.
ALTER TABLE trucking_operations
  ADD COLUMN IF NOT EXISTS sfal_qty DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS sfbd_qty DECIMAL(15, 2);

COMMENT ON COLUMN trucking_operations.sfal_qty IS 'Ship Figure After Loading quantity (Kg) — KLIP trucking modal';
COMMENT ON COLUMN trucking_operations.sfbd_qty IS 'Ship Figure Before Discharge quantity (Kg) — KLIP trucking modal';
