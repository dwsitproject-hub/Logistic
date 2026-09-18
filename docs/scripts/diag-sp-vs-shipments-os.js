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

  // B. Contracts in the same product/site that Shipping Performance has no row for.
  //
  //    Outstanding comes straight from contract_qty_move_snapshot rather than through
  //    sqlContractGlobalOutstandingExpr. That expression needs the qty_move CTE spliced in around
  //    it, and an earlier version of this script asked for it without defining the scope CTE it
  //    depends on: the query died with 42P01 and the connection logger printed several hundred KB
  //    of generated SQL to the terminal. The snapshot holds the same figures, keyed by contract
  //    number, and needs nothing around it.
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const known = [...spContracts];
  let outside = null;
  try {
    outside = (await connection.query(`
      SELECT c.contract_id, c.incoterm, c.product,
             ROUND(COALESCE(c.quantity_ordered, 0) / 1000, 1) AS ordered_mt,
             ROUND(GREATEST(
               COALESCE(c.quantity_ordered, 0) - CASE
                 WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) = 'FOB' THEN COALESCE(qms.quantity_delivery, 0)
                 ELSE COALESCE(qms.quantity_receive, 0)
               END, 0) / 1000, 1) AS os_mt,
             (SELECT COUNT(*) FROM shipments sh
               WHERE sh.contract_id = c.id AND COALESCE(sh.status, '') <> 'CANCELLED') AS shipment_rows
      FROM contracts c
      LEFT JOIN contract_qty_move_snapshot qms ON qms.contract_number = c.contract_id
      WHERE UPPER(TRIM(COALESCE(c.product, ''))) LIKE '%' || $1 || '%'
        AND UPPER(TRIM(COALESCE((${regionSite}), ''))) LIKE '%' || $2 || '%'
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF', 'CFR')
        AND NOT (c.contract_id = ANY($3::text[]))
      ORDER BY 5 DESC`, [PRODUCT, SITE, known])).rows;
  } catch (err) {
    // Never let a failure print the generated SQL - the message alone is the useful part.
    console.log(`\nB. could not be measured: ${String(err.message).slice(0, 200)}`);
  }

  if (outside) {
    const rows = outside.filter((r) => Number(r.os_mt) > 0);
    const kg = (rs) => rs.reduce((a, r) => a + Number(r.os_mt || 0), 0) * 1000;
    const noShipment = rows.filter((r) => Number(r.shipment_rows) === 0);
    const withShipment = rows.filter((r) => Number(r.shipment_rows) > 0);
    console.log(`\nB. contracts in the same product/site with NO Shipping Performance row:`);
    console.log(`   contracts   : ${rows.length}`);
    console.log(`   outstanding : ${mt(kg(rows))} MT`);
    console.log(`   no shipment at all : ${noShipment.length} contracts, ${mt(kg(noShipment))} MT  <- the backlog arm`);
    console.log(`   HAS a shipment     : ${withShipment.length} contracts, ${mt(kg(withShipment))} MT  <- this one needs explaining`);
    console.log(`\n   Shipping Performance ${mt(spTotal)} + outside ${mt(kg(rows))} = ${mt(spTotal + kg(rows))} MT`);

    console.log(`\nC. largest contracts outside Shipping Performance (top 15):`);
    console.log('   contract      inc    product          ordered      OS   shipments');
    for (const r of rows.slice(0, 15)) {
      console.log('   ' + String(r.contract_id).padEnd(14) + String(r.incoterm || '-').padEnd(7) +
        String(r.product || '-').slice(0, 16).padEnd(17) +
        String(r.ordered_mt).padStart(8) + String(r.os_mt).padStart(8) +
        String(r.shipment_rows).padStart(11));
    }
  }


  // D. The "HAS a shipment" contracts, split by the only two things that can explain them.
  //
  //    Either Shipping Performance has no row for the contract at all - which would be a real gap -
  //    or it HAS one, filed under a different product or site. The second is live: SP derives site
  //    from the raw discharge destination while the filter above uses the normalised Region/Site,
  //    so the same contract can sit under two different labels on the two pages.
  if (outside) {
    const byContract = new Map();
    for (const r of all) {
      for (const cn of String(r.contract_number ?? '').split(/,/)) {
        const k = cn.trim();
        if (!k) continue;
        if (!byContract.has(k)) byContract.set(k, []);
        byContract.get(k).push(r);
      }
    }
    const withShip = outside.filter((r) => Number(r.os_mt) > 0 && Number(r.shipment_rows) > 0);
    const elsewhere = [];
    const absent = [];
    for (const r of withShip) {
      (byContract.has(r.contract_id) ? elsewhere : absent).push(r);
    }
    console.log(`\nD. the ${withShip.length} contracts that HAVE a shipment but no row in this slice:`);
    console.log(`   present in Shipping Performance under another product/site : ${elsewhere.length}`);
    console.log(`   absent from Shipping Performance entirely                  : ${absent.length}   <- a real gap if non-zero`);
    for (const r of elsewhere) {
      const where = byContract.get(r.contract_id)
        .map((x) => `${String(x.product || '-')} / ${String(x.plant_site || '-')}`);
      console.log(`      ${r.contract_id}  filed under: ${[...new Set(where)].join(', ')}`);
    }
    for (const r of absent) {
      console.log(`      ${r.contract_id}  ${r.incoterm || '-'}  ${r.shipment_rows} shipment(s), ${r.os_mt} MT  - ABSENT`);
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
