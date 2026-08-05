-- Read-only preview: PO numbers with more than one active trucking operation.
-- Run before run-dedupe-trucking-by-po-staging.sh --all on SIT backend (.57).
-- Active = status <> CANCELLED.

\echo '=== Summary: duplicate PO groups ==='
SELECT COUNT(*)::int AS duplicate_po_groups
FROM (
  SELECT TRIM(c.po_number::text) AS po_norm
  FROM trucking_operations t
  INNER JOIN contracts c ON c.id = t.contract_id
  WHERE t.contract_id IS NOT NULL
    AND COALESCE(t.status, '') <> 'CANCELLED'
    AND NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
  GROUP BY TRIM(c.po_number::text)
  HAVING COUNT(*) > 1
) dup;

\echo ''
\echo '=== Top duplicate POs (by active op count) ==='
SELECT
  TRIM(c.po_number::text) AS po_number,
  c.product,
  COUNT(*)::int AS active_ops
FROM trucking_operations t
INNER JOIN contracts c ON c.id = t.contract_id
WHERE COALESCE(t.status, '') <> 'CANCELLED'
  AND NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
GROUP BY TRIM(c.po_number::text), c.product
HAVING COUNT(*) > 1
ORDER BY active_ops DESC, po_number
LIMIT 50;

\echo ''
\echo '=== Detail: all active ops per duplicate PO ==='
WITH dup_pos AS (
  SELECT TRIM(c.po_number::text) AS po_norm
  FROM trucking_operations t
  INNER JOIN contracts c ON c.id = t.contract_id
  WHERE t.contract_id IS NOT NULL
    AND COALESCE(t.status, '') <> 'CANCELLED'
    AND NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
  GROUP BY TRIM(c.po_number::text)
  HAVING COUNT(*) > 1
)
SELECT
  TRIM(c.po_number::text) AS po_number,
  t.operation_id,
  t.status,
  (
    SELECT COUNT(DISTINCT da.progress_date)::int
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = t.id
  ) AS wb_dates,
  (
    SELECT COALESCE(SUM(
      COALESCE(da.quantity_delivery_kg, da.quantity_kg, 0)
      + COALESCE(da.quantity_receive_kg, 0)
    ), 0)::bigint
    FROM trucking_daily_actuals da
    WHERE da.trucking_operation_id = t.id
  ) AS wb_qty_kg,
  COALESCE(jsonb_array_length(t.daily_deliverables), 0)::int AS planning_days,
  t.created_at::date AS created
FROM trucking_operations t
INNER JOIN contracts c ON c.id = t.contract_id
INNER JOIN dup_pos d ON d.po_norm = TRIM(c.po_number::text)
WHERE COALESCE(t.status, '') <> 'CANCELLED'
ORDER BY po_number, wb_dates DESC, t.operation_id;
