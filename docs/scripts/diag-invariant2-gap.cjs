/*
 * READ-ONLY: where does the Shipping Performance vs Contract Performance outstanding gap (INVARIANT 2 of
 * diag-cross-page-invariants.cjs) go, contract by contract?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-invariant2-gap.cjs \
 *     | docker exec -i klip-backend node - [PRODUCT] [SITE] [FROM] [TO]
 *
 * Same scope and same entry points as diag-cross-page-invariants.cjs (runShippingPerformance, loadLatePerformanceRows, sea incoterms only,
 * On Going = backlog or a status that is not Completed / Cancelled / Unplanned), so the two totals match what that script printed.
 *
 * It then sorts every contract into ONE class, so the gap is a sum of named parts instead of one number:
 *
 *   A  CP counts it, Shipping Performance has NO row for it            (membership: SP never lists it)
 *   B  CP counts it, SP lists it but none of its rows is On Going       (SP has it as Completed / Cancelled only)
 *   C  both On Going, the outstanding differs                           (arithmetic: the same contract, two numbers)
 *   D  SP counts it On Going, CP does not                               (the other direction)
 *
 * For A and B it prints what the contract is in the database (shipments by status, trucking, import status) because that decides whether the
 * cause is a gate or a rule. A shipping row carries one OR several contract numbers; a multi-contract row is NOT split between its contracts
 * (an even split once produced a confidently wrong answer), so contracts on such rows are reported as class C only when ALL their SP rows are
 * single-contract, and the multi-contract rows are totalled apart.
 *
 * COST: one Shipping Performance pass (~70s) plus one Contract Performance pass. Do not loop it.
 */
const path = require('path');
const fs = require('fs');

const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

const connection = load('database/connection');
const { runShippingPerformance, invalidateShippingPerformanceRowCache } = load('services/shippingPerformance.service');
const { parseLatePerformanceFilters, loadLatePerformanceRows, rowMatchesContractPerfStatusFilter } = load('services/latePerformance.service');
const { isShipmentPageSeaIncoterm } = load('utils/shipmentIncotermScope');
const { shippingPerfOutstandingQtyKgForAggregate } = load('utils/shippingPerformanceOutstandingAgg');

const POS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PRODUCT = (POS[0] || '').trim().toUpperCase();
const SITE = (POS[1] || '').trim().toUpperCase();
const DATE_FROM = (POS[2] || new Date().getFullYear() + '-01-01').trim();
const DATE_TO = (POS[3] || new Date().toISOString().slice(0, 10)).trim();
const TOLERANCE_KG = 1000;

