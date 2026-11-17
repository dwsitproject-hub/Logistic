/*
 * READ-ONLY: what does the Shipments list cost when it opens on Contract Date (newest first) instead of created_at?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-shipments-sort-cost.cjs | docker exec -i klip-backend node -
 *
 * It calls the real list handler (getShipments) with the query a default browser load sends (compact, year to date, 20 a page, page 1), the way the startup warmers do, for
 * the two list calls the page makes: the shell (skipSapJoin=true) and the hydrate (skipSapJoin=false). For created_at desc (today), contract_date desc (candidate) and
 * contract_date asc, plus vessel_name asc (a sort the warmer also warms).
 *
 * COLD vs WARM. The page cache is keyed by the whole query, and the startup warmers have already filled the keys for created_at desc, so a plain call of today's default
 * would say ~0 s and look free. Each "cold" call therefore changes the page size (21, 22, 23 ...) - a different key for the same list - and "warm" repeats it.
 * What the cold call cannot defeat is the scope row set the page derives its pages from: that stays warm, as it is for a real visitor after the first load.
 * It prints the seconds, the row count and the first rows of the candidate (so you can see what would be at the top). Only SELECTs; nothing is written.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) { console.error('no backend build found'); process.exit(1); }
const load = (m) => require(path.join(DIST, m));

const jakartaNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
const dateTo = jakartaNow.toISOString().slice(0, 10);
const dateFrom = `${dateTo.slice(0, 4)}-01-01`;

function fakeRes() {
  const holder = { body: null, status: 200 };
  const res = {
    headersSent: false, locals: {}, statusCode: 200,
    status(c) { holder.status = c; return res; },
    json(b) { holder.body = b; return res; },
    send(b) { holder.body = b; return res; },
    set() { return res; }, setHeader() { return res; }, type() { return res; }, vary() { return res; }, end() { return res; }, append() { return res; }, contentType() { return res; },
  };
  return { res, holder };
}

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const { getShipments } = load('controllers/shipment.controller');
  let nextLimit = 21;

  async function call(label, q, { cold }) {
    const { res, holder } = fakeRes();
    const query = { compact: 'true', includeSummary: 'false', page: '1', dateFrom, dateTo, limit: cold ? String(nextLimit++) : String(nextLimit - 1), ...q };
    const t0 = Date.now();
    await getShipments({ query, headers: {}, get: () => undefined }, res);
    const ms = Date.now() - t0;
    const body = holder.body || {};
    const rows = (body.data && body.data.shipments) || body.shipments || [];
    const total = body.data && body.data.pagination ? body.data.pagination.total : body.pagination ? body.pagination.total : '?';
    console.log(`${label.padEnd(52)} ${(ms / 1000).toFixed(1).padStart(6)} s  rows=${rows.length} total=${total}${holder.status !== 200 ? '  HTTP ' + holder.status : ''}`);
    return rows;
  }

  const sorts = [
    ['created_at desc (today)', { sortKey: 'created_at', sortDir: 'desc' }],
    ['contract_date desc (candidate)', { sortKey: 'contract_date', sortDir: 'desc' }],
    ['contract_date asc', { sortKey: 'contract_date', sortDir: 'asc' }],
    ['vessel_name asc (warmed too)', { sortKey: 'vessel_name', sortDir: 'asc' }],
  ];
  let candidate = [];
  for (const hydrate of [false, true]) {
    console.log(`\n=== ${hydrate ? 'hydrate (skipSapJoin=false)' : 'shell (skipSapJoin=true)'}`);
    for (const [label, q] of sorts) {
      const rows = await call(`${label} - cold`, { ...q, skipSapJoin: hydrate ? 'false' : 'true' }, { cold: true });
      await call(`${label} - warm`, { ...q, skipSapJoin: hydrate ? 'false' : 'true' }, { cold: false });
      if (!hydrate && q.sortKey === 'contract_date' && q.sortDir === 'desc') candidate = rows;
    }
  }
  console.log('\nTop of the page on contract_date desc:');
  console.table(
    candidate.slice(0, 6).map((r) => ({
      status: r.status, po: r.po_number ?? r.contract_number, contract_date: r.contract_date, sto: String(r.sto_number ?? r.operation_id ?? '').slice(0, 26), created_at: r.created_at,
    })),
  );
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
