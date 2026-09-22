/*
 * READ-ONLY: which CONTRACTS make two pages disagree, and by how much.
 *
 *   node /app/diag-os-per-contract.cjs CPO BONTANG
 *   node /app/diag-os-per-contract.cjs CPO BONTANG 2026-01-01 2026-09-22
 *
 * WHY THIS EXISTS. diag-cross-page-invariants.cjs answers "do the pages agree?" with one number.
 * When they do not, that number cannot say WHICH contract moved, and every attempt to reason it
 * out from totals on this project has produced a confidently wrong answer. This prints the list.
 *
 * IT CALLS THE PAGES' OWN CODE, and the reconciliation uses the same exported helpers the pages
 * use - loadContractExecutionOutstandingKg, osStageOf, shipmentActiveStageRank,
 * resolveOpenPerfOutstandingQtyKg, resolveContractEffectiveStatusText. Nothing here re-implements
 * a rule; copying a rule to measure it is what produced four wrong answers on 2026-09-18 and 09-21.
 *
 * WHAT IT MEASURED on the dev copy, 2026-09-22 (CPO / BONTANG / YTD): 77 contracts, and exactly
 * three disagreed - two B2B PARENTS that Contract Performance counts as Open and Shipping
 * Performance never sees (no shipment is raised against a parent), and one POME contract whose
 * outstanding rode a CPO row into a CPO-filtered scope. Both are questions about what SHOULD
 * count, not arithmetic faults - which is the distinction this script exists to surface.
 *
 * WHAT IT CANNOT PROVE: the Shipments OS card, for the reason given in diag-cross-page-invariants.
 * Shipping Performance stands in for it here, and the two are equal by construction except for
 * contracts whose merged STO row reads COMPLETED because a sibling finished.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) { console.error('no backend build found (looked in /app/dist and ../../backend/dist)'); process.exit(1); }
const load = (m) => require(path.join(DIST, m));

const { runShippingPerformance, invalidateShippingPerformanceRowCache } = load('services/shippingPerformance.service');
const { parseLatePerformanceFilters, loadLatePerformanceRows,
        resolveOpenPerfOutstandingQtyKg } = load('services/latePerformance.service');
const { resolveContractEffectiveStatusText } = load('utils/contractDeliveryStatus');
const { loadContractExecutionOutstandingKg, applyContractGrainOutstanding,
        contractNumbersOf, osStageOf } = load('services/shippingPerfContractGrainOs.service');
const { isShipmentActiveStage, shipmentActiveStageRank } = load('utils/shipmentActiveStageRank');
const { shippingPerfOutstandingQtyKgForAggregate } = load('utils/shippingPerformanceOutstandingAgg');
const { isShipmentPageSeaIncoterm } = load('utils/shipmentIncotermScope');

const PRODUCT = (process.argv[2] || 'CPO').trim().toUpperCase();
const SITE = (process.argv[3] || 'BONTANG').trim().toUpperCase();
const FROM = (process.argv[4] || new Date().getFullYear() + '-01-01').trim();
const TO = (process.argv[5] || new Date().toISOString().slice(0, 10)).trim();
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
const inScope = (r) => up(r.product).indexOf(PRODUCT) >= 0 && up(r.plant_site) === SITE;

(async () => {
  // ---- Shipping Performance, per contract -------------------------------------------------
  invalidateShippingPerformanceRowCache();
  const t0 = Date.now();
  const sp = await runShippingPerformance({ query: { scope: 'ytd', dateFrom: FROM, dateTo: TO } }, 'rows');
  const spRows = sp.rows.filter(inScope);
  console.error(`SP resolved in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${spRows.length} rows in scope`);

  const spOs = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  const backlogRows = spRows.filter((r) => r.is_unplanned_backlog === true);
  for (const r of backlogRows) {
    const cs = contractNumbersOf(r);
    const kg = shippingPerfOutstandingQtyKgForAggregate(r);
    for (const c of cs) add(spOs, c, kg / (cs.length || 1));
  }

  const voyage = spRows.filter((r) => r.is_unplanned_backlog !== true);
  const allContracts = [...new Set(voyage.flatMap(contractNumbersOf))];
  const execOs = await loadContractExecutionOutstandingKg(allContracts);
  const winner = new Map();
  for (const r of voyage) {
    const stage = osStageOf(r);
    if (!isShipmentActiveStage(stage)) continue;
    const rank = shipmentActiveStageRank(stage);
    for (const c of contractNumbersOf(r)) {
      if (!execOs.has(c)) continue;
      const held = winner.get(c);
      if (!held || rank > held) winner.set(c, rank);
    }
  }
  for (const [c] of winner) add(spOs, c, execOs.get(c) || 0);

  // ---- Contract Performance, per contract --------------------------------------------------
  const cpFilters = parseLatePerformanceFilters({ query: { dateFrom: FROM, dateTo: TO } }, 'rows');
  const cpAll = (await loadLatePerformanceRows(cpFilters)).filter(inScope)
    .filter((r) => isShipmentPageSeaIncoterm(r.incoterm));
  const cpOs = new Map();
  const cpStatus = new Map();
  for (const r of cpAll) {
    const st = resolveContractEffectiveStatusText(r);
    cpStatus.set(String(r.contract_id), st);
    const isOpen = st === 'OPEN' || st === 'ACTIVE';
    cpOs.set(String(r.contract_id), isOpen ? resolveOpenPerfOutstandingQtyKg(r) : 0);
  }

  // ---- Reconcile ---------------------------------------------------------------------------
  const ids = [...new Set([...cpOs.keys(), ...spOs.keys()])];
  const diffs = [];
  let cpTotal = 0, spTotal = 0;
  for (const id of ids) {
    const cp = cpOs.get(id) || 0, s = spOs.get(id) || 0;
    cpTotal += cp; spTotal += s;
    if (Math.abs(cp - s) > 1000) diffs.push({ id, cp, sp: s, d: s - cp, st: cpStatus.get(id) || '(not in CP)' });
  }
  diffs.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  console.log(`\nscope ${PRODUCT}/${SITE}/${FROM}..${TO} (sea incoterms), ${process.env.KLIP_ENV_LABEL || 'this database'}`);
  console.log(`Contract Performance (Open)  : ${mt(cpTotal)} MT over ${[...cpOs.values()].filter((v) => v > 0).length} contracts`);
  console.log(`Shipping Performance         : ${mt(spTotal)} MT over ${[...spOs.values()].filter((v) => v > 0).length} contracts`);
  console.log(`difference                   : ${mt(spTotal - cpTotal)} MT`);
  console.log(`\ncontracts differing by > 1 MT: ${diffs.length}`);
  console.log('contract        CP status     CP MT       SP MT      SP-CP');
  for (const d of diffs.slice(0, 30)) {
    console.log(`${d.id.padEnd(15)} ${String(d.st).padEnd(12)} ${mt(d.cp).padStart(9)} ${mt(d.sp).padStart(10)} ${mt(d.d).padStart(10)}`);
  }
  const byBucket = {};
  for (const d of diffs) {
    const k = d.cp === 0 ? `CP=0 (status ${d.st})` : d.sp === 0 ? 'SP=0' : 'both>0, differ';
    byBucket[k] = (byBucket[k] || 0) + d.d;
  }
  console.log('\nby bucket (SP - CP):');
  for (const [k, v] of Object.entries(byBucket).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
    console.log(`   ${k.padEnd(34)} ${mt(v).padStart(10)} MT`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', String(e && e.stack ? e.stack : e).slice(0, 600)); process.exit(1); });
