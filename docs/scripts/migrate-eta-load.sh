#!/usr/bin/env bash
# Wave 2a load: vessel ETA into PRODUCTION.
#
#   bash docs/scripts/migrate-eta-load.sh <csv>                          # dry run
#   bash docs/scripts/migrate-eta-load.sh <csv> --apply                  # writes
#   bash docs/scripts/migrate-eta-load.sh <csv> --apply --create-ports   # also creates KLIP-only ports
#
# Run on the PRODUCTION backend host. Dry run is the default and writes nothing.
#
# Two safety rules, both deliberate:
#
#   ETA is written only where production has none. Production users have been working since
#   go-live, and a straight overwrite would silently replace a date someone entered there with an
#   older one from staging. Filling gaps can only add information.
#
#   Port rows are not created unless you ask. Normally the loading port arrives from the SAP
#   import and the row already exists; a missing one means the user created it by hand in KLIP
#   before SAP had it. That is real user data and worth carrying - but it is also the case where a
#   mistake invents structure, so it takes an explicit flag and is reported either way.
#
#   --map-by-po attaches a KLIP-created shipment's ETA to the shipment production already has for
#   that contract. An MNL-/MSEA- row exists because a user created it before SAP had sent the STO;
#   once SAP did, production built its own row for the SAME voyage. Attaching there is more
#   correct than carrying the KLIP shipment across, and avoids two rows for one voyage. It applies
#   only where the contract has EXACTLY ONE shipment in production - with several, "which voyage"
#   has no answer the data can give, and those rows are left alone.
#
# Nothing here touches ATA, quality or quantities. Those columns are shared with the SAP import
# and their provenance cannot be established (docs/PROVENANCE-KLIP-VS-SAP.md); ETA is KLIP-only,
# which is exactly why it can be carried without argument.

set -uo pipefail

CSV="${1:-}"
shift || true
APPLY=""
CREATE_PORTS=""
MAP_BY_PO=""
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --create-ports) CREATE_PORTS=1 ;;
    --map-by-po) MAP_BY_PO=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"

[ -n "$CSV" ] || { echo "usage: bash migrate-eta-load.sh <csv> [--apply] [--create-ports]" >&2; exit 2; }
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

MODE="DRY RUN"
[ -n "$APPLY" ] && MODE="APPLY"
[ -n "$APPLY" ] && [ -n "$CREATE_PORTS" ] && MODE="APPLY + CREATE PORTS"
[ -n "$MAP_BY_PO" ] && MODE="$MODE + MAP BY PO"

echo "=== host   : $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"
echo "=== target : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "=== csv    : $CSV ($(wc -l < "$CSV") lines)"
echo "=== mode   : $MODE"
echo

run_sql() {
  docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
}

