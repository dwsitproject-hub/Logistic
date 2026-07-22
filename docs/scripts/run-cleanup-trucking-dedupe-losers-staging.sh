#!/usr/bin/env bash
# Hard-delete CANCELLED trucking_operations that are dedupe losers
# (still have an active keeper on the same PO). Manual CANCELLED without
# an active sibling are kept.
#
# DB access (host → SIT backend 172.28.92.57):
#   1) Prefer docker exec into klip-postgres (compose network name "postgres"
#      in backend/.env is NOT resolvable on the host)
#   2) Else host psql to 127.0.0.1:${POSTGRES_PORT:-5433}
#   3) Else host psql to DB_HOST/DB_PORT when they are already host-reachable
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
  sed -n '2,18p' "$0"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SQL_PREVIEW="backend/src/scripts/sql/previewCancelledTruckingDedupeLosers.sql"
SQL_DELETE="backend/src/scripts/sql/deleteCancelledTruckingDedupeLosers.sql"
ENV_FILE="backend/.env"
ROOT_ENV_FILE=".env"
COMPOSE=(docker compose -f docker-compose.backend.yml)

for f in "$SQL_PREVIEW" "$SQL_DELETE" "$ENV_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f — run from /opt/klip after: git pull origin SIT" >&2
    exit 1
  fi
done

# Load KEY=VALUE for selected keys only (ignore malformed/other secrets)
load_keys_from_file() {
  local env_file="$1"
  shift
  local allow=" $* "
  local line key val
  [[ -f "$env_file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      [[ "$allow" == *" $key "* ]] || continue
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      printf -v "$key" '%s' "$val"
      export "$key"
    fi
  done < "$env_file"
}

load_keys_from_file "$ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT
load_keys_from_file "$ROOT_ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT

DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD empty or missing as DB_PASSWORD=... in $ENV_FILE" >&2
  exit 1
fi

PSQL_MODE="" # docker_exec | host_psql
PSQL_HOST=""
PSQL_PORT=""

resolve_psql_target() {
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-postgres'; then
      PSQL_MODE="docker_exec"
      PSQL_HOST="klip-postgres (docker exec)"
      PSQL_PORT="5432"
      return 0
    fi
    if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx 'postgres'; then
      PSQL_MODE="compose_exec"
      PSQL_HOST="compose service postgres"
      PSQL_PORT="5432"
      return 0
    fi
  fi

  if ! command -v psql >/dev/null 2>&1; then
    echo "ERROR: psql not on PATH and klip-postgres container not running." >&2
    echo "  Start stack: docker compose -f docker-compose.backend.yml up -d" >&2
    exit 1
  fi

  PSQL_MODE="host_psql"
  case "${DB_HOST:-}" in
    postgres|klip-postgres|"")
      # Docker DNS names only work inside the compose network — use published host port
      PSQL_HOST="127.0.0.1"
      PSQL_PORT="$POSTGRES_PORT"
      ;;
    *)
      PSQL_HOST="$DB_HOST"
      PSQL_PORT="${DB_PORT:-5432}"
      ;;
  esac
}

run_psql_file() {
  local host_path="$1"
  case "$PSQL_MODE" in
    docker_exec)
      docker exec -i -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$host_path"
      ;;
    compose_exec)
      "${COMPOSE[@]}" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$host_path"
      ;;
    host_psql)
      PGPASSWORD="$DB_PASSWORD" psql \
        -h "$PSQL_HOST" \
        -p "$PSQL_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 \
        -f "$host_path"
      ;;
    *)
      echo "ERROR: unknown PSQL_MODE=$PSQL_MODE" >&2
      exit 1
      ;;
  esac
}

probe_psql() {
  case "$PSQL_MODE" in
    docker_exec)
      docker exec -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null
      ;;
    compose_exec)
      "${COMPOSE[@]}" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null
      ;;
    host_psql)
      PGPASSWORD="$DB_PASSWORD" psql \
        -h "$PSQL_HOST" -p "$PSQL_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "SELECT 1" >/dev/null
      ;;
  esac
}

resolve_psql_target

echo "=== KLIP trucking CANCELLED dedupe-loser cleanup ==="
echo "    dir:  $ROOT"
echo "    db:   $DB_USER@$PSQL_HOST:$PSQL_PORT/$DB_NAME  [$PSQL_MODE]"
echo "    mode: $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW)"
echo ""

echo "==> Connectivity"
if ! probe_psql; then
  echo "ERROR: cannot connect via $PSQL_MODE ($PSQL_HOST:$PSQL_PORT)" >&2
  echo "  Check: docker compose -f docker-compose.backend.yml ps" >&2
  echo "  Or host: psql -h 127.0.0.1 -p ${POSTGRES_PORT} -U $DB_USER -d $DB_NAME" >&2
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
