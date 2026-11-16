/*
 * READ-ONLY: does the Trucking list come out in the SAME order whether the page is served by the live ranking or by the stage snapshot?
 *
 *   BEFORE the backend that serves contract_date from the snapshot is deployed (the live ranking answers), and again AFTER it:
 *     cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-trucking-sort-parity.cjs | docker exec -i klip-backend node - > /tmp/parity-before.txt
 *     ... deploy ...
 *     cd /opt/klip && git show origin/SIT:docs/scripts/diag-trucking-sort-parity.cjs | docker exec -i klip-backend node - > /tmp/parity-after.txt
 *     diff /tmp/parity-before.txt /tmp/parity-after.txt && echo IDENTICAL
 *
 * For contract_date desc and asc, pages 1 to 4 (20 a page, year to date, ALL status) it prints one line per row: page, position, status, PO / contract number, STO and contract date.
 * Rows that tie on the sort key (many contracts share a date) are listed in the order the page gave them, so an identical file means identical paging, ties included. The last line is
 * a hash of everything above it. Only SELECTs. The handler caches an answer for 5 minutes per query: run the "after" more than 5 minutes after a restart, or it can answer from the cache.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) { console.error('no backend build found'); process.exit(1); }
const load = (m) => require(path.join(DIST, m));
const year = new Date().getFullYear();
const base = { limit: '20', skipSapJoin: 'true', dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, includeSummary: 'false' };

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const { resolveTruckingListForRequest } = load('services/truckingList.service');
  const lines = [];
  for (const dir of ['desc', 'asc']) {
    for (let page = 1; page <= 4; page += 1) {
      const req = { query: { ...base, page: String(page), sortKey: 'contract_date', sortDir: dir }, user: { id: 'diag', role: 'ADMIN', permissions: ['*'] } };
      const data = await resolveTruckingListForRequest(req);
      const rows = Array.isArray(data && data.truckingOperations) ? data.truckingOperations : [];
      rows.forEach((r, i) => {
        const cd = r.contract_date ? String(r.contract_date).slice(0, 10) : 'NULL';
        lines.push(`${dir} p${page} #${String(i + 1).padStart(2, '0')} ${String(r.status).padEnd(12)} ${String(r.po_number ?? r.contract_number ?? '').padEnd(12)} ${String(r.sto_number ?? '').slice(0, 24).padEnd(24)} ${cd}`);
      });
    }
  }
  const body = lines.join('\n');
  console.log(body);
  console.log(`HASH ${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}  rows=${lines.length}`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
