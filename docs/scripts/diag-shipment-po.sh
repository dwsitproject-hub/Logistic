#!/usr/bin/env bash
# Why is one PO on the Shipment page here but not there?
#
#   bash docs/scripts/diag-shipment-po.sh 1001031325
#
# Run the SAME command on BOTH environments and compare the two outputs line by line. Read-only:
# it runs SELECTs and nothing else.
#
# The SQL is generated from the page's own predicate builders
# (backend/src/scripts/renderShipmentPoVisibilitySql.ts), so a `false` in the output is the actual
# reason the row is absent, not an approximation of it.

set -uo pipefail

PO="${1:-}"
ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
SQL_FILE="${SQL_FILE:-$(cd "$(dirname "$0")" && pwd)/sql/diag-shipment-po-visibility.sql}"

[ -n "$PO" ] || { echo "usage: bash diag-shipment-po.sh <PO number>" >&2; exit 2; }
[ -f "$SQL_FILE" ] || { echo "missing $SQL_FILE - run git pull" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

# Parse, never source: a .env is not a shell script.
envval() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }

DB_HOST="$(envval DB_HOST)"; DB_PORT="$(envval DB_PORT)"; DB_NAME="$(envval DB_NAME)"
DB_USER="$(envval DB_USER)"; DB_PASSWORD="$(envval DB_PASSWORD)"
: "${DB_HOST:?DB_HOST not found in $ENV_FILE}"
: "${DB_NAME:?DB_NAME not found}"
: "${DB_USER:?DB_USER not found}"
: "${DB_PASSWORD:?DB_PASSWORD not found}"
DB_PORT="${DB_PORT:-5432}"

echo "=== host   : $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"
echo "=== target : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "=== PO     : $PO"
echo

docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v po="$PO" -f - < "$SQL_FILE"

cat <<'HOW'

--- how to read this ---
A PO reaches the Shipment page by ONE of two paths; it needs only one.

  execution  a `shipments` row exists  ->  section 2 is non-empty.
             GR-Close does NOT remove it; it only moves the row to the COMPLETED card.
             It IS removed when sap_presence is not PRESENT.

  backlog    no `shipments` row  ->  section 3 decides.
             Needs: has_shipment_row = f, blocked_by_sibling_sto = f, blocked_by_gr_status = f.

So the common production-only case is: section 2 empty AND blocked_by_gr_status = t. The PO is
GR-closed and no shipment was ever created for it in KLIP, so neither path carries it - while the
Contract page, which has no such gate, still shows it.
HOW
