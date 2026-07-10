#!/usr/bin/env bash
# Clean duplicate + CANCELLED trucking_operations on SIT/staging DB (172.28.92.57).
# Same sequence as local cleanup: op-id dupes → CANCELLED → per-contract dupes.
#
# Usage (on backend server):
#   cd /opt/klip
#   bash docs/scripts/run-cleanup-trucking-staging.sh              # preview only
#   bash docs/scripts/run-cleanup-trucking-staging.sh --apply      # execute cleanup
#
# Audit tables:
#   cleanup_audit_duplicate_trucking_op_id
#   cleanup_audit_cancelled_trucking
#   cleanup_audit_duplicate_trucking_per_contract
set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f docker-compose.backend.yml"
CONTAINER="klip-postgres"
PSQL=( $COMPOSE exec -T postgres psql -U "${DB_USER:-postgres}" -d "${DB_NAME:-klip_db}" -v ON_ERROR_STOP=1 )

SQL_PREVIEW="backend/src/scripts/sql/previewTruckingCleanupStaging.sql"
SQL_OP_ID="backend/src/scripts/sql/cleanupDuplicateTruckingByOperationId.sql"
SQL_CANCELLED="backend/src/scripts/sql/deleteCancelledTruckingOperations.sql"
SQL_PER_CONTRACT="backend/src/scripts/sql/cleanupDuplicateTruckingPerContract.sql"

for f in "$SQL_PREVIEW" "$SQL_OP_ID" "$SQL_CANCELLED" "$SQL_PER_CONTRACT"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f — run: git pull origin SIT" >&2
    exit 1
  fi
done

run_sql_in_container() {
  local host_path="$1"
  local container_path="$2"
  docker cp "$host_path" "${CONTAINER}:${container_path}"
  "${PSQL[@]}" -f "$container_path"
}

echo "=== PREVIEW (read-only) ==="
run_sql_in_container "$SQL_PREVIEW" /tmp/previewTruckingCleanupStaging.sql

if ! $APPLY; then
  echo ""
  echo "Review counts above. To execute cleanup:"
  echo "  bash docs/scripts/run-cleanup-trucking-staging.sh --apply"
  exit 0
fi

echo ""
echo "=== APPLY: Step 1/3 — duplicate operation_id groups ==="
run_sql_in_container "$SQL_OP_ID" /tmp/cleanupDuplicateTruckingByOperationId.sql

echo ""
echo "=== APPLY: Step 2/3 — CANCELLED trucking operations ==="
run_sql_in_container "$SQL_CANCELLED" /tmp/deleteCancelledTruckingOperations.sql

echo ""
echo "=== APPLY: Step 3/3 — duplicate per contract (keep best row) ==="
run_sql_in_container "$SQL_PER_CONTRACT" /tmp/cleanupDuplicateTruckingPerContract.sql

echo ""
echo "=== POST-CLEANUP SUMMARY ==="
run_sql_in_container "$SQL_PREVIEW" /tmp/previewTruckingCleanupStaging.sql

echo ""
echo "Restarting backend to refresh list caches..."
$COMPOSE restart backend || true

echo ""
echo "Done. Trucking cleanup committed on staging DB."
echo "Verify UI: http://8.215.6.189/trucking (hard refresh Ctrl+Shift+R)"
