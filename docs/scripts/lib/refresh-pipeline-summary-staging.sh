# Source from staging ops scripts (restore, master vessel sync, etc.).
# Usage:
#   source docs/scripts/lib/refresh-pipeline-summary-staging.sh
#   refresh_pipeline_summary_staging
#
# Rebuilds shipment_pipeline_daily_summary + shipment_list_stage_snapshot (Section 1 cards)
# and trucking pipeline tables. Required after restoring shipments without a full DB restore.

refresh_pipeline_summary_staging() {
  local compose=(docker compose -f docker-compose.backend.yml)

  echo ""
  echo "==> Refresh pipeline daily summary (Section 1 status cards + trucking snapshot)"
  if ! curl -sf http://127.0.0.1:5001/health >/dev/null 2>&1; then
    echo "    WARN: backend /health failed — skip refresh (restart backend, then re-run)" >&2
    return 1
  fi

  if "${compose[@]}" exec -T backend test -f dist/scripts/refreshPipelineDailySummary.js 2>/dev/null; then
    if "${compose[@]}" exec -T backend npm run pipeline-summary:refresh:prod; then
      echo "    pipeline summary refreshed"
      return 0
    fi
    echo "    WARN: pipeline-summary:refresh:prod failed — marking shipment+trucking stale" >&2
  else
    echo "    WARN: dist/scripts/refreshPipelineDailySummary.js missing — rebuild backend" >&2
  fi

  mark_pipeline_summary_stale_staging || true
  return 1
}

mark_pipeline_summary_stale_staging() {
  echo "    Marking pipeline_summary_refresh_meta stale (UI falls back to live SQL until refresh)"
  "${COMPOSE[@]:-docker compose -f docker-compose.backend.yml}" exec -T backend node -e "
const pool = require('./dist/database/connection').default;
pool.query(
  \"UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module IN ('shipment', 'trucking')\"
).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
" 2>/dev/null || true
}

print_shipment_pipeline_summary_counts_staging() {
  "${COMPOSE[@]:-docker compose -f docker-compose.backend.yml}" exec -T backend node -e "
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
    SELECT
      (SELECT COUNT(*)::int FROM shipments) AS shipments,
      (SELECT COALESCE(SUM(planned_count), 0)::int FROM shipment_pipeline_daily_summary) AS planned,
      (SELECT COALESCE(SUM(completed_count), 0)::int FROM shipment_pipeline_daily_summary) AS completed,
      (SELECT is_stale FROM pipeline_summary_refresh_meta WHERE module = 'shipment') AS shipment_meta_stale
  \`);
  console.log(JSON.stringify(r.rows[0], null, 2));
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
" 2>/dev/null || echo "    (count check skipped — backend unavailable)"
}
