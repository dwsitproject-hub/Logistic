#!/usr/bin/env bash
# Hard-delete CANCELLED trucking_operations that are dedupe losers
# (still have an active keeper on the same PO). Manual CANCELLED without
# an active sibling are kept.
#
# Uses remote SIT DB from /opt/klip/backend/.env (DB_HOST=172.28.92.60, DB_PORT=5442)
# — does NOT require a postgres container on the backend host.
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/run-cleanup-trucking-dedupe-losers-staging.sh          # preview
#   bash docs/scripts/run-cleanup-trucking-dedupe-losers-staging.sh --apply  # execute
#
# Audit table: cleanup_audit_cancelled_trucking_dedupe_losers
set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
elif [[ -n "${1:-}" && "${1:-}" != "-h" && "${1:-}" != "--help" ]]; then
  echo "Unknown arg: $1 (use --apply or no args for preview)" >&2
  exit 1
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,16p' "$0"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SQL_PREVIEW="backend/src/scripts/sql/previewCancelledTruckingDedupeLosers.sql"
SQL_DELETE="backend/src/scripts/sql/deleteCancelledTruckingDedupeLosers.sql"
ENV_FILE="backend/.env"
COMPOSE=(docker compose -f docker-compose.backend.yml)

for f in "$SQL_PREVIEW" "$SQL_DELETE" "$ENV_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f — run from /opt/klip after: git pull origin SIT" >&2
    exit 1
  fi
done

# Load DB_* from backend/.env without printing secrets
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-postgres}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD empty in $ENV_FILE" >&2
  exit 1
fi

run_psql_file() {
  local host_path="$1"
  PGPASSWORD="$DB_PASSWORD" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -f "$host_path"
}

echo "=== KLIP trucking CANCELLED dedupe-loser cleanup ==="
echo "    dir:  $ROOT"
echo "    db:   $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "    mode: $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW)"
echo ""

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found on PATH." >&2
  echo "  Install postgresql-client, or run from a host that has psql." >&2
  echo "  Fallback: PuTTY → DB host 172.28.92.60:" >&2
  echo "    docker exec -i klip-postgres psql -U postgres -d klip_db -v ON_ERROR_STOP=1 -f - < $SQL_PREVIEW" >&2
  exit 1
fi

echo "==> Connectivity"
if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null; then
  echo "ERROR: cannot connect to DB at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "    OK"
echo ""

echo "=== PREVIEW (read-only) ==="
run_psql_file "$SQL_PREVIEW"

if ! $APPLY; then
  echo ""
  echo "Review counts above. Manual CANCELLED (no active keeper) are NOT deleted."
  echo "To hard-delete dedupe losers only:"
  echo "  bash docs/scripts/run-cleanup-trucking-dedupe-losers-staging.sh --apply"
  exit 0
fi

echo ""
echo "=== APPLY: delete CANCELLED dedupe losers ==="
run_psql_file "$SQL_DELETE"

echo ""
echo "=== POST-CLEANUP PREVIEW ==="
run_psql_file "$SQL_PREVIEW"

echo ""
echo "==> Refresh trucking pipeline summary (best-effort)"
if curl -sf http://127.0.0.1:5001/health >/dev/null 2>&1; then
  if "${COMPOSE[@]}" exec -T backend test -f dist/scripts/refreshTruckingPipelineSummary.js 2>/dev/null; then
    "${COMPOSE[@]}" exec -T backend node dist/scripts/refreshTruckingPipelineSummary.js || true
  else
    echo "    refresh script missing — restarting backend instead"
    "${COMPOSE[@]}" restart backend || true
  fi
else
  echo "    backend health failed — skipping refresh (restart backend when up)"
fi

echo ""
echo "Done. Audit: cleanup_audit_cancelled_trucking_dedupe_losers"
echo "Verify UI Trucking Cancelled card (hard refresh Ctrl+Shift+R)."
