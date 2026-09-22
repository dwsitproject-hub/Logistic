#!/usr/bin/env bash
# Restore a production dump into a SEPARATE local database, beside the dev one.
#
#   bash docs/scripts/local-restore-prod-dump.sh klip-prod-20260922-1030.dump
#   bash docs/scripts/local-restore-prod-dump.sh klip-prod-20260922-1030.dump --replace
#
# THE DEV DATABASE IS NEVER TOUCHED. The copy lands in its own database (klip_prod_copy by
# default), because a second agent works against the dev one in this repo and a restore over it
# would destroy their state without warning. Nothing here drops anything unless --replace is
# passed, and then it says exactly what it is dropping first.
#
# Point a diagnostic at the copy with an env override, which leaves backend/.env alone:
#
#   cd backend && DB_NAME=klip_prod_copy node ../docs/scripts/diag-os-per-contract.cjs CPO BONTANG
#
# (dotenv does not overwrite a variable already present in the environment, so the override wins.
# Confirm with the line the connection logs on startup before trusting a number.)
set -euo pipefail

DUMP_FILE="${1:-}"
REPLACE="${2:-}"
[ -n "$DUMP_FILE" ] || { echo "usage: $0 <dump-file> [--replace]"; exit 1; }
[ -f "$DUMP_FILE" ] || { echo "no such file: $DUMP_FILE"; exit 1; }

CONTAINER="${KLIP_PG_CONTAINER:-klip-postgres}"
TARGET_DB="${KLIP_PROD_COPY_DB:-klip_prod_copy}"

ENV_FILE="${KLIP_ENV_FILE:-backend/.env}"
[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE (set KLIP_ENV_FILE)"; exit 1; }
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"\r'; }
DB_USER="$(get DB_USER)"
DEV_DB="$(get DB_NAME)"
: "${DB_USER:?DB_USER missing from $ENV_FILE}"

if [ "$TARGET_DB" = "$DEV_DB" ]; then
  echo "REFUSING: the target ($TARGET_DB) is the DEV database named in $ENV_FILE."
  echo "Set KLIP_PROD_COPY_DB to something else. Another agent is working against that database."
  exit 1
fi

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || {
  echo "container '$CONTAINER' is not running (set KLIP_PG_CONTAINER)"; exit 1; }

psql_q() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -At -c "$1"; }

EXISTS="$(psql_q "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}'" || true)"
if [ "$EXISTS" = "1" ]; then
  if [ "$REPLACE" != "--replace" ]; then
    echo "database '${TARGET_DB}' already exists."
    echo "Re-run with --replace to DROP it and restore fresh. Nothing has been changed."
    exit 1
  fi
  echo "dropping and recreating '${TARGET_DB}' (dev database '${DEV_DB}' is untouched)"
  psql_q "DROP DATABASE ${TARGET_DB}" >/dev/null
fi
psql_q "CREATE DATABASE ${TARGET_DB}" >/dev/null
echo "created ${TARGET_DB}"

BASE="$(basename "$DUMP_FILE")"
echo "copying ${BASE} into the container"
docker cp "$DUMP_FILE" "${CONTAINER}:/tmp/${BASE}"

# -j 4 restores in parallel; --no-owner/--no-privileges match how the dump was written.
# Errors are NOT fatal here on purpose: a production dump routinely references roles and
# extensions the local cluster lacks, and those failures are noise, not a broken copy. The row
# counts printed afterwards are what says whether the restore actually worked.
echo "restoring - role and extension warnings are expected and harmless"
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$TARGET_DB" \
  -j 4 --no-owner --no-privileges "/tmp/${BASE}" || true

docker exec -i "$CONTAINER" rm -f "/tmp/${BASE}"

echo
echo "row counts in the copy - compare these with production before trusting any measurement:"
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -c "
  SELECT 'contracts' AS table_name, COUNT(*) FROM contracts
  UNION ALL SELECT 'shipments', COUNT(*) FROM shipments
  UNION ALL SELECT 'contract_stos', COUNT(*) FROM contract_stos
  UNION ALL SELECT 'sap_processed_data', COUNT(*) FROM sap_processed_data
  UNION ALL SELECT 'contract_qty_move_snapshot', COUNT(*) FROM contract_qty_move_snapshot
  UNION ALL SELECT 'contract_latest_spd_snapshot', COUNT(*) FROM contract_latest_spd_snapshot;"

echo
echo "run a diagnostic against the copy like this (backend/.env is not modified):"
echo "  cd backend && DB_NAME=${TARGET_DB} node ../docs/scripts/diag-os-per-contract.cjs CPO BONTANG"
