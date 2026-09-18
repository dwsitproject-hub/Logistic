/*
 * READ-ONLY: the query that will feed Shipping Performance's unplanned-backlog arm, run on its own
 * so it is PROVEN to execute before any of it reaches the service.
 *
 *   node /app/diag-sp-backlog-arm.js                (whole database)
 *   node /app/diag-sp-backlog-arm.js CPO BONTANG    (one slice)
 *
 * WHY THIS SCRIPT EXISTS, AND WHY IT COMES FIRST.
 *
 * The first attempt at this arm shipped straight to production and failed with
 * `column l.b2b_flag_raw does not exist`. Because the new query sat in refreshShippingPerformanceRows
 * with no guard, the failure took the whole Shipping Performance page down rather than just the new
 * arm - and it was reverted minutes later.
 *
 * The cause is worth writing down: there are TWO different CTEs named `latest_spd_contract` in this
 * codebase.
 *
 *   shipment.controller.ts   projects SHIPMENT_LATEST_SPD_COLUMNS - b2b_flag_raw,
 *                            contract_reference_po_raw, effective_sto, contract_ext_no_raw,
 *                            discharge_destination
 *   shippingPerformance      projects the same values WITHOUT the `_raw` suffix
 *
 * contractBacklogCoreWhereSql was written against the first. Handing it the second is a name that
 * matches and a shape that does not. prePlannedManualEligibilitySql, its only other caller, joins
 * the first - which is what I should have read before assuming.
 *
 * Five unit tests were green when this failed. Every one of them asserted on the SQL string, and a
 * correct string proves nothing about whether the query runs. This script is the missing check.
 */
const connection = require('/app/dist/database/connection');
const { contractBacklogCoreWhereSql, sqlBacklogRemainingOsJoinExpr } = require('/app/dist/utils/shipmentUnplannedHybridSql');
const { sqlRegionSiteDisplayForContract } = require('/app/dist/utils/regionSiteSql');

const PRODUCT = (process.argv[2] || '').trim().toUpperCase();
const SITE = (process.argv[3] || '').trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * The CTE shape contractBacklogCoreWhereSql actually needs: the `_raw` columns, which migration 161
 * put directly on contract_latest_spd_snapshot. Selected explicitly rather than with * so a column
 * rename fails loudly here instead of silently changing what the rule reads.
 */
const LATEST_SPD_CONTRACT_CTE = `
  latest_spd_contract AS (
    SELECT contract_number,
           effective_sto,
           b2b_flag_raw,
           contract_reference_po_raw,
           contract_ext_no_raw,
           discharge_destination
    FROM contract_latest_spd_snapshot
    WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
  )`;

(async () => {
  const os = sqlBacklogRemainingOsJoinExpr();
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const params = [];
  const scope = [];
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
      WITH ${LATEST_SPD_CONTRACT_CTE}
      SELECT c.incoterm,
             COUNT(*)::int AS contracts,
             ROUND(SUM(${os}) / 1000)::int AS os_mt
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id
      WHERE ${contractBacklogCoreWhereSql('c', 'l')}
        AND (${os}) > 0
        ${scope.join('\n        ')}
      GROUP BY c.incoterm
      ORDER BY 3 DESC`, params)).rows;

    console.log('the backlog arm Shipping Performance does not yet have:');
    console.log('   incoterm   contracts           OS');
    let contracts = 0;
    let kg = 0;
    for (const r of rows) {
      contracts += Number(r.contracts);
      kg += Number(r.os_mt) * 1000;
      console.log('   ' + String(r.incoterm || '-').padEnd(11) + String(r.contracts).padStart(9) +
        String(Number(r.os_mt).toLocaleString('en-US')).padStart(13) + ' MT');
    }
    console.log('   ' + 'TOTAL'.padEnd(11) + String(contracts).padStart(9) + String(mt(kg)).padStart(13) + ' MT');

    console.log('\nThe query RAN. That is the point of this script - the previous attempt never did.');
    console.log('\nAfter the change, verify exactly this:');
    console.log('   - Shipping Performance outstanding rises by this figure, no more');
    console.log('   - every average delay figure is UNCHANGED to the decimal. These contracts have');
    console.log('     no vessel and no dates, so counting them in a sum/rowCount average would');
    console.log('     shrink every delay simply because something has not been planned yet');
    console.log('   - Total Vessels is UNCHANGED, for the same reason');
  } catch (err) {
    // Never print the generated SQL - the connection logger already tried, and it is hundreds of KB.
    console.log(`the query FAILED: ${String(err.message).slice(0, 200)}`);
    console.log('Do not deploy the arm until this prints numbers.');
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
