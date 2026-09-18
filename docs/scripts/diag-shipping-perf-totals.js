/*
 * READ-ONLY: do Shipping Performance's three surfaces agree, and if not, by how much and why.
 *
 *   node /app/diag-shipping-perf-totals.js
 *
 * The three surfaces are all served by runShippingPerformance from ONE rowset, so any difference
 * is introduced after the query rather than by three different queries:
 *
 *   rows     (view table)  returns filteredRows            - KEEPS sap_presence = WITHDRAWN
 *   summary  (Section 1)   buildPerVesselSummary(countable) - DROPS WITHDRAWN, qty apportioned
 *   tree     (drilldown)   buildPerfTree(countable)         - DROPS WITHDRAWN, qty apportioned
 *
 * Two structural differences follow from that, and this script measures each separately rather
 * than reporting one lump:
 *
 *   1. WITHDRAWN rows. The table shows them on purpose - the comment in the service says their
 *      history must stay reachable - and the aggregates drop them because a cancelled PO can never
 *      complete and would skew every average. So the table is higher by exactly their quantity.
 *
 *   2. Apportionment. The aggregates use shippingPerfOutstandingQtyKgForAggregate, which divides a
 *      row by po_sto_count when one PO carries several STOs. The table column is the raw
 *      per-row outstanding. Summing the table column therefore counts a multi-STO PO once per STO.
 *
 * Reproduces the service exactly: buildShippingPerformanceSql + aggregateShippingPerformanceRowsBySto,
 * then the same exported aggregate helper the cards and the tree both call. No date filter is
 * applied - the three surfaces must agree at every filter, so a global run is enough to find a
 * structural cause, and a filtered one would only make the numbers harder to compare to a screen.
 */
const connection = require('/app/dist/database/connection');
const {
  buildShippingPerformanceSql,
  aggregateShippingPerformanceRowsBySto,
} = require('/app/dist/services/shippingPerformance.service');
const {
  shippingPerfOutstandingQtyKgForAggregate,
  sumShippingPerfOutstandingQtyKg,
} = require('/app/dist/utils/shippingPerformanceOutstandingAgg');

const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const raw = (row) => Number(row.outstanding_qty ?? row.outstanding_qty_actual ?? 0) || 0;

// Mirrors frontend/src/lib/sapDisplayValue.ts + shippingPerformanceSummaryCounts.ts. The By Vessel
// table drops rows whose vessel is one of these placeholders - "groups named ships only" - so they
// are counted by Section 1 and absent from that table.
const SAP_EMPTY = new Set(['unknown', 'blank', 'null', 'undefined', 'n/a', 'na', 'none', '-', '—']);
const isCountableVessel = (v) => {
  if (v === null || v === undefined) return false;
  const t = String(v).trim();
  return t !== '' && !SAP_EMPTY.has(t.toLowerCase());
};

(async () => {
  console.log('running the Shipping Performance query (cold path, one pass)...');
  const result = await connection.query(await buildShippingPerformanceSql());
  const rows = aggregateShippingPerformanceRowsBySto(result.rows);

  const withdrawn = rows.filter((r) => String(r.sap_presence ?? 'PRESENT') === 'WITHDRAWN');
  const countable = rows.filter((r) => String(r.sap_presence ?? 'PRESENT') !== 'WITHDRAWN');

  const tableTotal = rows.reduce((a, r) => a + raw(r), 0);
  const aggTotal = sumShippingPerfOutstandingQtyKg(countable);
  const countableRawTotal = countable.reduce((a, r) => a + raw(r), 0);
  const withdrawnRawTotal = withdrawn.reduce((a, r) => a + raw(r), 0);

  console.log(`\nrows after STO aggregation: ${rows.length}  (withdrawn ${withdrawn.length}, countable ${countable.length})`);

  // The By Vessel table is a THIRD set: aggregateByVessel skips rows whose vessel_name is a
  // placeholder ("groups named ships only; unnamed STOs stay in All Shipments view"), and it sums
  // through the same apportioned helper. So it differs from Section 1 by membership, not by maths.
  const named = countable.filter((r) => isCountableVessel(r.vessel_name));
  const unnamed = countable.filter((r) => !isCountableVessel(r.vessel_name));
  const byVesselTotal = sumShippingPerfOutstandingQtyKg(named);

  console.log('\nwhat each surface totals:');
  console.log(`   Section 1     (apportioned, all countable) : ${mt(aggTotal)} MT`);
  console.log(`   drilldown     (same input, same helper)    : ${mt(aggTotal)} MT  <- identical by construction`);
  console.log(`   By Vessel     (apportioned, named ships)   : ${mt(byVesselTotal)} MT`);
  console.log(`   All Shipments (raw per row, everything)    : ${mt(tableTotal)} MT`);
  console.log(`\n   Section 1 - By Vessel = ${mt(aggTotal - byVesselTotal)} MT across ${unnamed.length} rows with no named vessel`);

  console.log('\nthe difference, decomposed:');
  console.log(`   withdrawn rows the table keeps       : ${mt(withdrawnRawTotal)} MT  (${withdrawn.length} rows)`);
  console.log(`   apportionment on the countable rows  : ${mt(countableRawTotal - aggTotal)} MT`);
  console.log(`   ------------------------------------------------------`);
  console.log(`   accounted for                        : ${mt(withdrawnRawTotal + (countableRawTotal - aggTotal))} MT`);
  console.log(`   actual gap (table - Section 1)       : ${mt(tableTotal - aggTotal)} MT`);
  console.log('   (if those last two differ, there is a THIRD cause and it is worth finding)');

  // Section 1 and the drilldown consume identical input through the identical helper, so they can
  // only diverge if one of them drops rows while grouping - a null product, plant, incoterm or
  // vessel key. Count what would land in a blank bucket.
  const blank = (v) => v === null || v === undefined || String(v).trim() === '';
  const blankKeyed = countable.filter(
    (r) => blank(r.product) || blank(r.plant_site) || blank(r.incoterm) || blank(r.vessel_name),
  );
  console.log(`\nrows with a blank grouping key (product/plant/incoterm/vessel): ${blankKeyed.length}`);
  console.log(`   their quantity: ${mt(sumShippingPerfOutstandingQtyKg(blankKeyed))} MT`);
  console.log('   (Section 1 sums them; the drilldown can only show them under a blank node.');
  console.log('    If the tree hides blank nodes, this is the amount the drilldown would lose.)');

  // How much of the apportionment gap is real multi-STO POs, for context.
  const multi = countable.filter((r) => Number(r.po_sto_count ?? 1) > 1);
  console.log(`\nrows on a PO carrying several STOs: ${multi.length}`);
  console.log(`   raw         : ${mt(multi.reduce((a, r) => a + raw(r), 0))} MT`);
  console.log(`   apportioned : ${mt(sumShippingPerfOutstandingQtyKg(multi))} MT`);
  console.log('   (the table counts these once per STO; the aggregates divide them)');

  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
