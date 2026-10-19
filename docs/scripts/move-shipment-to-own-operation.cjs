/*
 * Move ONE planned shipment out of an operation whose voyage is already finished, into an operation of its own.
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/move-shipment-to-own-operation.cjs | docker exec -i klip-backend node - --shipment=<shipment uuid>
 *
 * Dry run unless --apply. Needs no deploy - it calls the code already in the running image.
 *
 * Why: a PO that was added to an operation AFTER its voyage ended (operation OP-1004031313-76403194, PO 1001031718) shares the operation's single
 * Shipments row, and that row reads Completed from the finished PO's discharge ATA while the added PO has nothing delivered. Giving the added PO an
 * operation of its own makes the finished voyage a Completed row and the waiting PO a Planned row.
 *
 * What it changes, in one transaction:
 *   1. shipments.operation_id of that one shipment -> a new OP-<contract>-<8 digits> (the format Add New Shipment writes), operation_id_source -> NULL.
 *   2. user_sto_contract_assignments: the PO's row under the old key is re-keyed to the new one (it holds the PO's Shipment Plan Qty and is how
 *      Edit Shipment finds the PO of an operation).
 * Nothing else is touched: no quantity, status, ATA, port or SAP row. The shipment keeps its own id, shipment_id, vessel and ports.
 *
 * It REFUSES unless the shipment is exactly the reported case: not cancelled, in an OP- operation, another active member of that operation has a
 * discharge ATA and this one has none, and this PO's contract has nothing delivered or received. --force skips only the delivery check.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');

  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const arg = process.argv.find((a) => a.startsWith('--shipment='));
  const shipmentId = (arg ? arg.slice('--shipment='.length) : '').trim();
  if (!shipmentId) {
    console.error('Give the shipment to move: --shipment=<uuid>  (nothing is touched without it)');
    process.exit(1);
  }
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');

  const sRes = await pool.query(
    `SELECT s.id::text AS id, s.shipment_id, s.operation_id, s.status, s.vessel_name, c.contract_id, c.po_number
       FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id WHERE s.id = $1::uuid`,
    [shipmentId],
  );
  if (!sRes.rows.length) {
    console.error('shipment not found');
    process.exit(1);
  }
  const s = sRes.rows[0];
  const oldKey = String(s.operation_id || '').trim();
  console.log(`shipment ${s.id}  contract=${s.contract_id} po=${s.po_number} status=${s.status} vessel=${s.vessel_name || '-'}`);
  console.log(`operation_id: ${oldKey || '(none)'}   shipment_id: ${s.shipment_id}`);

  const refuse = (why) => {
    console.error(`\nREFUSED: ${why}`);
    process.exit(2);
  };
  if (/^cancel/i.test(String(s.status || ''))) refuse('the shipment is cancelled');
  if (!/^OP-/i.test(oldKey)) refuse('the shipment is not in an OP- operation');

  const members = await pool.query(
    `SELECT s.id::text AS id, c.po_number, s.status, s.created_at,
            COALESCE(sao.jps_ata_discharge_complete, sao.ata_discharge_complete, s.ata_discharge_complete,
              (SELECT MAX(v.ata_loading_completed)::date FROM vessel_loading_ports v
                WHERE v.shipment_id = s.id AND COALESCE(v.is_discharge_port, false) = true)) AS atc
       FROM shipments s
       LEFT JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
      WHERE TRIM(COALESCE(s.operation_id, '')) = $1
        AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
      ORDER BY s.created_at`,
    [oldKey],
  );
  console.log('\nActive members of the operation:');
  for (const m of members.rows) {
    console.log(`  ${m.id === s.id ? '->' : '  '} ${m.id.slice(0, 8)} po=${m.po_number} status=${m.status} created=${day(m.created_at)} discharge ATA=${day(m.atc)}`);
  }
  const mine = members.rows.find((m) => m.id === s.id);
  if (!mine) refuse('the shipment is not an active member of its operation');
  if (mine.atc) refuse('this shipment has its own discharge ATA - it belongs to the finished voyage');
  if (!members.rows.some((m) => m.id !== s.id && m.atc)) refuse('no other member of the operation has a discharge ATA - nothing to separate');

  const snap = await pool.query(
    `SELECT COALESCE(quantity_delivery_vessel, 0) + COALESCE(quantity_delivery_trucking, 0) AS delivered, COALESCE(quantity_receive, 0) AS receive
       FROM contract_qty_move_snapshot WHERE contract_number = $1`,
    [s.contract_id],
  );
  const delivered = snap.rows.length ? Number(snap.rows[0].delivered) : 0;
  const received = snap.rows.length ? Number(snap.rows[0].receive) : 0;
  console.log(`\ncontract ${s.contract_id}: delivered ${delivered.toLocaleString('en-US')} kg, received ${received.toLocaleString('en-US')} kg${snap.rows.length ? '' : ' (no snapshot)'}`);
  if ((delivered > 0 || received > 0) && !force) refuse('the contract has deliveries - this PO may have been carried by the voyage (use --force only if it was not)');

  // --into=<OP key> puts several waiting POs of one operation into the SAME new operation (run once per shipment, reusing the key the first run printed).
  const intoArg = process.argv.find((a) => a.startsWith('--into='));
  const into = (intoArg ? intoArg.slice('--into='.length) : '').trim();
  if (into && (!/^OP-/i.test(into) || into === oldKey)) refuse('--into must be an OP- key different from the current operation');
  const newKey = into || `OP-${s.contract_id}-${Date.now().toString().slice(-8)}`;
  if (!into) {
    const taken = await pool.query(`SELECT 1 FROM shipments WHERE TRIM(COALESCE(operation_id, '')) = $1 LIMIT 1`, [newKey]);
    if (taken.rows.length) refuse(`generated key ${newKey} already exists - run again`);
  }

  const assign = await pool.query(
    `SELECT id::text AS id, sto_qty_assigned FROM user_sto_contract_assignments
      WHERE sto_number = $1 AND contract_number = $2 AND COALESCE(po_number, '') = COALESCE($3, '')`,
    [oldKey, s.contract_id, s.po_number],
  );
  console.log(`\nPlan${apply ? '' : ' (dry run)'}:`);
  console.log(`  shipments.operation_id           ${oldKey}  ->  ${newKey}`);
  console.log(`  user_sto_contract_assignments    ${assign.rows.length} row(s) re-keyed${assign.rows.length ? ` (plan qty ${assign.rows.map((r) => r.sto_qty_assigned).join(', ')})` : ''}`);

  if (!apply) {
    console.log('\ndry run - nothing written. Add --apply to move it.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `UPDATE shipments SET operation_id = $2, operation_id_source = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND TRIM(COALESCE(operation_id, '')) = $3`,
      [s.id, newKey, oldKey],
    );
    if (u.rowCount !== 1) throw new Error(`expected to update 1 shipment, updated ${u.rowCount}`);
    const a = await client.query(
      `UPDATE user_sto_contract_assignments SET sto_number = $4, updated_at = CURRENT_TIMESTAMP
        WHERE sto_number = $1 AND contract_number = $2 AND COALESCE(po_number, '') = COALESCE($3, '')`,
      [oldKey, s.contract_id, s.po_number, newKey],
    );
    await client.query('COMMIT');
    console.log(`\nmoved: shipment updated, ${a.rowCount} assignment row(s) re-keyed`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  // Fire-and-forget: it SCHEDULES the snapshot refreshes and all of them still need this connection, so poll the stale flags and close the pool
  // only once they are clear (or after 5 minutes).
  invalidateAfterShipmentWrite([s.id]);
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
  console.log(remaining === 0 ? 'snapshots refreshed' : `${remaining} snapshot flag(s) still stale after 5 min - they rebuild on the next refresh`);
  console.log(
    'NOTE: the running backend keeps its own in-memory list caches (about an hour). They are not cleared from here - they expire on their own, ' +
      'or clear on the next shipment save in the app.',
  );
  await pool.end();
})().catch((e) => {
  console.error('failed:', e);
  process.exit(1);
});
