-- Preview CANCELLED trucking ops that still have an active sibling on the same PO
-- (dedupe losers). Read-only — does not delete.

\echo '=== CANCELLED trucking ops (all) ==='
SELECT COUNT(*)::int AS cancelled_all
FROM trucking_operations t
WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL');

\echo ''
\echo '=== Dedupe losers (CANCELLED + active keeper on same PO / blank-PO contract) ==='
WITH losers AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    t.created_at,
    (
      SELECT tk.operation_id
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
      ORDER BY tk.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS keeper_operation_id
  FROM trucking_operations t
  LEFT JOIN contracts c ON c.id = t.contract_id
  WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
    AND EXISTS (
      SELECT 1
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
    )
)
SELECT COUNT(*)::int AS dedupe_loser_rows FROM losers;

\echo ''
\echo '=== Sample losers (up to 30) ==='
WITH losers AS (
  SELECT
    t.id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    (
      SELECT tk.operation_id
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
      ORDER BY tk.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS keeper_operation_id,
    (
      SELECT COUNT(*)::int
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) AS wb_rows
  FROM trucking_operations t
  LEFT JOIN contracts c ON c.id = t.contract_id
  WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
    AND EXISTS (
      SELECT 1
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND (
          (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
          )
          OR (
            NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NULL
            AND TRIM(COALESCE(ck.contract_id::text, '')) = TRIM(COALESCE(c.contract_id::text, ''))
          )
        )
    )
)
SELECT po_number, operation_id, keeper_operation_id, wb_rows, contract_number
FROM losers
ORDER BY po_number NULLS LAST, operation_id
LIMIT 30;