{
cat <<'SQL'
\set ON_ERROR_STOP on
\pset footer off
BEGIN;

CREATE TEMP TABLE eta_incoming (
  scope TEXT,
  po_number TEXT,
  contract_number TEXT,
  shipment_key TEXT,
  port_sequence INT,
  is_discharge_port BOOLEAN,
  port_name TEXT,
  eta_vessel_arrival TIMESTAMP,
  eta_vessel_berthed TIMESTAMP,
  eta_loading_start TIMESTAMP,
  eta_loading_completed TIMESTAMP,
  eta_vessel_sailed TIMESTAMP,
  eta_vessel_berthed_at_loading_port TIMESTAMP,
  eta_vessel_arrive_at_discharge_port TIMESTAMP,
  eta_vessel_berthed_at_discharge_port TIMESTAMP,
  eta_vessel_start_discharging TIMESTAMP,
  eta_vessel_complete_discharge TIMESTAMP,
  sfal_qty NUMERIC,
  sfbd_qty NUMERIC
) ON COMMIT DROP;

\copy eta_incoming FROM STDIN WITH CSV HEADER
SQL
cat "$CSV"
printf '%s\n' '\.'
cat <<'SQL'

-- Re-anchor by business identity: PO -> contract, then (contract, shipment_id) -> shipment, then
-- (shipment, sequence, discharge?) -> port. That last triple is how the application's own SAP
-- writer matches a port row, so this agrees with it rather than inventing a rule.
CREATE TEMP TABLE eta_resolved ON COMMIT DROP AS
SELECT
  i.*,
  c.id AS contract_uuid,
  s.id AS shipment_uuid,
  vlp.id AS port_uuid
FROM eta_incoming i
LEFT JOIN contracts c
  ON TRIM(c.po_number::text) = TRIM(i.po_number)
LEFT JOIN shipments s
  ON s.contract_id = c.id
 AND COALESCE(NULLIF(TRIM(s.shipment_id), ''), '') = COALESCE(NULLIF(TRIM(i.shipment_key), ''), '')
LEFT JOIN vessel_loading_ports vlp
  ON i.scope = 'port'
 AND vlp.shipment_id = s.id
 AND COALESCE(vlp.port_sequence, -1) = COALESCE(i.port_sequence, -1)
 AND COALESCE(vlp.is_discharge_port, FALSE) = COALESCE(i.is_discharge_port, FALSE);

SQL

if [ -n "$MAP_BY_PO" ]; then
cat <<'SQL'

-- Attach a KLIP-created shipment's rows to the shipment production already has for that contract.
-- Restricted to contracts with exactly one, which is what makes the mapping unambiguous: with
-- several, nothing in the data says which voyage the ETA belongs to.
UPDATE eta_resolved r
SET shipment_uuid = one.id
FROM contracts c
JOIN LATERAL (
  SELECT s.id, COUNT(*) OVER () AS cnt
  FROM shipments s
  WHERE s.contract_id = c.id
) one ON one.cnt = 1
WHERE r.shipment_uuid IS NULL
  AND r.shipment_key ~ '^(MNL-|MSEA-)'
  AND TRIM(c.po_number::text) = TRIM(r.po_number);

-- Ports follow their shipment: same sequence, same loading-vs-discharge side.
UPDATE eta_resolved r
SET port_uuid = v.id
FROM vessel_loading_ports v
WHERE r.scope = 'port'
  AND r.port_uuid IS NULL
  AND r.shipment_uuid IS NOT NULL
  AND v.shipment_id = r.shipment_uuid
  AND COALESCE(v.port_sequence, -1) = COALESCE(r.port_sequence, -1)
  AND COALESCE(v.is_discharge_port, FALSE) = COALESCE(r.is_discharge_port, FALSE);

\echo ''
\echo '-- rows re-homed onto the shipment production already had --'
SELECT COUNT(*)::int AS rows_mapped_by_po
FROM eta_resolved
WHERE shipment_key ~ '^(MNL-|MSEA-)' AND shipment_uuid IS NOT NULL;
SQL
fi

cat <<'SQL'

\echo ''
\echo '======== what this CSV resolves to in production ========'
SELECT
  scope,
  COUNT(*)::int                                                    AS rows_in_csv,
  COUNT(*) FILTER (WHERE contract_uuid IS NULL)::int               AS contract_not_found,
  COUNT(*) FILTER (WHERE contract_uuid IS NOT NULL AND shipment_uuid IS NULL)::int AS shipment_not_found,
  COUNT(*) FILTER (WHERE scope = 'port' AND shipment_uuid IS NOT NULL AND port_uuid IS NULL)::int AS port_not_found,
  COUNT(*) FILTER (WHERE (scope = 'shipment' AND shipment_uuid IS NOT NULL)
                      OR (scope = 'port' AND port_uuid IS NOT NULL))::int AS loadable
FROM eta_resolved
GROUP BY scope ORDER BY scope;

\echo ''
\echo '-- ports that exist in staging but not in production --'
\echo '-- These are rows a user created in KLIP before SAP reported the loading port. Carrying'
\echo '-- them needs --create-ports; without it they are skipped and listed here.'
SELECT po_number, shipment_key, port_sequence, is_discharge_port, port_name
FROM eta_resolved
WHERE scope = 'port' AND shipment_uuid IS NOT NULL AND port_uuid IS NULL
ORDER BY 1, 3 LIMIT 20;

\echo ''
\echo '-- values production already holds (these will NOT be overwritten) --'
SELECT COUNT(*)::int AS ports_with_existing_eta
FROM eta_resolved r
JOIN vessel_loading_ports v ON v.id = r.port_uuid
WHERE r.scope = 'port'
  AND COALESCE(v.eta_vessel_arrival, v.eta_vessel_berthed, v.eta_loading_start,
               v.eta_loading_completed, v.eta_vessel_sailed) IS NOT NULL;
SQL

if [ -n "$APPLY" ]; then

if [ -n "$CREATE_PORTS" ]; then
cat <<'SQL'

\echo ''
\echo '======== creating KLIP-only port rows ========'
INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, is_discharge_port)
SELECT DISTINCT r.shipment_uuid, NULLIF(TRIM(r.port_name), ''), r.port_sequence, COALESCE(r.is_discharge_port, FALSE)
FROM eta_resolved r
WHERE r.scope = 'port' AND r.shipment_uuid IS NOT NULL AND r.port_uuid IS NULL;

-- Re-resolve so the ETA update below sees the rows just created.
UPDATE eta_resolved r
SET port_uuid = v.id
FROM vessel_loading_ports v
WHERE r.scope = 'port'
  AND r.port_uuid IS NULL
  AND v.shipment_id = r.shipment_uuid
  AND COALESCE(v.port_sequence, -1) = COALESCE(r.port_sequence, -1)
  AND COALESCE(v.is_discharge_port, FALSE) = COALESCE(r.is_discharge_port, FALSE);
SQL
fi

cat <<'SQL'

