/*
 * READ-ONLY: which HALF of the Trucking list makes the Contract Date sort slow - the executions (trucking_operations) or the backlog (contracts with no operation)?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-trucking-sort-halves.cjs | docker exec -i klip-backend node -
 *
 * On production the default list on Contract Date (newest first) took 7.3 s cold against 1.1 s on created_at. The ALL list is two halves merged: the snapshot serves the execution half
 * for created_at and supplier but not contract_date, and the backlog half is fetched as well when the sort is a global one. This times each half alone through the same function the page
 * uses (resolveTruckingListForRequest, year to date, 20 a page): status UNPLANNED is the backlog half; COMPLETED and CANCELLED are execution halves read from their own stage. Each sort is
 * run twice (the second is warm). Only SELECTs.
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
  const n = Array.isArray(data && data.truckingOperations) ? data.truckingOperations.length : -1;
  console.log(`${label.padEnd(46)} ${(ms / 1000).toFixed(1).padStart(6)} s  rows=${n} total=${data && data.pagination ? data.pagination.total : '?'}`);
}

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const { resolveTruckingListForRequest: resolve } = load('services/truckingList.service');
  const cases = [
    ['ALL      contract_date desc', { sortKey: 'contract_date', sortDir: 'desc' }],
    ['UNPLANNED contract_date desc (backlog half)', { status: 'UNPLANNED', sortKey: 'contract_date', sortDir: 'desc' }],
    ['UNPLANNED created_at desc   (backlog half)', { status: 'UNPLANNED', sortKey: 'created_at', sortDir: 'desc' }],
    ['COMPLETED contract_date desc (execution half)', { status: 'COMPLETED', sortKey: 'contract_date', sortDir: 'desc' }],
    ['COMPLETED created_at desc    (execution half)', { status: 'COMPLETED', sortKey: 'created_at', sortDir: 'desc' }],
    ['IN_PROGRESS contract_date desc (execution half)', { status: 'IN_PROGRESS', sortKey: 'contract_date', sortDir: 'desc' }],
  ];
  for (const [label, q] of cases) {
    await run(resolve, `${label} - first`, q);
    await run(resolve, `${label} - second`, q);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
