#!/usr/bin/env bash
# READ-ONLY on production. Dump the production database so analysis can run against its real shape.
#
#   bash docs/scripts/prod-dump-for-local.sh sizes            # step 1: what will it cost?
#   bash docs/scripts/prod-dump-for-local.sh dump             # step 2: write the dump
#   bash docs/scripts/prod-dump-for-local.sh dump --skip-sap  # same, without sap_processed_data rows
#
# WHY THIS EXISTS. Dev and production disagree on the very things being measured. The Contract
# Performance -> Shipping Performance gap runs in OPPOSITE directions on the two (dev reads CP
# higher, production reads it lower), and the B2B shapes differ in proportion. Twice in this work a
# conclusion drawn on dev did not survive contact with production. A local copy of production ends
# that guessing.
#
# WHAT IT DOES NOT DO: it never writes to production, never restores anything, and never prints a
# password. Credentials are read from /opt/klip/.env, where they already live.
set -euo pipefail

MODE="${1:-sizes}"
SKIP_SAP=""
[ "${2:-}" = "--skip-sap" ] && SKIP_SAP=1

ENV_FILE="${KLIP_ENV_FILE:-/opt/klip/.env}"
[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE (set KLIP_ENV_FILE)"; exit 1; }

# Read only the keys needed. Nothing is echoed, so nothing lands in the shell history or the logs.
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"\r'; }
DB_HOST="$(get DB_HOST)"
DB_PORT="$(get DB_PORT)"
DB_NAME="$(get DB_NAME)"
DB_USER="$(get DB_USER)"
PGPASSWORD="$(get DB_PASSWORD)"
export PGPASSWORD
DB_PORT="${DB_PORT:-5432}"
: "${DB_HOST:?DB_HOST missing from $ENV_FILE}"
: "${DB_NAME:?DB_NAME missing from $ENV_FILE}"

# Worth having: this file is the one that points production at production. If it still names the
# SIT host, stop - dumping SIT while believing it is production would poison every measurement
# that follows, exactly as the deploy runbook warns.
case "$DB_HOST" in
  *d9jx9o06qae8gf3h*) echo "REFUSING: DB_HOST is the SIT RDS host, not production."; exit 1;;
esac
echo "source: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

OUT_DIR="${KLIP_DUMP_DIR:-/opt/klip/backups}"
mkdir -p "$OUT_DIR"

# pg_dump must not be OLDER than the server, so the client comes from a pinned image rather than
# whatever happens to be installed on the host.
PG_IMAGE="${KLIP_PG_IMAGE:-postgres:16}"
run_pg() { docker run --rm -e PGPASSWORD -v "${OUT_DIR}:/out" "$PG_IMAGE" "$@"; }

if [ "$MODE" = "sizes" ]; then
  echo
  echo "server version, database size, and the twenty largest tables (all read-only):"
  run_pg psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT version()"
  run_pg psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT pg_size_pretty(pg_database_size(current_database())) AS whole_database;
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
           to_char(c.reltuples, 'FM9,999,999,999') AS approx_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 20;"
  echo
  echo "Check free space with 'df -h ${OUT_DIR}', then run:  $0 dump"
  echo
  echo "sap_processed_data is usually most of the volume. It decides incoterm, STO type and"
  echo "discharge destination, so --skip-sap makes the copy far smaller AND makes several of those"
  echo "answers wrong. Skip it for a structural look only, never for outstanding figures."
  exit 0
fi

[ "$MODE" = "dump" ] || { echo "usage: $0 [sizes|dump] [--skip-sap]"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M)"
FILE="klip-prod-${STAMP}.dump"
EXCLUDE=()
[ -n "$SKIP_SAP" ] && EXCLUDE=(--exclude-table-data=public.sap_processed_data)

echo "writing ${OUT_DIR}/${FILE} (custom format, compressed) - this reads, it never writes"
# -Fc            restorable with pg_restore -j, compressed on the way out
# --no-owner     the local copy has different roles and must not try to recreate production's
# --no-privileges  same reason, for GRANTs
run_pg pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -Fc --no-owner --no-privileges "${EXCLUDE[@]}" -f "/out/${FILE}"

ls -lh "${OUT_DIR}/${FILE}"
echo
echo "Next, from the machine that will hold the copy:"
echo "  scp <user>@<this-host>:${OUT_DIR}/${FILE} ./"
echo "  bash docs/scripts/local-restore-prod-dump.sh ${FILE}"
echo
echo "The dump holds real commercial data. Keep it out of the repo and off shared drives."
