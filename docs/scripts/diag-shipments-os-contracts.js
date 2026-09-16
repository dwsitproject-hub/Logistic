/*
 * READ-ONLY: list the Shipments OS per contract for one filtered slice, from the REAL query.
 *
 * The Shipments OS is assembled inside a ~148KB statement built in the controller, so it cannot be
 * reproduced in plain SQL - four hand-derived reconstructions gave wrong answers before this
 * technique was used instead. It intercepts the query the controller actually issues, then re-runs
 * it with the aggregate replaced by a per-contract listing.
 *
 * Runs against whatever database the container is configured for. It issues the same work one page
 * load does (a few seconds), so avoid running it repeatedly during business hours.
 *
 *   node /app/diag-shipments-os-contracts.js CPO BONTANG FOB 2026-01-01 2026-12-31
 */
const [, , PRODUCT = 'CPO', REGION = 'BONTANG', INCOTERM = 'FOB',
  DFROM = '2026-01-01', DTO = '2026-12-31'] = process.argv;

const connection = require('/app/dist/database/connection');
const original = connection.query;
const captured = [];
connection.query = async (text, params) => {
  if (typeof text === 'string' && text.includes('execution_os')) captured.push({ text, params: params || [] });
  return original(text, params);
};

const { getShipments } = require('/app/dist/controllers/shipment.controller');
const {
  buildShipmentOutstandingQtyBacklogAggregateQuery,
} = require('/app/dist/utils/shipmentOutstandingQtySummarySql');
const { buildUnplannedContractToolbarScope } = require('/app/dist/utils/shipmentUnplannedHybridSql');

const mt = (kg) => Math.round(Number(kg || 0) / 1000).toLocaleString('en-US');

(async () => {
  const columnFilters = JSON.stringify({ products: { type: 'text', value: PRODUCT } });
  const req = {
    query: {
      compact: 'true', outstandingQtyOnly: 'true', limit: '1', page: '1',
      dateFrom: DFROM, dateTo: DTO, columnFilters, plant: REGION,
    },
    user: { id: 'diag', role: 'ADMIN', permissions: ['*'] },
  };
  await getShipments(req, { json: () => undefined, status: () => ({ json: () => undefined }) });

  const rows = [];
  if (captured.length) {
    const c = captured[0];
    const f = c.text.lastIndexOf('FROM execution_os');
    const s = c.text.lastIndexOf('SELECT', f);
    const listing = c.text.slice(0, s) +
      'SELECT contract_number, incoterm, effective_status, outstanding_quantity FROM execution_os';
    for (const r of (await original(listing, c.params)).rows) rows.push({ ...r, arm: 'execution' });
  } else {
    console.log('(no execution_os query captured - the page may have served a cached summary)');
  }

  const scope = buildUnplannedContractToolbarScope({
    dateFrom: DFROM, dateTo: DTO, contract: undefined, plants: [REGION],
  });
  const bt = await buildShipmentOutstandingQtyBacklogAggregateQuery(scope.sql, '');
  const bf = bt.lastIndexOf('FROM backlog_rows');
  const bs = bt.lastIndexOf('SELECT', bf);
  const bl = bt.slice(0, bs) +
    'SELECT contract_number, incoterm, NULL AS effective_status, outstanding_quantity FROM backlog_rows';
  for (const r of (await original(bl, scope.params)).rows) rows.push({ ...r, arm: 'backlog' });

  const keep = rows.filter((r) => String(r.incoterm || '').trim().toUpperCase() === INCOTERM.toUpperCase());
  let total = 0;
  keep.sort((a, b) => Number(b.outstanding_quantity || 0) - Number(a.outstanding_quantity || 0));
  console.log(`\nShipments OS rows for ${PRODUCT} / ${REGION} / ${INCOTERM} (${DFROM}..${DTO}):\n`);
  console.log('  contract      arm        status            os_mt');
  for (const r of keep) {
    total += Number(r.outstanding_quantity || 0);
    console.log(`  ${String(r.contract_number).padEnd(13)} ${String(r.arm).padEnd(10)} ` +
      `${String(r.effective_status || '-').padEnd(17)} ${mt(r.outstanding_quantity).padStart(7)}`);
  }
  console.log(`\n  ${keep.length} rows, total ${mt(total)} MT`);
  console.log('\n  Diff this list against step 3 of diag-os-gap-slice.sh: contracts here and not');
  console.log('  there are the gap, and their arm says which half of the Shipments OS added them.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.message ? e.message : e); process.exit(1); });
