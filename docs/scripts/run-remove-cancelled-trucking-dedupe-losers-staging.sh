#!/usr/bin/env bash
# Remove CANCELLED trucking dedupe losers via backend container (same DB as UI).
# Fixes wrong-DB deletes when host psql targets local klip-postgres instead of .60:5442.
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh
#   bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply
#   bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply --op OP-LAND-130720260012
set -euo pipefail

APPLY=false
OP_FILTER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --op)
      if [[ -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "ERROR: --op requires operation_id" >&2
        exit 1
      fi
      OP_FILTER="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --apply | --op OP-LAND-...)" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.backend.yml)
VERIFY_POS=(1001030428 1001029797 1001030446)
DEFAULT_OP=OP-LAND-130720260012

echo "=== KLIP remove CANCELLED trucking dedupe losers (via backend DB) ==="
echo "    dir:  $ROOT"
echo "    mode: $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW)"
[[ -n "$OP_FILTER" ]] && echo "    op:   $OP_FILTER"
echo ""

echo "==> Health"
if ! curl -sf http://127.0.0.1:5001/health >/dev/null; then
  echo "ERROR: backend /health failed" >&2
  exit 1
fi
echo "    OK"

echo ""
echo "==> Rebuild backend if delete script missing"
if ! "${COMPOSE[@]}" exec -T backend test -f dist/scripts/deleteCancelledTruckingDedupeLosers.js 2>/dev/null; then
  echo "    Building backend image (includes new delete script)..."
  "${COMPOSE[@]}" up -d --build backend
fi
if ! "${COMPOSE[@]}" exec -T backend test -f dist/scripts/deleteCancelledTruckingDedupeLosers.js; then
  echo "ERROR: dist/scripts/deleteCancelledTruckingDedupeLosers.js missing after build" >&2
  echo "  git pull origin SIT && docker compose -f docker-compose.backend.yml up -d --build" >&2
  exit 1
fi
echo "    OK"

run_backend_node_check() {
  local label="$1"
  local op="$2"
  echo ""
  echo "==> $label"
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
  console.log('db:', process.env.DB_HOST + ':' + process.env.DB_PORT + '/' + process.env.DB_NAME);
  if (process.argv[1]) {
    const r = await p.query(
      \`SELECT t.operation_id, t.status, TRIM(c.po_number::text) AS po_number
       FROM trucking_operations t
       LEFT JOIN contracts c ON c.id = t.contract_id
       WHERE t.operation_id = \$1\`,
      [process.argv[1]]
    );
    console.table(r.rows);
    if (r.rows.length === 0) console.log('(not found in DB)');
  }
  const cancelled = await p.query(\`
    SELECT COUNT(*)::int AS cancelled_all FROM trucking_operations t
    WHERE UPPER(TRIM(COALESCE(t.status,''))) IN ('CANCELLED','CANCELED','CANCEL')
  \`);
  console.log('cancelled_all:', cancelled.rows[0]?.cancelled_all);
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
" "$op"
}

TARGET_OP="${OP_FILTER:-$DEFAULT_OP}"
run_backend_node_check "BEFORE (sample op $TARGET_OP)" "$TARGET_OP"

echo ""
echo "==> Delete eligible CANCELLED dedupe losers (backend → app DB)"
DELETE_ARGS=()
[[ -n "$OP_FILTER" ]] && DELETE_ARGS+=(--op "$OP_FILTER")
if $APPLY; then
  DELETE_ARGS+=(--apply)
fi
"${COMPOSE[@]}" exec -T backend node dist/scripts/deleteCancelledTruckingDedupeLosers.js "${DELETE_ARGS[@]}"

if ! $APPLY; then
  echo ""
  echo "Preview complete. To apply:"
  if [[ -n "$OP_FILTER" ]]; then
    echo "  bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply --op $OP_FILTER"
  else
    echo "  bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply"
    echo "  # or single OP:"
    echo "  bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply --op $DEFAULT_OP"
  fi
  exit 0
fi

run_backend_node_check "AFTER (sample op $TARGET_OP — should be absent)" "$TARGET_OP"

echo ""
echo "==> Verify sample POs"
for po in "${VERIFY_POS[@]}"; do
  echo "--- PO $po ---"
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
    \`SELECT t.operation_id, t.status FROM trucking_operations t
     JOIN contracts c ON c.id = t.contract_id
     WHERE TRIM(c.po_number::text) = \$1
     ORDER BY CASE WHEN UPPER(COALESCE(t.status,''))='CANCELLED' THEN 1 ELSE 0 END, t.operation_id\`,
    [process.argv[1]]
  );
  console.table(r.rows);
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
" "$po"
done

echo ""
echo "Done. Hard refresh http://8.215.6.189/trucking (Ctrl+Shift+R)"
