/*
 * READ-ONLY: do the pages still agree with each other?
 *
 *   node /app/diag-cross-page-invariants.cjs                 (whole database, YTD)
 *   node /app/diag-cross-page-invariants.cjs CPO BONTANG     (one slice)
 *   node /app/diag-cross-page-invariants.cjs CPO BONTANG 2026-01-01 2026-09-21
 *
 * WHY THIS EXISTS. Every discrepancy chased on 2026-09-18 and 09-21 had one shape: one rule with
 * two spellings. Closing one page's number bent another's, and nobody found out until someone
 * opened the other page days later. Shipments and Contract Performance agreed before that work
 * and did not after it - which is exactly what this is meant to catch in one run, before a deploy.
 *
 * IT CALLS THE PAGES' OWN CODE. runShippingPerformance and loadLatePerformanceRows are the real
 * entry points, not reproductions. Copying a page's query to measure it has produced a confidently
 * wrong answer here four separate times: the backlog formula standing in for the execution one
 * (reported 5,162 MT against a real 1,661), an even split of a merged row across its contracts
 * (ten contracts "over" by the same few values - the split showing through, not the data), "has a
 * shipment" standing in for "is at an active stage", and a group key compared against itself.
 *
 * WHAT IT CANNOT PROVE, stated rather than faked: the Shipments OS card. Its entry point
 * loadShipmentOutstandingQtyForRequest needs the shipmentBaseCteSql the controller assembles, so
 * it cannot be called alone. That figure is read off the page - and this prints what it should
 * equal.
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
  runShippingPerformance,
  invalidateShippingPerformanceRowCache,
} = load('services/shippingPerformance.service');
const {
  parseLatePerformanceFilters,
  loadLatePerformanceRows,
} = load('services/latePerformance.service');
const {
  sqlBacklogRemainingOsJoinExpr,
  unplannedContractBacklogBaseWhereSql,
  preplannedContractBacklogBaseWhereSql,
} = load('utils/shipmentUnplannedHybridSql');
const { sqlRegionSiteDisplayForContract } = load('utils/regionSiteSql');
const { isShipmentPageSeaIncoterm } = load('utils/shipmentIncotermScope');
const {
  shippingPerfOutstandingQtyKgForAggregate,
} = load('utils/shippingPerformanceOutstandingAgg');

const PRODUCT = (process.argv[2] || '').trim().toUpperCase();
const SITE = (process.argv[3] || '').trim().toUpperCase();
const DATE_FROM = (process.argv[4] || new Date().getFullYear() + '-01-01').trim();
const DATE_TO = (process.argv[5] || new Date().toISOString().slice(0, 10)).trim();

const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const up = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
const inScope = (r) =>
  (!PRODUCT || up(r.product).indexOf(PRODUCT) >= 0) && (!SITE || up(r.plant_site) === SITE);

const LATEST_SPD_CTE =
  ' latest_spd_contract AS (' +
  '   SELECT contract_number, effective_sto, b2b_flag_raw, contract_reference_po_raw,' +
  '          contract_ext_no_raw, discharge_destination' +
  '   FROM contract_latest_spd_snapshot' +
  "   WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''" +
  ' )';

/** Anything under a tonne is rounding, not drift. */
const TOLERANCE_KG = 1000;

