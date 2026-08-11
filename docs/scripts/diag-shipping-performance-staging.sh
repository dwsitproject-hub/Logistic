#!/usr/bin/env bash
# Diagnose empty Shipping Performance on SIT backend.
# Usage (PuTTY → 172.28.92.57):
#   cd /opt/klip
#   bash docs/scripts/diag-shipping-performance-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.backend.yml)

echo "=== KLIP Shipping Performance diagnostic (SIT) ==="
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

echo ""
echo "==> 2) Git / backend image (recent deploy?)"
git rev-parse --short HEAD 2>/dev/null || true
git log -1 --oneline 2>/dev/null || true

echo ""
echo "==> 3) DB schema prerequisites (migrations 091 + 136)"
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
  const tables = ['master_vessel_code_aliases', 'master_vessels', 'shipment_ata_overrides'];
  for (const t of tables) {
    const r = await p.query(
      \"SELECT to_regclass('public.' || \$1) IS NOT NULL AS exists\",
      [t],
    );
    console.log('table', t + ':', r.rows[0]?.exists ? 'OK' : 'MISSING');
  }
  const mv = await p.query('SELECT COUNT(*)::int AS n FROM master_vessels');
  const al = await p.query('SELECT COUNT(*)::int AS n FROM master_vessel_code_aliases');
  console.log('master_vessels:', mv.rows[0]?.n, '| aliases:', al.rows[0]?.n);
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"

echo ""
echo "==> 4) Shipment scope counts (SEA CIF/FOB/CFR, non-cancelled)"
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
    SELECT
      COUNT(*)::int AS total_shipments,
      COUNT(*) FILTER (WHERE COALESCE(s.status,'') <> 'CANCELLED')::int AS non_cancelled,
      COUNT(*) FILTER (
        WHERE COALESCE(s.status,'') <> 'CANCELLED'
          AND upper(trim(COALESCE(c.incoterm,''))) IN ('CIF','FOB','CFR')
      )::int AS sea_incoterm,
      COUNT(*) FILTER (
        WHERE COALESCE(s.status,'') <> 'CANCELLED'
          AND upper(trim(COALESCE(c.incoterm,''))) IN ('CIF','FOB','CFR')
          AND upper(trim(COALESCE(s.status,''))) <> 'UNPLANNED'
      )::int AS sea_non_unplanned,
      COUNT(*) FILTER (
        WHERE COALESCE(s.status,'') <> 'CANCELLED'
          AND upper(trim(COALESCE(c.incoterm,''))) IN ('CIF','FOB','CFR')
          AND c.contract_date IS NOT NULL
      )::int AS sea_with_contract_date,
      COUNT(*) FILTER (
        WHERE COALESCE(s.status,'') <> 'CANCELLED'
          AND upper(trim(COALESCE(c.incoterm,''))) IN ('CIF','FOB','CFR')
          AND c.contract_date >= date_trunc('year', CURRENT_DATE)
      )::int AS sea_ytd_contract_date
    FROM shipments s
    INNER JOIN contracts c ON s.contract_id = c.id
  \`);
  console.log(JSON.stringify(r.rows[0], null, 2));
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"

echo ""
echo "==> 5) Run shipping performance SQL (row count + sample error)"
"${COMPOSE[@]}" exec -T backend node -e "
const { query } = require('./dist/database/connection');
const { runShippingPerformance } = require('./dist/services/shippingPerformance.service');
(async () => {
  try {
    const req = { query: { scope: 'ytd' } };
    const data = await runShippingPerformance(req, 'rows');
    const rows = data.rows || [];
    console.log('API rows (backend filter):', rows.length);
    if (rows.length > 0) {
      const sample = rows[0];
      console.log('Sample:', JSON.stringify({
        contract_number: sample.contract_number,
        contract_date: sample.contract_date,
        status: sample.status,
        incoterm: sample.incoterm,
        vessel_name: sample.vessel_name,
      }, null, 2));
      const withDate = rows.filter((r) => String(r.contract_date || '').trim()).length;
      const ongoing = rows.filter((r) => {
        const u = String(r.status || '').trim().toUpperCase();
        return u && u !== 'UNPLANNED' && u !== 'CANCELLED' && u !== 'COMPLETED';
      }).length;
      console.log('Rows with contract_date:', withDate);
      console.log('Rows ongoing status (UI default card):', ongoing);
    }
  } catch (e) {
    console.error('SQL/API ERROR (likely cause of empty UI):');
    console.error(e.message || e);
    if (e.stack) console.error(String(e.stack).split('\\n').slice(0, 5).join('\\n'));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
"

echo ""
echo "==> 6) Backend log tail (shipping performance errors)"
docker logs --tail 30 klip-backend 2>&1 | grep -i 'shipping performance\\|Get shipping performance' || echo "    (no recent perf errors in last 30 lines)"

echo ""
echo "DONE."
echo "If step 5 shows SQL ERROR → rebuild backend after git pull + run migrate."
echo "If rows > 0 but contract_date low → UI YTD filter hides rows; check contracts.contract_date on SIT."
echo "If rows > 0 but ongoing = 0 → click Close/All card on Shipping Performance page."
