#!/usr/bin/env bash
# Diagnose Trucking Section 1 COMPLETED / Total card anomalies on SIT.
# Compares live DB vs backup counts file and pipeline daily summary.
#
# Usage (PuTTY → backend 172.28.92.57):
#   cd /opt/klip
#   bash docs/scripts/diag-trucking-summary-staging.sh
#   bash docs/scripts/diag-trucking-summary-staging.sh /opt/klip/backups/klip_sit_txn_20260811_164207.dump
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.backend.yml)
OUT_DIR="${OUT_DIR:-/opt/klip/backups}"
BACKUP_DUMP="${1:-}"

echo "=== KLIP Trucking Section 1 diagnostic (SIT) ==="
echo "    host: $(hostname)"
echo "    repo: $ROOT"
echo ""

echo "==> 1) Backend health"
if curl -sf http://127.0.0.1:5001/health >/dev/null; then
  echo "    OK: /health"
else
  echo "    FAIL: backend /health" >&2
  exit 1
fi

read_counts_key() {
  local counts_file="$1"
  local key="$2"
  local line
  [[ -f "$counts_file" ]] || return 0
  while IFS= read -r line; do
    if [[ "$line" =~ ^${key}=([0-9]+)$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
    if [[ "$line" =~ ^([0-9]+)[[:space:]]+${key}$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
  done < "$counts_file"
}

echo ""
echo "==> 2) Backup counts (compare trucking_operations / trucking_daily_actuals)"
if [[ -z "$BACKUP_DUMP" ]]; then
  shopt -s nullglob
  candidates=("$OUT_DIR"/klip_sit_txn_*.dump)
  shopt -u nullglob
  if [[ ${#candidates[@]} -gt 0 ]]; then
    BACKUP_DUMP="$(ls -t "${candidates[@]}" 2>/dev/null | head -1)"
  fi
fi

if [[ -n "$BACKUP_DUMP" && -f "$BACKUP_DUMP" ]]; then
  counts_file="${BACKUP_DUMP%.dump}_counts.txt"
  [[ -f "$counts_file" ]] || counts_file="${BACKUP_DUMP%.sql}_counts.txt"
  echo "    backup: $BACKUP_DUMP"
  if [[ -f "$counts_file" ]]; then
    echo "    counts file: $counts_file"
    for key in trucking_operations trucking_daily_actuals trucking_realizations trucking_wb_imports shipments; do
      val="$(read_counts_key "$counts_file" "$key")"
      printf "      backup %-24s %s\n" "$key" "${val:-?}"
    done
  else
    echo "    (no *_counts.txt — run dump-sit-transactional-data.sh to generate)"
  fi
else
  echo "    (no backup specified — pass path or ensure $OUT_DIR/klip_sit_txn_*.dump exists)"
fi

echo ""
echo "==> 3) Live DB — ops status + child tables + pipeline summary"
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
    SELECT
      (SELECT COUNT(*)::int FROM trucking_operations) AS ops_total,
      (SELECT COUNT(*)::int FROM trucking_operations WHERE COALESCE(status,'') = 'COMPLETED') AS ops_status_completed,
      (SELECT COUNT(*)::int FROM trucking_operations WHERE COALESCE(status,'') = 'CANCELLED') AS ops_cancelled,
      (SELECT COUNT(*)::int FROM trucking_daily_actuals) AS daily_actuals,
      (SELECT COUNT(*)::int FROM trucking_realizations) AS realizations,
      (SELECT COUNT(*)::int FROM trucking_wb_imports) AS wb_imports,
      (SELECT COALESCE(SUM(completed_count),0)::int FROM trucking_pipeline_daily_summary) AS pipeline_completed,
      (SELECT COALESCE(SUM(total_count),0)::int FROM trucking_pipeline_daily_summary) AS pipeline_total,
      (SELECT is_stale FROM pipeline_summary_refresh_meta WHERE module = 'trucking') AS trucking_meta_stale
  \`);
  console.log(JSON.stringify(summary.rows[0], null, 2));

  const byStatus = await p.query(\`
    SELECT COALESCE(NULLIF(TRIM(status), ''), '(null)') AS status, COUNT(*)::int AS n
    FROM trucking_operations
    GROUP BY 1
    ORDER BY n DESC
  \`);
  console.log('');
  console.log('Status breakdown:');
  console.table(byStatus.rows);

  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"

echo ""
echo "==> 4) Recent dedupe audit files (if any)"
if ls -lt /opt/klip/tmp/trucking-po-dedupe-audit-*.csv 2>/dev/null | head -3; then
  true
else
  echo "    (none in /opt/klip/tmp/)"
fi

echo ""
echo "==> Interpretation"
echo "    backup trucking_operations >> live ops_total  → missing ops; restore with --include-trucking"
echo "    ops_cancelled very high vs backup               → dedupe side-effect (expected)"
echo "    daily_actuals low vs backup                     → missing WB data; COMPLETED stage under-counts"
echo "    pipeline_completed ≈ low ops_status_completed   → pipeline OK; data is the issue"
echo "    pipeline_completed = 0 but many COMPLETED ops   → run refresh-pipeline-summary-staging.sh"
echo ""
echo "Restore trucking from backup (after git pull):"
echo "  bash docs/scripts/restore-sit-txn-from-backup-staging.sh \\"
echo "    ${BACKUP_DUMP:-/opt/klip/backups/klip_sit_txn_YYYYMMDD_HHMMSS.dump} \\"
echo "    --include-trucking --truncate-trucking-first --apply"
echo ""
echo "DONE. Verify http://8.215.6.189/trucking Section 1 (Ctrl+Shift+R)."
