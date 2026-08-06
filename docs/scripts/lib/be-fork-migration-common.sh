#!/usr/bin/env bash
# Shared helpers for BE local fork → remote DB migration scripts.
set -euo pipefail

BE_FORK_REMOTE_HOST="${BE_FORK_REMOTE_HOST:-172.28.92.60}"
BE_FORK_REMOTE_PORT="${BE_FORK_REMOTE_PORT:-5442}"
BE_FORK_CUTOFF="${BE_FORK_CUTOFF:-2026-08-03}"
BE_FORK_STAGING_SCHEMA="${BE_FORK_STAGING_SCHEMA:-be_fork}"

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

is_docker_dns_db_host() {
  case "${1:-}" in
    postgres|klip-postgres|"") return 0 ;;
    *) return 1 ;;
  esac
}

load_migration_env() {
  local root="${1:-.}"
  load_keys_from_file "$root/backend/.env" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT
  load_keys_from_file "$root/.env" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT

  DB_NAME="${DB_NAME:-klip_db}"
  DB_USER="${DB_USER:-postgres}"
  POSTGRES_PORT="${POSTGRES_PORT:-5433}"
  REMOTE_DB_HOST="${REMOTE_DB_HOST:-$BE_FORK_REMOTE_HOST}"
  REMOTE_DB_PORT="${REMOTE_DB_PORT:-$BE_FORK_REMOTE_PORT}"

  if [[ -z "${DB_PASSWORD:-}" ]] && command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-backend'; then
      DB_PASSWORD="$(docker exec klip-backend printenv DB_PASSWORD 2>/dev/null || true)"
      export DB_PASSWORD
    fi
  fi

  if [[ -z "${DB_PASSWORD:-}" ]]; then
    echo "ERROR: DB_PASSWORD empty (set in backend/.env or klip-backend env)" >&2
    exit 1
  fi
  export PGPASSWORD="$DB_PASSWORD"
}

require_local_fork_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker required to reach local BE fork (klip-postgres)" >&2
    exit 1
  fi
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-postgres'; then
    echo "ERROR: klip-postgres container not running on this host" >&2
    exit 1
  fi
}

psql_local_fork() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
    psql -U "$DB_USER" -d "$DB_NAME" "$@"
}

psql_remote() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "ERROR: psql not on PATH (apt-get install -y postgresql-client)" >&2
    exit 1
  fi
  psql -h "$REMOTE_DB_HOST" -p "$REMOTE_DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

pg_dump_local_fork() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
    pg_dump -U "$DB_USER" -d "$DB_NAME" "$@"
}

# Transactional tables in FK-safe merge order (public schema).
BE_FORK_MERGE_TABLES=(
  pre_planned_parcel_capacity
  suppliers
  products
  supplier_groups
  master_plants
  master_vessels
  master_loading_ports
  loading_ports
  surveyors
  contracts
  contract_stos
  sap_data_imports
  sap_raw_data
  sap_processed_data
  claim_mutu_imports
  claim_mutu_rows
  claim_susut_imports
  claim_susut_rows
  pre_planned_groups
  pre_planned_group_members
  pre_planned_rebuild_log
  shipments
  vessel_loading_ports
  shipment_ata_overrides
  trucking_operations
  trucking_daily_actuals
  trucking_realizations
  trucking_wb_imports
  quality_surveys
  payments
  documents
  commercial_document_files
  commercial_document_history
  settlement_invoice_summaries
  remarks
  alerts
  audit_logs
)

table_exists_local() {
  local t="$1"
  psql_local_fork -Atc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1" \
    2>/dev/null || true
}

table_exists_remote() {
  local t="$1"
  psql_remote -Atc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1" \
    2>/dev/null || true
}

row_count_local() {
  local t="$1"
  psql_local_fork -Atc "SELECT COUNT(*) FROM public.$t" 2>/dev/null || echo "ERR"
}

row_count_remote() {
  local t="$1"
  psql_remote -Atc "SELECT COUNT(*) FROM public.$t" 2>/dev/null || echo "ERR"
}

delta_count_local_since_cutoff() {
  local t="$1"
  local cutoff="$2"
  local ts_col
  ts_col="$(psql_local_fork -Atc "
    SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='$t' AND column_name='updated_at'
      ) THEN 'updated_at'
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='$t' AND column_name='created_at'
      ) THEN 'created_at'
      ELSE NULL
    END
  " 2>/dev/null || true)"
  if [[ -z "$ts_col" || "$ts_col" == "NULL" ]]; then
    echo "n/a"
    return 0
  fi
  psql_local_fork -Atc \
    "SELECT COUNT(*) FROM public.$t WHERE $ts_col >= '$cutoff'::timestamptz" 2>/dev/null || echo "ERR"
}

resolve_backend_db_target() {
  # DB_* may live in env_file only (dotenv inside Node) — not always in printenv.
  BACKEND_DB_HOST=""
  BACKEND_DB_PORT=""

  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-backend'; then
    BACKEND_DB_HOST="$(docker exec klip-backend printenv DB_HOST 2>/dev/null || true)"
    BACKEND_DB_PORT="$(docker exec klip-backend printenv DB_PORT 2>/dev/null || true)"

    if [[ -z "$BACKEND_DB_HOST" ]]; then
      BACKEND_DB_HOST="$(
        docker inspect klip-backend --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
          | sed -n 's/^DB_HOST=//p' | head -1
      )"
    fi
    if [[ -z "$BACKEND_DB_PORT" ]]; then
      BACKEND_DB_PORT="$(
        docker inspect klip-backend --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
          | sed -n 's/^DB_PORT=//p' | head -1
      )"
    fi
  fi

  # Host env files — what compose / dotenv actually configure
  if [[ -z "$BACKEND_DB_HOST" ]]; then
    BACKEND_DB_HOST="${DB_HOST:-}"
  fi
  if [[ -z "$BACKEND_DB_PORT" ]]; then
    BACKEND_DB_PORT="${DB_PORT:-}"
  fi

  export BACKEND_DB_HOST BACKEND_DB_PORT
}

verify_backend_points_remote() {
  local strict="${1:-false}"

  if ! command -v docker >/dev/null 2>&1; then
    echo "WARN: klip-backend not checked (docker missing)"
    return 0
  fi
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-backend'; then
    echo "WARN: klip-backend not running — skip DB_HOST check"
    return 0
  fi

  resolve_backend_db_target
  local host="$BACKEND_DB_HOST"
  local port="$BACKEND_DB_PORT"

  echo "klip-backend DB_HOST=${host:-<unset>} DB_PORT=${port:-<unset>} (container env + backend/.env)"

  if [[ -z "$host" ]]; then
    if [[ "$strict" == "true" ]]; then
      echo "ERROR: DB_HOST not found in container or backend/.env — confirm env before merge." >&2
      exit 1
    fi
    echo "WARN: DB_HOST unset — preview continues; set DB_HOST=172.28.92.60 in backend/.env before --apply."
    return 0
  fi

  if is_docker_dns_db_host "$host"; then
    if [[ "$strict" == "true" ]]; then
      echo "ERROR: backend still points at local fork ($host). Fix env before merge." >&2
      exit 1
    fi
    echo "WARN: backend DB_HOST=$host looks like local fork — preview continues; fix before --apply."
    return 0
  fi

  if [[ "$host" != "$REMOTE_DB_HOST" || "${port:-5442}" != "$REMOTE_DB_PORT" ]]; then
    echo "WARN: backend DB target ($host:${port:-5432}) differs from migration remote ($REMOTE_DB_HOST:$REMOTE_DB_PORT)"
  fi
}