(async () => {
  console.log('scope: ' + (PRODUCT || 'all products') + ' / ' + (SITE || 'all sites') +
    ' / ' + DATE_FROM + '..' + DATE_TO);

  // ---- Shipping Performance, through its own entry point ------------------------------------
  invalidateShippingPerformanceRowCache();
  const req = { query: { scope: 'ytd', dateFrom: DATE_FROM, dateTo: DATE_TO } };
  const started = Date.now();
  const sp = await runShippingPerformance(req, 'rows');
  const spRows = sp.rows.filter(inScope);
  const spOnGoing = spRows.filter(
    (r) =>
      r.is_unplanned_backlog === true ||
      (up(r.status) !== 'COMPLETED' &&
        up(r.status) !== 'CANCELLED' &&
        up(r.status) !== '' &&
        up(r.status) !== 'UNPLANNED'),
  );
  const spBacklogKg = spRows
    .filter((r) => r.is_unplanned_backlog === true)
    .reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  const spKg = spOnGoing.reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
  console.log('   (Shipping Performance resolved in ' +
    ((Date.now() - started) / 1000).toFixed(1) + 's)');

  // ---- Contract Performance, through its own entry point ------------------------------------
  let cpKg = null;
  try {
    const cpFilters = parseLatePerformanceFilters(
      { query: { dateFrom: DATE_FROM, dateTo: DATE_TO } },
      'rows',
    );
    /*
     * Sea incoterms only. Contract Performance covers EVERY incoterm, Shipping Performance covers
     * CIF / CFR / FOB, and comparing the two whole was the script's first output: it reported
     * 75,477 MT of "DRIFT" that was simply trucking. A check that cries wolf gets ignored, and an
     * ignored check is worse than none - so the scopes are matched here with the page's own
     * predicate rather than a list written out again.
     */
    const cpRows = (await loadLatePerformanceRows(cpFilters))
      .filter(inScope)
      .filter((r) => isShipmentPageSeaIncoterm(r.incoterm));
    cpKg = cpRows.reduce((a, r) => a + (Number(r.outstanding_quantity) || 0), 0);
  } catch (err) {
    console.log('   Contract Performance could not be read: ' + String(err.message).slice(0, 140));
  }

  // ---- The Shipments BACKLOG arm - the one part that is a shared function --------------------
  const osExpr = sqlBacklogRemainingOsJoinExpr();
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const params = [DATE_FROM, DATE_TO];
  const scope = [];
  if (PRODUCT) {
    params.push(PRODUCT);
    scope.push("AND UPPER(TRIM(COALESCE(c.product, ''))) LIKE '%' || $" + params.length + " || '%'");
  }
  if (SITE) {
    params.push(SITE);
    scope.push('AND UPPER(TRIM(COALESCE((' + regionSite + "), ''))) = $" + params.length);
  }
  const arm = async (whereSql) => {
    const r = await connection.query(
      'WITH ' + LATEST_SPD_CTE +
      ' SELECT COALESCE(SUM(' + osExpr + '), 0)::numeric AS kg, COUNT(*)::int AS n' +
      ' FROM contracts c' +
      ' LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id' +
      ' LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id' +
      ' WHERE ' + whereSql +
      ' AND (' + osExpr + ') > 0' +
      ' AND c.contract_date >= $1 AND c.contract_date <= $2 ' +
      scope.join(' '),
      params,
    );
    return { kg: Number(r.rows[0].kg) || 0, n: Number(r.rows[0].n) || 0 };
  };

  let shipBacklogKg = null;
  try {
    const unplanned = await arm(unplannedContractBacklogBaseWhereSql('c', 'l'));
    const preplanned = await arm(preplannedContractBacklogBaseWhereSql('c', 'l'));
    shipBacklogKg = unplanned.kg + preplanned.kg;
    console.log('   (Shipments backlog: Unplanned ' + unplanned.n + ' rows, Preplanned ' +
      preplanned.n + ' rows)');
  } catch (err) {
    console.log('   Shipments backlog could not be read: ' + String(err.message).slice(0, 140));
  }

  // ---- The report ---------------------------------------------------------------------------
  const line = (label, kg, note) =>
    console.log('   ' + label.padEnd(42) +
      (kg === null ? '-' : mt(kg) + ' MT').padStart(13) + (note ? '   ' + note : ''));
  const verdict = (a, b) =>
    Math.abs(a - b) < TOLERANCE_KG ? 'OK    ' + mt(a - b) + ' MT' : 'DRIFT ' + mt(a - b) + ' MT';

  console.log('');
  console.log('OUTSTANDING, same scope, page by page:');
  line('Shipping Performance (On Going)', spKg);
  line('Contract Performance (sea incoterms)', cpKg);
  line('Shipments', null, '<- read it off the page, see INVARIANT 3');

  console.log('');
  console.log('INVARIANT 1 - the backlog arm. Both pages call contractBacklogCoreWhereSql, the');
  console.log('SAME function, so a difference here can only be scope or period, never a rule.');
  if (shipBacklogKg !== null) {
    line('   Shipping Performance backlog', spBacklogKg);
    line('   Shipments Unplanned + Preplanned', shipBacklogKg);
    console.log('   ' + verdict(spBacklogKg, shipBacklogKg));
  }

  console.log('');
  console.log('INVARIANT 2 - Shipping Performance against Contract Performance.');
  if (cpKg !== null) {
    console.log('   ' + verdict(spKg, cpKg));
    console.log('   Contract Performance is the agreed reference (see the OS sections in the');
    console.log('   README). If this drifts, the page that moved is the one to look at.');
  }

  console.log('');
  console.log('INVARIANT 3 - Shipments, which cannot be called on its own.');
  console.log('   loadShipmentOutstandingQtyForRequest needs the shipmentBaseCteSql the controller');
  console.log('   assembles, and reproducing that has produced a wrong answer four times. Open');
  console.log('   Shipments with the same filters and compare its Outstanding Qty with the two');
  console.log('   figures above. All three should agree.');

  console.log('');
  console.log('Run this BEFORE a deploy that touches outstanding, not after.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
