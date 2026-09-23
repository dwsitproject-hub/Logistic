/*
 * READ-ONLY: all FOUR outstanding figures at once, each through its own entry point.
 *
 *   node /app/diag-four-page-os.cjs BONTANG
 *   node /app/diag-four-page-os.cjs BONTANG 2026-01-01 2026-09-22
 *
 * Contract Performance is split by incoterm so each operational page meets the half it owns:
 * Shipping Performance and Shipments against FOB/CIF/CFR, Trucking against LCO/FRC. Comparing
 * either against the whole reported 75,477 MT of "DRIFT" the first time this was tried, which was
 * simply the other transport mode.
 *
 * WHY THIS EXISTS. diag-cross-page-invariants.cjs states plainly that it cannot measure the
 * Shipments OS card: `loadShipmentOutstandingQtyForRequest` needs the `shipmentBaseCteSql` the
 * controller assembles, and reproducing that has produced a wrong answer four times. So that
 * figure was read off the screen by hand, which is how it went unnoticed that Shipments sits
 * 1,161 MT above Contract Performance while Shipping Performance now matches it to 0.7 MT.
 *
 * It does not need reproducing. `getShipments` is exported, it is the route handler itself, and
 * with `compact=true&outstandingQtyOnly=true` it returns exactly the card - so calling it with a
 * mock `req`/`res` measures the page rather than an imitation of it. (`getShipments` never reads
 * `req.user`, checked, so there is no scope to fake.)
 *
 * NO PRODUCT FILTER. On the Shipments page the product arrives inside `columnFilters` as a JSON
 * payload rather than as its own parameter, and guessing its shape would put an untested filter
 * between the three numbers. Region/Site and the date range are enough to make them comparable,
 * and all three are narrowed the same way.
 *
 * Shipments' card covers sea incoterms only, so Contract Performance is filtered to the same set
 * with the page's own predicate.
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

const { getShipments } = load('controllers/shipment.controller');
const { getTruckingOperations } = load('controllers/trucking.controller');
const { runShippingPerformance } = load('services/shippingPerformance.service');
const {
  parseLatePerformanceFilters,
  loadLatePerformanceRows,
  resolveOpenPerfOutstandingQtyKg,
} = load('services/latePerformance.service');
const { resolveContractEffectiveStatusText } = load('utils/contractDeliveryStatus');
const { isShipmentPageSeaIncoterm } = load('utils/shipmentIncotermScope');
const {
  shippingPerfOutstandingQtyKgForAggregate,
} = load('utils/shippingPerformanceOutstandingAgg');
/*
 * Shipments' card is execution arm + backlog arm, documented as disjoint ("Exactly once, either
 * way"). The backlog arm needs no controller-assembled CTE, so measuring it separately splits the
 * search space in half without reproducing anything: if the two pages' backlog arms agree, the
 * drift is in execution, and if they do not, it is in backlog.
 */
const connection = load('database/connection');
const {
  sqlBacklogRemainingOsJoinExpr,
  unplannedContractBacklogBaseWhereSql,
  preplannedContractBacklogBaseWhereSql,
} = load('utils/shipmentUnplannedHybridSql');
const { sqlRegionSiteDisplayForContract } = load('utils/regionSiteSql');

const SITE = (process.argv[2] || 'BONTANG').trim().toUpperCase();
const FROM = (process.argv[3] || new Date().getFullYear() + '-01-01').trim();
const TO = (process.argv[4] || new Date().toISOString().slice(0, 10)).trim();

const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
const up = (v) => String(v == null ? '' : v).trim().toUpperCase();

