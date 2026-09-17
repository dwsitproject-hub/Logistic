#!/usr/bin/env bash
# Wave 1 load: WB daily actuals into PRODUCTION.
#
#   bash docs/scripts/migrate-wb-load.sh /opt/klip/backups/klip-wb-actuals-<ts>.csv           # dry run
#   bash docs/scripts/migrate-wb-load.sh /opt/klip/backups/klip-wb-actuals-<ts>.csv --apply   # writes
#
# Run on the PRODUCTION backend host. Dry run is the default and writes nothing.
#
# What this does NOT do, and why it matters more than what it does:
#
#   It never creates a trucking operation. Production already has operations from the SAP import,
#   and `trucking_operations_one_active_per_contract_uidx` (migration 141) permits exactly one
#   active operation per contract - so inserting staging's would either fail or fight the import.
#   WB rows are attached to the operation production already has, matched by PO number.
#
#   It never touches a contract, a shipment, or anything SAP owns.
#
# After loading, `trucking_operations.quantity_delivered` is recomputed from the daily actuals,
# because that column is derived (truckingRealization.service's sync does the same thing on every
# WB upload). Skipping it would load the rows and leave every Outstanding Qty wrong, which is the
# one number this migration exists to make right.

set -uo pipefail

CSV="${1:-}"
APPLY="${2:-}"
ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"

[ -n "$CSV" ] || { echo "usage: bash migrate-wb-load.sh <csv> [--apply]" >&2; exit 2; }
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
[ "$APPLY" = "--apply" ] && MODE="APPLY"

echo "=== host   : $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"
echo "=== target : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
echo "=== csv    : $CSV ($(wc -l < "$CSV") lines)"
echo "=== mode   : $MODE"
echo

# The CSV travels through stdin rather than a bind mount. A mount needs the host's Docker file
# sharing to cover wherever the file happens to sit - one more thing to configure, and one more way
# to fail on a host other than the one it was written on.
run_sql() {
  docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
}

# One session, one transaction: the staging table, the report and the writes have to see the same
# data, and a dry run must leave nothing behind.
{
cat <<SQL
\\set ON_ERROR_STOP on
\\pset footer off
BEGIN;

CREATE TEMP TABLE wb_incoming (
  po_number TEXT,
  contract_number TEXT,
  sto_number TEXT,
  progress_date DATE,
  quantity_kg NUMERIC,
  quantity_delivery_kg NUMERIC,
  quantity_receive_kg NUMERIC,
  source TEXT
) ON COMMIT DROP;

\\copy wb_incoming FROM STDIN WITH CSV HEADER
SQL
cat "$CSV"
printf '%s\n' '\.'
cat <<SQL

-- Re-anchor: PO number first, contract number as the fallback, exactly as the application's own
-- matching does (truckingOperationUniqueness / truckingDedupe).
CREATE TEMP TABLE wb_resolved ON COMMIT DROP AS
SELECT
  i.*,
  c.id AS contract_uuid,
  (
    SELECT t.id
    FROM trucking_operations t
    WHERE t.contract_id = c.id
      AND t.deduped_at IS NULL
      AND UPPER(COALESCE(t.status, '')) NOT IN ('CANCELLED', 'CANCELED')
    ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id
    LIMIT 1
  ) AS operation_uuid
FROM wb_incoming i
LEFT JOIN contracts c
  ON TRIM(c.po_number::text) = TRIM(i.po_number)
  OR (NULLIF(TRIM(i.po_number), '') IS NULL AND TRIM(c.contract_id::text) = TRIM(i.contract_number));

\\echo ''
\\echo '======== what this CSV resolves to in production ========'
SELECT
  COUNT(*)::int                                                        AS rows_in_csv,
  COUNT(DISTINCT po_number)::int                                       AS pos_in_csv,
  COUNT(*) FILTER (WHERE contract_uuid IS NULL)::int                   AS rows_contract_not_found,
  COUNT(DISTINCT po_number) FILTER (WHERE contract_uuid IS NULL)::int  AS pos_contract_not_found,
  COUNT(*) FILTER (WHERE contract_uuid IS NOT NULL AND operation_uuid IS NULL)::int  AS rows_no_active_operation,
  COUNT(*) FILTER (WHERE operation_uuid IS NOT NULL)::int              AS rows_loadable
FROM wb_resolved;

\\echo ''
\\echo '-- POs whose contract is not in production (SAP has not imported them) --'
SELECT DISTINCT po_number FROM wb_resolved WHERE contract_uuid IS NULL ORDER BY 1 LIMIT 20;

\\echo ''
\\echo '-- POs whose contract exists but has no active trucking operation --'
SELECT DISTINCT po_number FROM wb_resolved WHERE contract_uuid IS NOT NULL AND operation_uuid IS NULL ORDER BY 1 LIMIT 20;

\\echo ''
\\echo '-- rows already present in production (these would be updated, not added) --'
SELECT COUNT(*)::int AS already_present
FROM wb_resolved r
JOIN trucking_daily_actuals d
  ON d.trucking_operation_id = r.operation_uuid
 AND d.progress_date = r.progress_date
 AND COALESCE(NULLIF(TRIM(d.sto_number), ''), '') = COALESCE(NULLIF(TRIM(r.sto_number), ''), '')
WHERE r.operation_uuid IS NOT NULL;
SQL

if [ "$APPLY" = "--apply" ]; then
cat <<'SQL'

\echo ''
\echo '======== applying ========'
INSERT INTO trucking_daily_actuals (
  trucking_operation_id, progress_date, sto_number,
  quantity_kg, quantity_delivery_kg, quantity_receive_kg, source
)
SELECT
  r.operation_uuid,
  r.progress_date,
  COALESCE(NULLIF(TRIM(r.sto_number), ''), ''),
  r.quantity_kg,
  r.quantity_delivery_kg,
  r.quantity_receive_kg,
  COALESCE(NULLIF(TRIM(r.source), ''), 'manual')
FROM wb_resolved r
WHERE r.operation_uuid IS NOT NULL
ON CONFLICT (trucking_operation_id, progress_date, sto_number) DO UPDATE SET
  quantity_kg = EXCLUDED.quantity_kg,
  quantity_delivery_kg = EXCLUDED.quantity_delivery_kg,
  quantity_receive_kg = EXCLUDED.quantity_receive_kg,
  source = EXCLUDED.source;

-- Derived, not stored by the import: every WB write in the application recomputes it, and an
-- Outstanding Qty read against a stale value is the failure this migration is meant to prevent.
UPDATE trucking_operations t
SET quantity_delivered = agg.total,
    updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT d.trucking_operation_id, COALESCE(SUM(d.quantity_kg), 0)::numeric AS total
  FROM trucking_daily_actuals d
  WHERE d.trucking_operation_id IN (SELECT DISTINCT operation_uuid FROM wb_resolved WHERE operation_uuid IS NOT NULL)
  GROUP BY d.trucking_operation_id
) agg
WHERE t.id = agg.trucking_operation_id;

