#!/usr/bin/env bash
# Dump KLIP transactional (domain) data from SIT/staging DB.
#
# Run on backend host (PuTTY → 172.28.92.57), from /opt/klip:
#   bash docs/scripts/dump-sit-transactional-data.sh
#   # optional:
#   OUT_DIR=/opt/klip/backups bash docs/scripts/dump-sit-transactional-data.sh
#   FORMAT=plain bash docs/scripts/dump-sit-transactional-data.sh   # .sql instead of .dump
#
# Uses DB_* from klip-backend (typically 172.28.92.60:5442 / klip_db).
# Excludes auth/RBAC (users, roles, passwords) and large AI/activity noise by default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
FORMAT="${FORMAT:-custom}"   # custom → -Fc (.dump); plain → -Fp (.sql)
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT_DIR"

DB_HOST="${DB_HOST:-$(docker exec klip-backend printenv DB_HOST 2>/dev/null || true)}"
DB_PORT="${DB_PORT:-$(docker exec klip-backend printenv DB_PORT 2>/dev/null || true)}"
DB_NAME="${DB_NAME:-$(docker exec klip-backend printenv DB_NAME 2>/dev/null || echo klip_db)}"
DB_USER="${DB_USER:-$(docker exec klip-backend printenv DB_USER 2>/dev/null || echo postgres)}"
DB_HOST="${DB_HOST:-172.28.92.60}"
DB_PORT="${DB_PORT:-5442}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  PGPASSWORD="$(docker exec klip-backend printenv DB_PASSWORD)"
  export PGPASSWORD
fi

# Prefer pg_dump matching server major version (from DB host via network, or local).
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
if ! command -v "$PG_DUMP_BIN" >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found on PATH. Install postgresql-client or set PG_DUMP_BIN." >&2
  exit 1
fi

# Domain / transactional tables (data-only). Skip missing tables gracefully via --table filter after existence check.
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

echo "=== Dump target $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME ==="
echo "=== Listing existing tables ==="
EXISTING=()
for t in "${TABLES[@]}"; do
  exists="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t' LIMIT 1" || true)"
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
  "$PG_DUMP_BIN" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --data-only --no-owner --no-acl \
    "${TABLE_ARGS[@]}" \
    -f "$OUT_FILE"
else
  OUT_FILE="$OUT_DIR/klip_sit_txn_${STAMP}.dump"
  echo "=== pg_dump -Fc data-only → $OUT_FILE ==="
  "$PG_DUMP_BIN" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -Fc --data-only --no-owner --no-acl \
    "${TABLE_ARGS[@]}" \
    -f "$OUT_FILE"
fi

# Row counts for sanity
COUNT_FILE="$OUT_DIR/klip_sit_txn_${STAMP}_counts.txt"
{
  echo "stamp=$STAMP host=$DB_HOST:$DB_PORT db=$DB_NAME"
  echo "file=$OUT_FILE"
  echo "--- row counts ---"
  for t in "${EXISTING[@]}"; do
    n="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT COUNT(*) FROM public.$t")"
    printf '%s\t%s\n' "$n" "$t"
  done
} | tee "$COUNT_FILE"

ls -lh "$OUT_FILE" "$COUNT_FILE"
echo "Done."
echo ""
echo "Copy to laptop (from your PC):"
echo "  scp root@172.28.92.57:$OUT_FILE D:/Project/Klip/docs/"
echo "  scp root@172.28.92.57:$COUNT_FILE D:/Project/Klip/docs/"
