#!/usr/bin/env bash
# Hard-delete CANCELLED trucking_operations that are dedupe losers
# (still have an active keeper on the same PO). Manual CANCELLED without
# an active sibling are kept.
#
# DB access (host → SIT backend 172.28.92.57):
#   Prefer the SAME DB as the running backend container (printenv DB_*),
#   e.g. 172.28.92.60:5442 — NOT the leftover local klip-postgres unless
#   the backend itself still points at klip-postgres/postgres.
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

# Overlay from running backend container (source of truth for app data)
load_keys_from_backend_container() {
  command -v docker >/dev/null 2>&1 || return 0
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-backend' || return 0
  local line key val
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ ^(DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      printf -v "$key" '%s' "$val"
      export "$key"
    fi
  done < <(docker exec klip-backend printenv 2>/dev/null | grep -E '^(DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD)=' || true)
}

load_keys_from_file "$ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT
load_keys_from_file "$ROOT_ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT
load_keys_from_backend_container

DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD empty or missing (backend/.env or klip-backend env)" >&2
  exit 1
fi

PSQL_MODE="" # docker_exec | compose_exec | host_psql
PSQL_HOST=""
PSQL_PORT=""

is_docker_dns_db_host() {
  case "${1:-}" in
    postgres|klip-postgres|"") return 0 ;;
    *) return 1 ;;
  esac
}

resolve_psql_target() {
  # 1) Backend points at a host-reachable DB (SIT dedicated DB .60:5442)
  if ! is_docker_dns_db_host "${DB_HOST:-}"; then
    if command -v psql >/dev/null 2>&1; then
      PSQL_MODE="host_psql"
      PSQL_HOST="$DB_HOST"
      PSQL_PORT="${DB_PORT:-5432}"
      return 0
    fi
    echo "ERROR: backend uses DB_HOST=$DB_HOST but host has no psql client." >&2
    echo "  apt-get install -y postgresql-client" >&2
    exit 1
  fi

  # 2) In-stack postgres (legacy / local compose)
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
    echo "ERROR: psql not on PATH and no local klip-postgres container." >&2
    exit 1
  fi

  PSQL_MODE="host_psql"
  PSQL_HOST="127.0.0.1"
  PSQL_PORT="$POSTGRES_PORT"
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
  echo "  Backend env DB_HOST/DB_PORT should match (docker exec klip-backend printenv | grep DB_)" >&2
  echo "  Remote SIT: apt-get install -y postgresql-client && retry" >&2
  exit 1
fi
echo "    OK"
echo ""

echo "=== PREVIEW (read-only) ==="
run_psql_file "$SQL_PREVIEW"

if ! $APPLY; then
  echo ""
  echo "Review counts above (rule_a_active_keeper + rule_b_orphan_no_wb = would_delete)."
  echo "CANCELLED with WB but no keeper are kept (cancelled_kept_has_wb_no_keeper)."
  echo "Header db: must match backend (e.g. 172.28.92.60:5442), not empty local klip-postgres."
  echo "To hard-delete eligible rows:"
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
