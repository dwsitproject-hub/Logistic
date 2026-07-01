-- Preview counts before staging trucking cleanup (read-only).

\echo '=== Trucking operations by status ==='
SELECT UPPER(COALESCE(status, '(null)')) AS status, COUNT(*)::int AS row_count
FROM trucking_operations
GROUP BY 1
ORDER BY row_count DESC;

\echo ''
\echo '=== Cancelled rows (step 2 target — CANCELLED / CANCELED / CANCEL) ==='
SELECT COUNT(*)::int AS cancelled_rows
FROM trucking_operations
WHERE UPPER(TRIM(COALESCE(status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL');

\echo ''
\echo '=== Duplicate operation_id groups (step 1 target) ==='
WITH dup_op_ids AS (
  SELECT TRIM(t.operation_id::text) AS op_key
  FROM trucking_operations t
  WHERE NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
    AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
  GROUP BY TRIM(t.operation_id::text)
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*)::int AS duplicate_operation_id_groups,
  COALESCE(SUM(cnt), 0)::int AS rows_in_dup_groups
FROM (
  SELECT d.op_key, COUNT(*)::int AS cnt
  FROM trucking_operations t
  INNER JOIN dup_op_ids d ON TRIM(t.operation_id::text) = d.op_key
  WHERE UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
  GROUP BY d.op_key
) x;

\echo ''
\echo '=== Duplicate per contract groups (step 3 target) ==='
WITH dup_contracts AS (
  SELECT contract_id
  FROM trucking_operations
  WHERE contract_id IS NOT NULL
    AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
  GROUP BY contract_id
  HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*)::int FROM dup_contracts) AS duplicate_contract_groups,
  (
    SELECT COUNT(*)::int
    FROM trucking_operations t
    WHERE t.contract_id IN (SELECT contract_id FROM dup_contracts)
      AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
  ) AS rows_in_dup_groups,
  (
    SELECT COUNT(*)::int
    FROM trucking_operations t
    WHERE t.contract_id IN (SELECT contract_id FROM dup_contracts)
      AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
  ) - (SELECT COUNT(*)::int FROM dup_contracts) AS rows_to_delete_keep_one_per_contract;

\echo ''
\echo '=== Sample duplicate operation_id (top 5) ==='
WITH dup_op_ids AS (
  SELECT TRIM(t.operation_id::text) AS op_key
  FROM trucking_operations t
  WHERE NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL
    AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
  GROUP BY TRIM(t.operation_id::text)
  HAVING COUNT(*) > 1
)
SELECT TRIM(t.operation_id::text) AS operation_id,
       STRING_AGG(DISTINCT c.po_number::text, ', ' ORDER BY c.po_number::text) AS po_numbers,
       COUNT(*)::int AS row_count
FROM trucking_operations t
INNER JOIN dup_op_ids d ON TRIM(t.operation_id::text) = d.op_key
INNER JOIN contracts c ON c.id = t.contract_id
WHERE UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('CANCELLED', 'CANCELED', 'CANCEL')
GROUP BY TRIM(t.operation_id::text)
ORDER BY row_count DESC
LIMIT 5;
