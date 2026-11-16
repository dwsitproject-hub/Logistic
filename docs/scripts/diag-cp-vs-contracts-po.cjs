/*
 * READ-ONLY: why is a PO on the Contracts page but not on Contract Performance?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-cp-vs-contracts-po.cjs | docker exec -i -e PO=1001032275 klip-backend node -
 *
 * It asks the Contracts list endpoint (the same handler both pages call) for that PO under the filters Contract Performance adds on top of the Contracts page,
 * ONE AT A TIME, and says which one drops it:
 *   - requireRegionSite : CP hides a contract with no Region/Site (blank or missing) - the Contracts page keeps it.
 *   - status Open/Close : CP opens on Open, and moves a contract that has effectively finished (OS in the zero band, or ATC at discharge filled) to Close.
 *   - date range        : CP opens on year-to-date.
 * Writes nothing. The handler caches an answer for 60 s per query, which is harmless here.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const PO = String(process.env.PO || '1001032275').trim();

function ask(getContracts, query) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let code = 200;
    const res = {
      status(c) { code = c; return res; },
      json(body) { resolve({ code, body, ms: Date.now() - started }); return res; },
      send(body) { resolve({ code, body, ms: Date.now() - started }); return res; },
      set() { return res; },
      setHeader() { return res; },
      headersSent: false,
    };
    Promise.resolve(getContracts({ query, headers: {} }, res)).catch(reject);
  });
}

const sameYtdFrom = `${new Date().getFullYear()}-01-01`;
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const pool = load('database/connection').default;
  const { getContracts } = load('controllers/contract.controller');

  console.log(`PO ${PO}\n`);
  const rows = await pool.query(
    `SELECT contract_id, po_number, status, incoterm, source_type, transport_mode, contract_date::date AS contract_date, delivery_end_date::date AS delivery_end_date,
            product, supplier, group_name, plant_code, sap_presence, quantity_ordered, created_at::date AS created
       FROM contracts WHERE po_number = $1 OR contract_id = $1 ORDER BY created_at DESC LIMIT 8`,
    [PO],
  );
  console.log('--- contracts rows for this PO');
  console.table(rows.rows);
  if (rows.rows.length === 0) {
    console.log('No contracts row has this PO or contract id. It cannot be on either page.');
    process.exit(0);
  }
  const contractIds = new Set(rows.rows.map((r) => String(r.contract_id)));
  const isOurs = (c) => contractIds.has(String(c.contract_id)) || String(c.po_numbers || '').split(',').map((s) => s.trim()).includes(PO);

  const base = { page: '1', limit: '50', search: PO };
  const cpOpen = { ...base, scope: 'filtered', dateFrom: sameYtdFrom, dateTo: today, requireRegionSite: 'true', compact: 'true', status: 'Open' };
  const variants = [
    ['Contracts page: no status, no date, no region rule', { ...base }],
    ['+ date range year-to-date only', { ...base, dateFrom: sameYtdFrom, dateTo: today }],
    ['+ requireRegionSite only (CP hides a blank Region/Site)', { ...base, requireRegionSite: 'true', compact: 'true' }],
    ['+ requireRegionSite + status Open (CP default tab)', { ...base, requireRegionSite: 'true', compact: 'true', status: 'Open' }],
    ['+ requireRegionSite + status Close', { ...base, requireRegionSite: 'true', compact: 'true', status: 'Close' }],
    ['status Open alone (no region rule)', { ...base, status: 'Open' }],
    ['status Close alone (no region rule)', { ...base, status: 'Close' }],
    ['CP exactly: YTD + region rule + status Open', { ...base, scope: 'filtered', dateFrom: sameYtdFrom, dateTo: today, requireRegionSite: 'true', compact: 'true', status: 'Open' }],
    // The Late / On Time tabs of the CP table send lateOnTimeFilter and excludeUnscheduled=true; "all" sends excludeUnscheduled=false.
    ['CP + Late tab (lateOnTimeFilter=LATE, excludeUnscheduled)', { ...cpOpen, lateOnTimeFilter: 'LATE', excludeUnscheduled: 'true' }],
    ['CP + On Time tab (lateOnTimeFilter=ON_TIME, excludeUnscheduled)', { ...cpOpen, lateOnTimeFilter: 'ON_TIME', excludeUnscheduled: 'true' }],
    ['CP + all, excludeUnscheduled=false (what the page sends with no Late/On Time tab)', { ...cpOpen, lateOnTimeFilter: 'ALL', excludeUnscheduled: 'false' }],
    // Planning Status is a CP filter too (one value only); the PO's shipment status is UNPLANNED when it has no shipment yet.
    ['CP + Planning Status = Planned', { ...cpOpen, planningStatuses: 'PLANNED' }],
    ['CP + Planning Status = Unplanned', { ...cpOpen, planningStatuses: 'UNPLANNED' }],
  ];

  const out = [];
  let firstRow = null;
  for (const [label, q] of variants) {
    try {
      const r = await ask(getContracts, q);
      const list = (r.body && r.body.data && r.body.data.contracts) || [];
      const hit = list.find(isOurs);
      if (hit && !firstRow) firstRow = hit;
      out.push({ filters: label, found: hit ? 'YES' : 'no', rows_returned: list.length, http: r.code, seconds: Math.round(r.ms / 100) / 10 });
    } catch (e) {
      out.push({ filters: label, found: 'ERROR', rows_returned: '-', http: '-', seconds: String(e && e.message ? e.message : e).slice(0, 60) });
    }
  }
  console.log('\n--- where it drops out');
  console.table(out);

  // The cards and the Product > Region/Plant > Incoterm drilldown come from the tree endpoint, not the list.
  try {
    const { getLatePerformanceTree } = load('controllers/contract.controller');
    const tr = await ask(getLatePerformanceTree, { scope: 'filtered', dateFrom: sameYtdFrom, dateTo: today });
    const text = JSON.stringify((tr.body && tr.body.data) || tr.body || {});
    const plantHint = firstRow && firstRow.plant_site ? String(firstRow.plant_site) : '';
    console.log('\n--- drilldown tree (late-performance/tree, YTD): HTTP ' + tr.code + ', ' + text.length + ' chars' + (plantHint ? ', mentions ' + plantHint + ': ' + text.toUpperCase().includes(plantHint.toUpperCase()) : ''));
    if (plantHint) {
      const i = text.toUpperCase().indexOf(plantHint.toUpperCase());
      if (i >= 0) console.log('  around it: ' + text.slice(Math.max(0, i - 200), i + 500));
    }
  } catch (e) {
    console.log('\n--- drilldown tree: skipped (' + (e && e.message ? e.message : e) + ')');
  }

  if (firstRow) {
    console.log('--- the row as the list returns it (the fields the CP rules read)');
    const keys = ['contract_id', 'po_numbers', 'plant_site', 'plant_code', 'status', 'import_status', 'incoterm', 'transport_mode', 'source_type', 'product', 'supplier',
      'quantity_ordered', 'quantity_delivery', 'quantity_receive', 'outstanding_quantity', 'sto_count', 'shipment_status', 'trucking_status', 'contract_date'];
    console.table([Object.fromEntries(keys.map((k) => [k, firstRow[k] === undefined ? '' : firstRow[k]]))]);
  } else {
    console.log('The Contracts list did not return this PO even with no filter: search by this PO text may not match, or it is outside the default scope.');
  }
  // Contract Performance moves a contract to Close when it has "effectively finished" (contractDeliveryStatus.sqlContractEffectivelyDoneExpr): any ONE of
  //   (1) outstanding inside the zero band, (2) an ATC at discharge with every STO discharged, (3) every vessel STO's shipment finished.
  // The Contracts page does not apply this, which is the usual reason a contract is Open on one page and Close on the other. Each arm is evaluated here.
  try {
    const cyc = load('utils/contractsListCycleSql');
    const tol = load('utils/qtyZeroTolerance').OUTSTANDING_QTY_ZERO_TOLERANCE_KG;
    const cid = String(rows.rows[0].contract_id);
    const arms = await pool.query(
      `SELECT ${cyc.sqlLastAtaVesselCompleteDischargeForContract('(SELECT c_done.id FROM contracts c_done WHERE c_done.contract_id = $1::text ORDER BY c_done.created_at DESC LIMIT 1)')} AS atc_at_discharge,
              COALESCE((${cyc.sqlContractVesselStosFinishedExpr('$1::text')}), FALSE) AS every_vessel_sto_finished`,
      [cid],
    );
    const os = firstRow ? Number(firstRow.outstanding_quantity) : null;
    console.log('\n--- why Contract Performance may call it Close (any ONE arm is enough)');
    console.table([{
      outstanding_kg: os,
      arm1_os_inside_zero_band: os !== null && os <= Number(tol) ? 'YES (<= ' + tol + ' kg)' : 'no (needs <= ' + tol + ' kg)',
      arm2_atc_at_discharge: arms.rows[0].atc_at_discharge ? String(arms.rows[0].atc_at_discharge).slice(0, 10) : 'none',
      arm3_every_vessel_sto_finished: arms.rows[0].every_vessel_sto_finished ? 'YES' : 'no',
      sto_count_in_list: firstRow ? firstRow.sto_count : null,
    }]);
    const ships = await pool.query(
      `SELECT s.operation_id, s.sto_number, s.status, s.ata_discharge_complete::date AS ata_discharge_complete, s.quantity_delivered, s.quantity_delivered_klip, s.actual_vessel_qty_receive
         FROM shipments s WHERE s.contract_id IN (SELECT id FROM contracts WHERE contract_id = $1::text) ORDER BY s.created_at`,
      [cid],
    );
    console.log('--- shipments of this contract');
    console.table(ships.rows);
  } catch (e) {
    console.log('\n--- effectively-done arms: skipped (' + (e && e.message ? e.message : e) + ')');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
