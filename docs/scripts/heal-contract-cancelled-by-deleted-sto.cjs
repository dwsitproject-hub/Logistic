/**
 * Bring back a contract (and its shipments) that ONE deleted STO cancelled although the PO still has a live STO.
 *
 * Until the fix, a SAP line with Delete STO Status (say "L") was read like a Delete PO Status line: the contract went to CANCELLED and every shipment
 * and trucking operation of it was cancelled. PO 1001032300 (contract 1004032300, 2026-10-20) has STO 1006020464 open and STO 1006020263 deleted, GR PO and GR STO
 * Open - and KLIP held the whole contract CANCELLED. The import now cancels only the deleted STO (utils/sapDeletedPoLines.ts), but it hash-skips a row that has
 * not changed, so a contract already cancelled stays cancelled until this runs.
 *
 *   --scan                       list the contracts that look wrongly cancelled (CANCELLED, with a SAP line that carries neither delete flag). Writes nothing.
 *   --contracts=1004032300[,..]  show what would change for those contracts; nothing is written without --apply
 *   --contracts=... --apply      set the contract back to what SAP reads (ACTIVE when open, COMPLETED when Close) and its shipments to the status their ATA ladder gives (restore-shipments-cancelled-by-deleted-line.cjs
 *                                rule), EXCEPT the shipments of a deleted STO, which stay CANCELLED. Trucking operations are counted and left alone.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/heal-contract-cancelled-by-deleted-sto.cjs | docker exec -i klip-backend node - --scan
 *   ... | docker exec -i klip-backend node - --contracts=1004032300
 *   ... | docker exec -i klip-backend node - --contracts=1004032300 --apply
 *
 * A contract is healed only when Contract Performance's own reading (import_status, from the latest SAP lines) is NOT Cancelled, so this never overrides SAP:
 * a PO whose every STO is deleted stays cancelled. Needs no deploy - it calls the code already in the running image.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');
  const { ContractPerformanceSnapshotService } = dist('services/contractPerformanceSnapshot.service');
  const { sqlContractImportStatusExpr } = dist('utils/contractDeliveryStatus');
  const { sqlSpdHasDeletePoFlagFromRow, sqlSpdHasDeleteStoFlagFromRow } = dist('utils/sapMasterV2UatFormat');
  const { deriveShipmentStatus } = dist('utils/shipmentStatus');

  const apply = process.argv.includes('--apply');
  const scan = process.argv.includes('--scan');
  const arg = process.argv.find((a) => a.startsWith('--contracts='));
  const contractNumbers = (arg ? arg.slice('--contracts='.length) : '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!scan && contractNumbers.length === 0) {
    console.error('Give --scan, or --contracts=1004032300[,...] (add --apply to write). Nothing is touched without one of them.');
    process.exit(1);
  }
  if (apply && scan) {
    console.error('--apply goes with --contracts=..., not with --scan: name the contracts you have read.');
    process.exit(1);
  }

  // The status KLIP stores for what SAP reads: Close -> COMPLETED, otherwise ACTIVE (the same mapping statusForDb applies on import).
  const targetStatus = (importStatus) => (['CLOSE', 'CLOSED', 'COMPLETED', 'COMPLETE'].includes(String(importStatus || '').trim().toUpperCase()) ? 'COMPLETED' : 'ACTIVE');

  const live = (a) => `NOT (${sqlSpdHasDeletePoFlagFromRow(a)}) AND NOT (${sqlSpdHasDeleteStoFlagFromRow(a)}) AND NULLIF(TRIM(${a}.sto_number::text), '') IS NOT NULL`;

  if (scan) {
    const r = await pool.query(
      `SELECT c.contract_id, c.po_number, c.status, ${sqlContractImportStatusExpr('c')} AS import_status,
              (SELECT COUNT(*)::int FROM sap_processed_data l WHERE l.contract_number = c.contract_id AND l.po_number = c.po_number AND ${live('l')}) AS live_stos,
              (SELECT COUNT(*)::int FROM sap_processed_data d WHERE d.contract_number = c.contract_id AND d.po_number = c.po_number AND ${sqlSpdHasDeleteStoFlagFromRow('d')}) AS deleted_stos,
              (SELECT COUNT(*)::int FROM shipments s WHERE s.contract_id = c.id AND UPPER(COALESCE(s.status, '')) = 'CANCELLED') AS cancelled_shipments
         FROM contracts c
        WHERE UPPER(COALESCE(c.status, '')) = 'CANCELLED'
          AND EXISTS (SELECT 1 FROM sap_processed_data l WHERE l.contract_number = c.contract_id AND l.po_number = c.po_number AND ${live('l')})
        ORDER BY c.contract_id`,
    );
    const wrong = r.rows.filter((x) => String(x.import_status || '').toUpperCase() !== 'CANCELLED');
    console.log(`CANCELLED contracts with a live SAP STO line: ${r.rows.length}; of them SAP still reads open (would be healed): ${wrong.length}`);
    for (const x of wrong) {
      console.log(`   ${String(x.contract_id).padEnd(12)} PO ${String(x.po_number).padEnd(12)} import_status=${String(x.import_status || '-').padEnd(8)} -> ${targetStatus(x.import_status).padEnd(9)} live STOs ${x.live_stos}  deleted STOs ${x.deleted_stos}  cancelled shipments ${x.cancelled_shipments}`);
    }
    console.log('\nread-only. Re-run with --contracts=<numbers> to see what would change, then add --apply.');
    await pool.end();
    return;
  }

  const restored = [];
  let contractsHealed = 0;
  for (const contractNumber of contractNumbers) {
    const c = await pool.query(
      `SELECT c.id::text AS id, c.contract_id, c.po_number, c.status, ${sqlContractImportStatusExpr('c')} AS import_status
         FROM contracts c WHERE c.contract_id = $1`,
      [contractNumber],
    );
    const row = c.rows[0];
    if (!row) {
      console.log(`${contractNumber}: not found - skipped`);
      continue;
    }
    console.log(`\n${contractNumber} (PO ${row.po_number}): status=${row.status || '-'} import_status=${row.import_status || '-'}`);
    const lines = await pool.query(
      `SELECT TRIM(spd.sto_number::text) AS sto, spd.import_id::text AS import_id, spd.last_seen_at::date AS seen,
              (${sqlSpdHasDeletePoFlagFromRow('spd')}) AS del_po, (${sqlSpdHasDeleteStoFlagFromRow('spd')}) AS del_sto
         FROM sap_processed_data spd WHERE spd.contract_number = $1 AND spd.po_number = $2 ORDER BY 1`,
      [contractNumber, row.po_number],
    );
    for (const l of lines.rows) {
      console.log(`    SAP line STO ${String(l.sto || '-').padEnd(12)} import ${String(l.import_id || '-').slice(0, 8)} seen ${l.seen ? String(l.seen).slice(0, 10) : '-'}  Delete PO ${l.del_po}  Delete STO ${l.del_sto}`);
    }
    const liveRows = lines.rows.filter((l) => !l.del_po && !l.del_sto && l.sto);
    const deletedStos = new Set(lines.rows.filter((l) => l.del_sto && l.sto && !liveRows.some((x) => x.sto === l.sto)).map((l) => l.sto));
    if (String(row.status || '').toUpperCase() !== 'CANCELLED') {
      console.log('    contract is not CANCELLED - nothing to heal here (shipments of a live contract are not touched by this script)');
      continue;
    }
    if (liveRows.length === 0) {
      console.log('    no live SAP STO line: every STO is deleted, so the PO IS cancelled - left alone');
      continue;
    }
    if (String(row.import_status || '').toUpperCase() === 'CANCELLED') {
      console.log('    SAP reads this PO as Cancelled (import_status) - left alone');
      continue;
    }

    const ships = await pool.query(
      `SELECT s.id::text AS id, s.shipment_id, s.operation_id,
              s.eta_arrival, s.eta_berthed, s.eta_loading_start, s.eta_loading_complete, s.eta_sailed,
              s.eta_discharge_arrival, s.eta_discharge_berthed, s.eta_discharge_start, s.eta_discharge_complete,
              COALESCE(sao.ata_arrival, s.ata_arrival) AS ata_arrival,
              COALESCE(sao.ata_berthed, s.ata_berthed) AS ata_berthed,
              COALESCE(sao.ata_loading_start, s.ata_loading_start) AS ata_loading_start,
              COALESCE(sao.ata_loading_complete, s.ata_loading_complete) AS ata_loading_complete,
              COALESCE(sao.ata_sailed, s.ata_sailed) AS ata_sailed,
              COALESCE(sao.jps_ata_discharge_arrival, sao.ata_discharge_arrival, s.ata_discharge_arrival) AS ata_discharge_arrival,
              COALESCE(sao.jps_ata_discharge_berthed, sao.ata_discharge_berthed, s.ata_discharge_berthed) AS ata_discharge_berthed,
              COALESCE(sao.jps_ata_discharge_start, sao.ata_discharge_start, s.ata_discharge_start) AS ata_discharge_start,
              COALESCE(sao.jps_ata_discharge_complete, sao.ata_discharge_complete, s.ata_discharge_complete) AS ata_discharge_complete
         FROM shipments s
         LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE s.contract_id = $1::uuid AND UPPER(COALESCE(s.status, '')) = 'CANCELLED'`,
      [row.id],
    );
    const trucking = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trucking_operations WHERE contract_id = $1::uuid AND deduped_at IS NULL AND status = 'CANCELLED'`,
      [row.id],
    );
    const target = targetStatus(row.import_status);
    console.log(`    -> contract CANCELLED -> ${target}${apply ? '' : '   (dry run)'}; ${ships.rows.length} cancelled shipment(s), ${trucking.rows[0].n} cancelled trucking op(s) left alone; deleted STO(s): ${[...deletedStos].join(', ') || '-'}`);

    if (apply) {
      const u = await pool.query(
        `UPDATE contracts SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND UPPER(COALESCE(status, '')) = 'CANCELLED' RETURNING id`,
        [row.id, target],
      );
      contractsHealed += u.rowCount || 0;
    }
    for (const s of ships.rows) {
      const own = String(s.shipment_id || '').trim();
      const ofDeletedSto = [...deletedStos].some((sto) => own === sto || own.startsWith(sto + '-'));
      if (ofDeletedSto) {
        console.log(`    shipment ${own}: stays CANCELLED (its STO is deleted)`);
        continue;
      }
      const next = deriveShipmentStatus({
        eta_arrival_at_loading_port: s.eta_arrival,
        eta_berthed_at_loading_port: s.eta_berthed,
        eta_start_loading: s.eta_loading_start,
        eta_completed_loading: s.eta_loading_complete,
        eta_sailed_from_loading_port: s.eta_sailed,
        eta_arrive_at_discharge_port: s.eta_discharge_arrival,
        eta_berthed_at_discharge_port: s.eta_discharge_berthed,
        eta_start_discharging: s.eta_discharge_start,
        eta_complete_discharge: s.eta_discharge_complete,
        ata_arrival_at_loading_port: s.ata_arrival,
        ata_berthed_at_loading_port: s.ata_berthed,
        ata_start_loading: s.ata_loading_start,
        ata_completed_loading: s.ata_loading_complete,
        ata_sailed_from_loading_port: s.ata_sailed,
        ata_arrive_at_discharge_port: s.ata_discharge_arrival,
        ata_berthed_at_discharge_port: s.ata_discharge_berthed,
        ata_start_discharging: s.ata_discharge_start,
        ata_complete_discharge: s.ata_discharge_complete,
        contract_import_status: row.import_status,
      });
      console.log(`    shipment ${own || s.operation_id}: CANCELLED -> ${next}${apply ? '' : '   (dry run)'}`);
      if (apply) {
        const r = await pool.query(
          `UPDATE shipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid AND UPPER(COALESCE(status, '')) = 'CANCELLED' RETURNING id::text`,
          [next, s.id],
        );
        if (r.rows.length > 0) restored.push(String(s.id));
      }
    }
  }

  if (apply && (contractsHealed > 0 || restored.length > 0)) {
    // The contract status feeds the Contract Performance snapshot even when no shipment changed, and the per-shipment refresh cannot reach a contract that has none.
    // So rebuild the snapshot IN FULL, awaited. This used to only MARK it stale, and nothing then ran the full rebuild that clears the flag (only refreshAll sets
    // is_stale = FALSE): the flag stayed true for hours, and while it is true the Contract Performance page and the Contracts list leave the snapshot and compute
    // live, which is the ~65 s / ~182 s cold path. (Production 2026-10-20, 04:51 UTC and 06:13 UTC.)
    console.log('\nrebuilding the Contract Performance snapshot in full (about 2-3 minutes) ...');
    const rebuilt = await ContractPerformanceSnapshotService.refreshAll();
    console.log(`snapshot rebuilt: ${rebuilt} rows`);
    invalidateAfterShipmentWrite(restored);
    const staleNow = async () => {
      const r = await pool.query(
        `SELECT (SELECT COUNT(*) FROM pipeline_summary_refresh_meta WHERE is_stale) +
                (SELECT COUNT(*) FROM contract_performance_snapshot_meta WHERE is_stale) +
                (SELECT COUNT(*) FROM oil_loss_snapshot_meta WHERE is_stale) AS n`,
      );
      return Number(r.rows[0].n);
    };
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
    console.log(
      `\nhealed ${contractsHealed} contract(s), restored ${restored.length} shipment(s); ` +
        (remaining === 0 ? 'snapshots refreshed' : `${remaining} snapshot flag(s) still stale after 5 min - they rebuild on the next refresh`),
    );
    console.log('NOTE: the running backend keeps its own in-memory list caches (about an hour); they expire on their own or clear on the next shipment save in the app.');
  } else if (!apply) {
    console.log('\ndry run - nothing written. Add --apply to heal.');
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
