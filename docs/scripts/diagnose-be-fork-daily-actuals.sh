#!/usr/bin/env bash
# Diagnose why trucking_daily_actuals merge may show 0/0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=docs/scripts/lib/be-fork-migration-common.sh
source "$ROOT/docs/scripts/lib/be-fork-migration-common.sh"

CUTOFF="${BE_FORK_CUTOFF:-2026-08-03}"
load_migration_env "$ROOT"

echo "=== trucking_daily_actuals merge diagnostic (cutoff $CUTOFF) ==="
echo ""

psql_remote -v ON_ERROR_STOP=1 <<SQL
\\echo '1) Row counts since cutoff'
SELECT 'be_fork' AS src, COUNT(*) AS cnt, MAX(updated_at) AS max_ts
FROM be_fork.trucking_daily_actuals
WHERE updated_at >= '${CUTOFF}'::timestamptz
UNION ALL
SELECT 'public', COUNT(*), MAX(updated_at)
FROM public.trucking_daily_actuals
WHERE updated_at >= '${CUTOFF}'::timestamptz;

\\echo ''
\\echo '2) Fork rows with no resolvable public trucking_operation_id'
WITH mapped AS (
  SELECT
    da.id,
    COALESCE(
      (SELECT pub.id FROM be_fork.trucking_operations fo
       JOIN public.trucking_operations pub ON pub.id = fo.id
       WHERE fo.id = da.trucking_operation_id LIMIT 1),
      (SELECT pub.id FROM be_fork.trucking_operations fo
       JOIN public.trucking_operations pub ON (
         fo.operation_id IS NOT NULL AND pub.operation_id IS NOT NULL
         AND pub.operation_id IS NOT DISTINCT FROM fo.operation_id
         AND pub.contract_id = COALESCE((
           SELECT COALESCE(pubc.id, fc.id) FROM be_fork.contracts fc
           LEFT JOIN public.contracts pubc ON (
             NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
             AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
           )
           WHERE fc.id = fo.contract_id LIMIT 1
         ), fo.contract_id)
       )
       WHERE fo.id = da.trucking_operation_id LIMIT 1),
      (SELECT t.id FROM public.trucking_operations t
       WHERE t.id = da.trucking_operation_id LIMIT 1)
    ) AS public_op_id
  FROM be_fork.trucking_daily_actuals da
  WHERE da.updated_at >= '${CUTOFF}'::timestamptz
)
SELECT
  COUNT(*) FILTER (WHERE public_op_id IS NULL) AS unmapped,
  COUNT(*) FILTER (WHERE public_op_id IS NOT NULL) AS mappable
FROM mapped;

\\echo ''
\\echo '3) Sample fork rows (first 3 since cutoff)'
SELECT id, trucking_operation_id, progress_date, sto_number, updated_at
FROM be_fork.trucking_daily_actuals
WHERE updated_at >= '${CUTOFF}'::timestamptz
ORDER BY updated_at DESC
LIMIT 3;
SQL

echo ""
echo "If be_fork count is 0, reload staging from local fork:"
echo "  bash docs/scripts/load-be-fork-to-remote-staging.sh"
echo "Then merge:"
echo "  BE_FORK_CUTOFF=${CUTOFF} bash docs/scripts/apply-be-fork-merge.sh --apply"
