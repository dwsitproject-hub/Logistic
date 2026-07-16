-- Clear quantity_delivered_klip that was only sourced from planning (Add New Shipment /
-- migration 112 dual-write). Delivery Qty should fall back to SAP unless the user
-- explicitly edited delivery via Edit Shipment (quantity_delivered_klip differs from
-- planning assignment, or no matching assignment exists).

WITH normalized AS (
  SELECT
    u.sto_number,
    u.contract_number,
    COALESCE(NULLIF(TRIM(u.po_number::text), ''), '') AS po_key,
    CASE
      WHEN COALESCE(c.quantity_ordered, 0) > 0
        AND COALESCE(u.sto_qty_assigned, 0) > 0
        AND COALESCE(u.sto_qty_assigned, 0) <= COALESCE(c.quantity_ordered, 0) / 100
      THEN COALESCE(u.sto_qty_assigned, 0) * 1000
      ELSE COALESCE(u.sto_qty_assigned, 0)
    END AS qty_kg
  FROM user_sto_contract_assignments u
  INNER JOIN contracts c ON TRIM(c.contract_id) = TRIM(u.contract_number)
  WHERE COALESCE(u.sto_qty_assigned, 0) > 0
),
matched AS (
  SELECT DISTINCT s.id AS shipment_id
  FROM normalized n
  INNER JOIN contracts c ON TRIM(c.contract_id) = TRIM(n.contract_number)
  INNER JOIN shipments s ON s.contract_id = c.id
  WHERE s.quantity_delivered_klip IS NOT NULL
    AND COALESCE(s.quantity_delivered_klip, 0) > 0
    AND ABS(COALESCE(s.quantity_delivered_klip, 0) - n.qty_kg) < 0.01
    AND (
      (NULLIF(TRIM(c.po_number::text), '') IS NOT NULL AND n.po_key <> '' AND TRIM(c.po_number::text) = n.po_key)
      OR n.po_key = ''
      OR NULLIF(TRIM(c.po_number::text), '') IS NULL
    )
    AND (
      (TRIM(COALESCE(s.operation_id, '')) <> '' AND TRIM(s.operation_id) = TRIM(n.sto_number))
      OR (TRIM(COALESCE(s.shipment_id, '')) <> '' AND TRIM(s.shipment_id) = TRIM(n.sto_number))
      OR (
        TRIM(COALESCE(c.sto_number::text, '')) <> ''
        AND TRIM(c.sto_number::text) = TRIM(n.sto_number)
      )
    )
)
UPDATE shipments s
SET quantity_delivered_klip = NULL,
    updated_at = CURRENT_TIMESTAMP
FROM matched m
WHERE s.id = m.shipment_id;

COMMENT ON COLUMN shipments.quantity_delivered_klip IS
  'KLIP-entered delivery quantity (kg) from Edit Shipment / info modal only. Not set by Add New Shipment planning qty. Independent of SAP Quantity Delivered.';
