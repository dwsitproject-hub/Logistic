#!/usr/bin/env bash
# Which shipments does the ETA export reference that production does not have - and could
# production ever create them by itself?
#
#   bash docs/scripts/diag-missing-shipments.sh /opt/klip/backups/klip-eta-<ts>.csv
#
# Run on the PRODUCTION backend host. Read-only: SELECTs and a temp table, always rolled back.
#
# This is the question wave 3 turns on. A shipment whose key is an STO number was created by the
# SAP import, and production's own import will create it once that STO reaches it - migrating it
# would duplicate work the importer is going to do, and risks fighting the
# (contract_id, shipment_id) unique index. A key like `MNL-...` or `MSEA-...` was created by a user
# in KLIP; production will never produce it, so its ETA has nowhere to land until it is carried.
#
# The split decides whether wave 3 is worth doing at all, or whether the honest answer is to wait
# for the SAP import.

set -uo pipefail

CSV="${1:-}"
ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"

[ -n "$CSV" ] || { echo "usage: bash diag-missing-shipments.sh <eta csv>" >&2; exit 2; }
[ -f "$CSV" ] || { echo "csv not found: $CSV" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

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
echo "=== csv    : $CSV"
echo

{
cat <<'SQL'
\set ON_ERROR_STOP on
\pset footer off
BEGIN;

CREATE TEMP TABLE eta_in (
  scope TEXT, po_number TEXT, contract_number TEXT, shipment_key TEXT,
  port_sequence INT, is_discharge_port BOOLEAN, port_name TEXT,
  c1 TIMESTAMP, c2 TIMESTAMP, c3 TIMESTAMP, c4 TIMESTAMP, c5 TIMESTAMP,
  c6 TIMESTAMP, c7 TIMESTAMP, c8 TIMESTAMP, c9 TIMESTAMP, c10 TIMESTAMP,
  sfal NUMERIC, sfbd NUMERIC
) ON COMMIT DROP;

\copy eta_in FROM STDIN WITH CSV HEADER
SQL
cat "$CSV"
printf '%s\n' '\.'
cat <<'SQL'

\echo ''
\echo '======== shipments this CSV needs, split by who could have made them ========'
SELECT
  CASE
    WHEN i.shipment_key ~ '^(MNL-|MSEA-)' THEN 'KLIP manual - production will NEVER create it'
    WHEN i.shipment_key ~ '^[0-9]+$'      THEN 'SAP STO number - production creates it on import'
    ELSE 'other pattern - look at it'
  END AS origin,
  COUNT(DISTINCT i.shipment_key)::int AS distinct_shipments,
  COUNT(*)::int                       AS eta_rows,
  COUNT(*) FILTER (WHERE s.id IS NULL)::int AS eta_rows_blocked
FROM eta_in i
LEFT JOIN contracts c ON TRIM(c.po_number::text) = TRIM(i.po_number)
LEFT JOIN shipments s
  ON s.contract_id = c.id
 AND COALESCE(NULLIF(TRIM(s.shipment_id), ''), '') = COALESCE(NULLIF(TRIM(i.shipment_key), ''), '')
GROUP BY 1 ORDER BY 4 DESC;

\echo ''
\echo '-- the blocked ones, in detail (first 30) --'
SELECT DISTINCT i.po_number, i.shipment_key,
  CASE WHEN i.shipment_key ~ '^(MNL-|MSEA-)' THEN 'KLIP manual' ELSE 'SAP STO' END AS origin
FROM eta_in i
LEFT JOIN contracts c ON TRIM(c.po_number::text) = TRIM(i.po_number)
LEFT JOIN shipments s
  ON s.contract_id = c.id
 AND COALESCE(NULLIF(TRIM(s.shipment_id), ''), '') = COALESCE(NULLIF(TRIM(i.shipment_key), ''), '')
WHERE s.id IS NULL
ORDER BY 3, 1 LIMIT 30;

\echo ''
\echo '-- for the blocked SAP-numbered ones: is that STO in production SAP data at all? --'
\echo '-- Present means the next import should create the shipment; absent means it never will.'
SELECT
  COUNT(DISTINCT i.shipment_key)::int AS blocked_sap_shipments,
  COUNT(DISTINCT i.shipment_key) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.sto_number::text, '')) = TRIM(i.shipment_key)
    )
  )::int AS sto_present_in_sap_data
FROM eta_in i
LEFT JOIN contracts c ON TRIM(c.po_number::text) = TRIM(i.po_number)
LEFT JOIN shipments s
  ON s.contract_id = c.id
 AND COALESCE(NULLIF(TRIM(s.shipment_id), ''), '') = COALESCE(NULLIF(TRIM(i.shipment_key), ''), '')
WHERE s.id IS NULL AND i.shipment_key ~ '^[0-9]+$';

ROLLBACK;
\echo ''
\echo 'read-only - nothing was written.'
SQL
} | docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
