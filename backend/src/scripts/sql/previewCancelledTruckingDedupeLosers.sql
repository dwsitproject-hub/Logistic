-- Preview CANCELLED trucking ops eligible for hard-delete (Rule A ∪ Rule B).
-- Rule A: active keeper on same PO (or blank-PO contract_id)
-- Rule B: orphan shell — no active keeper AND no trucking_daily_actuals rows
-- Read-only — does not delete.
-- Debug one OP: add AND t.operation_id = 'OP-LAND-150720260079' in cancelled CTE.

\echo '=== CANCELLED trucking ops (all) ==='
SELECT COUNT(*)::int AS cancelled_all
FROM trucking_operations t
WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL');

\echo ''
\echo '=== Would-delete breakdown (Rule A + Rule B) ==='
WITH cancelled AS (
  SELECT
    t.id,
    t.contract_id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    (
      SELECT COUNT(*)::int
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) AS wb_rows,
    EXISTS (
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
    ) AS has_active_keeper,
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
),
classified AS (
  SELECT
    *,
    CASE
      WHEN has_active_keeper THEN 'active_keeper'
      WHEN wb_rows = 0 THEN 'orphan_no_wb'
      ELSE NULL
    END AS delete_reason
  FROM cancelled
),
eligible AS (
  SELECT * FROM classified WHERE delete_reason IS NOT NULL
)
SELECT
  (SELECT COUNT(*)::int FROM classified WHERE delete_reason = 'active_keeper') AS rule_a_active_keeper,
  (SELECT COUNT(*)::int FROM classified WHERE delete_reason = 'orphan_no_wb') AS rule_b_orphan_no_wb,
  (SELECT COUNT(*)::int FROM eligible) AS would_delete,
  (SELECT COUNT(*)::int FROM classified WHERE delete_reason IS NULL) AS cancelled_kept_has_wb_no_keeper;

\echo ''
\echo '=== Sample would-delete (up to 40; includes delete_reason) ==='
WITH cancelled AS (
  SELECT
    t.id,
    c.contract_id AS contract_number,
    c.po_number,
    t.operation_id,
    t.status,
    (
      SELECT COUNT(*)::int
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = t.id
    ) AS wb_rows,
    EXISTS (
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
    ) AS has_active_keeper,
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
),
eligible AS (
  SELECT
    *,
    CASE
      WHEN has_active_keeper THEN 'active_keeper'
      WHEN wb_rows = 0 THEN 'orphan_no_wb'
      ELSE NULL
    END AS delete_reason
  FROM cancelled
  WHERE has_active_keeper OR wb_rows = 0
)
SELECT
  delete_reason,
  po_number,
  operation_id,
  keeper_operation_id,
  wb_rows,
  contract_number
FROM eligible
ORDER BY delete_reason, po_number NULLS LAST, operation_id
LIMIT 40;

\echo ''
\echo '=== Debug OP-LAND-150720260079 (if present) ==='
SELECT
  t.operation_id,
  t.status,
  c.po_number,
  (
    SELECT COUNT(*)::int FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id
  ) AS wb_rows,
  EXISTS (
    SELECT 1
    FROM trucking_operations tk
    INNER JOIN contracts ck ON ck.id = tk.contract_id
    WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
      AND NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
      AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
  ) AS has_active_keeper,
  CASE
    WHEN UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
      THEN 'not_cancelled'
    WHEN EXISTS (
      SELECT 1
      FROM trucking_operations tk
      INNER JOIN contracts ck ON ck.id = tk.contract_id
      WHERE UPPER(TRIM(COALESCE(tk.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
        AND NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
        AND TRIM(COALESCE(ck.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
    ) THEN 'active_keeper'
    WHEN NOT EXISTS (
      SELECT 1 FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id
    ) THEN 'orphan_no_wb'
    ELSE 'kept_has_wb_no_keeper'
  END AS delete_reason
FROM trucking_operations t
LEFT JOIN contracts c ON c.id = t.contract_id
WHERE t.operation_id = 'OP-LAND-150720260079';
