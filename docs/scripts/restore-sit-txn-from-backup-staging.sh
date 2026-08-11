#!/usr/bin/env bash
# Restore SIT transactional domain data (shipments, ports, trucking, …) from backup.
# Use after accidental TRUNCATE CASCADE on master_vessels wiped shipments.
#
# Backups are created by:
#   bash docs/scripts/dump-sit-transactional-data.sh
#   bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh --apply  (auto backup)
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/restore-sit-txn-from-backup-staging.sh --list
#   bash docs/scripts/restore-sit-txn-from-backup-staging.sh --latest
#   bash docs/scripts/restore-sit-txn-from-backup-staging.sh --latest --apply
#   bash docs/scripts/restore-sit-txn-from-backup-staging.sh /opt/klip/backups/klip_sit_txn_YYYYMMDD_HHMMSS.dump --apply
#   bash docs/scripts/restore-sit-txn-from-backup-staging.sh --reprocess-sap --apply   # no backup (slow)
#
# Prereq: postgresql-client on host (apt-get install -y postgresql-client) for pg_restore/psql
set -euo pipefail

APPLY=false
LIST_ONLY=false
USE_LATEST=false
REPROCESS_SAP=false
DUMP_FILE=""
OUT_DIR="${OUT_DIR:-/opt/klip/backups}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --list) LIST_ONLY=true; shift ;;
    --latest) USE_LATEST=true; shift ;;
    --reprocess-sap) REPROCESS_SAP=true; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$DUMP_FILE" ]]; then DUMP_FILE="$1"; shift; else echo "Unknown arg: $1" >&2; exit 1; fi
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.backend.yml)
ENV_FILE="backend/.env"
ROOT_ENV_FILE=".env"

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

load_keys_from_file "$ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
load_keys_from_file "$ROOT_ENV_FILE" DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'klip-backend'; then
  if [[ -z "${DB_PASSWORD:-}" ]]; then
    DB_PASSWORD="$(docker exec klip-backend printenv DB_PASSWORD 2>/dev/null || true)"
    export DB_PASSWORD
  fi
  CONTAINER_DB_HOST="$(docker exec klip-backend printenv DB_HOST 2>/dev/null || true)"
  CONTAINER_DB_PORT="$(docker exec klip-backend printenv DB_PORT 2>/dev/null || true)"
  if [[ -n "$CONTAINER_DB_HOST" ]] && ! is_docker_dns_db_host "$CONTAINER_DB_HOST"; then
    DB_HOST="$CONTAINER_DB_HOST"
    DB_PORT="${CONTAINER_DB_PORT:-5432}"
  fi
fi

DB_HOST="${DB_HOST:-172.28.92.60}"
DB_PORT="${DB_PORT:-5442}"
DB_NAME="${DB_NAME:-klip_db}"
DB_USER="${DB_USER:-klip_user}"

if is_docker_dns_db_host "$DB_HOST"; then
  DB_HOST="172.28.92.60"
  DB_PORT="5442"
fi

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD not set (backend/.env or klip-backend container)" >&2
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

