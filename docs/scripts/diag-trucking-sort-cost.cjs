/*
 * READ-ONLY: what does the Trucking list cost when it opens on Contract Date (newest first) instead of created_at?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-trucking-sort-cost.cjs | docker exec -i klip-backend node -
 *
 * It calls the same function the Trucking page's request reaches (resolveTruckingListForRequest) with the page's own default parameters (year to date, 20 a page, ALL status,
 * skipSapJoin like the page) for four sorts, each twice (the second call is the warm one): created_at desc (today's default), contract_date desc (the candidate),
 * contract_date asc and supplier asc (the snapshot-served sort, as a reference). It prints the seconds, the row count and the first three rows' PO / contract date / created_at,
 * so it also shows what the top of the page would be. Only SELECTs; nothing is written. The handler caches an answer per query for a while, so the cold figure is the
 * first call of a sort after a restart or a cache expiry.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) { console.error('no backend build found'); process.exit(1); }
const load = (m) => require(path.join(DIST, m));

const year = new Date().getFullYear();
const base = { page: '1', limit: '20', skipSapJoin: 'true', dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, includeSummary: 'false' };

async function run(resolve, label, q) {
  const req = { query: { ...base, ...q }, user: { id: 'diag', role: 'ADMIN', permissions: ['*'] } };
  const t0 = Date.now();
  const data = await resolve(req);
  const ms = Date.now() - t0;
  const rows = Array.isArray(data && data.truckingOperations) ? data.truckingOperations : [];
  console.log(`${label.padEnd(34)} ${String((ms / 1000).toFixed(1)).padStart(7)} s   rows=${rows.length}  total=${data && data.pagination ? data.pagination.total : '?'}`);
  return { ms, rows };
}

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const { resolveTruckingListForRequest } = load('services/truckingList.service');
  const sorts = [
    ['created_at desc (today)', { sortKey: 'created_at', sortDir: 'desc' }],
    ['contract_date desc (candidate)', { sortKey: 'contract_date', sortDir: 'desc' }],
    ['contract_date asc', { sortKey: 'contract_date', sortDir: 'asc' }],
    ['supplier asc (snapshot, reference)', { sortKey: 'supplier', sortDir: 'asc' }],
  ];
  let candidateRows = [];
  for (const [label, q] of sorts) {
    const cold = await run(resolveTruckingListForRequest, `${label} - first`, q);
    await run(resolveTruckingListForRequest, `${label} - second`, q);
    if (q.sortKey === 'contract_date' && q.sortDir === 'desc') candidateRows = cold.rows;
  }
  console.log('\nTop of the page on contract_date desc:');
  console.table(
    candidateRows.slice(0, 5).map((r) => ({
      status: r.status, po: r.po_number ?? r.contract_number, contract_date: r.contract_date, sto: String(r.sto_number ?? '').slice(0, 24), created_at: r.created_at,
    })),
  );
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
