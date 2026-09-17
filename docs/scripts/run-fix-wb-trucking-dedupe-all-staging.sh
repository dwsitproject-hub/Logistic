#!/usr/bin/env bash
# One-shot SIT fix: dedupe ALL duplicate active trucking_operations per PO so
# WB upload no longer fails with "Multiple FRC/LCO trucking operations share PO".
#
# Orchestrates: optional backup → pre-flight preview → dry-run → (apply) → verify.
#
# Usage (PuTTY → backend 172.28.92.57, from /opt/klip):
#   bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh
#   bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh --apply
#   bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh --apply --skip-backup
#   bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh --apply --cleanup-cancelled
#
# Prereq:
#   git pull origin SIT
#   docker compose -f docker-compose.backend.yml up -d --build
#   postgresql-client on host (for backup): apt-get install -y postgresql-client
set -euo pipefail

APPLY=false
SKIP_BACKUP=false
CLEANUP_CANCELLED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --skip-backup) SKIP_BACKUP=true; shift ;;
    --cleanup-cancelled) CLEANUP_CANCELLED=true; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1 (use --apply | --skip-backup | --cleanup-cancelled)" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.backend.yml)
DEDUPE_SCRIPT="$ROOT/docs/scripts/run-dedupe-trucking-by-po-staging.sh"
CLEANUP_LOSERS_SCRIPT="$ROOT/docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh"
PREVIEW_SQL="$ROOT/backend/src/scripts/sql/previewDuplicateTruckingByPo.sql"
DUMP_SCRIPT="$ROOT/docs/scripts/dump-sit-transactional-data.sh"

# Known WB blocker POs from recent upload failures (verification sample).
VERIFY_POS=(1001030428 1001029797 1001030446)

for f in "$DEDUPE_SCRIPT" "$PREVIEW_SQL"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f — run: git pull origin SIT" >&2
    exit 1
  fi
done

echo "=== KLIP WB fix: dedupe ALL duplicate trucking ops per PO ==="
echo "    dir:   $ROOT"
echo "    mode:  $([[ "$APPLY" == true ]] && echo APPLY || echo PREVIEW-ONLY)"
echo ""

echo "==> Health"
if ! curl -sf http://127.0.0.1:5001/health >/dev/null; then
  echo "ERROR: backend /health failed. Deploy first:" >&2
  echo "  bash docs/scripts/staging-deploy-backend.sh" >&2
  exit 1
fi
echo "    OK"

echo ""
echo "==> Check compiled dedupe script in backend image"
if ! "${COMPOSE[@]}" exec -T backend test -f dist/scripts/cleanupDuplicateTruckingByPo.js; then
  echo "ERROR: missing dist/scripts/cleanupDuplicateTruckingByPo.js" >&2
  echo "  git pull origin SIT && docker compose -f docker-compose.backend.yml up -d --build" >&2
  exit 1
fi
echo "    OK"

