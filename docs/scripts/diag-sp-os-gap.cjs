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
const {
  parseShippingPerfContractDateList,
  shippingPerfRowMatchesContractDateRange,
} = load('services/shippingPerformance.service');

const PRODUCT = (process.argv[2] || 'CPO').trim().toUpperCase();
const SITE = (process.argv[3] || 'BONTANG').trim().toUpperCase();
// Both pages default to YTD and both filter contract_date, so compare on the same period.
const YEAR_START = new Date().getFullYear() + '-01-01';
const DATE_FROM = (process.argv[4] || YEAR_START).trim();
const DATE_TO = (process.argv[5] || new Date().toISOString().slice(0, 10)).trim();
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

  /*
   * A WATERFALL, because the first version of this script reported 97,607 MT for a slice the page
   * itself shows as 75,876 - a 21,731 MT disagreement between the measurement and the thing being
   * measured, which is larger than the gap it was written to explain. Guessing which filter
   * accounts for it would have been the third wrong hypothesis in a day; this prints every step so
   * one run names it.
   *
   * The steps are the page's own pipeline, in order:
   *   sap_presence WITHDRAWN  - runShippingPerformance drops these from the cards and the tree
   *                             (the table keeps them on purpose, so their history stays reachable)
   *   CANCELLED               - shippingPerfRowMatchesCard excludes them from every card
   *   UNPLANNED not backlog   - excludeUnplannedShippingRows, the page's Step A
   *   exact vs substring      - this script matched the site and product as SUBSTRINGS; the page
   *                             matches normalised whole values, so 'BONTANG' here also swept up
   *                             anything merely containing it
   */
  const step = (label, keep) => {
    const before = rows.length;
    const beforeKg = rows.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
    const kept = rows.filter(keep);
    const afterKg = kept.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
    console.log('   ' + label.padEnd(34) + String(kept.length).padStart(5) + ' rows  ' +
      (mt(afterKg) + ' MT').padStart(13) + '   (removed ' + (before - kept.length) + ' rows, ' +
      mt(beforeKg - afterKg) + ' MT)');
    return kept;
  };

  console.log('');
  console.log('the page pipeline, step by step:');
  console.log('   ' + 'everything in this slice'.padEnd(34) + String(rows.length).padStart(5) + ' rows  ' +
    (mt(rows.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0)) + ' MT').padStart(13));
  let cur = rows;
  const chain = [
    ['drop sap_presence WITHDRAWN', (r) => up(r.sap_presence || 'PRESENT') !== 'WITHDRAWN'],
    ['drop CANCELLED', (r) => up(r.status) !== 'CANCELLED' && up(r.status) !== 'CANCELED'],
    ['drop UNPLANNED that is not backlog', (r) => r.is_unplanned_backlog === true || up(r.status) !== 'UNPLANNED'],
    ['site matched exactly, not substring', (r) => up(r.plant_site) === SITE],
    ['product matched exactly', (r) => up(r.product) === PRODUCT],
  ];
  for (const [label, keep] of chain) {
    const prev = cur;
    cur = (() => {
      const before = prev.length;
      const beforeKg = prev.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
      const kept = prev.filter(keep);
      const afterKg = kept.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
      console.log('   ' + label.padEnd(34) + String(kept.length).padStart(5) + ' rows  ' +
        (mt(afterKg) + ' MT').padStart(13) + '   (-' + (before - kept.length) + ' rows, -' +
        mt(beforeKg - afterKg) + ' MT)');
      return kept;
    })();
  }
  console.log('   ^ the step where this lands on the figure your screen shows is the answer.');

  /*
   * The Performance Period, which none of the steps above model. The page filters on contract_date
   * and a merged STO row can carry SEVERAL dates, so this uses the service's own parser rather
   * than reading the field as one date. If the screen figure appears against one year here, the
   * script was simply measuring a wider period than the screen - not a defect in either page.
   */
  const byYear = new Map();
  for (const r of rows) {
    const dates = parseShippingPerfContractDateList(r.contract_date);
    const years = dates.length ? [...new Set(dates.map((d) => String(d).slice(0, 4)))] : ['(no date)'];
    const kg = shippingPerfOutstandingQtyKgForAggregate(r);
    for (const y of years) {
      const acc = byYear.get(y) ?? { rows: 0, kg: 0 };
      acc.rows += 1;
      // A row spanning two years is counted once in each, exactly as a period filter would keep it.
      acc.kg += kg;
      byYear.set(y, acc);
    }
  }
  console.log('');
  console.log('by contract_date year (the Performance Period filter):');
  for (const [y, acc] of [...byYear.entries()].sort()) {
    console.log('   ' + String(y).padEnd(12) + String(acc.rows).padStart(5) + ' rows  ' +
      (mt(acc.kg) + ' MT').padStart(13));
  }
  console.log('   (a row carrying dates in two years appears under both, as the filter would keep it)');

  /*
   * The period as the page actually applies it, through the service's own matcher.
   *
   * And the divergence this exposes. Shipments filters in SQL on ONE c.contract_date per contract.
   * Shipping Performance filters in JS on a MERGED STO row whose contract_date can be a list of
   * dates, keeping the row if ANY of them falls in range - so a row spanning a 2025 contract and a
   * 2026 one is kept WHOLE here and only partly there. Same root as everything else in this file:
   * an STO grain against a contract grain.
   */
  const inPeriod = rows.filter((r) => shippingPerfRowMatchesContractDateRange(r.contract_date, DATE_FROM, DATE_TO));
  const inPeriodKg = inPeriod.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  console.log('');
  console.log('period as the page applies it (' + DATE_FROM + ' .. ' + DATE_TO + '):');
  console.log('   ' + String(inPeriod.length).padStart(5) + ' rows  ' + (mt(inPeriodKg) + ' MT').padStart(13) +
    '   <- compare THIS with the Shipping Performance screen');

  const straddling = inPeriod.filter((r) => {
    const dates = parseShippingPerfContractDateList(r.contract_date);
    if (dates.length < 2) return false;
    const inside = dates.filter((d) => d >= DATE_FROM && d <= DATE_TO).length;
    return inside > 0 && inside < dates.length;
  });
  const straddlingKg = straddling.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  console.log('   of those, rows whose dates STRADDLE the period boundary: ' + straddling.length);
  console.log('   they carry ' + mt(straddlingKg) + ' MT, counted WHOLE here and only partly by Shipments');
  console.log('   (an upper bound on how much of the remaining gap is the any-date rule)');

  /*
   * THE THREE SURFACES, all within the period above, because "the Shipping Performance number" is
   * not one number and reading the wrong one sends the search somewhere else entirely.
   *
   *   Section 1  buildPerVesselSummary / buildCardSummary - every countable row
   *   drilldown  matchesPerfDrilldownRow - drops COMPLETED and drops outstanding <= 0
   *   table      the raw per-row column, no apportionment
   *
   * A claim repeated in this repo - including by an earlier version of this script - is that the
   * "outstanding <= 0" half of the drilldown filter cannot move a total, because a zero adds
   * nothing. Measured, that is FALSE, and the reason is a field mismatch:
   *
   *   matchesPerfDrilldownRow  tests outstanding_qty_actual ?? outstanding_qty   (STO level)
   *   the sum                  uses  outstanding_qty_aggregate when present      (PO level)
   *
   * So a row whose own STO has nothing left, on a PO that still has outstanding, is DROPPED by the
   * drilldown while contributing a positive figure to Section 1. On dev that is 3,954 of the
   * 7,155 MT between them - more than the COMPLETED rows everyone assumed was the whole story.
   */
  const drill = inPeriod.filter((r) => up(r.status) !== 'COMPLETED' && raw(r) > 0);
  const drillKg = drill.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  const completedInPeriod = inPeriod.filter((r) => up(r.status) === 'COMPLETED' && raw(r) > 0);
  const completedKg = completedInPeriod.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  console.log('');
  console.log('the three Shipping Performance surfaces, same period:');
  console.log('   Section 1 (cards)      ' + String(inPeriod.length).padStart(5) + ' rows  ' + (mt(inPeriodKg) + ' MT').padStart(13));
  console.log('   drilldown              ' + String(drill.length).padStart(5) + ' rows  ' + (mt(drillKg) + ' MT').padStart(13));
  console.log('   table (raw per row)    ' + String(inPeriod.length).padStart(5) + ' rows  ' +
    (mt(inPeriod.reduce((a, r) => a + raw(r), 0)) + ' MT').padStart(13));
  const zeroRawPositiveAgg = inPeriod.filter(
    (r) => raw(r) <= 0 && shippingPerfOutstandingQtyKgForAggregate(r) > 0,
  );
  const zeroRawKg = zeroRawPositiveAgg.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  console.log('   Section 1 - drilldown = ' + mt(inPeriodKg - drillKg) + ' MT, and it is TWO causes:');
  console.log('      COMPLETED still carrying outstanding : ' + String(completedInPeriod.length).padStart(4) +
    ' rows  ' + (mt(completedKg) + ' MT').padStart(13));
  console.log('      raw OS <= 0 but aggregate OS > 0     : ' + String(zeroRawPositiveAgg.length).padStart(4) +
    ' rows  ' + (mt(zeroRawKg) + ' MT').padStart(13) + '  <- the filter and the sum read DIFFERENT fields');
  console.log('   ^ NOTE: the frontend never fetches the backend tree - it builds its own from rows,');
  console.log('     with no COMPLETED/OS filter, so on screen the drilldown and Section 1 agree and');
  console.log('     the split above is between two BACKEND surfaces, one of which the UI never calls.');

  /*
   * THE CARDS, which is what a screen figure usually is. shippingPerfRowMatchesCard:
   *   all      everything
   *   close    status COMPLETED  - shows contract qty, not outstanding (Ryan, 2026-09-18)
   *   ongoing  not CANCELLED, not COMPLETED, status present and not UNPLANNED - plus the
   *            unplanned backlog, which is open work with no shipment yet
   */
  const cancelled = (r) => up(r.status) === 'CANCELLED' || up(r.status) === 'CANCELED';
  const cards = {
    All: inPeriod,
    'On Going': inPeriod.filter(
      (r) => !cancelled(r) && (r.is_unplanned_backlog === true ||
        (up(r.status) !== 'COMPLETED' && up(r.status) !== '' && up(r.status) !== 'UNPLANNED')),
    ),
    Close: inPeriod.filter((r) => !cancelled(r) && up(r.status) === 'COMPLETED'),
  };
  console.log('');
  console.log('the Section 1 cards, same period:');
  for (const [name, rs] of Object.entries(cards)) {
    console.log('   ' + name.padEnd(12) + String(rs.length).padStart(5) + ' rows  ' +
      (mt(rs.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0)) + ' MT').padStart(13));
  }
  console.log('   ^ find your screen figure here. That names the card, and the card names the rule.');

  /*
   * THE SAME POPULATIONS WITHOUT APPORTIONMENT.
   *
   * Shipments computes outstanding PER CONTRACT (sqlShipmentExecutionOsPerContractCtes) and does
   * not divide. Shipping Performance sums per STO row and divides by po_sto_count. And Shipments
   * already excludes COMPLETED - sqlShipmentOutstandingActiveStagePredicate allows only
   * PLANNED..UNLOADING - so COMPLETED is NOT the difference, which is worth stating because the
   * first reading of these numbers said it was.
   *
   * If a raw figure below lands on the Shipments number, the gap is the division and nothing is
   * missing from either page.
   */
  const rawOf = (rs) => rs.reduce((a, r) => a + raw(r), 0);
  console.log('');
  console.log('the same populations, apportioned vs raw:');
  const pops = [['card All', cards.All], ['card On Going', cards['On Going']], ['drilldown', drill]];
  for (const [name, rs] of pops) {
    const ap = rs.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
    console.log('   ' + name.padEnd(16) + 'apportioned ' + (mt(ap) + ' MT').padStart(12) +
      '   raw ' + (mt(rawOf(rs)) + ' MT').padStart(12) +
      '   diff ' + (mt(rawOf(rs) - ap) + ' MT').padStart(11));
  }
  console.log('   ^ compare the RAW column with the Shipments figure.');

  /*
   * THE STO ROWS THAT ARE CLOSED BUT SIT ON THE ON GOING CARD.
   *
   * Card membership reads row.status - the SHIPMENT status. The row also carries import_status,
   * the per-STO Open/Close state from perf_sto_status, and the two can disagree: an STO whose SAP
   * import status is CLOSE/CLOSED/COMPLETED while its shipment has not been stamped COMPLETED.
   * Those rows land on On Going and bring their outstanding with them, which is exactly what
   * "baris STO yang completed harusnya masuk ke card completed bukan Open" describes.
   */
  const CLOSED = new Set(['CLOSE', 'CLOSED', 'COMPLETED', 'COMPLETE']);
  const closedButOngoing = cards['On Going'].filter((r) => CLOSED.has(up(r.import_status)));
  const closedButOngoingKg = closedButOngoing.reduce(
    (a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0,
  );
  console.log('');
  console.log('STO rows on On Going whose per-STO import_status is already closed:');
  console.log('   ' + String(closedButOngoing.length).padStart(5) + ' rows  ' +
    (mt(closedButOngoingKg) + ' MT').padStart(13) + '   <- would move to Close');
  console.log('   On Going after moving them: ' +
    mt(cards['On Going'].reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0) - closedButOngoingKg) + ' MT');
  const seen = new Map();
  for (const r of cards['On Going']) {
    const k = up(r.import_status) || '(blank)';
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  console.log('   import_status seen on On Going: ' +
    [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ':' + n).join('  '));
  void step;

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