(async () => {
  console.log(`scope: ${SITE} / ${FROM}..${TO} / all products, sea AND land`);

  // ---- Shipments, through its route handler ------------------------------------------------
  let shipmentsKg = null;
  let bucketsComplete = null;
  let shipmentsByIncoterm = null;
  try {
    const req = {
      query: {
        compact: 'true',
        outstandingQtyOnly: 'true',
        dateFrom: FROM,
        dateTo: TO,
        plant: SITE,
      },
    };
    let payload = null;
    const res = {
      status() { return this; },
      json(p) { payload = p; return this; },
      setHeader() { return this; },
      send(p) { payload = p; return this; },
    };
    const t0 = Date.now();
    await getShipments(req, res);
    const os = payload && payload.data && payload.data.outstandingQty;
    if (os) {
      shipmentsKg = Number(os.totalKg) || 0;
      bucketsComplete = os.bucketsComplete;
      console.log(`   (Shipments answered in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      /*
       * The card fills progressively - the total lands before the buckets do. A screenshot taken
       * in between shows 3rd Party + Interco exceeding the total, which looks like an
       * inconsistency and is not one. `bucketsComplete` is how to tell.
       */
      const slices =
        Number(os.thirdParty?.fobKg || 0) + Number(os.thirdParty?.cifKg || 0) +
        Number(os.thirdParty?.cfrKg || 0) + Number(os.interco?.fobKg || 0) +
        Number(os.interco?.cifKg || 0) + Number(os.interco?.cfrKg || 0) +
        Number(os.otherKg || 0);
      console.log(`   3rd Party + Interco + Other = ${mt(slices)} MT   bucketsComplete=${bucketsComplete}`);
      /*
       * The card splits itself by incoterm, and Contract Performance carries the same column, so
       * the gap can be localised without inventing a classifier for 3rd Party vs Interco - which
       * would put an untested rule between two numbers being compared.
       */
      shipmentsByIncoterm = {
        FOB: Number(os.thirdParty?.fobKg || 0) + Number(os.interco?.fobKg || 0),
        CIF: Number(os.thirdParty?.cifKg || 0) + Number(os.interco?.cifKg || 0),
        CFR: Number(os.thirdParty?.cfrKg || 0) + Number(os.interco?.cfrKg || 0),
      };
    } else {
      console.log('   Shipments returned no outstandingQty payload');
    }
  } catch (err) {
    console.log('   Shipments could not be read: ' + String(err && err.message).slice(0, 160));
  }

  // ---- Shipments' OWN two halves: the status cards against the strip -------------------------
  /*
   * The card carries two figures from two producers - the status-card sum (drawn first) and the
   * incoterm strip - and on 2026-09-22 they disagreed twice: by 1,000 MT because only the strip
   * required a resolved Region/Site, and by 98 MT because the combined-summary shortcut computed
   * effective_status without the own-STO discharge column. Neither was visible on the page, since
   * reconcileShipmentOutstandingQtySummary absorbs the difference into `otherKg`, which only shows
   * in the tooltip. So it is checked here rather than looked at.
   */
  let statusCardSumKg = null;
  try {
    const req = { query: { summaryOnly: 'true', dateFrom: FROM, dateTo: TO, plant: SITE } };
    let payload = null;
    const res = {
      status() { return this; },
      json(p) { payload = p; return this; },
      setHeader() { return this; },
      send(p) { payload = p; return this; },
    };
    await getShipments(req, res);
    const so = payload && payload.data && payload.data.summary && payload.data.summary.statusOutstandingQty;
    if (so) {
      statusCardSumKg = Object.values(so).reduce((a, v) => a + (Number(v) || 0), 0);
    } else {
      console.log('   Shipments returned no statusOutstandingQty');
    }
  } catch (err) {
    console.log('   Shipments status cards could not be read: ' + String(err && err.message).slice(0, 160));
  }

  // ---- Trucking, through its own route handler ----------------------------------------------
  /*
   * summaryOnly=true is Trucking's equivalent of the Shipments flag above, and it answers from
   * trucking_list_stage_snapshot - the payload's `summaryFreshness` says which source and as-of,
   * and a stale one is worth knowing about before reading the number, because a full rebuild of
   * that snapshot is ~21 minutes and is not something to trigger by accident.
   */
  let truckingKg = null;
  let truckingFreshness = null;
  try {
    const req = {
      query: { summaryOnly: 'true', dateFrom: FROM, dateTo: TO, plant: SITE },
    };
    let payload = null;
    const res = {
      status() { return this; },
      json(p) { payload = p; return this; },
      setHeader() { return this; },
      send(p) { payload = p; return this; },
    };
    const t0 = Date.now();
    await getTruckingOperations(req, res);
    const sum = payload && payload.data && payload.data.summary;
    if (sum && sum.outstandingQty) {
      truckingKg = Number(sum.outstandingQty.totalKg) || 0;
      truckingFreshness = sum.summaryFreshness || null;
      console.log(`   (Trucking answered in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (truckingFreshness) {
        console.log(`   Trucking summary source=${truckingFreshness.source} isStale=${truckingFreshness.isStale} asOf=${truckingFreshness.asOf}`);
      }
    } else {
      console.log('   Trucking returned no outstandingQty summary');
    }
  } catch (err) {
    console.log('   Trucking could not be read: ' + String(err && err.message).slice(0, 160));
  }

  // ---- Shipping Performance, through its own entry point ------------------------------------
  const sp = await runShippingPerformance(
    { query: { scope: 'ytd', dateFrom: FROM, dateTo: TO } },
    'rows',
  );
  const spRows = sp.rows.filter((r) => up(r.plant_site) === SITE);
  const spKg = spRows
    .filter(
      (r) =>
        r.is_unplanned_backlog === true ||
        !['COMPLETED', 'CANCELLED', '', 'UNPLANNED'].includes(up(r.status)),
    )
    .reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);

  // ---- Contract Performance, through its own entry point ------------------------------------
  const cpFilters = parseLatePerformanceFilters({ query: { dateFrom: FROM, dateTo: TO } }, 'rows');
  const cpAllRows = (await loadLatePerformanceRows(cpFilters)).filter(
    (r) => up(r.plant_site) === SITE,
  );
  const cpRows = cpAllRows.filter((r) => isShipmentPageSeaIncoterm(r.incoterm));
  const cpKg = cpRows
    .filter((r) => ['OPEN', 'ACTIVE'].includes(resolveContractEffectiveStatusText(r)))
    .reduce((a, r) => a + resolveOpenPerfOutstandingQtyKg(r), 0);

  const line = (label, kg) =>
    console.log('   ' + label.padEnd(34) + (kg === null ? '-' : mt(kg) + ' MT').padStart(14));

  const cpLandKg = cpAllRows
    .filter((r) => ['OPEN', 'ACTIVE'].includes(resolveContractEffectiveStatusText(r)))
    .filter((r) => ['LCO', 'FRC'].includes(up(r.incoterm)))
    .reduce((a, r) => a + resolveOpenPerfOutstandingQtyKg(r), 0);

  console.log('');
  console.log('SEA (FOB / CIF / CFR), one scope, three entry points:');
  line('Contract Performance (Open)', cpKg);
  line('Shipping Performance (On Going)', spKg);
  line('Shipments (OS card)', shipmentsKg);
  console.log('');
  console.log('LAND (LCO / FRC):');
  line('Contract Performance (Open)', cpLandKg);
  line('Trucking (OS card)', truckingKg);
  if (truckingKg !== null) {
    const d = truckingKg - cpLandKg;
    console.log(`   ${'Trucking - Contract Perf'.padEnd(30)} ${(Math.abs(d) < 1000 ? 'OK    ' : 'DRIFT ') + mt(d) + ' MT'}`);
  }
  console.log('');
  const gap = (a, b, label) => {
    if (a === null || b === null) return;
    const d = a - b;
    console.log(`   ${label.padEnd(30)} ${(Math.abs(d) < 1000 ? 'OK    ' : 'DRIFT ') + mt(d) + ' MT'}`);
  };
  gap(spKg, cpKg, 'Shipping Perf - Contract Perf');
  gap(shipmentsKg, cpKg, 'Shipments - Contract Perf');
  gap(shipmentsKg, spKg, 'Shipments - Shipping Perf');
  if (statusCardSumKg !== null && shipmentsKg !== null) {
    const d = statusCardSumKg - shipmentsKg;
    console.log(
      `   ${'Shipments cards - its own strip'.padEnd(30)} ${(Math.abs(d) < 1000 ? 'OK    ' : 'DRIFT ') + mt(d) + ' MT'}`,
    );
  }

  // ---- the backlog arm, the half that needs no controller CTE ------------------------------
  const osExpr = sqlBacklogRemainingOsJoinExpr();
  const regionSite = sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number');
  const LATEST_SPD =
    ` latest_spd_contract AS (
        SELECT contract_number, effective_sto, b2b_flag_raw, contract_reference_po_raw,
               contract_ext_no_raw, discharge_destination
        FROM contract_latest_spd_snapshot
        WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
      )`;
  const backlogArm = async (whereSql) => {
    const r = await connection.query(
      `WITH ${LATEST_SPD}
       SELECT COALESCE(SUM(${osExpr}), 0)::numeric AS kg, COUNT(*)::int AS n
       FROM contracts c
       LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
       LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id
       WHERE ${whereSql}
         AND (${osExpr}) > 0
         AND c.contract_date >= $1 AND c.contract_date <= $2
         AND UPPER(TRIM(COALESCE((${regionSite}), ''))) = $3`,
      [FROM, TO, SITE],
    );
    return { kg: Number(r.rows[0].kg) || 0, n: Number(r.rows[0].n) || 0 };
  };
  let shipBacklogKg = null;
  try {
    const u = await backlogArm(unplannedContractBacklogBaseWhereSql('c', 'l'));
    const pp = await backlogArm(preplannedContractBacklogBaseWhereSql('c', 'l'));
    shipBacklogKg = u.kg + pp.kg;
    const spBacklogKg = spRows
      .filter((r) => r.is_unplanned_backlog === true)
      .reduce((a, r) => a + shippingPerfOutstandingQtyKgForAggregate(r), 0);
    console.log('');
    console.log('SPLIT: which arm drifts?');
    console.log(`   Shipments backlog arm            ${(mt(shipBacklogKg) + ' MT').padStart(13)}   (${u.n} unplanned + ${pp.n} preplanned)`);
    console.log(`   Shipping Perf backlog rows       ${(mt(spBacklogKg) + ' MT').padStart(13)}`);
    console.log(`   backlog difference               ${(mt(shipBacklogKg - spBacklogKg) + ' MT').padStart(13)}`);
    if (shipmentsKg !== null) {
      const shipExec = shipmentsKg - shipBacklogKg;
      const spExec = spKg - spBacklogKg;
      console.log(`   Shipments execution (total - backlog) ${(mt(shipExec) + ' MT').padStart(8)}`);
      console.log(`   Shipping Perf execution              ${(mt(spExec) + ' MT').padStart(8)}`);
      console.log(`   execution difference                 ${(mt(shipExec - spExec) + ' MT').padStart(8)}`);
    }
  } catch (err) {
    console.log('   backlog arm could not be read: ' + String(err && err.message).slice(0, 160));
  }

  if (shipmentsByIncoterm) {
    const cpByIncoterm = { FOB: 0, CIF: 0, CFR: 0, OTHER: 0 };
    for (const r of cpRows) {
      if (!['OPEN', 'ACTIVE'].includes(resolveContractEffectiveStatusText(r))) continue;
      const key = ['FOB', 'CIF', 'CFR'].includes(up(r.incoterm)) ? up(r.incoterm) : 'OTHER';
      cpByIncoterm[key] += resolveOpenPerfOutstandingQtyKg(r);
    }
    console.log('');
    console.log('WHERE the Shipments gap sits, by incoterm:');
    console.log('   incoterm    Contract Perf      Shipments        Shipments - CP');
    for (const k of ['FOB', 'CIF', 'CFR']) {
      const d = shipmentsByIncoterm[k] - cpByIncoterm[k];
      console.log(
        `   ${k.padEnd(11)} ${(mt(cpByIncoterm[k]) + ' MT').padStart(13)} ${(mt(shipmentsByIncoterm[k]) + ' MT').padStart(15)} ${(mt(d) + ' MT').padStart(17)}`,
      );
    }
    if (cpByIncoterm.OTHER > 0) {
      console.log(`   (Contract Performance also holds ${mt(cpByIncoterm.OTHER)} MT on other incoterms, which the card has no bucket for)`);
    }
  }
  console.log('');
  console.log('Contract Performance is the agreed reference (see the OS sections in the README).');
  console.log('Whichever line drifts is the page that moved.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.stack ? e.stack : e).slice(0, 400));
  process.exit(1);
});
