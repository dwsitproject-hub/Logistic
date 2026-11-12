/*
 * Clean the dates a fan-out wrote across two voyages that were held in ONE operation (OP-1004032450-17019387, split on 2026-11-12: split-operation-by-sto.cjs).
 * Dry run unless --apply. Two independent parts, each with its own operation key; name at least one:
 *
 *   --clear-discharge-op=OP-1004032450-17019387   the voyage that kept the old key (BG. SMS 3000, STO 1006020800)
 *   --restore-loading-op=OP-1004030762-53832097   the voyage that moved out (Luminor 6, STO 1006019958)
 *   --reset-status                                (with --clear-discharge-op) also bring a stored COMPLETED back to what the milestones say
 *
 *   cd /opt/klip && cat docs/scripts/clean-split-operation-dates.cjs | docker exec -i klip-backend node - --clear-discharge-op=OP-1004032450-17019387 --restore-loading-op=OP-1004030762-53832097
 *   ... add --apply to write. Needs no deploy.
 *
 * PART 1 - clear-discharge-op. The discharge-port row of a live shipment of that operation holds a discharge ATA (ata_loading_completed on the is_discharge_port row) that is NOT the voyage's.
 * A row is cleared only when ALL hold: no person wrote it (not in klip_edited_fields); it is the ATC the page SHOWS (no override ATC, no ATC in shipments.ata_discharge_complete);
 * SAP's row of the shipment's OWN STO has no ATC; and the date is IMPOSSIBLE - it is earlier than the voyage's own loading ATA (a vessel does not discharge before it loaded).
 * Cleared: ata_loading_completed and its SAP mirror sap_ata_loading_completed.
 *
 * PART 2 - restore-loading-op. A loading-port row of a live shipment of that operation holds a loading ATA that the OTHER voyage's save fanned out over it. A field (ata_vessel_arrival,
 * ata_vessel_berthed, ata_loading_start, ata_loading_completed, ata_vessel_sailed) is restored to its SAP mirror (sap_ata_*) only when: the mirror has a value, the current value is a
 * different day, and the current value is LATER than the shipment's own discharge ATC (loading after discharging is impossible). The restored field is also removed from klip_edited_fields,
 * because a person did not mean it for this PO. A shipment whose discharge ATC is unknown is left alone: nothing proves the date wrong.
 *
 * --reset-status: a stored COMPLETED of a Part 1 shipment is brought to the status its milestones give WITHOUT the cleared ATC (the page's own ladder, deriveShipmentStatus).
 * The modal shows the HIGHER of the stored and the derived status, so clearing the date alone leaves the modal on Completed. Do it only when the user confirms the voyage is not finished.
 *
 * The statements that put every old value back are printed, with --apply, before anything is written. Nothing else is touched: no ETA, quantity, SAP row, document.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const SAP_DATE = (t) => `CASE
  WHEN ${t} ~ '^\\d{1,2}/\\d{1,2}/\\d{2}$' THEN to_date(${t}, 'MM/DD/YY')
  WHEN ${t} ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_date(${t}, 'MM/DD/YYYY')
  WHEN ${t} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(${t} from 1 for 10)::date
  WHEN ${t} ~ '^\\d{2}\\.\\d{2}\\.\\d{4}$' THEN to_date(${t}, 'DD.MM.YYYY')
END`;
const LOADING_FIELDS = [
  ['ata_vessel_arrival', 'sap_ata_vessel_arrival'],
  ['ata_vessel_berthed', 'sap_ata_vessel_berthed'],
  ['ata_loading_start', 'sap_ata_loading_start'],
  ['ata_loading_completed', 'sap_ata_loading_completed'],
  ['ata_vessel_sailed', 'sap_ata_vessel_sailed'],
];
const d10 = (v) => (v ? String(v).slice(0, 10) : '');

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');
  const { deriveShipmentStatus } = dist('utils/shipmentStatus');
  // the GR status the page itself uses for "the contract is closed" (a Close without ATC still reads Completed), not contracts.status
  const { sqlContractImportStatusExpr } = dist('utils/contractDeliveryStatus');
  const flag = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3).trim() : '';
  };
  const apply = process.argv.includes('--apply');
  const resetStatus = process.argv.includes('--reset-status');
  const clearOp = flag('clear-discharge-op');
  const restoreOp = flag('restore-loading-op');
  const max = flag('max') ? Number(flag('max')) : 10;
  if (!clearOp && !restoreOp) {
    console.error('Name at least one part: --clear-discharge-op=OP-... and/or --restore-loading-op=OP-...  (nothing is touched without them)');
    process.exit(1);
  }
  if (resetStatus && !clearOp) {
    console.error('--reset-status belongs to --clear-discharge-op');
    process.exit(1);
  }
  const live = `UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')`;
  const marked = (edited, col) => String(edited || '').includes(col);
  const undo = [];
  const touchedShipments = new Set();

  // ---------------------------------------------------------------- PART 1
  const clearTargets = [];
  const statusTargets = [];
  if (clearOp) {
    console.log(`===== PART 1: clear the discharge ATA that is not the voyage's - operation ${clearOp} =====`);
    const rows = (await pool.query(
      `WITH sap_rows AS (
         SELECT DISTINCT ON (TRIM(spd.contract_number), TRIM(spd.sto_number::text))
                TRIM(spd.contract_number) AS cn, TRIM(spd.sto_number::text) AS sto,
                ${SAP_DATE("TRIM(COALESCE(spd.data->'raw'->>'ATA Vessel Complete Discharge', ''))")} AS sap_atc
           FROM sap_processed_data spd
          WHERE NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL
          ORDER BY TRIM(spd.contract_number), TRIM(spd.sto_number::text), spd.created_at DESC)
       SELECT v.id::text AS port_id, s.id::text AS shipment_id, c.contract_id AS cn, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, s.status, ${sqlContractImportStatusExpr('c', 'c.po_number', "NULLIF(TRIM(s.shipment_id::text), '')")} AS contract_status,
              v.ata_loading_completed::text AS port_ata, v.sap_ata_loading_completed::text AS sap_mirror, v.klip_edited_fields::text AS edited,
              s.ata_discharge_complete::text AS stored_atc, sao.ata_discharge_complete::text AS override_atc,
              (SELECT MAX(l.ata_loading_completed)::text FROM vessel_loading_ports l
                WHERE l.shipment_id = s.id AND NOT COALESCE(l.is_discharge_port, false) AND COALESCE(l.is_cancelled, false) = false) AS loading_ata,
              EXISTS (SELECT 1 FROM sap_rows r WHERE r.cn = c.contract_id AND r.sto = TRIM(s.shipment_id::text)) AS own_in_sap,
              (SELECT r.sap_atc::text FROM sap_rows r WHERE r.cn = c.contract_id AND r.sto = TRIM(s.shipment_id::text)) AS own_sap_atc
         FROM vessel_loading_ports v
         JOIN shipments s ON s.id = v.shipment_id
         JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE TRIM(COALESCE(s.operation_id, '')) = $1 AND COALESCE(v.is_discharge_port, false) AND COALESCE(v.is_cancelled, false) = false AND ${live}
        ORDER BY c.po_number`,
      [clearOp],
    )).rows;
    console.log(`${rows.length} live discharge-port row(s)\n`);
    for (const r of rows) {
      let why = null;
      if (!r.port_ata) why = 'no ATA on the discharge-port row: nothing to clear';
      else if (marked(r.edited, 'ata_loading_completed')) why = 'marked as typed by a person: left alone';
      else if (r.override_atc) why = `a person's override ATC (${d10(r.override_atc)}) wins: left alone`;
      else if (r.stored_atc) why = `the shipment's own ATC (${d10(r.stored_atc)}) wins: left alone`;
      else if (r.own_sap_atc) why = `SAP's row of its own STO has an ATC (${d10(r.own_sap_atc)}): left alone`;
      else if (!r.loading_ata) why = 'no loading ATA to compare with: nothing proves the date wrong, left alone';
      else if (d10(r.port_ata) >= d10(r.loading_ata)) why = `${d10(r.port_ata)} does not precede the loading ATA ${d10(r.loading_ata)}: not proven wrong, left alone`;
      console.log(
        `  PO ${r.po}  STO ${r.sto}  [${r.status}]\n` +
          `      discharge-port ATA ${d10(r.port_ata) || '-'}  SAP mirror ${d10(r.sap_mirror) || '-'}  loading ATA ${d10(r.loading_ata) || '-'}  SAP own-STO ATC ${r.own_in_sap ? d10(r.own_sap_atc) || 'none' : 'no SAP row'}\n` +
          `      -> ${why || 'WILL BE CLEARED' + (apply ? '' : '  (dry run)')}`,
      );
      if (!why) clearTargets.push(r);
    }
    console.log(`\n${clearTargets.length} discharge-port row(s) to clear.`);

    // status
    const stored = clearTargets.filter((r) => String(r.status || '').toUpperCase() === 'COMPLETED');
    if (stored.length > 0) {
      const ms = (await pool.query(
        `SELECT s.id::text AS id,
                s.eta_arrival, s.eta_berthed, s.eta_loading_start, s.eta_loading_complete, s.eta_sailed, s.eta_discharge_arrival, s.eta_discharge_berthed, s.eta_discharge_start, s.eta_discharge_complete,
                COALESCE(sao.ata_arrival, s.ata_arrival, lp.ata_vessel_arrival) AS ata_arrival,
                COALESCE(sao.ata_berthed, s.ata_berthed, lp.ata_vessel_berthed) AS ata_berthed,
                COALESCE(sao.ata_loading_start, s.ata_loading_start, lp.ata_loading_start) AS ata_loading_start,
                COALESCE(sao.ata_loading_complete, s.ata_loading_complete, lp.ata_loading_completed) AS ata_loading_complete,
                COALESCE(sao.ata_sailed, s.ata_sailed, lp.ata_vessel_sailed) AS ata_sailed,
                COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival) AS ata_discharge_arrival,
                COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed) AS ata_discharge_berthed,
                COALESCE(sao.ata_discharge_start, s.ata_discharge_start) AS ata_discharge_start
           FROM shipments s
           LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
           LEFT JOIN LATERAL (SELECT MAX(l.ata_vessel_arrival) AS ata_vessel_arrival, MAX(l.ata_vessel_berthed) AS ata_vessel_berthed, MAX(l.ata_loading_start) AS ata_loading_start,
                                     MAX(l.ata_loading_completed) AS ata_loading_completed, MAX(l.ata_vessel_sailed) AS ata_vessel_sailed
                                FROM vessel_loading_ports l WHERE l.shipment_id = s.id AND NOT COALESCE(l.is_discharge_port, false) AND COALESCE(l.is_cancelled, false) = false) lp ON TRUE
          WHERE s.id = ANY($1::uuid[])`,
        [stored.map((r) => r.shipment_id)],
      )).rows;
      console.log(`\nstored status COMPLETED on ${stored.length} of them. The status the milestones give WITHOUT the cleared ATC:`);
      for (const r of stored) {
        const m = ms.find((x) => x.id === r.shipment_id);
        const next = deriveShipmentStatus({
          eta_arrival_at_loading_port: m.eta_arrival, eta_berthed_at_loading_port: m.eta_berthed, eta_start_loading: m.eta_loading_start, eta_completed_loading: m.eta_loading_complete,
          eta_sailed_from_loading_port: m.eta_sailed, eta_arrive_at_discharge_port: m.eta_discharge_arrival, eta_berthed_at_discharge_port: m.eta_discharge_berthed,
          eta_start_discharging: m.eta_discharge_start, eta_complete_discharge: m.eta_discharge_complete,
          ata_arrival_at_loading_port: m.ata_arrival, ata_berthed_at_loading_port: m.ata_berthed, ata_start_loading: m.ata_loading_start, ata_completed_loading: m.ata_loading_complete,
          ata_sailed_from_loading_port: m.ata_sailed, ata_arrive_at_discharge_port: m.ata_discharge_arrival, ata_berthed_at_discharge_port: m.ata_discharge_berthed,
          ata_start_discharging: m.ata_discharge_start, ata_complete_discharge: null,
          contract_import_status: r.contract_status,
        });
        console.log(`  PO ${r.po}: COMPLETED -> ${next}${resetStatus ? (apply ? '' : '   (--reset-status, dry run)') : '   (NOT applied: add --reset-status after the user confirms)'}`);
        if (resetStatus && next !== 'COMPLETED') statusTargets.push({ shipmentId: r.shipment_id, po: r.po, next });
      }
    }
  }

  // ---------------------------------------------------------------- PART 2
  const restoreTargets = [];
  if (restoreOp) {
    console.log(`\n===== PART 2: restore the loading ATAs a fan-out overwrote - operation ${restoreOp} =====`);
    const rows = (await pool.query(
      `SELECT v.id::text AS port_id, s.id::text AS shipment_id, c.po_number AS po, TRIM(s.shipment_id::text) AS sto, v.port_name, v.klip_edited_fields::text AS edited,
              ${LOADING_FIELDS.map(([f, m]) => `v.${f}::text AS cur_${f}, v.${m}::text AS mir_${f}`).join(', ')},
              COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete, (SELECT MAX(d.ata_loading_completed)::date FROM vessel_loading_ports d
                 WHERE d.shipment_id = s.id AND COALESCE(d.is_discharge_port, false) AND COALESCE(d.is_cancelled, false) = false))::text AS effective_atc
         FROM vessel_loading_ports v
         JOIN shipments s ON s.id = v.shipment_id
         JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE TRIM(COALESCE(s.operation_id, '')) = $1 AND NOT COALESCE(v.is_discharge_port, false) AND COALESCE(v.is_cancelled, false) = false AND ${live}
        ORDER BY c.po_number, v.port_sequence`,
      [restoreOp],
    )).rows;
    console.log(`${rows.length} live loading-port row(s)\n`);
    for (const r of rows) {
      console.log(`  PO ${r.po}  STO ${r.sto}  ${r.port_name}   (the shipment's discharge ATC: ${d10(r.effective_atc) || 'unknown'})`);
      const fields = [];
      for (const [f, m] of LOADING_FIELDS) {
        const cur = r[`cur_${f}`];
        const mir = r[`mir_${f}`];
        let verdict;
        if (!mir) verdict = 'no SAP mirror: left alone';
        else if (!cur) verdict = 'empty: left alone';
        else if (d10(cur) === d10(mir)) verdict = 'same as SAP: fine';
        else if (!r.effective_atc) verdict = 'discharge ATC unknown: nothing proves it wrong, left alone';
        else if (d10(cur) <= d10(r.effective_atc)) verdict = `differs from SAP but does not follow the discharge ATC ${d10(r.effective_atc)}: not proven wrong, left alone`;
        else {
          verdict = `RESTORE to ${d10(mir)}${apply ? '' : '  (dry run)'}`;
          fields.push({ f, m, cur, mir });
        }
        console.log(`      ${f.padEnd(22)} now ${d10(cur) || '-'}  SAP ${d10(mir) || '-'}  ${marked(r.edited, f) ? '[typed-by-person marker]  ' : ''}-> ${verdict}`);
      }
      if (fields.length > 0) restoreTargets.push({ r, fields });
    }
    console.log(`\n${restoreTargets.length} loading-port row(s) to restore (${restoreTargets.reduce((a, t) => a + t.fields.length, 0)} field(s)).`);
  }

  if (clearTargets.length > max || restoreTargets.length > max) {
    console.error(`More than --max=${max} rows in a part: this is not the case this script was written for. Nothing written.`);
    process.exit(1);
  }
  if (!apply) {
    console.log('\ndry run - nothing written. Add --apply to write.');
    await pool.end();
    return;
  }

  console.log('\nto put the old values back (keep this output):');
  for (const r of clearTargets) {
    undo.push(`UPDATE vessel_loading_ports SET ata_loading_completed = ${r.port_ata ? `'${r.port_ata.slice(0, 19)}'` : 'NULL'}, sap_ata_loading_completed = ${r.sap_mirror ? `'${r.sap_mirror.slice(0, 10)}'` : 'NULL'} WHERE id = '${r.port_id}';`);
  }
  for (const t of restoreTargets) {
    const sets = t.fields.map(({ f, cur }) => `${f} = '${String(cur).slice(0, 19)}'`).join(', ');
    undo.push(`UPDATE vessel_loading_ports SET ${sets}, klip_edited_fields = '${String(t.r.edited || '{}')}'::text[] WHERE id = '${t.r.port_id}';`);
  }
  for (const t of statusTargets) undo.push(`UPDATE shipments SET status = 'COMPLETED' WHERE id = '${t.shipmentId}';`);
  for (const line of undo) console.log(`  ${line}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of clearTargets) {
      const res = await client.query(
        `UPDATE vessel_loading_ports SET ata_loading_completed = NULL, sap_ata_loading_completed = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::uuid AND ata_loading_completed IS NOT NULL AND NOT ('ata_loading_completed' = ANY(COALESCE(klip_edited_fields, '{}'))) RETURNING id`,
        [r.port_id],
      );
      if (res.rows.length === 1) touchedShipments.add(r.shipment_id);
    }
    for (const t of restoreTargets) {
      const sets = t.fields.map(({ f, m }) => `${f} = ${m}::timestamp`).join(', ');
      const res = await client.query(
        `UPDATE vessel_loading_ports SET ${sets},
                klip_edited_fields = ARRAY(SELECT x FROM unnest(COALESCE(klip_edited_fields, '{}')) AS x WHERE x <> ALL($2::text[])), updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::uuid RETURNING id`,
        [t.r.port_id, t.fields.map(({ f }) => f)],
      );
      if (res.rows.length === 1) touchedShipments.add(t.r.shipment_id);
    }
    for (const t of statusTargets) {
      await client.query(`UPDATE shipments SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND UPPER(COALESCE(status, '')) = 'COMPLETED'`, [t.shipmentId, t.next]);
      touchedShipments.add(t.shipmentId);
    }
    await client.query('COMMIT');
    console.log(`\nCOMMITTED: ${clearTargets.length} discharge row(s) cleared, ${restoreTargets.length} loading row(s) restored, ${statusTargets.length} status(es) reset.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  if (touchedShipments.size > 0) {
    // Fire-and-forget: it SCHEDULES the snapshot refreshes, which still need this connection; poll the stale flags and close only when they are clear.
    invalidateAfterShipmentWrite([...touchedShipments]);
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
    console.log('NOTE: the running backend keeps its own in-memory list caches (about an hour); they expire on their own or clear on the next shipment save in the app.');
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