read_counts_file() {
  local counts_file="$1"
  local key="$2"
  local line val
  [[ -f "$counts_file" ]] || return 0
  while IFS= read -r line; do
    if [[ "$line" =~ ^${key}=([0-9]+)$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
    if [[ "$line" =~ ^([0-9]+)[[:space:]]+${key}$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
  done < "$counts_file"
  return 0
}

shipments_in_counts_file() {
  local counts_file="${1%.dump}_counts.txt"
  if [[ ! -f "$counts_file" ]]; then
    counts_file="${1%.sql}_counts.txt"
  fi
  read_counts_file "$counts_file" "shipments" || echo "?"
}

print_db_counts() {
  local label="$1"
  echo "==> $label"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc "
SELECT 'shipments=' || COUNT(*)::text FROM shipments
UNION ALL SELECT 'vessel_loading_ports=' || COUNT(*)::text FROM vessel_loading_ports
UNION ALL SELECT 'trucking_operations=' || COUNT(*)::text FROM trucking_operations
UNION ALL SELECT 'contracts=' || COUNT(*)::text FROM contracts
UNION ALL SELECT 'sap_processed_data=' || COUNT(*)::text FROM sap_processed_data
UNION ALL SELECT 'master_vessels=' || COUNT(*)::text FROM master_vessels;
"
}

list_backups() {
  echo "=== Available backups in $OUT_DIR ==="
  local found=0
  shopt -s nullglob
  for f in "$OUT_DIR"/klip_sit_txn_*.dump "$OUT_DIR"/klip_sit_txn_*.sql; do
    [[ -f "$f" ]] || continue
    found=1
    local ship
    ship="$(shipments_in_counts_file "$f")"
    local sz
    sz="$(du -h "$f" | awk '{print $1}')"
    printf "  %s  shipments=%s  %s\n" "$(basename "$f")" "${ship:-?}" "$sz"
  done
  shopt -u nullglob
  if [[ "$found" -eq 0 ]]; then
    echo "  (none — run: bash docs/scripts/dump-sit-transactional-data.sh)"
  fi
}

pick_latest_backup_with_shipments() {
  local best=""
  local best_ship=0
  shopt -s nullglob
  for f in "$OUT_DIR"/klip_sit_txn_*.dump "$OUT_DIR"/klip_sit_txn_*.sql; do
    [[ -f "$f" ]] || continue
    local ship
    ship="$(shipments_in_counts_file "$f")"
    if [[ "$ship" =~ ^[0-9]+$ ]] && (( ship > 0 )); then
      if [[ -z "$best" ]] || [[ "$f" -nt "$best" ]]; then
        best="$f"
        best_ship="$ship"
      fi
    fi
  done
  shopt -u nullglob
  if [[ -z "$best" ]]; then
    echo "ERROR: no backup with shipments>0 in $OUT_DIR" >&2
    echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh --list" >&2
    echo "  Or upload a .dump to $OUT_DIR and pass the path explicitly." >&2
    exit 1
  fi
  echo "    Selected latest backup with shipments=$best_ship"
  echo "    $best"
  DUMP_FILE="$best"
}

restore_from_dump() {
  local file="$1"
  echo ""
  echo "==> Tables in backup"
  if [[ "$file" == *.dump ]]; then
    if ! command -v pg_restore >/dev/null 2>&1; then
      echo "ERROR: pg_restore not found. Install: sudo apt-get install -y postgresql-client" >&2
      exit 1
    fi
    pg_restore -l "$file" | grep "TABLE DATA" | head -40
    echo ""
    echo "==> Restoring (pg_restore data-only, disable triggers)..."
    pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      --data-only --disable-triggers --no-owner --no-acl --exit-on-error \
      "$file"
  elif [[ "$file" == *.sql ]]; then
    if ! command -v psql >/dev/null 2>&1; then
      echo "ERROR: psql not found. Install: sudo apt-get install -y postgresql-client" >&2
      exit 1
    fi
    echo "    (plain SQL file)"
    echo ""
    echo "==> Restoring via psql -f ..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -f "$file"
  else
    echo "ERROR: unsupported backup format (use .dump or .sql): $file" >&2
    exit 1
  fi
}

reprocess_all_sap() {
  echo ""
  echo "==> Emergency rebuild from sap_processed_data (slow; manual edits may be lost)"
  if ! curl -sf http://127.0.0.1:5001/health >/dev/null; then
    echo "ERROR: backend /health failed" >&2
    exit 1
  fi
  "${COMPOSE[@]}" exec -T backend node -e "
const pool = require('./dist/database/connection').default;
const { SapDataDistributionService } = require('./dist/services/sapDataDistribution.service');
(async () => {
  const client = await pool.connect();
  const { rows } = await client.query('SELECT id, data FROM sap_processed_data ORDER BY created_at ASC');
  console.log('Rows to reprocess:', rows.length);
  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      await client.query('BEGIN');
      await SapDataDistributionService.distributeData(client, row.data, undefined);
      await client.query('COMMIT');
      ok++;
      if (ok % 500 === 0) console.log('  progress OK', ok);
    } catch (e) {
      await client.query('ROLLBACK');
      fail++;
      if (fail <= 5) console.error('  fail row', row.id, e.message || e);
    }
  }
  client.release();
  const counts = await pool.query(\`
    SELECT
      (SELECT COUNT(*)::int FROM shipments) AS shipments,
      (SELECT COUNT(*)::int FROM vessel_loading_ports) AS ports
  \`);
  console.log(JSON.stringify({ ok, fail, ...counts.rows[0] }, null, 2));
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
"
}

echo "=== KLIP SIT restore transactional data ==="
echo "    repo:   $ROOT"
echo "    target: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "    mode:   $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW)"

if $LIST_ONLY; then
  list_backups
  exit 0
fi

if $REPROCESS_SAP; then
  print_db_counts "Current DB counts"
  if ! $APPLY; then
    echo ""
    echo "Preview only. To rebuild shipments from SAP:"
    echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh --reprocess-sap --apply"
    exit 0
  fi
  reprocess_all_sap
  print_db_counts "Post-reprocess counts"
  echo ""
  echo "DONE (SAP reprocess). Verify /shipments in browser."
  exit 0
fi

if $USE_LATEST; then
  echo ""
  echo "==> Pick latest backup with shipments > 0"
  pick_latest_backup_with_shipments
fi

if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: backup file required." >&2
  echo "" >&2
  list_backups
  echo "" >&2
  echo "Usage:" >&2
  echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh --list" >&2
  echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh --latest --apply" >&2
  echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh /opt/klip/backups/klip_sit_txn_....dump --apply" >&2
  exit 1
fi

echo ""
echo "    backup: $DUMP_FILE"
shipments_in_backup="$(shipments_in_counts_file "$DUMP_FILE")"
if [[ -n "$shipments_in_backup" && "$shipments_in_backup" != "?" ]]; then
  echo "    backup shipments (from counts file): $shipments_in_backup"
fi

print_db_counts "Current DB counts"

if ! $APPLY; then
  echo ""
  list_backups
  echo ""
  echo "Preview only. To restore:"
  echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh \"$DUMP_FILE\" --apply"
  if $USE_LATEST; then
    echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh --latest --apply"
  fi
  exit 0
fi

current_shipments="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT COUNT(*)::int FROM shipments" || echo 0)"
if [[ "$current_shipments" != "0" ]]; then
  echo ""
  echo "WARN: shipments table is not empty (count=$current_shipments)." >&2
  echo "      pg_restore may fail on duplicate keys. Continue only if intentional." >&2
  echo "      Press Ctrl+C within 5s to abort..." >&2
  sleep 5
fi

restore_from_dump "$DUMP_FILE"

print_db_counts "Post-restore counts"

echo ""
echo "==> Invalidate shipping performance cache (best-effort)"
if curl -sf http://127.0.0.1:5001/health >/dev/null; then
  "${COMPOSE[@]}" exec -T backend node -e "
try {
  const svc = require('./dist/services/shippingPerformance.service');
  if (typeof svc.invalidateShippingPerformanceRowCache === 'function') {
    svc.invalidateShippingPerformanceRowCache();
    console.log('    cache invalidated');
  }
} catch (e) { console.log('    skip:', e.message); }
" || true
fi

echo ""
echo "SUCCESS."
echo "  Verify: http://8.215.6.189/shipments and /shipping-performance (Ctrl+Shift+R)"
echo ""
echo "Optional — re-link master vessels (safe; uses DELETE not TRUNCATE CASCADE):"
echo "  bash docs/scripts/sync-master-vessel-staging.sh --file tmp/master_vessel_local_to_sit.sql --apply"