\echo ''
\echo '======== applying ETA (gaps only) ========'
-- COALESCE(existing, incoming): production wins wherever it already has a value. A production
-- user has been entering ETA since go-live and their date must not be replaced by an older one
-- from staging.
UPDATE vessel_loading_ports v
SET
  eta_vessel_arrival                   = COALESCE(v.eta_vessel_arrival, r.eta_vessel_arrival),
  eta_vessel_berthed                   = COALESCE(v.eta_vessel_berthed, r.eta_vessel_berthed),
  eta_loading_start                    = COALESCE(v.eta_loading_start, r.eta_loading_start),
  eta_loading_completed                = COALESCE(v.eta_loading_completed, r.eta_loading_completed),
  eta_vessel_sailed                    = COALESCE(v.eta_vessel_sailed, r.eta_vessel_sailed),
  eta_vessel_berthed_at_loading_port   = COALESCE(v.eta_vessel_berthed_at_loading_port, r.eta_vessel_berthed_at_loading_port),
  eta_vessel_arrive_at_discharge_port  = COALESCE(v.eta_vessel_arrive_at_discharge_port, r.eta_vessel_arrive_at_discharge_port),
  eta_vessel_berthed_at_discharge_port = COALESCE(v.eta_vessel_berthed_at_discharge_port, r.eta_vessel_berthed_at_discharge_port),
  eta_vessel_start_discharging         = COALESCE(v.eta_vessel_start_discharging, r.eta_vessel_start_discharging),
  eta_vessel_complete_discharge        = COALESCE(v.eta_vessel_complete_discharge, r.eta_vessel_complete_discharge),
  updated_at = CURRENT_TIMESTAMP
FROM eta_resolved r
WHERE r.scope = 'port' AND v.id = r.port_uuid;

UPDATE shipments s
SET
  eta_arrival           = COALESCE(s.eta_arrival, r.eta_vessel_arrival::date),
  eta_berthed           = COALESCE(s.eta_berthed, r.eta_vessel_berthed::date),
  eta_loading_start     = COALESCE(s.eta_loading_start, r.eta_loading_start::date),
  eta_loading_complete  = COALESCE(s.eta_loading_complete, r.eta_loading_completed::date),
  eta_sailed            = COALESCE(s.eta_sailed, r.eta_vessel_sailed::date),
  eta_discharge_arrival = COALESCE(s.eta_discharge_arrival, r.eta_vessel_arrive_at_discharge_port::date),
  eta_discharge_berthed = COALESCE(s.eta_discharge_berthed, r.eta_vessel_berthed_at_discharge_port::date),
  eta_discharge_start   = COALESCE(s.eta_discharge_start, r.eta_vessel_start_discharging::date),
  eta_discharge_complete= COALESCE(s.eta_discharge_complete, r.eta_vessel_complete_discharge::date),
  -- SFAL/SFBD ride on the same shipment row and are KLIP-only: the SAP upsert assigns them but
  -- never carries a value (0 occurrences of any SF key across 27,003 SAP rows). Gaps only, so a
  -- figure a production user has already entered is never traded for staging's.
  sfal_qty              = COALESCE(s.sfal_qty, r.sfal_qty),
  sfbd_qty              = COALESCE(s.sfbd_qty, r.sfbd_qty),
  updated_at = CURRENT_TIMESTAMP
FROM eta_resolved r
WHERE r.scope = 'shipment' AND s.id = r.shipment_uuid;

-- The shipment snapshot now disagrees with the rows underneath it.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'shipment';

\echo ''
\echo '-- verification: CSV rows whose ETA is still absent in production (should be empty) --'
SELECT r.po_number, r.scope, r.port_sequence
FROM eta_resolved r
LEFT JOIN vessel_loading_ports v ON v.id = r.port_uuid
WHERE r.scope = 'port'
  AND r.port_uuid IS NOT NULL
  AND r.eta_vessel_arrival IS NOT NULL
  AND v.eta_vessel_arrival IS NULL
LIMIT 20;

COMMIT;
\echo ''
\echo 'applied and committed.'
SQL
else
cat <<'SQL'

ROLLBACK;
\echo ''
\echo 'DRY RUN - nothing was written. Re-run with --apply once the numbers above look right.'
SQL
fi
} | run_sql
RC=$?

echo
if [ $RC -ne 0 ]; then
  echo ">>> FAILED (exit $RC). It ran in one transaction, so nothing was committed." >&2
  exit $RC
fi

if [ -n "$APPLY" ]; then
  cat <<'NEXT'

--- next ---
The shipment snapshot is marked stale. Wait for the scheduled refresh, or force it:

  docker exec klip-backend node dist/scripts/refreshPipelineDailySummary.js

Then open a migrated PO on the Shipments page: its ETA columns should be populated, and it should
no longer sit in the Unplanned backlog (that card is gated on having no registered ETA).
NEXT
fi
