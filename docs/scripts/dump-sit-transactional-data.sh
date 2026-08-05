#!/usr/bin/env bash
# Dump KLIP transactional (domain) data from SIT/staging DB.
#
# Run on backend host (PuTTY → 172.28.92.57), from /opt/klip:
#   bash docs/scripts/dump-sit-transactional-data.sh
#   # optional:
#   OUT_DIR=/opt/klip/backups bash docs/scripts/dump-sit-transactional-data.sh
#   FORMAT=plain bash docs/scripts/dump-sit-transactional-data.sh   # .sql instead of .dump
#
# DB resolution (same rules as run-cleanup-trucking-dedupe-losers-staging.sh):
#   - Prefer host-reachable DB from /opt/klip/.env or backend/.env (e.g. 172.28.92.60:5442)
#   - Ignore Docker-only hostnames (postgres, klip-postgres) when running pg_dump on the host
#   - Fallback: pg_dump via docker exec klip-postgres when local stack holds data
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
FORMAT="${FORMAT:-custom}"   # custom → -Fc (.dump); plain → -Fp (.sql)
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT_DIR"

ENV_FILE="backend/.env"
ROOT_ENV_FILE=".env"
COMPOSE=(docker compose -f docker-compose.backend.yml)

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

is_docker_dns_db_host() {
  case "${1:-}" in
    postgres|klip-postgres|"") return 0 ;;
    *) return 1 ;;
  esac
}

# 1) Host-reachable targets from env files (SIT: 172.28.92.60:5442)
load_keys_from_file "$ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT
load_keys_from_file "$ROOT_ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD POSTGRES_PORT

HOST_DB_HOST="${DB_HOST:-}"
HOST_DB_PORT="${DB_PORT:-}"
CONTAINER_DB_HOST=""
CONTAINER_DB_PORT=""

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-backend'; then
  CONTAINER_DB_HOST="$(docker exec klip-backend printenv DB_HOST 2>/dev/null || true)"
  CONTAINER_DB_PORT="$(docker exec klip-backend printenv DB_PORT 2>/dev/null || true)"
  if [[ -z "${DB_PASSWORD:-}" ]]; then
    DB_PASSWORD="$(docker exec klip-backend printenv DB_PASSWORD 2>/dev/null || true)"
    export DB_PASSWORD
  fi
  # Use container host only when it is reachable from the PuTTY host (not Docker DNS).
  if [[ -n "$CONTAINER_DB_HOST" ]] && ! is_docker_dns_db_host "$CONTAINER_DB_HOST"; then
    HOST_DB_HOST="$CONTAINER_DB_HOST"
    HOST_DB_PORT="${CONTAINER_DB_PORT:-5432}"
  fi
fi

DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"

if is_docker_dns_db_host "$HOST_DB_HOST"; then
  HOST_DB_HOST="${HOST_DB_HOST:-172.28.92.60}"
  HOST_DB_PORT="${HOST_DB_PORT:-5442}"
  if is_docker_dns_db_host "$HOST_DB_HOST"; then
    HOST_DB_HOST="172.28.92.60"
    HOST_DB_PORT="5442"
  fi
fi

HOST_DB_PORT="${HOST_DB_PORT:-5442}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD empty (set in backend/.env or klip-backend env)" >&2
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

DUMP_MODE="" # host_pg_dump | docker_exec | compose_exec
DUMP_LABEL=""

resolve_dump_target() {
  if command -v psql >/dev/null 2>&1; then
    if PGPASSWORD="$DB_PASSWORD" psql -h "$HOST_DB_HOST" -p "$HOST_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
      DUMP_MODE="host_pg_dump"
      DUMP_LABEL="$DB_USER@$HOST_DB_HOST:$HOST_DB_PORT/$DB_NAME [host]"
      return 0
    fi
  fi

  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-postgres'; then
      if docker exec -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
        DUMP_MODE="docker_exec"
        DUMP_LABEL="$DB_USER@klip-postgres(docker)/$DB_NAME"
        return 0
      fi
    fi
    if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx 'postgres'; then
      if "${COMPOSE[@]}" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
        DUMP_MODE="compose_exec"
        DUMP_LABEL="$DB_USER@compose-postgres/$DB_NAME"
        return 0
      fi
    fi
  fi

  echo "ERROR: cannot connect to DB for dump." >&2
  echo "  Tried host: $DB_USER@$HOST_DB_HOST:$HOST_DB_PORT/$DB_NAME" >&2
  echo "  Container DB_HOST=$CONTAINER_DB_HOST (Docker DNS names are not reachable from PuTTY host)" >&2
  echo "  Fix: set DB_HOST=172.28.92.60 DB_PORT=5442 in /opt/klip/.env" >&2
  echo "  Or: apt-get install -y postgresql-client && nc -vz 172.28.92.60 5442" >&2
  exit 1
}

