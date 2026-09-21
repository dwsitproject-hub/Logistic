/*
 * READ-ONLY: where the remaining Shipping Performance vs Shipments outstanding gap goes, for one
 * product/site slice.
 *
 *   node /app/diag-sp-os-gap.cjs CPO BONTANG
 *
 * Reported on production 2026-09-21: SP 75,876 MT against Shipments 80,939 MT - 5,063 MT, down
 * from 31,832 before the backlog arm.
 *
 * Membership was already proven identical on dev: every contract outside Shipping Performance also
 * fails contractBacklogCoreWhereSql, the Shipments rule itself. This script re-checks that on THIS
 * database and then asks the question membership cannot answer - whether the two pages add the
 * same rows up differently.
 *
 *   APPORTIONMENT. Shipping Performance divides a row by po_sto_count when one PO carries several
 *   STOs (shippingPerfOutstandingQtyKgForAggregate). Summing the rows raw counts a multi-STO PO
 *   once per STO. If the raw total lands on the Shipments figure, that is the whole answer and it
 *   is arithmetic, not membership.
 *
 * Runs the REAL builders on both sides. Copying either query means measuring the copy - that has
 * produced wrong answers here more than once.
 *
 * COST: one pass of the Shipping Performance query (~52s cold). Do not loop it.
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
const {
  buildShippingPerformanceSql,
  buildShippingPerformanceBacklogSql,
  aggregateShippingPerformanceRowsBySto,
} = load('services/shippingPerformance.service');
const {
  shippingPerfOutstandingQtyKgForAggregate,
} = load('utils/shippingPerformanceOutstandingAgg');

const PRODUCT = (process.argv[2] || 'CPO').trim().toUpperCase();
const SITE = (process.argv[3] || 'BONTANG').trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const up = (v) => String(v ?? '').trim().toUpperCase();
const raw = (r) => Number(r.outstanding_qty_actual ?? r.outstanding_qty ?? 0) || 0;

(async () => {
  console.log(`scope: ${PRODUCT} / ${SITE}`);
  console.log('running the real Shipping Performance query (one pass)...');
  const voyages = aggregateShippingPerformanceRowsBySto(
    (await connection.query(await buildShippingPerformanceSql())).rows,
  );
  let backlog = [];
  try {
    backlog = (await connection.query(await buildShippingPerformanceBacklogSql())).rows;
  } catch (err) {
    console.log(`backlog arm FAILED: ${String(err.message).slice(0, 160)}`);
  }
  const rows = [...voyages, ...backlog].filter(
    (r) => up(r.product).includes(PRODUCT) && up(r.plant_site).includes(SITE),
  );

  const apportioned = rows.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  const rawTotal = rows.reduce((a, r) => a + raw(r), 0);

  console.log(`\nrows in scope: ${rows.length}  (voyage ${rows.length - rows.filter((r) => r.is_unplanned_backlog).length}, backlog ${rows.filter((r) => r.is_unplanned_backlog).length})`);
  console.log('\nthe SAME rows, added up two ways:');
  console.log(`   apportioned (what Section 1 shows) : ${mt(apportioned)} MT`);
  console.log(`   raw per row                        : ${mt(rawTotal)} MT`);
  console.log(`   difference                         : ${mt(rawTotal - apportioned)} MT`);
  console.log('   Compare BOTH against the Shipments figure before looking any further: if the raw');
  console.log('   total matches it, the gap is apportionment and nothing is missing.');

  // Which rows actually carry the division, so the figure above has somewhere to come from.
  const multi = rows.filter((r) => Number(r.po_sto_count ?? 1) > 1);
  console.log(`\nrows on a PO carrying several STOs: ${multi.length}`);
  console.log(`   raw         : ${mt(multi.reduce((a, r) => a + raw(r), 0))} MT`);
  console.log(`   apportioned : ${mt(multi.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0))} MT`);
  const counts = new Map();
  for (const r of multi) {
    const n = Number(r.po_sto_count ?? 1);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  if (counts.size) {
    console.log('   po_sto_count distribution: ' +
      [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}x:${c}`).join('  '));
  }

  // COMPLETED rows still carrying outstanding - they are in Section 1 and NOT in the drilldown,
  // so if the two disagree by exactly this, the surfaces differ rather than the pages.
  const completedWithOs = rows.filter(
    (r) => up(r.status) === 'COMPLETED' && raw(r) > 0,
  );
  console.log(`\nCOMPLETED rows that still carry outstanding: ${completedWithOs.length}`);
  console.log(`   apportioned: ${mt(completedWithOs.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0))} MT`);
  console.log('   (Section 1 counts these; the drilldown filter drops them. A gap of exactly this');
  console.log('    size is a difference between SP surfaces, not between the two pages.)');

  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
