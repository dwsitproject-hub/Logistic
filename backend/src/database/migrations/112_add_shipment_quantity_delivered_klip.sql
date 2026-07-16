-- Explicit KLIP Delivery Qty, separate from SAP-derived / legacy shipments.quantity_delivered.
-- Used when Open contracts take Shipment Qty from Add New Shipment (dual-written with planning).

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS quantity_delivered_klip NUMERIC(15, 2);

COMMENT ON COLUMN shipments.quantity_delivered_klip IS
  'KLIP-entered shipment delivery quantity (kg). Independent of SAP Quantity Delivered.';

-- Backfill active shipments from existing planning assignments (user_sto_contract_assignments).
-- Only non-COMPLETED / non-CANCELLED rows. Normalize legacy MT values to kg using the same
-- threshold as sqlUserStoQtyAssignedToKgSql (assignment <= contract_qty / 100 → treat as MT).
-- Pick one matching shipment per assignment+contract to avoid multiplying across duplicates.
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
ranked_shipments AS (
  SELECT
    s.id AS shipment_id,
    n.qty_kg,
    ROW_NUMBER() OVER (
      PARTITION BY n.sto_number, n.contract_number, n.po_key
      ORDER BY
        CASE
          WHEN NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
            AND n.po_key <> ''
            AND TRIM(c.po_number::text) = n.po_key
          THEN 0
          ELSE 1
        END,
        s.created_at DESC NULLS LAST,
        s.id
    ) AS rn
  FROM normalized n
  INNER JOIN contracts c ON TRIM(c.contract_id) = TRIM(n.contract_number)
  INNER JOIN shipments s ON s.contract_id = c.id
  WHERE COALESCE(s.status, '') NOT IN ('COMPLETED', 'CANCELLED')
    AND s.quantity_delivered_klip IS NULL
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
SET quantity_delivered_klip = r.qty_kg,
    updated_at = CURRENT_TIMESTAMP
FROM ranked_shipments r
WHERE s.id = r.shipment_id
  AND r.rn = 1
  AND r.qty_kg > 0;
