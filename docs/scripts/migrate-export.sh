#!/usr/bin/env bash
# Export one operational dataset from STAGING, as CSV.
#
#   bash docs/scripts/migrate-export.sh eta
#   bash docs/scripts/migrate-export.sh planning
#   bash docs/scripts/migrate-export.sh wb
#
# Read-only. Run on the STAGING host; it reads the database /opt/klip/.env points at.
#
# Each dataset is one of the kinds production cannot recreate from SAP - see
# docs/PROVENANCE-KLIP-VS-SAP.md for why these and not the others.

set -uo pipefail

DATASET="${1:-}"
ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
SQL_DIR="${SQL_DIR:-$(cd "$(dirname "$0")" && pwd)/sql}"

case "$DATASET" in
  wb)       SQL_FILE="$SQL_DIR/migrate-wb-export.sql";       LABEL="wb-actuals" ;;
  eta)      SQL_FILE="$SQL_DIR/migrate-eta-export.sql";      LABEL="eta" ;;
  planning) SQL_FILE="$SQL_DIR/migrate-planning-export.sql"; LABEL="planning" ;;
  *) echo "usage: bash migrate-export.sh <wb|eta|planning>" >&2; exit 2 ;;
esac

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
OUT="$OUT_DIR/klip-$LABEL-$(date +%F-%H%M).csv"

echo "=== host    : $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"
echo "=== source  : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "=== dataset : $DATASET"
echo "=== out     : $OUT"
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

# An empty export from a populated staging database means a filter went wrong, and shipping it on
# would look like a migration that succeeded and moved nothing.
if [ "$ROWS" -le 0 ]; then
  echo
  echo ">>> STOP: the export is empty. Either this host points at a database without this data," >&2
  echo "    or every row was filtered out." >&2
  exit 1
fi

echo
echo "Distinct POs: $(cut -d, -f2 "$OUT" | tail -n +2 | sort -u | wc -l)"
echo
case "$DATASET" in
  wb)       echo "Next: copy to production and run  bash docs/scripts/migrate-wb-load.sh <csv>" ;;
  eta)      echo "Next: copy to production and run  bash docs/scripts/migrate-eta-load.sh <csv>" ;;
  planning) echo "Next: copy to production and run  bash docs/scripts/migrate-planning-load.sh <csv>" ;;
esac
echo "All loaders default to a dry run and write nothing until you pass --apply."
