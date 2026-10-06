/**
 * Bring back the shipments that a deleted PO LINE cancelled, once the PO is no longer cancelled.
 *
 * Before the 2026-10-06 fix, an export listing one PO on two lines - one with Delete PO Status "S", one open - let the deleted
 * line cancel the contract's shipments. Re-importing the file now heals the contract, but the shipment update path keeps a
 * CANCELLED shipment CANCELLED on purpose (SAP must not revive one that was cancelled), so those shipments stay cancelled.
 * This restores them, for the contracts you name and only when the contract itself is no longer cancelled.
 *
 * Shipments only. Trucking operations are counted and left alone: their status comes from SAP receive dates.
 * Needs no deploy - it calls the code already in the running image. Dry run unless --apply:
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/restore-shipments-cancelled-by-deleted-line.cjs \
 *     | docker exec -i klip-backend node - --contracts=1004031313
 *   ... | docker exec -i klip-backend node - --contracts=1004031313 --apply
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');
  const { sqlContractImportStatusExpr } = dist('utils/contractDeliveryStatus');
  const { deriveShipmentStatus } = dist('utils/shipmentStatus');

  const apply = process.argv.includes('--apply');
  const arg = process.argv.find((a) => a.startsWith('--contracts='));
  const contractNumbers = (arg ? arg.slice('--contracts='.length) : '').split(',').map((s) => s.trim()).filter(Boolean);
  if (contractNumbers.length === 0) {
    console.error('Give the contracts to restore: --contracts=1004031313[,...]  (nothing is touched without them)');
    process.exit(1);
  }

  const restored = [];
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
    const text = `status=${row.status || '-'} import_status=${row.import_status || '-'}`;
    const stillCancelled =
      String(row.status || '').toUpperCase() === 'CANCELLED' || String(row.import_status || '').toUpperCase() === 'CANCELLED';
    if (stillCancelled) {
      console.log(`${contractNumber} (PO ${row.po_number}): ${text} - still cancelled, so its shipments stay cancelled. Re-import the SAP file first.`);
      continue;
    }
    const ships = await pool.query(
      // The ATAs the pages show: the JPS lane (the shipment is not COMPLETED, so it counts), then a KLIP edit
      // (shipment_ata_overrides), then the shipment's own column. Reading only shipments.* missed an ATS typed in the modal.
      `SELECT s.id::text AS id, s.shipment_id, s.operation_id, s.status,
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
    console.log(`${contractNumber} (PO ${row.po_number}): ${text} - ${ships.rows.length} cancelled shipment(s), ${trucking.rows[0].n} cancelled trucking op(s) left alone`);
    for (const s of ships.rows) {
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
      console.log(
        `    shipment ${s.shipment_id || s.operation_id}: CANCELLED -> ${next}${apply ? '' : '   (dry run)'}` +
          `   [ATS discharge: ${s.ata_discharge_start ? String(s.ata_discharge_start).slice(0, 10) : '-'}, ATC: ${s.ata_discharge_complete ? String(s.ata_discharge_complete).slice(0, 10) : '-'}]`,
      );
      if (apply) {
        const r = await pool.query(
          `UPDATE shipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid AND UPPER(COALESCE(status, '')) = 'CANCELLED' RETURNING id::text`,
          [next, s.id],
        );
        if (r.rows.length > 0) restored.push(String(s.id));
      }
    }
  }
  if (apply && restored.length > 0) {
    // Fire-and-forget: it SCHEDULES the Contract Performance snapshot refresh and the oil-loss stale flag, which still need this
    // connection. Closing the pool straight away made both fail, so wait for them.
    invalidateAfterShipmentWrite(restored);
    await new Promise((resolve) => setTimeout(resolve, 12000));
    console.log(`\nrestored ${restored.length} shipment(s); snapshots refreshed`);
    console.log(
      'NOTE: the running backend keeps its own in-memory list caches (about an hour). They are not cleared from here - they expire ' +
        'on their own, or clear on the next shipment save in the app.',
    );
  } else if (!apply) {
    console.log('\ndry run - nothing written. Add --apply to restore.');
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
