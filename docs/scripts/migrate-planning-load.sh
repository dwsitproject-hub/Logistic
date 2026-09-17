#!/usr/bin/env bash
# Wave 2b load: trucking daily planning into PRODUCTION.
#
#   bash docs/scripts/migrate-planning-load.sh <csv>           # dry run
#   bash docs/scripts/migrate-planning-load.sh <csv> --apply   # writes
#
# Run on the PRODUCTION backend host. Dry run is the default and writes nothing.
#
# Like the WB load, this never creates a trucking operation: migration 141 allows exactly one
# active operation per contract and the SAP import already made it. The plan is attached to the
# operation production has, matched by PO.
#
# A plan is only written where production has none. `daily_deliverables` is one editable unit in
# the UI - replacing a plan a production user has already built would lose their work wholesale,
# and merging two plans day by day would invent a schedule neither person wrote.

set -uo pipefail

CSV="${1:-}"
APPLY="${2:-}"
ENV_FILE="${ENV_FILE:-/opt/klip/.env}"
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"

[ -n "$CSV" ] || { echo "usage: bash migrate-planning-load.sh <csv> [--apply]" >&2; exit 2; }
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

run_sql() {
  docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f -
}

{
cat <<'SQL'
\set ON_ERROR_STOP on
\pset footer off
BEGIN;

CREATE TEMP TABLE plan_incoming (
  po_number TEXT,
  contract_number TEXT,
  daily_deliverables TEXT,
  last_daily_deliverable_date DATE,
  trucking_start_date DATE,
  trucking_completion_date DATE,
  sfal_qty NUMERIC,
  sfbd_qty NUMERIC
) ON COMMIT DROP;

\copy plan_incoming FROM STDIN WITH CSV HEADER
SQL
cat "$CSV"
printf '%s\n' '\.'
cat <<'SQL'

CREATE TEMP TABLE plan_resolved ON COMMIT DROP AS
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
FROM plan_incoming i
LEFT JOIN contracts c ON TRIM(c.po_number::text) = TRIM(i.po_number);

\echo ''
\echo '======== what this CSV resolves to in production ========'
SELECT
  COUNT(*)::int                                                     AS rows_in_csv,
  COUNT(*) FILTER (WHERE contract_uuid IS NULL)::int                AS contract_not_found,
  COUNT(*) FILTER (WHERE contract_uuid IS NOT NULL AND operation_uuid IS NULL)::int AS no_active_operation,
  COUNT(*) FILTER (WHERE operation_uuid IS NOT NULL)::int           AS loadable
FROM plan_resolved;

\echo ''
\echo '-- operations that already hold a plan (these will NOT be replaced) --'
SELECT COUNT(*)::int AS already_planned
FROM plan_resolved r
JOIN trucking_operations t ON t.id = r.operation_uuid
WHERE jsonb_array_length(COALESCE(NULLIF(t.daily_deliverables, 'null'::jsonb), '[]'::jsonb)) > 0;

\echo ''
\echo '-- POs whose contract is not in production --'
SELECT po_number FROM plan_resolved WHERE contract_uuid IS NULL ORDER BY 1 LIMIT 20;
SQL

if [ "$APPLY" = "--apply" ]; then
cat <<'SQL'

\echo ''
\echo '======== applying ========'
UPDATE trucking_operations t
SET
  daily_deliverables = r.daily_deliverables::jsonb,
  last_daily_deliverable_date = COALESCE(t.last_daily_deliverable_date, r.last_daily_deliverable_date),
  -- Planning dates fill gaps only: migration 057 seeded these from SAP, so production may already
  -- hold a value that did not come from a user and must not be traded for staging's.
  trucking_start_date = COALESCE(t.trucking_start_date, r.trucking_start_date),
  trucking_completion_date = COALESCE(t.trucking_completion_date, r.trucking_completion_date),
  updated_at = CURRENT_TIMESTAMP
FROM plan_resolved r
WHERE t.id = r.operation_uuid
  -- Only where production has no plan of its own. A plan is one unit; replacing it would discard
  -- a production user's work, and merging would invent a schedule nobody wrote.
  AND jsonb_array_length(COALESCE(NULLIF(t.daily_deliverables, 'null'::jsonb), '[]'::jsonb)) = 0;

-- SFAL/SFBD are separate fields, not part of the plan, so they load even where production already
-- has a plan of its own. Gaps only, for the same reason as everywhere else.
UPDATE trucking_operations t
SET sfal_qty = COALESCE(t.sfal_qty, r.sfal_qty),
    sfbd_qty = COALESCE(t.sfbd_qty, r.sfbd_qty),
    updated_at = CURRENT_TIMESTAMP
FROM plan_resolved r
WHERE t.id = r.operation_uuid
  AND (r.sfal_qty IS NOT NULL OR r.sfbd_qty IS NOT NULL)
  AND (t.sfal_qty IS NULL OR t.sfbd_qty IS NULL);

UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking';

\echo ''
\echo '-- verification: loadable rows whose operation still has no plan (should be empty) --'
SELECT r.po_number
FROM plan_resolved r
JOIN trucking_operations t ON t.id = r.operation_uuid
WHERE jsonb_array_length(COALESCE(NULLIF(t.daily_deliverables, 'null'::jsonb), '[]'::jsonb)) = 0
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

if [ "$APPLY" = "--apply" ]; then
  cat <<'NEXT'

--- next ---
The trucking snapshot is marked stale. Wait for the scheduled refresh, or force it:

  docker exec klip-backend node dist/scripts/refreshTruckingPipelineSummary.js

Then open a migrated PO on the Trucking page: its daily planning should be there, and the
operation should read as Planned rather than Unplanned.
NEXT
fi
