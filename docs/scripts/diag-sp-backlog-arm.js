/*
 * READ-ONLY: what Shipping Performance would gain by counting the same unplanned contracts the
 * Shipments page already counts.
 *
 *   node /app/diag-sp-backlog-arm.js                (whole database)
 *   node /app/diag-sp-backlog-arm.js CPO BONTANG    (one slice)
 *
 * The Shipments OS is two disjoint arms: execution (contracts with a live shipment) and backlog
 * (contracts without one). Shipping Performance is built from shipments, so it has only the first,
 * and its Outstanding Qty means something narrower than the identical label on the other page.
 *
 * This measures the second arm through `contractBacklogCoreWhereSql` - the SAME function the
 * Shipments page uses - rather than a rewritten copy of its criteria. That matters more than it
 * looks: a rewritten copy would agree today and drift silently later, which is exactly how three
 * write paths ended up invalidating different caches. Its comments also explain why the arm is
 * disjoint from execution, so adding it cannot double count.
 *
 * The number this prints is the baseline to verify against afterwards: Shipping Performance's
 * outstanding must rise by exactly this, and not one of its average delay figures may move.
 */
const connection = require('/app/dist/database/connection');
const { contractBacklogCoreWhereSql } = require('/app/dist/utils/shipmentUnplannedHybridSql');
const { sqlRegionSiteDisplayForContract } = require('/app/dist/utils/regionSiteSql');

const PRODUCT = (process.argv[2] || '').trim().toUpperCase();
const SITE = (process.argv[3] || '').trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });

(async () => {
  const where = contractBacklogCoreWhereSql('c', 'l');
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const scope = [];
  const params = [];
  if (PRODUCT) {
    params.push(PRODUCT);
    scope.push(`AND UPPER(TRIM(COALESCE(c.product, ''))) LIKE '%' || $${params.length} || '%'`);
  }
  if (SITE) {
    params.push(SITE);
    scope.push(`AND UPPER(TRIM(COALESCE((${regionSite}), ''))) LIKE '%' || $${params.length} || '%'`);
  }
  console.log(`scope: ${PRODUCT || 'all products'} / ${SITE || 'all sites'}\n`);

  try {
    const rows = (await connection.query(`
      SELECT c.incoterm,
             COUNT(*)::int AS contracts,
             ROUND(SUM(GREATEST(
               COALESCE(c.quantity_ordered, 0) - CASE
                 WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) = 'FOB' THEN COALESCE(qms.quantity_delivery, 0)
                 ELSE COALESCE(qms.quantity_receive, 0)
               END, 0)) / 1000)::int AS os_mt
      FROM contracts c
      LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
      WHERE ${where}
        ${scope.join('\n        ')}
      GROUP BY c.incoterm
      ORDER BY 3 DESC`, params)).rows;

    console.log('the backlog arm Shipping Performance does not have:');
    console.log('   incoterm   contracts        OS');
    let contracts = 0;
    let kg = 0;
    for (const r of rows) {
      contracts += Number(r.contracts);
      kg += Number(r.os_mt) * 1000;
      console.log('   ' + String(r.incoterm || '-').padEnd(11) + String(r.contracts).padStart(9) +
        String(Number(r.os_mt).toLocaleString('en-US')).padStart(12) + ' MT');
    }
    console.log('   ' + 'TOTAL'.padEnd(11) + String(contracts).padStart(9) + String(mt(kg)).padStart(12) + ' MT');

    console.log('\nAfter the change, verify exactly this:');
    console.log('   - Shipping Performance outstanding rises by this figure, no more');
    console.log('   - every average delay figure is UNCHANGED. These contracts have no vessel and');
    console.log('     no dates, so counting them in a `sum / rowCount` average would shrink every');
    console.log('     delay simply because something has not been planned yet - the metric the page');
    console.log('     exists for, quietly degraded.');
    console.log('   - Total Vessels is UNCHANGED, for the same reason: there is no vessel here.');
  } catch (err) {
    console.log(`could not be measured: ${String(err.message).slice(0, 200)}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
