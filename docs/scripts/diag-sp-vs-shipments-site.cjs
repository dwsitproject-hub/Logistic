/*
 * READ-ONLY: how many contracts would MOVE between Region/Site if Shipping Performance adopted the
 * Shipments rule for picking a discharge destination.
 *
 *   node /app/diag-sp-vs-shipments-site.js
 *
 * This is NOT the KIJING alias. That was measured and settled - both pages normalise, and the
 * database holds zero KIJING rows. What remains is that the two pages pick the destination from
 * different SOURCES, so the same contract can sit under two different sites with identical
 * normalisation:
 *
 *   Shipments (sqlRegionSiteRawForContract)
 *     b2b_ending_child_snapshot keyed by origin_po
 *     -> else the NEWEST sap_processed_data row for the CONTRACT
 *
 *   Shipping Performance (plant_site)
 *     b2b_end.discharge_destination
 *     -> else a PER-SHIPMENT SAP aggregate  <- the source Shipments has no equivalent of
 *     -> else the contract-level latest-SPD snapshot
 *
 * So a contract whose shipment carries a different destination from its contract-level one lands
 * in two places. That is the population this script counts, and where each row would move to.
 *
 * Deliberately does NOT reproduce either expression by hand. It runs the REAL Shipping Performance
 * query for one side and the REAL exported Shipments helper for the other. Copying a builder to
 * measure it means measuring the copy - that has already produced wrong answers here twice.
 *
 * COST: the Shipping Performance query is ~52s cold and has OOMed the database before now. This
 * runs it ONCE. Do not loop it.
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
const { sqlRegionSiteDisplayForContract } = load('utils/regionSiteSql');
const {
  shippingPerfOutstandingQtyKgForAggregate,
} = load('utils/shippingPerformanceOutstandingAgg');

const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const site = (v) => String(v ?? '').trim().toUpperCase() || 'BLANK';

(async () => {
  console.log('running the real Shipping Performance query (one pass, ~52s cold)...');
  const main = aggregateShippingPerformanceRowsBySto(
    (await connection.query(await buildShippingPerformanceSql())).rows,
  );

  let backlog = [];
  try {
    backlog = (await connection.query(await buildShippingPerformanceBacklogSql())).rows;
  } catch (err) {
    console.log(`backlog arm skipped: ${String(err.message).slice(0, 120)}`);
  }
  const rows = [...main, ...backlog];
  console.log(`rows on the page: ${rows.length}  (voyages ${main.length}, backlog ${backlog.length})\n`);

  // The Shipments rule, for exactly the contracts on the page - one row per contract, so the two
  // correlated subqueries run over a few thousand contracts rather than all 18k.
  /*
   * mergeShippingPerfStoGroup joins contract numbers with ', ' when one STO spans several
   * contracts, so contract_number is a LIST, not an id. A first pass matched it whole and silently
   * failed to find 455 of 1,053 rows - and still printed a total, which is the more dangerous half.
   */
  const contractsOf = (row) =>
    String(row.contract_number || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const contractIds = [...new Set(rows.flatMap(contractsOf))];
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const shipmentsSite = new Map();
  for (const row of (await connection.query(
    `SELECT c.contract_id, (${regionSite}) AS shipments_site
     FROM contracts c
     WHERE c.contract_id = ANY($1::text[])`,
    [contractIds],
  )).rows) {
    shipmentsSite.set(String(row.contract_id), site(row.shipments_site));
  }

  const moves = new Map();
  const movedContracts = new Set();
  let movedKg = 0;
  let sameKg = 0;
  let unknown = 0;

  for (const row of rows) {
    const mine = contractsOf(row);
    const known = mine.filter((c) => shipmentsSite.has(c));
    if (known.length === 0) {
      unknown += 1;
      continue;
    }
    const ours = site(row.plant_site);
    const kg = shippingPerfOutstandingQtyKgForAggregate(row);
    // A merged row shows ONE site for several contracts, so it only really disagrees when the
    // Shipments rule puts none of them where this page does.
    if (known.some((c) => shipmentsSite.get(c) === ours)) {
      sameKg += kg;
      continue;
    }
    movedKg += kg;
    for (const c of known) {
      movedContracts.add(c);
      const key = `${ours} -> ${shipmentsSite.get(c)}`;
      const acc = moves.get(key) || { rows: 0, kg: 0, contracts: new Set() };
      acc.rows += 1;
      acc.kg += kg / known.length;
      acc.contracts.add(c);
      moves.set(key, acc);
    }
  }

  console.log(`contracts that would MOVE : ${movedContracts.size} of ${contractIds.length}`);
  console.log(`outstanding that would move: ${mt(movedKg)} MT  (staying put: ${mt(sameKg)} MT)`);
  if (unknown) console.log(`rows whose contract was not found: ${unknown}`);

  if (moves.size) {
    console.log('\nwhere it would move  (Shipping Performance now -> Shipments rule):');
    console.log('   from -> to'.padEnd(52) + 'contracts'.padStart(10) + 'rows'.padStart(7) + 'OS'.padStart(14));
    for (const [key, acc] of [...moves.entries()].sort((a, b) => b[1].kg - a[1].kg)) {
      console.log(
        '   ' + key.slice(0, 48).padEnd(49) +
        String(acc.contracts.size).padStart(10) +
        String(acc.rows).padStart(7) +
        (mt(acc.kg) + ' MT').padStart(14),
      );
    }
  }

  /*
   * Name them. A rule change is a decision; a place that moves to somewhere implausible is a data
   * error, and the only way to tell the two apart is to look at the contracts themselves.
   */
  if (movedContracts.size) {
    const detail = (await connection.query(
      `SELECT c.contract_id, c.po_number, c.product, c.incoterm, c.supplier,
              (${regionSite}) AS shipments_site
       FROM contracts c
       WHERE c.contract_id = ANY($1::text[])
       ORDER BY c.contract_id`,
      [[...movedContracts]],
    )).rows;
    const spSite = new Map();
    for (const row of rows) {
      for (const c of contractsOf(row)) {
        if (movedContracts.has(c)) spSite.set(c, site(row.plant_site));
      }
    }
    console.log('');
    console.log('the contracts, so they can be checked in SAP:');
    console.log('   contract      PO             product        SP site          Shipments site');
    for (const r of detail) {
      console.log('   ' + String(r.contract_id).padEnd(14) +
        String(r.po_number || '-').padEnd(15) +
        String(r.product || '-').slice(0, 14).padEnd(15) +
        String(spSite.get(String(r.contract_id)) || '-').padEnd(17) +
        String(site(r.shipments_site)));
    }
  }

  // Which of the two disagreeing sources is actually responsible. If the moving rows are almost all
  // ones where the per-shipment aggregate won, the fix is a source-precedence decision; if they are
  // b2b rows, it is a keying difference (origin_po vs the join) and a different fix entirely.
  console.log('\nRead the direction before choosing a rule: "-> BLANK" means the Shipments side has');
  console.log('no destination for that contract at all, which is a reason to keep this page\'s');
  console.log('per-shipment source rather than a reason to drop it.');

  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 300));
  process.exit(1);
});
