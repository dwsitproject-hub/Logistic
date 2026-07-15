-- Persist Netto PKS (delivery) and Netto EUP (receive) from WB rekap alongside effective quantity_kg.
ALTER TABLE trucking_daily_actuals
  ADD COLUMN IF NOT EXISTS quantity_delivery_kg NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS quantity_receive_kg NUMERIC(15, 2);

-- Legacy rows: treat quantity_kg as delivery until the next WB re-upload fills both columns.
UPDATE trucking_daily_actuals
SET quantity_delivery_kg = quantity_kg
WHERE quantity_delivery_kg IS NULL
  AND quantity_kg IS NOT NULL;
