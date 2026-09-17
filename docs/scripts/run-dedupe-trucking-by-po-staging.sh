#!/usr/bin/env bash
# Dedupe active trucking_operations per PO on SIT/staging (backend 172.28.92.57).
#
# Keeps the WB-complete keeper; sets loser status = CANCELLED (rows stay in DB
# so they appear on the Trucking Cancelled card). Does NOT delete CANCELLED rows
# (unlike run-cleanup-trucking-staging.sh).
#
# Default PO matches local remediation: 1001031094
#   (OP-LAND-300620260835 → CANCELLED, keeper OP-LAND-160720260073)
#
# Usage (PuTTY → backend server, from /opt/klip):
#   bash docs/scripts/run-dedupe-trucking-by-po-staging.sh
#   bash docs/scripts/run-dedupe-trucking-by-po-staging.sh --apply
#   bash docs/scripts/run-dedupe-trucking-by-po-staging.sh --po 1001031094 --apply
#   bash docs/scripts/run-dedupe-trucking-by-po-staging.sh --all --apply
#
# Prereq: backend image already built with dist/scripts/cleanupDuplicateTruckingByPo.js
#   (git pull + docker compose -f docker-compose.backend.yml up -d --build)
set -euo pipefail

APPLY=false
ALL=false
PO="1001031094"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --all) ALL=true; shift ;;
    --po)
      if [[ -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "ERROR: --po requires a PO number" >&2
        exit 1
      fi
      PO="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --po N | --all | --apply)" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.backend.yml)

echo "=== KLIP trucking PO dedupe (CANCEL losers, keep rows) ==="
echo "    dir:   $ROOT"
echo "    mode:  $([[ "$APPLY" == true ]] && echo APPLY || echo DRY-RUN)"
if $ALL; then
  echo "    scope: ALL duplicate POs"
else
  echo "    scope: PO $PO"
fi
echo ""

echo "==> Health"
if ! curl -sf http://127.0.0.1:5001/health >/dev/null; then
  echo "ERROR: backend /health failed. Deploy backend first:" >&2
  echo "  bash docs/scripts/staging-deploy-backend.sh" >&2
  exit 1
fi
echo "    OK"

echo ""
echo "==> Check compiled scripts in backend image"
if ! "${COMPOSE[@]}" exec -T backend test -f dist/scripts/cleanupDuplicateTruckingByPo.js; then
  echo "ERROR: missing dist/scripts/cleanupDuplicateTruckingByPo.js" >&2
  echo "  git pull origin SIT && docker compose -f docker-compose.backend.yml up -d --build" >&2
  exit 1
fi
if ! "${COMPOSE[@]}" exec -T backend test -f dist/scripts/refreshTruckingPipelineSummary.js; then
  echo "ERROR: missing dist/scripts/refreshTruckingPipelineSummary.js" >&2
  exit 1
fi
echo "    OK"

echo ""
echo "==> Check migration 119_po_primary_identity.sql"
MIG_JSON="$("${COMPOSE[@]}" exec -T backend node -e "
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  const r = await p.query(
    \"SELECT filename, applied_at FROM schema_migrations WHERE filename = '119_po_primary_identity.sql'\"
  );
  console.log(JSON.stringify(r.rows));
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
")"
echo "    $MIG_JSON"
if ! echo "$MIG_JSON" | grep -q '119_po_primary_identity.sql'; then
  echo "WARN: migration 119 not in schema_migrations — running migrate.js"
  "${COMPOSE[@]}" exec -T backend node dist/database/migrate.js
  MIG_JSON="$("${COMPOSE[@]}" exec -T backend node -e "
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  const r = await p.query(
    \"SELECT filename, applied_at FROM schema_migrations WHERE filename = '119_po_primary_identity.sql'\"
  );
  console.log(JSON.stringify(r.rows));
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
")"
  echo "    after migrate: $MIG_JSON"
  if ! echo "$MIG_JSON" | grep -q '119_po_primary_identity.sql'; then
    echo "ERROR: migration 119 still missing after migrate.js" >&2
    exit 1
  fi
fi

run_po_status_report() {
  local label="$1"
  local po_filter="$2"
  echo ""
  echo "==> $label"
  if [[ -n "$po_filter" ]]; then
    "${COMPOSE[@]}" exec -T backend node -e "
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  const r = await p.query(
    \`SELECT t.operation_id, t.status,
            (SELECT COUNT(DISTINCT da.progress_date)::int
               FROM trucking_daily_actuals da
              WHERE da.trucking_operation_id = t.id) AS wb_dates
     FROM trucking_operations t
     JOIN contracts c ON c.id = t.contract_id
     WHERE TRIM(c.po_number::text) = TRIM(\$1::text)
     ORDER BY CASE WHEN UPPER(COALESCE(t.status,'')) = 'CANCELLED' THEN 1 ELSE 0 END,
              t.operation_id\`,
    [process.argv[1]]
  );
  console.table(r.rows);
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
" "$po_filter"
  else
    echo "    (skipped detail for --all; see script JSON output)"
  fi
}

if ! $ALL; then
  run_po_status_report "BEFORE (PO $PO)" "$PO"
fi

echo ""
echo "==> Dry-run / report (cleanupDuplicateTruckingByPo)"
if $ALL; then
  "${COMPOSE[@]}" exec -T backend node dist/scripts/cleanupDuplicateTruckingByPo.js --all
else
  "${COMPOSE[@]}" exec -T backend node dist/scripts/cleanupDuplicateTruckingByPo.js --po "$PO"
fi

if ! $APPLY; then
  echo ""
  echo "Dry-run only. To apply CANCEL on losers:"
  if $ALL; then
    echo "  bash docs/scripts/run-dedupe-trucking-by-po-staging.sh --all --apply"
  else
    echo "  bash docs/scripts/run-dedupe-trucking-by-po-staging.sh --po $PO --apply"
  fi
  exit 0
fi

echo ""
echo "==> APPLY — merge WB actuals + CANCEL losers"
if $ALL; then
  "${COMPOSE[@]}" exec -T backend node dist/scripts/cleanupDuplicateTruckingByPo.js --all --apply
else
  "${COMPOSE[@]}" exec -T backend node dist/scripts/cleanupDuplicateTruckingByPo.js --po "$PO" --apply
fi

echo ""
echo "==> Refresh trucking pipeline summary / stage snapshot"
"${COMPOSE[@]}" exec -T backend node dist/scripts/refreshTruckingPipelineSummary.js

if ! $ALL; then
  run_po_status_report "AFTER (PO $PO)" "$PO"
fi

echo ""
echo "Done. Verify UI: http://8.215.6.189/trucking (Ctrl+Shift+R)"
echo "  - In Progress: loser OP should be gone"
echo "  - Cancelled: loser OP should appear (e.g. OP-LAND-300620260835 for PO 1001031094)"
