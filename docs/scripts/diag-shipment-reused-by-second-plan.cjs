/*
 * READ-ONLY: what is left of the FIRST voyage on a shipment that a second plan overwrote?
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/diag-shipment-reused-by-second-plan.cjs | docker exec -i klip-backend node - --shipment=1dbb50d6-862e-4f69-ad5a-135b8056a1fa
 *
 * Planning a PO a second time (another vessel, to cover the quantity the first voyage left outstanding) used to UPDATE the first voyage's shipment row
 * instead of inserting a new one (createShipment.service.ts, fallback "newest active shipment of the contract"): the new vessel and operation landed on top
 * of the old ETAs, ATAs, ports and quantities, and the first voyage (PO 1001031313: Dahlia, completed) was lost as a row.
 *
 * Prints, for one shipment: the row, its ATA override, its port rows, the audit trail, and the vessel name SAP carries for its contract -
 * the places where the first voyage's identity (vessel, ETAs, ATAs) may still be found.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));
const day = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '-');
const json = (v) => JSON.stringify(v);

(async () => {
  const pool = dist('database/connection').default;
  const arg = process.argv.find((a) => a.startsWith('--shipment='));
  const id = (arg ? arg.slice('--shipment='.length) : '').trim();
  if (!id) {
    console.error('Give the shipment: --shipment=<uuid>');
    process.exit(1);
  }
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);

  const [s] = await q(
    `SELECT s.*, c.contract_id AS business_contract, c.po_number FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id WHERE s.id = $1::uuid`,
    [id],
  );
  if (!s) {
    console.error('shipment not found');
    process.exit(1);
  }
  console.log('1. The shipment row');
  console.log(`   contract ${s.business_contract}  po ${s.po_number}  status ${s.status}`);
  console.log(`   shipment_id ${s.shipment_id}   operation_id ${s.operation_id}   source ${s.operation_id_source || '-'}`);
  console.log(`   vessel ${s.vessel_name || '-'}  code ${s.vessel_code || '-'}  voyage ${s.voyage_no || '-'}  owner ${s.vessel_owner || '-'}`);
  console.log(`   created ${day(s.created_at)}   last updated ${day(s.updated_at)}`);
  console.log(`   ports ${s.port_of_loading || '-'} -> ${s.port_of_discharge || '-'}`);
  const eta = ['eta_arrival', 'eta_berthed', 'eta_loading_start', 'eta_loading_complete', 'eta_sailed', 'eta_discharge_arrival', 'eta_discharge_berthed', 'eta_discharge_start', 'eta_discharge_complete'];
  const ata = ['ata_arrival', 'ata_berthed', 'ata_loading_start', 'ata_loading_complete', 'ata_sailed', 'ata_discharge_arrival', 'ata_discharge_berthed', 'ata_discharge_start', 'ata_discharge_complete'];
  console.log('   ETA ' + eta.map((k) => `${k.replace('eta_', '')}=${day(s[k]).slice(0, 10)}`).join(' '));
  console.log('   ATA ' + ata.map((k) => `${k.replace('ata_', '')}=${day(s[k]).slice(0, 10)}`).join(' '));
  console.log(`   qty shipped ${s.quantity_shipped}  delivered ${s.quantity_delivered}  delivered klip ${s.quantity_delivered_klip}  plan ${s.quantity_shipment_plan}`);

  console.log('\n2. ATA override (manual ATA, with who and when)');
  const [sao] = await q(`SELECT * FROM shipment_ata_overrides WHERE shipment_id = $1::uuid`, [id]);
  if (sao) {
    console.log(`   source ${sao.source}  created ${day(sao.created_at)}  updated ${day(sao.updated_at)}  by ${sao.updated_by || '-'}`);
    console.log('   ' + ata.map((k) => `${k.replace('ata_', '')}=${day(sao[k]).slice(0, 10)}`).join(' '));
  } else console.log('   (none)');

  console.log('\n3. Port rows');
  const vlp = await q(
    `SELECT port_name, port_sequence, is_discharge_port, ata_vessel_arrival, ata_loading_completed, ata_vessel_sailed, created_at
       FROM vessel_loading_ports WHERE shipment_id = $1::uuid ORDER BY is_discharge_port, port_sequence, created_at`,
    [id],
  );
  for (const v of vlp) {
    console.log(`   ${v.is_discharge_port ? 'DISCHARGE' : 'LOADING  '} seq ${v.port_sequence}  ${v.port_name || '-'}  arrival ${day(v.ata_vessel_arrival).slice(0, 10)}  completed ${day(v.ata_loading_completed).slice(0, 10)}  created ${day(v.created_at)}`);
  }
  if (!vlp.length) console.log('   (none)');

  console.log('\n4. Audit trail of the shipment (oldest first) - vessel / operation / ETA changes');
  const audit = await q(
    `SELECT a.action, a.entity_type, a.timestamp, a.before_data, a.after_data, COALESCE(u.username, '') AS username
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE (a.entity_type = 'SHIPMENT' AND a.entity_id = $1::uuid)
         OR (a.entity_type = 'LOADING_PORT' AND a.entity_id IN (SELECT id FROM vessel_loading_ports WHERE shipment_id = $1::uuid))
      ORDER BY a.timestamp ASC LIMIT 60`,
    [id],
  );
  for (const a of audit) {
    const b = a.before_data || {};
    const af = a.after_data || {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(af)])].filter((k) => json(b[k]) !== json(af[k]) && !/updated_at/.test(k)).slice(0, 8);
    console.log(`   ${day(a.timestamp)} ${a.username || '-'} ${a.action} ${a.entity_type}: ${keys.map((k) => `${k} ${json(b[k])} -> ${json(af[k])}`).join('; ') || '(no field diff)'}`);
  }
  if (!audit.length) console.log('   (no audit rows - a create/plan overwrite writes none)');

  console.log('\n5. Vessel SAP carries for this contract (latest SAP rows)');
  const spd = await q(
    `SELECT spd.created_at, spd.data->'shipment'->>'vessel_name' AS vessel_a, spd.data->'raw'->>'Vessel Name' AS vessel_b, spd.data->'raw'->>'STO No.' AS sto
       FROM sap_processed_data spd WHERE TRIM(spd.contract_number) = $1 OR TRIM(spd.po_number) = $2 ORDER BY spd.created_at DESC LIMIT 6`,
    [s.business_contract, s.po_number],
  );
  for (const r of spd) console.log(`   ${day(r.created_at).slice(0, 10)}  vessel ${r.vessel_a || r.vessel_b || '-'}  sto ${r.sto || '-'}`);
  if (!spd.length) console.log('   (none)');

  console.log('\n6. Other shipments of the same contract');
  const others = await q(`SELECT id::text AS id, shipment_id, operation_id, vessel_name, status, created_at FROM shipments WHERE contract_id = $1::uuid ORDER BY created_at`, [s.contract_id]);
  for (const o of others) console.log(`   ${o.id === id ? '->' : '  '} ${o.id.slice(0, 8)} ${o.status} vessel ${o.vessel_name || '-'} op ${o.operation_id || '-'} shipment_id ${o.shipment_id} created ${day(o.created_at).slice(0, 10)}`);

  await pool.end();
})().catch((e) => {
  console.error('diag failed:', e);
  process.exit(1);
});
