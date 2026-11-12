/*
 * Clear a discharge-port ATA that was COPIED onto the shipments of one operation, not typed. Dry run unless --apply.
 *
 *   cd /opt/klip && cat docs/scripts/repair-copied-discharge-ata.cjs | docker exec -i klip-backend node - --op=OP-1004030473-49138234
 *   cd /opt/klip && cat docs/scripts/repair-copied-discharge-ata.cjs | docker exec -i klip-backend node - --op=OP-1004030473-49138234 --apply
 *
 * Background (2026-11-12): the five shipments of OP-1004030473-49138234 (manual STOs MNL-50527716-..., MT. MULIA KARSA 2) showed an ATC of 2026-09-15 nobody typed. It was the ATC of the
 * same POs' finished voyage on STO 1006019867, written into their discharge-port rows by the SAP port sync (fixed in 70e4cfd) and replicated among the operation's members.
 * The sync only fills gaps, so the dates stay until they are removed. Needs no deploy of its own, but it only HOLDS once 70e4cfd is on the server: before that, opening the shipment
 * writes the date again.
 *
 * What it touches, and nothing else - a row is cleared only when ALL of these hold:
 *   - the shipment belongs to the operation you name, is live, and its STO is a manual one (not a number);
 *   - it is the DISCHARGE-port row and holds an ATA (ata_loading_completed);
 *   - no person wrote it: the column is not in klip_edited_fields;
 *   - it is the ATC the page SHOWS: no override ATC and no ATC in shipments.ata_discharge_complete (a person's value always wins over the port row).
 * Cleared: ata_loading_completed and its SAP mirror sap_ata_loading_completed. Every other date (the loading port's ATA of 2026-11-07, ETAs, quantities) stays. The statements to put
 * the old values back are printed, with --apply, before anything is written.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');
  const apply = process.argv.includes('--apply');
  const opArg = process.argv.find((a) => a.startsWith('--op='));
  const op = (opArg ? opArg.slice('--op='.length) : '').trim();
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const max = maxArg ? Number(maxArg.slice('--max='.length)) : 10;
  if (!op) {
    console.error('Name the operation: --op=OP-...  (nothing is touched without it)');
    process.exit(1);
  }

  const rows = (await pool.query(
    `SELECT v.id::text AS port_id, s.id::text AS shipment_id, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, s.status, v.port_name,
            v.ata_loading_completed::text AS port_ata, v.sap_ata_loading_completed::text AS sap_mirror, v.klip_edited_fields::text AS edited,
            s.ata_discharge_complete::text AS stored_atc, sao.ata_discharge_complete::text AS override_atc,
            v.eta_vessel_arrive_at_discharge_port::text AS eta_arrive, v.eta_vessel_berthed_at_discharge_port::text AS eta_berthed,
            v.eta_vessel_start_discharging::text AS eta_start, v.eta_vessel_complete_discharge::text AS eta_complete
       FROM vessel_loading_ports v
       JOIN shipments s ON s.id = v.shipment_id
       JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
      WHERE s.operation_id = $1 AND COALESCE(v.is_discharge_port, false) AND COALESCE(v.is_cancelled, false) = false
        AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
      ORDER BY c.po_number`,
    [op],
  )).rows;
  console.log(`operation ${op}: ${rows.length} live discharge-port row(s)\n`);
  if (rows.length === 0) {
    await pool.end();
    return;
  }

  const verdict = (r) => {
    if (!r.port_ata) return 'no ATA on the discharge-port row: nothing to clear';
    if (/^\d+$/.test(r.sto)) return `STO ${r.sto} is a SAP STO, not a manual one: left alone`;
    if (String(r.edited || '').includes('ata_loading_completed')) return 'marked as typed by a person: left alone';
    if (r.override_atc) return `a person's override ATC (${r.override_atc}) wins over this row: left alone`;
    if (r.stored_atc) return `the shipment's own ATC (${r.stored_atc}) wins over this row: left alone`;
    return null;
  };
  const eligible = [];
  for (const r of rows) {
    const why = verdict(r);
    console.log(
      `  PO ${r.po}  ${r.sto}  [${r.status}]  ${r.port_name}\n` +
        `      discharge-port ATA ${r.port_ata ? r.port_ata.slice(0, 10) : '-'}   SAP mirror ${r.sap_mirror || '-'}   typed-by-person marker: ${String(r.edited || '').includes('ata_loading_completed') ? 'yes' : 'no'}\n` +
        `      other discharge dates kept: ETA arrive ${r.eta_arrive || '-'}, berthed ${r.eta_berthed || '-'}, start ${r.eta_start || '-'}, complete ${r.eta_complete || '-'}\n` +
        `      -> ${why ? why : 'WILL BE CLEARED' + (apply ? '' : '  (dry run)')}`,
    );
    if (!why) eligible.push(r);
  }
  console.log(`\n${eligible.length} row(s) to clear.`);
  if (eligible.length > max) {
    console.error(`More than --max=${max}: this is not the case this script was written for. Nothing written.`);
    process.exit(1);
  }
  if (!apply) {
    console.log('dry run - nothing written. Add --apply to clear them.');
    await pool.end();
    return;
  }

  console.log('\nto put the old values back (keep this output):');
  for (const r of eligible) {
    console.log(
      `  UPDATE vessel_loading_ports SET ata_loading_completed = ${r.port_ata ? `'${r.port_ata.slice(0, 19)}'` : 'NULL'}, sap_ata_loading_completed = ${r.sap_mirror ? `'${r.sap_mirror.slice(0, 10)}'` : 'NULL'} WHERE id = '${r.port_id}';`,
    );
  }
  const done = [];
  for (const r of eligible) {
    const res = await pool.query(
      `UPDATE vessel_loading_ports
          SET ata_loading_completed = NULL, sap_ata_loading_completed = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND ata_loading_completed IS NOT NULL
          AND NOT ('ata_loading_completed' = ANY(COALESCE(klip_edited_fields, '{}')))
        RETURNING id::text`,
      [r.port_id],
    );
    if (res.rows.length > 0) done.push(r.shipment_id);
  }
  console.log(`\ncleared ${done.length} discharge-port ATA(s).`);
  if (done.length > 0) {
    // Fire-and-forget: it SCHEDULES the snapshot refreshes, which still need this connection; poll the stale flags and close only when they are clear.
    invalidateAfterShipmentWrite(done);
    const staleNow = async () =>
      Number(
        (await pool.query(
          `SELECT (SELECT COUNT(*) FROM pipeline_summary_refresh_meta WHERE is_stale) +
                  (SELECT COUNT(*) FROM contract_performance_snapshot_meta WHERE is_stale) +
                  (SELECT COUNT(*) FROM oil_loss_snapshot_meta WHERE is_stale) AS n`,
        )).rows[0].n,
      );
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(4000);
    const deadline = Date.now() + 300000;
    let clearPolls = 0;
    let remaining = await staleNow();
    while (Date.now() < deadline && clearPolls < 2) {
      clearPolls = remaining === 0 ? clearPolls + 1 : 0;
      if (clearPolls < 2) {
        await sleep(3000);
        remaining = await staleNow();
      }
    }
    console.log(remaining === 0 ? 'snapshots refreshed' : `${remaining} snapshot flag(s) still stale after 5 min - they rebuild on the next refresh`);
    console.log('NOTE: the running backend keeps its own in-memory list caches (about an hour). They are not cleared from here - they expire on their own, or clear on the next shipment save in the app.');
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
