/*
 * READ-ONLY: which Shipments rows rest on a SIBLING STO ATC (A: COMPLETED on it), and which ACTIVE rows lost their own ATC (B)?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-shipment-sibling-atc-rows.cjs \
 *     | docker exec -i klip-backend node - [--plant="TANJUNG PURA"] [--from=2026-01-01] [--to=2026-10-20]
 *
 * The page used to read a row's stage from the discharge ATC of the whole STO group (MAX over every member). A group can hold shipments whose own
 * shipment_id is another STO (shipmentListSeaStoKeyExpr keys FOB by a contract-level pick), so a finished voyage marked a row with no discharge of its
 * own as COMPLETED - while the OS path, which reads ata_vessel_complete_discharge_own_sto, counted its outstanding on an active stage. The status cards
 * had no row for that stage and the strip came 8,144.9 MT under the OS card (TANJUNG PURA 2026-10-20: BG. AS MARINA 10 and BG. KALTIM).
 *
 * This lists the rows that rule changes: list status COMPLETED, a group-wide ATC, NO ATC of the group's own STO, GR not Close. On the OLD code it is the
 * number of rows that will come back as active after the change; on the NEW code it must be 0 (a COMPLETED row then has its own ATC, a Close GR, or no
 * outstanding left - is_contract_os_within_band, which the payload does not carry, so a small remainder on the new code is read, not assumed to be a bug).
 * Calls the route handler itself, as the page does. Nothing is written.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const { getShipments } = require(path.join(DIST, 'controllers/shipment.controller'));
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const plant = arg('plant', '');
const from = arg('from', new Date().getFullYear() + '-01-01');
const to = arg('to', new Date().toISOString().slice(0, 10));
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

async function call(query) {
  let payload = null;
  const res = { status() { return this; }, json(p) { payload = p; return this; }, setHeader() { return this; }, send(p) { payload = p; return this; } };
  await getShipments({ query, headers: {}, user: undefined }, res);
  return payload;
}

(async () => {
  const LIMIT = 500;
  // Every row, not only the COMPLETED ones: part B below needs the ACTIVE rows too.
  const base = { dateFrom: from, dateTo: to, limit: String(LIMIT), ...(plant ? { plant } : {}) };
  console.log('scope: ' + (plant || 'all sites') + ' / ' + from + '..' + to + ' / every list row');
  const all = [];
  for (let page = 1; page <= 200; page += 1) {
    const p = await call({ ...base, page: String(page) });
    const chunk = (p && p.data && (Array.isArray(p.data) ? p.data : p.data.shipments || p.data.items)) || [];
    all.push(...chunk);
    if (chunk.length < LIMIT) break;
  }
  const rows = all.filter((r) => String(r.status || '').toUpperCase() === 'COMPLETED');
  console.log('rows read: ' + all.length + '   of them COMPLETED: ' + rows.length);

  /*
   * B. The other direction: an ACTIVE row whose group has an ATC that the row's OWN-STO ATC does not carry.
   *    - keyed by a real STO (digits): a SIBLING STO's ATC - the row is rightly still active (BG. KALTIM, BG. AS MARINA 10).
   *    - keyed by an OPERATION (OP- ...) or a KLIP shipment id: the own-STO filter once marked a manually planned shipment (shipment_id MNL-...) foreign, so a shipment that HAD
   *      discharged read Unloading in the table while its Edit modal read Completed (PO 1001031704, 2026-10-20). Fixed by 6c902ce9; on code without it these rows are listed here.
   */
  const activeStatus = (r) => !['COMPLETED', 'CANCELLED', ''].includes(String(r.status || '').toUpperCase()) && r.is_unplanned_backlog !== true;
  const heldBack = all.filter((r) => activeStatus(r) && r.ata_vessel_complete_discharge && !r.ata_vessel_complete_discharge_own_sto);
  const isStoKey = (r) => /^\d+$/.test(String(r.sto_key || '').trim());
  const sibling = heldBack.filter(isStoKey);
  const operation = heldBack.filter((r) => !isStoKey(r));
  const sum = (list) => list.reduce((a, r) => a + (Number(r.outstanding_quantity) || 0), 0);
  console.log('\nB. ACTIVE rows with a group ATC and no ATC of their own STO');
  console.log('   STO-keyed (a sibling STO discharged - rightly still active) : ' + String(sibling.length).padStart(4) + ' rows   ' + (mt(sum(sibling)) + ' MT').padStart(12));
  console.log('   operation-keyed (own ATC dropped - the 6c902ce9 class)       : ' + String(operation.length).padStart(4) + ' rows   ' + (mt(sum(operation)) + ' MT').padStart(12));
  for (const r of operation.sort((a, b) => (Number(b.outstanding_quantity) || 0) - (Number(a.outstanding_quantity) || 0)).slice(0, 25)) {
    console.log(
      '      ' + String(r.sto_key || '-').padEnd(26) + String(r.status || '-').padEnd(10) + String(r.vessel_name || '-').padEnd(24) + (mt(r.outstanding_quantity) + ' MT').padStart(10) +
        '   group ATC ' + String(r.ata_vessel_complete_discharge).slice(0, 10) + '   POs ' + String(r.po_numbers || '-').slice(0, 40),
    );
  }
  console.log('\nA. COMPLETED rows that rest on a sibling STO ATC alone');

  const changes = rows.filter(
    (r) =>
      String(r.status || '').toUpperCase() === 'COMPLETED' &&
      r.ata_vessel_complete_discharge &&
      !r.ata_vessel_complete_discharge_own_sto &&
      r.is_contract_sap_closed !== true,
  );
  const outstandingKg = changes.reduce((a, r) => a + (Number(r.outstanding_quantity) || 0), 0);
  console.log('\nrows COMPLETED on a sibling STO\'s ATC alone (no own-STO ATC, GR not Close): ' + changes.length + '   outstanding on them ' + mt(outstandingKg) + ' MT');
  const bySite = new Map();
  for (const r of changes) {
    const k = String(r.plant_site || r.region_site || r.plant || '-');
    const cur = bySite.get(k) || { n: 0, kg: 0 };
    cur.n += 1;
    cur.kg += Number(r.outstanding_quantity) || 0;
    bySite.set(k, cur);
  }
  for (const [k, v] of [...bySite.entries()].sort((a, b) => b[1].kg - a[1].kg)) {
    console.log('   ' + k.padEnd(22) + String(v.n).padStart(5) + ' rows   ' + (mt(v.kg) + ' MT').padStart(13));
  }
  console.log('\nlargest rows:');
  for (const r of changes.sort((a, b) => (Number(b.outstanding_quantity) || 0) - (Number(a.outstanding_quantity) || 0)).slice(0, 20)) {
    console.log(
      '   ' + String(r.sto_key || r.sto_number || '-').padEnd(26) + String(r.vessel_name || '-').padEnd(26) + (mt(r.outstanding_quantity) + ' MT').padStart(11) +
        '   group ATC ' + String(r.ata_vessel_complete_discharge).slice(0, 10) + '   contracts ' + String(r.contract_numbers || '-').slice(0, 60),
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e && e.message ? e.message : e);
  process.exit(1);
});
