-- Qty Shipment Plan: the quantity a planner intends to ship on this PO, entered in Add New Shipment.
--
-- Its own column, on purpose. It used to be typed into "Qty Delivery (Klip)" and stored as quantity_delivered_klip, which made a
-- plan read as a delivery: it fed Delivered Qty, Outstanding and the OS cards before anything had moved. A plan is not a delivery
-- and not SAP's STO quantity, so it is kept apart and read-only afterwards. Kilograms, like every other quantity on shipments.
-- Nullable and with no backfill: only shipments created from now on carry one.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS quantity_shipment_plan NUMERIC(15, 2);

COMMENT ON COLUMN shipments.quantity_shipment_plan IS
  'Planned shipment quantity (kg) entered at Add New Shipment, per PO. Read-only afterwards. Not a delivery: feeds no Delivered / Outstanding quantity.';