-- The snapshot now disagrees with the rows underneath it. Marking it stale lets the scheduled
-- rebuild correct it; nothing here rebuilds 20+ minutes of snapshot inside a migration.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking';

\echo ''
\echo '-- verification: every CSV row, compared to what is now stored --'
\echo '-- Compared row by row, not by PO total: production may legitimately hold WB rows of its'
\echo '-- own for other dates, and a total would read those as a discrepancy.'
SELECT
  r.po_number,
  r.progress_date,
  r.sto_number,
  r.quantity_kg AS csv_qty,
  d.quantity_kg AS stored_qty
FROM wb_resolved r
LEFT JOIN trucking_daily_actuals d
  ON d.trucking_operation_id = r.operation_uuid
 AND d.progress_date = r.progress_date
 AND COALESCE(NULLIF(TRIM(d.sto_number), ''), '') = COALESCE(NULLIF(TRIM(r.sto_number), ''), '')
WHERE r.operation_uuid IS NOT NULL
  AND d.quantity_kg IS DISTINCT FROM r.quantity_kg
LIMIT 20;

\echo ''
\echo '-- row count: loaded vs verified (these must match) --'
SELECT
  COUNT(*)::int AS csv_rows_loadable,
  COUNT(d.trucking_operation_id)::int AS rows_now_stored
FROM wb_resolved r
LEFT JOIN trucking_daily_actuals d
  ON d.trucking_operation_id = r.operation_uuid
 AND d.progress_date = r.progress_date
 AND COALESCE(NULLIF(TRIM(d.sto_number), ''), '') = COALESCE(NULLIF(TRIM(r.sto_number), ''), '')
WHERE r.operation_uuid IS NOT NULL;

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

if [ "$APPLY" = "--apply" ]; then
  cat <<'NEXT'

--- next ---
The trucking snapshot is marked stale, so the page still serves the previous build until it is
rebuilt. Either wait for the scheduled refresh, or force it now (20+ minutes on a full database):

  docker exec klip-backend node dist/scripts/refreshTruckingPipelineSummary.js

Check a PO on the Trucking page afterwards: its Outstanding Qty should reflect the WB rows.
NEXT
fi
