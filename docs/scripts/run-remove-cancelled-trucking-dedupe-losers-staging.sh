#!/usr/bin/env bash
# Remove CANCELLED trucking dedupe losers from DB so they disappear from the
# Trucking view table (Cancelled filter) and Cancelled status card.
#
# Rule A: CANCELLED + active keeper on same PO (e.g. OP-LAND-130720260012 after PO dedupe)
# Rule B: CANCELLED orphan with no WB rows and no keeper
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh
#   bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply
#
# Prereq: PO dedupe already applied (losers are CANCELLED, keeper still active).
# Does NOT delete manual CANCELLED ops that have WB but no keeper.
set -euo pipefail

APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --apply)" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CLEANUP_SCRIPT="$ROOT/docs/scripts/run-cleanup-trucking-dedupe-losers-staging.sh"
COMPOSE=(docker compose -f docker-compose.backend.yml)

# Sample POs / ops from recent WB duplicate remediation
VERIFY_POS=(1001030428 1001029797 1001030446)
# Sample duplicate loser ops (keepers must remain after cleanup)
SAMPLE_LOSER_OPS=(OP-LAND-130720260012)

if [[ ! -f "$CLEANUP_SCRIPT" ]]; then
  echo "Missing $CLEANUP_SCRIPT — run: git pull origin SIT" >&2
  exit 1
fi

echo "=== KLIP remove CANCELLED trucking dedupe losers ==="
echo "    dir:  $ROOT"
echo "    mode: $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW)"
echo ""

echo "==> Health"
if ! curl -sf http://127.0.0.1:5001/health >/dev/null; then
  echo "ERROR: backend /health failed" >&2
  exit 1
fi
echo "    OK"

echo ""
echo "==> BEFORE: cancelled count + sample loser ops"
"${COMPOSE[@]}" exec -T backend node -e "
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
const sampleOps = process.argv.slice(1);
(async () => {
  const cancelled = await p.query(\`
    SELECT COUNT(*)::int AS cancelled_all
    FROM trucking_operations t
    WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
  \`);
  console.log('cancelled_all:', cancelled.rows[0]?.cancelled_all ?? 0);

  if (sampleOps.length > 0) {
    const ops = await p.query(
      \`SELECT t.operation_id, t.status, TRIM(c.po_number::text) AS po_number
       FROM trucking_operations t
       LEFT JOIN contracts c ON c.id = t.contract_id
       WHERE t.operation_id = ANY(\$1::text[])
       ORDER BY t.operation_id\`,
      [sampleOps]
    );
    console.log('Sample loser ops (still in DB if listed):');
    console.table(ops.rows);
  }
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
" "${SAMPLE_LOSER_OPS[@]}"

echo ""
echo "==> Preview eligible hard-deletes"
bash "$CLEANUP_SCRIPT"

if ! $APPLY; then
  echo ""
  echo "Preview complete. Review would_delete and delete_reason=active_keeper above."
  echo "To hard-delete and remove from Cancelled table/card:"
  echo "  bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply"
  exit 0
fi

echo ""
echo "==> APPLY hard-delete CANCELLED dedupe losers"
bash "$CLEANUP_SCRIPT" --apply

echo ""
echo "==> AFTER: verify sample POs (expect 1 active op each; losers gone)"
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
    \`SELECT t.operation_id, t.status,
            (SELECT COUNT(DISTINCT da.progress_date)::int
               FROM trucking_daily_actuals da
              WHERE da.trucking_operation_id = t.id) AS wb_dates
     FROM trucking_operations t
     JOIN contracts c ON c.id = t.contract_id
     WHERE TRIM(c.po_number::text) = \$1
     ORDER BY CASE WHEN UPPER(COALESCE(t.status,'')) = 'CANCELLED' THEN 1 ELSE 0 END,
              t.operation_id\`,
    [process.argv[1]]
  );
  console.table(r.rows);
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
" "$po"
done

echo ""
echo "==> AFTER: sample loser ops should be absent"
"${COMPOSE[@]}" exec -T backend node -e "
const { Pool } = require('pg');
const p = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
const sampleOps = process.argv.slice(1);
(async () => {
  const r = await p.query(
    \`SELECT t.operation_id, t.status FROM trucking_operations t
     WHERE t.operation_id = ANY(\$1::text[])\`,
    [sampleOps]
  );
  if (r.rows.length === 0) {
    console.log('OK: sample loser ops no longer in DB');
  } else {
    console.log('WARN: some sample ops still exist:');
    console.table(r.rows);
  }
  const cancelled = await p.query(\`
    SELECT COUNT(*)::int AS cancelled_all
    FROM trucking_operations t
    WHERE UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
  \`);
  console.log('cancelled_all:', cancelled.rows[0]?.cancelled_all ?? 0);
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
" "${SAMPLE_LOSER_OPS[@]}"

echo ""
echo "Done. Verify UI: http://8.215.6.189/trucking (Ctrl+Shift+R)"
echo "  - Cancelled card count should decrease"
echo "  - Cancelled filter: duplicate ops like OP-LAND-130720260012 should be gone"
