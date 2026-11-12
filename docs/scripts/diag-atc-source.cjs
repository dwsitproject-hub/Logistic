/*
 * READ-ONLY: where does the ATC (ATA Vessel Complete Discharge) of an operation come from - a KLIP user, SAP's row of its OWN STO, or a date SAP sent for ANOTHER STO of the same PO?
 *
 *   cat docs/scripts/diag-atc-source.cjs | docker exec -i -e OP=OP-1004030473-49138234 klip-backend node -
 *
 * The page's ATC is COALESCE(JPS lane while the shipment is open, shipment_ata_overrides.ata_discharge_complete, shipments.ata_discharge_complete, discharge port row's
 * ata_loading_completed). Each source is printed with who wrote it, then compared with SAP's latest row of the shipment's own STO and of every other STO of the same PO
 * (migrations 169 / 170 / 173 cleared dates copied across STOs before; this checks whether one is back or never was).
 */
const pool = require('./dist/database/connection').default;
const OP = process.env.OP || 'OP-1004030473-49138234';
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const iso = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return t;
};

(async () => {
  console.log(`operation ${OP}`);
  let ships = await q(
    `SELECT s.id, c.contract_id AS contract, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, s.status, s.vessel_name AS vessel,
            s.ata_sailed::text AS ata_sailed, s.ata_discharge_start::text AS ata_disch_start, s.ata_discharge_complete::text AS stored_atc,
            s.klip_edited_fields::text AS edited, s.updated_at::text AS updated_at,
            sao.ata_discharge_complete::text AS override_atc, sao.source AS override_source, sao.updated_at::text AS override_at, u.full_name AS override_by
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       LEFT JOIN users u ON u.id = sao.updated_by
      WHERE s.operation_id = $1
      ORDER BY c.po_number, s.shipment_id`,
    [OP],
  );
  if (ships.length === 0) {
    console.log('no shipment carries this operation_id; showing the shipments of contract 1004030473 instead');
    ships = await q(
      `SELECT s.id, c.contract_id AS contract, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, s.status, s.vessel_name AS vessel, s.operation_id,
              s.ata_sailed::text AS ata_sailed, s.ata_discharge_start::text AS ata_disch_start, s.ata_discharge_complete::text AS stored_atc,
              s.klip_edited_fields::text AS edited, s.updated_at::text AS updated_at,
              sao.ata_discharge_complete::text AS override_atc, sao.source AS override_source, sao.updated_at::text AS override_at, u.full_name AS override_by
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id LEFT JOIN users u ON u.id = sao.updated_by
        WHERE c.contract_id = '1004030473' ORDER BY c.po_number, s.shipment_id`,
    );
  }
  console.log(`\nshipment rows (${ships.length}):`);
  for (const s of ships) console.log(' ', JSON.stringify(s));
  if (ships.length === 0) { process.exit(0); }

  const ids = ships.map((s) => s.id);
  const contracts = [...new Set(ships.map((s) => s.contract))];

  const ports = await q(
    `SELECT v.shipment_id AS id, v.port_name, v.is_discharge_port, v.port_sequence, v.ata_loading_completed::text AS port_ata, v.sap_ata_loading_completed::text AS port_sap_ata,
            v.klip_edited_fields::text AS edited
       FROM vessel_loading_ports v WHERE v.shipment_id = ANY($1::uuid[]) ORDER BY v.shipment_id, v.is_discharge_port, v.port_sequence`,
    [ids],
  );
  console.log('\nport rows (the discharge port row also feeds the ATC):');
  for (const r of ports) console.log(' ', JSON.stringify(r));

  const sap = await q(
    `SELECT DISTINCT ON (TRIM(spd.contract_number), TRIM(spd.sto_number::text))
            TRIM(spd.contract_number) AS contract, spd.po_number AS po, TRIM(spd.sto_number::text) AS sto,
            spd.data->'raw'->>'STO Item' AS item, spd.data->'raw'->>'STO Type' AS type, spd.data->'raw'->>'Vessel Name' AS vessel,
            spd.data->'raw'->>'ATA Vessel Sailed from Loading Port' AS sailed, spd.data->'raw'->>'ATA Vessel Complete Discharge' AS atc,
            spd.data->'raw'->>'Delete STO Status' AS del_sto, spd.created_at::text AS row_created
       FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = ANY($1::text[]) AND spd.sto_number IS NOT NULL
      ORDER BY TRIM(spd.contract_number), TRIM(spd.sto_number::text), spd.created_at DESC`,
    [contracts],
  );
  console.log('\nSAP latest row per STO of the same contract / PO:');
  for (const r of sap) console.log(' ', JSON.stringify({ ...r, atc_iso: iso(r.atc) }));

  const audit = await q(
    `SELECT a.timestamp::text AS at, a.action, a.entity_type, u.full_name AS who, a.entity_id,
            substring(a.before_data::text from '"[a-z_]*discharge_complete[a-z_]*": ?(null|"[^"]*")') AS before_atc,
            substring(a.after_data::text from '"[a-z_]*discharge_complete[a-z_]*": ?(null|"[^"]*")') AS after_atc
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_id = ANY($1::uuid[])
      ORDER BY a.timestamp DESC LIMIT 30`,
    [ids],
  );
  console.log('\naudit trail of these shipments (newest first; before / after = the discharge-complete value in the logged data, when there is one):');
  for (const r of audit) console.log(' ', JSON.stringify(r));
  if (audit.length === 0) console.log('  (no audit rows for these shipment ids)');

  console.log('\nverdict per shipment:');
  for (const s of ships) {
    const own = sap.find((r) => r.contract === s.contract && r.sto === s.sto);
    const others = sap.filter((r) => r.contract === s.contract && r.sto !== s.sto);
    const dp = ports.find((r) => r.id === s.id && r.is_discharge_port);
    const sources = [
      ['override (manual)', s.override_atc],
      ['shipments.ata_discharge_complete', s.stored_atc],
      ['discharge port row', dp && dp.port_ata],
    ].filter(([, v]) => v);
    const shown = sources[0];
    const ownAtc = own ? iso(own.atc) : null;
    const userMarked = String(s.edited || '').includes('ata_discharge_complete');
    let verdict;
    if (!shown) verdict = 'no ATC on this row';
    else if (shown[0].startsWith('override')) verdict = `manual override by ${s.override_by || '(unknown)'} at ${s.override_at}: a user wrote it`;
    else if (shown[0] === 'shipments.ata_discharge_complete' && userMarked) verdict = 'marked as written by a KLIP user in klip_edited_fields';
    else if (ownAtc && iso(shown[1]) === ownAtc) verdict = "equals SAP's ATC of its OWN STO: SAP wrote it";
    else {
      const twin = others.find((r) => iso(r.atc) && iso(r.atc) === iso(shown[1]));
      verdict = twin
        ? `equals the ATC SAP sent for ANOTHER STO of the same PO (${twin.sto}), and SAP's own STO has ${ownAtc || 'none'}: a copy from the sibling`
        : `not marked as a user's, not equal to any SAP row of this PO (own STO: ${ownAtc || 'none'}): origin unknown, see the audit trail`;
    }
    console.log(`  PO ${s.po} / STO ${s.sto}: shown ATC ${shown ? shown[1] + ' from ' + shown[0] : '-'} -> ${verdict}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
