/*
 * READ-ONLY: which Shipments rows are COMPLETED only because a SIBLING STO discharged?
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
  const LIMIT = 200;
  const base = { dateFrom: from, dateTo: to, status: 'COMPLETED', limit: String(LIMIT), ...(plant ? { plant } : {}) };
  console.log('scope: ' + (plant || 'all sites') + ' / ' + from + '..' + to + ' / list status COMPLETED');
  const rows = [];
  for (let page = 1; page <= 200; page += 1) {
    const p = await call({ ...base, page: String(page) });
    const chunk = (p && p.data && (Array.isArray(p.data) ? p.data : p.data.shipments || p.data.items)) || [];
    rows.push(...chunk);
    if (chunk.length < LIMIT) break;
  }
  console.log('COMPLETED rows read: ' + rows.length);

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