run_psql_at() {
  local sql="$1"
  case "$DUMP_MODE" in
    host_pg_dump)
      psql -h "$HOST_DB_HOST" -p "$HOST_DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc "$sql"
      ;;
    docker_exec)
      docker exec -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -Atc "$sql"
      ;;
    compose_exec)
      "${COMPOSE[@]}" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
        psql -U "$DB_USER" -d "$DB_NAME" -Atc "$sql"
      ;;
  esac
}

run_pg_dump() {
  local out_file="$1"
  shift
  local extra_args=("$@")
  case "$DUMP_MODE" in
    host_pg_dump)
      pg_dump -h "$HOST_DB_HOST" -p "$HOST_DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        "${extra_args[@]}" -f "$out_file"
      ;;
    docker_exec)
      docker exec -e PGPASSWORD="$DB_PASSWORD" klip-postgres \
        pg_dump -U "$DB_USER" -d "$DB_NAME" \
        "${extra_args[@]}" > "$out_file"
      ;;
    compose_exec)
      "${COMPOSE[@]}" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
        pg_dump -U "$DB_USER" -d "$DB_NAME" \
        "${extra_args[@]}" > "$out_file"
      ;;
  esac
}

resolve_dump_target

if [[ "$DUMP_MODE" == "host_pg_dump" ]]; then
  PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
  if ! command -v "$PG_DUMP_BIN" >/dev/null 2>&1; then
    echo "ERROR: pg_dump not on PATH. Install: apt-get install -y postgresql-client" >&2
    exit 1
  fi
fi

TABLES=(
  contracts
  contract_stos
  shipments
  vessel_loading_ports
  trucking_operations
  trucking_daily_actuals
  trucking_realizations
  trucking_wb_imports
  payments
  documents
  remarks
  quality_surveys
  sap_data_imports
  sap_raw_data
  sap_processed_data
  claim_mutu_imports
  claim_mutu_rows
  claim_susut_imports
  claim_susut_rows
  commercial_document_files
  commercial_document_history
  settlement_invoice_summaries
  shipment_ata_overrides
  alerts
  suppliers
  products
  surveyors
  loading_ports
  master_plants
  master_vessels
  master_loading_ports
  supplier_groups
)

echo "=== Dump target $DUMP_LABEL ==="
if [[ "$CONTAINER_DB_HOST" != "$HOST_DB_HOST" ]]; then
  echo "    (backend container DB_HOST=$CONTAINER_DB_HOST → host dump via $HOST_DB_HOST:$HOST_DB_PORT)"
fi
echo "=== Listing existing tables ==="
EXISTING=()
for t in "${TABLES[@]}"; do
  exists="$(run_psql_at "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1" || true)"
  if [[ "$exists" == "1" ]]; then
    EXISTING+=("$t")
    echo "  + $t"
  else
    echo "  - $t (skip, not found)"
  fi
done

if [[ ${#EXISTING[@]} -eq 0 ]]; then
  echo "ERROR: no tables found to dump." >&2
  exit 1
fi

TABLE_ARGS=()
for t in "${EXISTING[@]}"; do
  TABLE_ARGS+=(--table="public.$t")
done

if [[ "$FORMAT" == "plain" ]]; then
  OUT_FILE="$OUT_DIR/klip_sit_txn_${STAMP}.sql"
  echo "=== pg_dump data-only → $OUT_FILE ==="
  run_pg_dump "$OUT_FILE" --data-only --no-owner --no-acl "${TABLE_ARGS[@]}"
else
  OUT_FILE="$OUT_DIR/klip_sit_txn_${STAMP}.dump"
  echo "=== pg_dump -Fc data-only → $OUT_FILE ==="
  run_pg_dump "$OUT_FILE" -Fc --data-only --no-owner --no-acl "${TABLE_ARGS[@]}"
fi

COUNT_FILE="$OUT_DIR/klip_sit_txn_${STAMP}_counts.txt"
{
  echo "stamp=$STAMP target=$DUMP_LABEL"
  echo "file=$OUT_FILE"
  echo "--- row counts ---"
  for t in "${EXISTING[@]}"; do
    n="$(run_psql_at "SELECT COUNT(*) FROM public.$t")"
    printf '%s\t%s\n' "$n" "$t"
  done
} | tee "$COUNT_FILE"

ls -lh "$OUT_FILE" "$COUNT_FILE"
echo "Done."
echo ""
echo "Copy to laptop (from your PC):"
echo "  scp root@172.28.92.57:$OUT_FILE D:/Project/Klip/docs/"
echo "  scp root@172.28.92.57:$COUNT_FILE D:/Project/Klip/docs/"
