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
  const variants = [
    ['Contracts page: no status, no date, no region rule', { ...base }],
    ['+ date range year-to-date only', { ...base, dateFrom: sameYtdFrom, dateTo: today }],
    ['+ requireRegionSite only (CP hides a blank Region/Site)', { ...base, requireRegionSite: 'true', compact: 'true' }],
    ['+ requireRegionSite + status Open (CP default tab)', { ...base, requireRegionSite: 'true', compact: 'true', status: 'Open' }],
    ['+ requireRegionSite + status Close', { ...base, requireRegionSite: 'true', compact: 'true', status: 'Close' }],
    ['status Open alone (no region rule)', { ...base, status: 'Open' }],
    ['status Close alone (no region rule)', { ...base, status: 'Close' }],
    ['CP exactly: YTD + region rule + status Open', { ...base, scope: 'filtered', dateFrom: sameYtdFrom, dateTo: today, requireRegionSite: 'true', compact: 'true', status: 'Open' }],
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

  if (firstRow) {
    console.log('--- the row as the list returns it (the fields the CP rules read)');
    const keys = ['contract_id', 'po_numbers', 'plant_site', 'plant_code', 'status', 'import_status', 'incoterm', 'transport_mode', 'source_type', 'product', 'supplier',
      'quantity_ordered', 'quantity_delivery', 'quantity_receive', 'outstanding_quantity', 'sto_count', 'shipment_status', 'trucking_status', 'contract_date'];
    console.table([Object.fromEntries(keys.map((k) => [k, firstRow[k] === undefined ? '' : firstRow[k]]))]);
  } else {
    console.log('The Contracts list did not return this PO even with no filter: search by this PO text may not match, or it is outside the default scope.');
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
