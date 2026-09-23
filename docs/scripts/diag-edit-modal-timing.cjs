/*
 * READ-ONLY: how long does the shipment edit/view modal take to open?
 *
 *   node /app/diag-edit-modal-timing.cjs          (12 shipments, newest first)
 *   node /app/diag-edit-modal-timing.cjs 30       (a wider sample)
 *
 * WHY THIS EXISTS. The modal's cost is the endpoint it calls, `/shipments/:id/edit-payload`, and
 * that endpoint is entirely database-bound - time outside SQL measured at ~0. So a number here is
 * the number the user feels, and it needs no screen to obtain.
 *
 * IT PRINTS THE DISTRIBUTION, NOT THE MEAN, and that is the point. On 2026-09-22 a three-shipment
 * sample said the endpoint had gone from 1,497 ms to 859 ms and I reported it as a 43% win. A
 * twelve-shipment sample then split in two: seven at 4,150-5,053 ms and five at 248-547 ms. The
 * mean hid it; the median and the maximum did not. Read the max and the median, never the mean.
 *
 * After migration 179 (three expression indexes on the STO lookups) the same twelve read
 * 171-537 ms, median 248.
 *
 * It calls the controller handler directly with a mock req/res, so it measures the page's own code
 * rather than an imitation, and it touches no cache and writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) =>
  fs.existsSync(p),
);
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

const connection = load('database/connection');
const { getShipmentEditPayload } = load('controllers/shipment.controller');

const LIMIT = Math.max(1, Math.min(200, Number(process.argv[2]) || 12));

(async () => {
  const picked = await connection.query(
    `SELECT s.id
     FROM shipments s
     WHERE COALESCE(s.status, '') <> 'CANCELLED'
     ORDER BY s.created_at DESC
     LIMIT $1`,
    [LIMIT],
  );
  if (picked.rows.length === 0) {
    console.log('no shipments to measure');
    process.exit(0);
  }

  const rows = [];
  for (const row of picked.rows) {
    let payload = null;
    const res = {
      status() { return this; },
      json(p) { payload = p; return this; },
      setHeader() { return this; },
      send(p) { payload = p; return this; },
    };
    const t0 = Date.now();
    await getShipmentEditPayload({ params: { id: row.id }, query: {} }, res);
    const ms = Date.now() - t0;
    const data = payload && payload.data;
    rows.push({
      id: String(row.id),
      ms,
      contractDetails: ((data && data.contractDetails) || []).length,
      ports: ((data && data.ports) || []).length,
      ok: Boolean(data && data.shipment),
    });
  }

  rows.sort((a, b) => b.ms - a.ms);
  console.log(`edit-payload, ${rows.length} shipments, slowest first:`);
  for (const r of rows) {
    console.log(
      `  ${String(r.ms).padStart(6)} ms   contractDetails=${r.contractDetails}  ports=${r.ports}${r.ok ? '' : '   <- NO PAYLOAD'}`,
    );
  }

  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => ms[Math.min(ms.length - 1, Math.floor((ms.length - 1) * p))];
  console.log('');
  console.log(`  min ${ms[0]} ms   median ${pct(0.5)} ms   p90 ${pct(0.9)} ms   max ${ms[ms.length - 1]} ms`);
  console.log('');
  console.log('Read the MEDIAN and the MAX. A mean over a bimodal sample hid a fault affecting most');
  console.log('rows once already. Anything above ~1,500 ms means a lookup has fallen back to a');
  console.log('sequential scan - check that migration 179 has run.');
  const failed = rows.filter((r) => !r.ok);
  if (failed.length) console.log(`\n${failed.length} shipment(s) returned no payload - investigate those first.`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.stack ? e.stack : e).slice(0, 400));
  process.exit(1);
});
