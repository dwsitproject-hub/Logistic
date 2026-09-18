/*
 * READ-ONLY: why Shipping Performance and Shipments report different outstanding for the same
 * product and site, decomposed by cause.
 *
 *   node /app/diag-sp-vs-shipments-os.js                 (defaults to CPO / BONTANG)
 *   node /app/diag-sp-vs-shipments-os.js "CPO" "BONTANG"
 *
 * Reported case: CPO / Bontang reads 49,107 MT on Shipping Performance and 80,939 MT on Shipments,
 * a gap of 31,832 MT.
 *
 * TWO CANDIDATE CAUSES, and reading the code has already settled one of them:
 *
 *   MEMBERSHIP. Shipments counts two arms - shipments that exist, AND contracts that have no
 *   shipment at all. Shipping Performance is built from shipments, so the second arm cannot appear
 *   there however the numbers are computed. This script measures that arm directly.
 *
 *   THE SITE FILTER ITSELF - eliminated for this case, but worth recording. The two pages derive
 *   "site" differently: Shipping Performance takes the raw discharge destination
 *   (COALESCE(b2b_end, sa, l) ... 'Blank'), while the Shipments Region/Site filter runs it through
 *   sqlNormalizeDischargeDestination first. So the same contract can sit under two different sites
 *   on the two pages. The alias map holds exactly one entry - KIJING -> TANJUNG PURA - so it cannot
 *   affect Bontang, but it will affect Tanjung Pura, and this script prints the overlap so that
 *   shows up rather than being assumed away.
 *
 * Deliberately does NOT reproduce the Shipments page query. That query is enormous and copying it
 * would mean measuring my copy rather than the page. Instead it takes the Shipping Performance
 * rowset as given and asks what exists OUTSIDE it, which is the question that matters.
 */
const connection = require('/app/dist/database/connection');
const {
  buildShippingPerformanceSql,
  aggregateShippingPerformanceRowsBySto,
} = require('/app/dist/services/shippingPerformance.service');
const { sumShippingPerfOutstandingQtyKg } = require('/app/dist/utils/shippingPerformanceOutstandingAgg');
const { sqlContractGlobalOutstandingExpr, buildQtyMoveCte } = require('/app/dist/utils/contractGlobalOutstandingSql');
const { sqlRegionSiteDisplayForContract } = require('/app/dist/utils/regionSiteSql');

const PRODUCT = (process.argv[2] || 'CPO').trim().toUpperCase();
const SITE = (process.argv[3] || 'BONTANG').trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const up = (v) => String(v ?? '').trim().toUpperCase();

(async () => {
  console.log(`scope: product ${PRODUCT}, site ${SITE}\n`);
  console.log('running the Shipping Performance query...');
  const all = aggregateShippingPerformanceRowsBySto(
    (await connection.query(await buildShippingPerformanceSql())).rows,
  );
  const inScope = all.filter(
    (r) => up(r.product).includes(PRODUCT) && up(r.plant_site).includes(SITE),
  );
  const spTotal = sumShippingPerfOutstandingQtyKg(inScope);
  const spContracts = new Set();
  for (const r of inScope) {
    for (const cn of String(r.contract_number ?? '').split(/\s*,\s*/)) {
      if (cn.trim()) spContracts.add(cn.trim());
    }
  }

  console.log(`\nA. Shipping Performance, ${PRODUCT} / ${SITE}:`);
  console.log(`   rows      : ${inScope.length}`);
  console.log(`   contracts : ${spContracts.size}`);
  console.log(`   outstanding (apportioned) : ${mt(spTotal)} MT`);

  // B. Contracts in the same product/site that Shipping Performance has no row for. These are what
  //    the Shipments page counts through its backlog arm and Shipping Performance structurally
  //    cannot show. Region/Site here is the Shipments page's own expression, not SP's.
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const os = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const known = [...spContracts];
  const outside = (await connection.query(`
    WITH ${buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' })}
    SELECT c.contract_id, c.incoterm, c.product,
           ROUND(COALESCE(c.quantity_ordered, 0) / 1000, 1) AS ordered_mt,
           ROUND(GREATEST((${os}), 0) / 1000, 1) AS os_mt,
           (SELECT COUNT(*) FROM shipments sh
             WHERE sh.contract_id = c.id AND COALESCE(sh.status, '') <> 'CANCELLED') AS shipment_rows
    FROM contracts c
    WHERE UPPER(TRIM(COALESCE(c.product, ''))) LIKE '%' || $1 || '%'
      AND UPPER(TRIM(COALESCE((${regionSite}), ''))) LIKE '%' || $2 || '%'
      AND NOT (c.contract_id = ANY($3::text[]))
      AND GREATEST((${os}), 0) > 0
    ORDER BY (${os}) DESC`, [PRODUCT, SITE, known]).catch((e) => {
    console.log(`   (contract-side query failed: ${e.message})`);
    return { rows: null };
  }));

  if (outside.rows) {
    const rows = outside.rows;
    const total = rows.reduce((a, r) => a + Number(r.os_mt || 0), 0) * 1000;
    const noShipment = rows.filter((r) => Number(r.shipment_rows) === 0);
    const withShipment = rows.filter((r) => Number(r.shipment_rows) > 0);
    console.log(`\nB. contracts in the same product/site that Shipping Performance has NO row for:`);
    console.log(`   contracts : ${rows.length}`);
    console.log(`   outstanding : ${mt(total)} MT`);
    console.log(`   of those, with no shipment at all : ${noShipment.length} contracts, ` +
      `${mt(noShipment.reduce((a, r) => a + Number(r.os_mt || 0), 0) * 1000)} MT  <- the backlog arm`);
    console.log(`   of those, WITH a shipment         : ${withShipment.length} contracts, ` +
      `${mt(withShipment.reduce((a, r) => a + Number(r.os_mt || 0), 0) * 1000)} MT  <- these need explaining`);

    console.log(`\n   Shipping Performance ${mt(spTotal)} + outside ${mt(total)} = ${mt(spTotal + total)} MT`);
    console.log('   (compare that with what the Shipments page shows for the same filter)');

    console.log(`\nC. the largest contracts outside Shipping Performance (top 15):`);
    console.log('   contract      inc    product          ordered      OS   shipments');
    for (const r of rows.slice(0, 15)) {
      console.log('   ' + String(r.contract_id).padEnd(14) + String(r.incoterm || '-').padEnd(7) +
        String(r.product || '-').slice(0, 16).padEnd(17) +
        String(r.ordered_mt).padStart(8) + String(r.os_mt).padStart(8) +
        String(r.shipment_rows).padStart(11));
    }
  }

  console.log('\nRead B first. A contract with no shipment at all cannot appear on a page built');
  console.log('from shipments, so that line is a definition difference rather than a fault. The');
  console.log('line below it - contracts that DO have a shipment yet are missing from Shipping');
  console.log('Performance - is the one that would be a real gap.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