const up = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const inScope = (r) => (!PRODUCT || up(r.product).indexOf(PRODUCT) >= 0) && (!SITE || up(r.plant_site) === SITE);
const contractsOf = (row) =>
  String(row.contract_number ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

(async () => {
  console.log('scope: ' + (PRODUCT || 'all products') + ' / ' + (SITE || 'all sites') + ' / ' + DATE_FROM + '..' + DATE_TO);

  // ---- Shipping Performance, through its own entry point ------------------------------------
  invalidateShippingPerformanceRowCache();
  const sp = await runShippingPerformance({ query: { scope: 'ytd', dateFrom: DATE_FROM, dateTo: DATE_TO } }, 'rows');
  const spRows = sp.rows.filter(inScope);
  const isOnGoing = (r) =>
    r.is_unplanned_backlog === true ||
    (up(r.status) !== 'COMPLETED' && up(r.status) !== 'CANCELLED' && up(r.status) !== '' && up(r.status) !== 'UNPLANNED');

  const spAnyContracts = new Set(); // contracts SP lists at all
  const spOnGoing = new Map(); // contract -> { kg, rows, multiRows }
  let multiContractKg = 0;
  let multiContractRows = 0;
  for (const r of spRows) {
    const cs = contractsOf(r);
    cs.forEach((c) => spAnyContracts.add(c));
    if (!isOnGoing(r)) continue;
    const kg = shippingPerfOutstandingQtyKgForAggregate(r);
    if (cs.length > 1) {
      multiContractKg += kg;
      multiContractRows += 1;
    }
    for (const c of cs) {
      const e = spOnGoing.get(c) || { kg: 0, rows: 0, multi: false };
      e.rows += 1;
      if (cs.length > 1) e.multi = true;
      else e.kg += kg;
      spOnGoing.set(c, e);
    }
  }
  const spKg = [...spRows.filter(isOnGoing)].reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);

  // ---- Contract Performance, through its own entry point ------------------------------------
  const cpFilters = parseLatePerformanceFilters({ query: { dateFrom: DATE_FROM, dateTo: DATE_TO } }, 'rows');
  // OPEN contracts only (--all-status keeps closed and cancelled ones): the row set holds both, and a short-closed contract keeps a positive
  // outstanding_quantity, which is what put 156,747 MT of closed/cancelled contracts into the first reading of this gap.
  const ALL_STATUS = process.argv.includes('--all-status');
  const cpRows = (await loadLatePerformanceRows(cpFilters))
    .filter(inScope)
    .filter((r) => isShipmentPageSeaIncoterm(r.incoterm))
    .filter((r) => ALL_STATUS || rowMatchesContractPerfStatusFilter(r, 'Open'));
  const cp = new Map();
  for (const r of cpRows) {
    const kg = Number(r.outstanding_quantity) || 0;
    cp.set(String(r.contract_id), { kg, row: r });
  }
  const cpKg = [...cp.values()].reduce((a, e) => a + e.kg, 0);

  console.log('');
  console.log('Shipping Performance On Going : ' + mt(spKg) + ' MT  (' + spOnGoing.size + ' contracts, ' + multiContractRows + ' multi-contract rows = ' + mt(multiContractKg) + ' MT)');
  console.log('Contract Performance (sea)    : ' + mt(cpKg) + ' MT  (' + cp.size + ' contracts)');
  console.log('Gap (SP - CP)                 : ' + mt(spKg - cpKg) + ' MT');

  // ---- Classes ------------------------------------------------------------------------------
  const classA = [];
  const classB = [];
  const classC = [];
  const classD = [];
  for (const [c, e] of cp) {
    if (e.kg <= 0) continue;
    if (!spAnyContracts.has(c)) classA.push({ c, kg: e.kg, cp: e.row });
    else if (!spOnGoing.has(c)) classB.push({ c, kg: e.kg, cp: e.row });
    else {
      const s = spOnGoing.get(c);
      if (!s.multi && Math.abs(s.kg - e.kg) >= TOLERANCE_KG) classC.push({ c, kg: s.kg - e.kg, sp: s.kg, cpKg: e.kg, cp: e.row });
    }
  }
  for (const [c, s] of spOnGoing) {
    if (s.multi || s.kg <= 0) continue;
    if (!cp.has(c) || cp.get(c).kg <= 0) classD.push({ c, kg: s.kg });
  }
  const sum = (arr) => arr.reduce((a, x) => a + x.kg, 0);

  console.log('');
  console.log('Class                                                   contracts          MT');
  const line = (label, arr) => console.log('  ' + label.padEnd(52) + String(arr.length).padStart(9) + mt(sum(arr)).padStart(12));
  line('A  CP counts it, SP has no row for it', classA);
  line('B  CP counts it, SP lists it but none On Going', classB);
  line('C  both On Going, outstanding differs (SP - CP)', classC);
  line('D  SP On Going, CP does not count it', classD);
  const explained = -sum(classA) - sum(classB) + sum(classC) + sum(classD);
  console.log('  ' + 'explained: -A -B +C +D'.padEnd(52) + ''.padStart(9) + mt(explained).padStart(12));
  console.log('  ' + 'gap not explained (multi-contract rows, rounding)'.padEnd(52) + ''.padStart(9) + mt(spKg - cpKg - explained).padStart(12));

  // ---- What A and B are in the database -----------------------------------------------------
  const describe = async (arr, title) => {
    if (arr.length === 0) return;
    const ids = arr.map((x) => x.c);
    const feats = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const r = await connection.query(
        `SELECT c.contract_id,
                COUNT(s.id) FILTER (WHERE UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('COMPLETED', 'CANCELLED')) AS ship_active,
                COUNT(s.id) FILTER (WHERE UPPER(TRIM(COALESCE(s.status, ''))) = 'COMPLETED') AS ship_completed,
                COUNT(s.id) FILTER (WHERE UPPER(TRIM(COALESCE(s.status, ''))) = 'CANCELLED') AS ship_cancelled,
                (SELECT COUNT(*) FROM trucking_operations t JOIN contracts ct ON ct.id = t.contract_id WHERE ct.contract_id = c.contract_id) AS trucking
         FROM contracts c
         LEFT JOIN shipments s ON s.contract_id = c.id
         WHERE c.contract_id = ANY($1::text[])
         GROUP BY c.contract_id`,
        [part],
      );
      r.rows.forEach((x) => feats.set(String(x.contract_id), x));
    }
    const shape = (f) => {
      if (!f) return 'not in contracts';
      const a = Number(f.ship_active);
      const c = Number(f.ship_completed);
      const x = Number(f.ship_cancelled);
      if (a + c + x === 0) return Number(f.trucking) > 0 ? 'no shipment, has trucking' : 'no shipment at all';
      if (a > 0) return 'has an ACTIVE shipment';
      if (c > 0 && x === 0) return 'shipments all COMPLETED';
      if (c === 0) return 'shipments all CANCELLED';
      return 'COMPLETED + CANCELLED only';
    };
    const buckets = new Map();
    for (const x of arr) {
      const key = shape(feats.get(x.c)) + '  |  import_status=' + (x.cp.import_status || '-') + '  |  status=' + (x.cp.status || '-');
      const b = buckets.get(key) || { n: 0, kg: 0, ex: [] };
      b.n += 1;
      b.kg += x.kg;
      if (b.ex.length < 4) b.ex.push(x.c);
      buckets.set(key, b);
    }
    console.log('');
    console.log(title);
    [...buckets.entries()]
      .sort((a, b) => b[1].kg - a[1].kg)
      .slice(0, 12)
      .forEach(([k, b]) => console.log('  ' + String(b.n).padStart(5) + ' contracts ' + mt(b.kg).padStart(9) + ' MT   ' + k + '\n        e.g. ' + b.ex.join(', ')));
  };
  await describe(classA, 'CLASS A - what the contracts CP counts and SP has no row for ARE:');
  await describe(classB, 'CLASS B - what the contracts SP lists only as Completed / Cancelled ARE:');

  if (classC.length > 0) {
    console.log('');
    console.log('CLASS C - largest differences on contracts both pages count On Going (SP - CP):');
    classC
      .sort((a, b) => Math.abs(b.kg) - Math.abs(a.kg))
      .slice(0, 10)
      .forEach((x) => console.log('  ' + x.c.padEnd(14) + (x.cp.incoterm || '-').padEnd(5) + 'SP ' + mt(x.sp).padStart(8) + '  CP ' + mt(x.cpKg).padStart(8) + '  diff ' + mt(x.kg).padStart(8) + ' MT'));
  }
  if (classD.length > 0) {
    console.log('');
    console.log('CLASS D - largest contracts SP counts On Going that CP does not:');
    classD
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 10)
      .forEach((x) => console.log('  ' + x.c.padEnd(14) + mt(x.kg).padStart(8) + ' MT'));
  }

  await connection.end?.();
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e && e.message ? e.message : e);
  process.exit(1);
});
