/*
 * READ-ONLY: how does the SHIPMENTS page see ONE contract - its OS card and the list row(s) it sits on?
 *
 *   cd /opt/klip && docker exec -i klip-backend node - --contract=1004030297 < docs/scripts/diag-shipments-contract-os.cjs
 *
 * Calls the route handler itself (getShipments, mock req/res) with the page's own `contract` filter, so nothing is reconstructed. Prints
 * the OS card for that contract and the list rows: status, the group's discharge ATA and its own-STO twin, the contracts on the row, OS fields.
 * Built for 1004030297 / 1004030835: Contract Performance and Shipments count them Open, Shipping Performance reads their merged row COMPLETED.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const { getShipments } = require(path.join(DIST, 'controllers/shipment.controller'));
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const contracts = arg('contract').split(',').map((s) => s.trim()).filter(Boolean);
const mt = (kg) => (Number(kg || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

async function call(query) {
  let payload = null;
  const res = { status() { return this; }, json(p) { payload = p; return this; }, setHeader() { return this; }, send(p) { payload = p; return this; } };
  await getShipments({ query, headers: {}, user: undefined }, res);
  return payload;
}

(async () => {
  for (const contract of contracts) {
    console.log('\n=== contract ' + contract);
    const base = { dateFrom: '2026-01-01', dateTo: '2026-12-31', contract };
    const card = await call({ ...base, compact: 'true', outstandingQtyOnly: 'true' });
    const os = card && card.data && card.data.outstandingQty;
    if (os) {
      console.log('OS card total ' + mt(os.totalKg) + ' MT   3rd Party FOB/CIF/CFR ' + [os.thirdParty && os.thirdParty.fobKg, os.thirdParty && os.thirdParty.cifKg, os.thirdParty && os.thirdParty.cfrKg].map(mt).join(' / ') +
        '   Interco ' + [os.interco && os.interco.fobKg, os.interco && os.interco.cifKg, os.interco && os.interco.cfrKg].map(mt).join(' / ') + '   other ' + mt(os.otherKg));
    } else {
      console.log('OS card: no payload ' + JSON.stringify(card).slice(0, 200));
    }
    const list = await call({ ...base, page: '1', limit: '50' });
    const rows = (list && list.data && (Array.isArray(list.data) ? list.data : list.data.shipments || list.data.items)) || [];
    console.log('list rows: ' + rows.length);
    const keep = /^(sto_key|sto_number|shipment_id|operation_id|vessel_name|status|effective_status|contract_numbers|po_numbers|ata_vessel_complete_discharge|ata_vessel_complete_discharge_own_sto|is_contract_sap_closed|outstanding|quantity_delivered|quantity_shipped|quantity_shipment_plan|contract_os)/;
    for (const r of rows) {
      console.log(JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k, v]) => keep.test(k) && v !== null && v !== undefined && v !== ''))));
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e && e.message ? e.message : e);
  process.exit(1);
});
