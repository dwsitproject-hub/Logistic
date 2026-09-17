#!/usr/bin/env bash
# Wave 1 export: WB daily actuals from STAGING, as CSV.
#
#   bash docs/scripts/migrate-wb-export.sh
#   OUT_DIR=/opt/klip/backups bash docs/scripts/migrate-wb-export.sh
#
# Read-only. Run on the STAGING host; it reads the database /opt/klip/.env points at.
#
# Why WB first: `trucking_daily_actuals` is the one operational table the SAP import never writes,
# so every row came from a user. It needs no provenance argument - unlike ATA or the KLIP
# quantities, where a user's value and SAP's share one column. It is also the data nobody could
# reasonably retype: weighbridge quantities, day by day.
#
# The CSV is keyed by PO number, STO number and date - never by UUID, which differs per
# environment. Migration 119 made TRIM(po_number) the stable identity and the loader re-anchors on
# it.

set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
SQL_FILE="${SQL_FILE:-$(cd "$(dirname "$0")" && pwd)/sql/migrate-wb-export.sql}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
[ -f "$SQL_FILE" ] || { echo "missing $SQL_FILE - run git pull" >&2; exit 1; }

# Parse, never source: a .env is not a shell script.
envval() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }

DB_HOST="$(envval DB_HOST)"; DB_PORT="$(envval DB_PORT)"; DB_NAME="$(envval DB_NAME)"
DB_USER="$(envval DB_USER)"; DB_PASSWORD="$(envval DB_PASSWORD)"
: "${DB_HOST:?DB_HOST not found in $ENV_FILE}"
: "${DB_NAME:?DB_NAME not found}"
: "${DB_USER:?DB_USER not found}"
: "${DB_PASSWORD:?DB_PASSWORD not found}"
DB_PORT="${DB_PORT:-5432}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%F-%H%M)"
OUT="$OUT_DIR/klip-wb-actuals-$STAMP.csv"

echo "=== host   : $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"
echo "=== source : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "=== out    : $OUT"
echo

docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -f - < "$SQL_FILE" > "$OUT"
RC=$?

if [ $RC -ne 0 ]; then
  echo ">>> export FAILED (exit $RC)" >&2
  rm -f "$OUT"
  exit $RC
fi

ROWS="$(( $(wc -l < "$OUT") - 1 ))"
echo "rows exported : $ROWS"
ls -lh "$OUT"

# An empty export is never right for a staging database that has WB data, and silently shipping
# one to production would look like a successful migration that moved nothing.
if [ "$ROWS" -le 0 ]; then
  echo
  echo ">>> STOP: the export is empty. Either this host points at a database with no WB rows," >&2
  echo "    or every row was filtered out. Check with:" >&2
  echo "      SELECT COUNT(*) FROM trucking_daily_actuals;" >&2
  exit 1
fi

echo
echo "Distinct POs: $(cut -d, -f1 "$OUT" | tail -n +2 | sort -u | wc -l)"
echo
echo "Next: copy this file to the production backend host and run"
echo "  bash docs/scripts/migrate-wb-load.sh $(basename "$OUT")"
echo "It defaults to a dry run and writes nothing until you pass --apply."