run_preview_sql() {
  echo ""
  echo "==> Pre-flight preview (read-only)"
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
  const summary = await p.query(\`
    SELECT COUNT(*)::int AS duplicate_po_groups
    FROM (
      SELECT TRIM(c.po_number::text) AS po_norm
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE t.contract_id IS NOT NULL
        AND COALESCE(t.status, '') <> 'CANCELLED'
        AND NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
      GROUP BY TRIM(c.po_number::text)
      HAVING COUNT(*) > 1
    ) dup
  \`);
  console.log('duplicate_po_groups:', summary.rows[0]?.duplicate_po_groups ?? 0);

  const top = await p.query(\`
    SELECT TRIM(c.po_number::text) AS po_number, c.product, COUNT(*)::int AS active_ops
    FROM trucking_operations t
    INNER JOIN contracts c ON c.id = t.contract_id
    WHERE COALESCE(t.status, '') <> 'CANCELLED'
      AND NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
    GROUP BY TRIM(c.po_number::text), c.product
    HAVING COUNT(*) > 1
    ORDER BY active_ops DESC, po_number
    LIMIT 20
  \`);
  if (top.rows.length === 0) {
    console.log('No duplicate PO groups found — WB upload should not hit Multiple FRC/LCO error.');
  } else {
    console.log('Top duplicate POs:');
    console.table(top.rows);
  }

  const detail = await p.query(\`
    WITH dup_pos AS (
      SELECT TRIM(c.po_number::text) AS po_norm
      FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE t.contract_id IS NOT NULL
        AND COALESCE(t.status, '') <> 'CANCELLED'
        AND NULLIF(TRIM(c.po_number::text), '') IS NOT NULL
      GROUP BY TRIM(c.po_number::text)
      HAVING COUNT(*) > 1
    )
    SELECT
      TRIM(c.po_number::text) AS po_number,
      t.operation_id,
      t.status,
      (SELECT COUNT(DISTINCT da.progress_date)::int
         FROM trucking_daily_actuals da WHERE da.trucking_operation_id = t.id) AS wb_dates
    FROM trucking_operations t
    INNER JOIN contracts c ON c.id = t.contract_id
    INNER JOIN dup_pos d ON d.po_norm = TRIM(c.po_number::text)
    WHERE COALESCE(t.status, '') <> 'CANCELLED'
    ORDER BY po_number, wb_dates DESC, t.operation_id
    LIMIT 100
  \`);
  if (detail.rows.length > 0) {
    console.log('Sample ops (first 100 rows):');
    console.table(detail.rows);
  }
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"
}

run_duplicate_count() {
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
  const r = await p.query(\`
    SELECT COUNT(*)::int AS duplicate_po_groups FROM (
      SELECT TRIM(c.po_number) po FROM trucking_operations t
      JOIN contracts c ON c.id = t.contract_id
      WHERE COALESCE(t.status,'') <> 'CANCELLED'
      GROUP BY TRIM(c.po_number) HAVING COUNT(*) > 1
    ) x\`);
  console.log(JSON.stringify(r.rows[0]));
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"
}

verify_sample_pos() {
  echo ""
  echo "==> Verify sample WB-blocker POs"
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
}

if ! $SKIP_BACKUP; then
  echo ""
  echo "==> Backup (transactional dump, recommended before --apply)"
  if [[ -f "$DUMP_SCRIPT" ]]; then
    if $APPLY; then
      if ! bash "$DUMP_SCRIPT"; then
        echo "" >&2
        echo "ERROR: backup failed — dedupe NOT applied." >&2
        echo "  Fix DB connectivity (see dump script hints), or re-run with:" >&2
        echo "    bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh --apply --skip-backup" >&2
        exit 1
      fi
      echo "    Backup complete."
    else
      echo "    Skipped in preview mode. Will run automatically with --apply."
      echo "    To backup now: bash docs/scripts/dump-sit-transactional-data.sh"
    fi
  else
    echo "    WARN: $DUMP_SCRIPT not found — backup skipped"
  fi
fi

run_preview_sql

echo ""
echo "==> Dry-run dedupe (all duplicate POs)"
bash "$DEDUPE_SCRIPT" --all

if ! $APPLY; then
  echo ""
  echo "Preview complete. Review keeper/loser JSON above."
  echo "To apply (backup + cancel losers + refresh pipeline):"
  echo "  bash docs/scripts/run-fix-wb-trucking-dedupe-all-staging.sh --apply"
  if $CLEANUP_CANCELLED; then
    echo "  (with --cleanup-cancelled: also hard-delete CANCELLED dedupe losers from UI)"
  else
    echo "To also remove CANCELLED losers from view table / Cancelled card after apply:"
    echo "  bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply"
  fi
  exit 0
fi

echo ""
echo "==> APPLY dedupe (all duplicate POs)"
bash "$DEDUPE_SCRIPT" --all --apply

echo ""
echo "==> Post-apply global check"
POST_COUNT="$(run_duplicate_count)"
echo "    $POST_COUNT"

verify_sample_pos

echo ""
if echo "$POST_COUNT" | grep -q '"duplicate_po_groups":0'; then
  echo "SUCCESS: no duplicate active trucking ops per PO remain."
else
  echo "WARN: some duplicate PO groups may still exist — review output above."
fi

if $CLEANUP_CANCELLED; then
  echo ""
  echo "==> Hard-delete CANCELLED dedupe losers (remove from Cancelled table/card)"
  if [[ -f "$CLEANUP_LOSERS_SCRIPT" ]]; then
    bash "$CLEANUP_LOSERS_SCRIPT" --apply
  else
    echo "WARN: $CLEANUP_LOSERS_SCRIPT not found — run manually:" >&2
    echo "  bash docs/scripts/run-cleanup-trucking-dedupe-losers-staging.sh --apply" >&2
  fi
fi

echo ""
echo "Next steps:"
echo "  1. Re-upload WB at http://8.215.6.189/trucking (Ctrl+Shift+R)"
echo "  2. Status Upload should no longer show 'Multiple FRC/LCO trucking operations share PO'"
if ! $CLEANUP_CANCELLED; then
  echo "  3. Remove CANCELLED duplicate ops from view table / Cancelled card:"
  echo "       bash docs/scripts/run-remove-cancelled-trucking-dedupe-losers-staging.sh --apply"
fi
