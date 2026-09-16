/*
 * READ-ONLY: trace named contracts through the Shipments execution arm, stage by stage.
 *
 * Three contracts are counted by Contract Performance and by neither Shipments arm. The backlog
 * rejects them correctly - each holds a live PLANNED shipment - so their quantity belongs to the
 * execution arm, and the execution arm does not have them. PLANNED is an active stage, so something
 * between the shipment row and execution_os drops them.
 *
 * This walks the real query's own CTEs in order and reports where each contract disappears:
 *
 *   shipment_base            the grouped STO row, and which contracts it lists
 *   filtered_shipments       survived the toolbar, stage and active-stage predicates
 *   execution_os_contracts   the per-contract rows, with the stage that ranked
 *   execution_os             what finally carries quantity
 *
 *   node /app/diag-execution-arm-trace.js 1004030633 1004031792 1004031937
 */
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('usage: node diag-execution-arm-trace.js <contract_id> [contract_id ...]');
  process.exit(1);
}
const idRegex = ids.join('|');

const connection = require('/app/dist/database/connection');
const original = connection.query;
const captured = [];
connection.query = async (text, params) => {
  if (typeof text === 'string' && text.includes('execution_os')) captured.push({ text, params: params || [] });
  return original(text, params);
};
const { getShipments } = require('/app/dist/controllers/shipment.controller');

const show = (label, rows, pick) => {
  console.log('\n' + label + ': ' + rows.length + ' row(s)');
  for (const r of rows) console.log('   ' + pick(r));
};

(async () => {
  await getShipments({
    query: {
      compact: 'true', outstandingQtyOnly: 'true', limit: '1', page: '1',
      dateFrom: '2026-01-01', dateTo: '2026-12-31',
    },
    user: { id: 'diag', role: 'ADMIN', permissions: ['*'] },
  }, { json: () => undefined, status: () => ({ json: () => undefined }) });

  if (!captured.length) {
    console.log('no execution_os query captured - a cached summary may have served the page');
    process.exit(1);
  }
  const c = captured[0];
  const f = c.text.lastIndexOf('FROM execution_os');
  const s = c.text.lastIndexOf('SELECT', f);
  const head = c.text.slice(0, s);
  const run = async (tail) => (await original(head + tail, c.params)).rows;

  const base = await run(
    "SELECT * FROM shipment_base WHERE contract_numbers::text ~ '(" + idRegex + ")'");
  show('shipment_base (the grouped STO row)', base, (r) =>
    'sto=' + String(r.sto_number || r.sto_key || '-') +
    '  status=' + String(r.status || '-') +
    '  atc_group=' + String(r.ata_vessel_complete_discharge || 'null') +
    '  atc_own_sto=' + String(r.ata_vessel_complete_discharge_own_sto || 'null') +
    '\n      contracts: ' + String(r.contract_numbers || '-'));

  const filtered = await run(
    "SELECT * FROM filtered_shipments WHERE contract_numbers::text ~ '(" + idRegex + ")'");
  show('filtered_shipments (passed the active-stage predicate)', filtered, (r) =>
    'sto=' + String(r.sto_number || r.sto_key || '-') + '  status=' + String(r.status || '-'));

  const perContract = await run(
    "SELECT * FROM execution_os_contracts WHERE contract_number ~ '(" + idRegex + ")'");
  show('execution_os_contracts (per contract, before ranking)', perContract, (r) =>
    String(r.contract_number) + '  status=' + String(r.effective_status) +
    '  incoterm=' + String(r.os_incoterm || '-') + '  rank=' + String(r.stage_rank));

  const finalRows = await run(
    "SELECT contract_number, incoterm, effective_status, outstanding_quantity FROM execution_os" +
    " WHERE contract_number ~ '(" + idRegex + ")'");
  show('execution_os (carries quantity)', finalRows, (r) =>
    String(r.contract_number) + '  ' + String(r.incoterm) + '  ' + String(r.effective_status) +
    '  ' + Math.round(Number(r.outstanding_quantity || 0) / 1000) + ' MT');

  console.log('\nRead it as: the last stage that still lists a contract is where it survives, and');
  console.log('the first that does not is the one to fix.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});
