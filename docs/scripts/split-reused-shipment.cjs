/*
 * Split a shipment that a second plan overwrote back into the two voyages it was made of.
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/split-reused-shipment.cjs | docker exec -i klip-backend node - \
 *     --shipment=<row to restore as the first voyage> --first-vessel="BG. DAHLIA" --first-delivered-kg=1378000 --first-sfal=1395645000 --first-sfbd=1389016000 \
 *     --moved-po-shipment=<shipment of the PO added to the second voyage>
 *
 * Three modes: no flag = prints the plan and the rows involved, writes nothing; --rehearse = performs every write inside a transaction, prints the
 * resulting rows and ROLLS BACK; --apply = commits. Needs no deploy - it calls the code already in the running image.
 *
 * Why: planning PO 1001031313 a second time (Kapuas 168, to cover what the Dahlia voyage left outstanding) UPDATEd the Dahlia shipment row instead of
 * inserting a new one (createShipment.service.ts, fixed). The row kept Dahlia's ETAs, ATAs, ports and received quantity under the new vessel and operation.
 *
 * What it does, in one transaction:
 *   1. Inserts a NEW shipment for the second voyage: the vessel, operation id, ports, Delivered (Klip) and Shipment Plan the row carries NOW (they are the
 *      second plan's), no ETA / ATA / status progress.
 *   2. Restores the existing row as the FIRST voyage: vessel (and code / owner / master vessel when the master has exactly one row of that name), a new
 *      operation id of its own, Delivered (Klip) = --first-delivered-kg, Shipment Plan cleared (the first plan's value was not recorded), SFAL / SFBD =
 *      --first-sfal / --first-sfbd (the values the row had while it was the first voyage; the ones it carries now go to the second voyage). It keeps its
 *      ETAs, ATA override, port rows, documents and audit trail: those are the first voyage's.
 *   3. Moves the --moved-po-shipment into the second voyage's operation (the PO that was added to the second voyage).
 * Nothing else is touched. It refuses when the row is not in the state described (see the checks).
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');

  const flag = (name) => {
    const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
    return hit ? hit.slice(name.length + 3).trim() : '';
  };
  const apply = process.argv.includes('--apply');
  const rehearse = process.argv.includes('--rehearse');
  const rowId = flag('shipment');
  const firstVessel = flag('first-vessel');
  const firstDeliveredKg = Number(flag('first-delivered-kg'));
  const movedId = flag('moved-po-shipment');
  const firstSfal = flag('first-sfal') === '' ? null : Number(flag('first-sfal'));
  const firstSfbd = flag('first-sfbd') === '' ? null : Number(flag('first-sfbd'));
  if ((firstSfal !== null && !Number.isFinite(firstSfal)) || (firstSfbd !== null && !Number.isFinite(firstSfbd))) {
    console.error('--first-sfal / --first-sfbd must be numbers');
    process.exit(1);
  }
  const moveSf = firstSfal !== null || firstSfbd !== null;
  if (!rowId || !firstVessel || !Number.isFinite(firstDeliveredKg) || firstDeliveredKg <= 0 || !movedId) {
    console.error('Needs --shipment, --first-vessel, --first-delivered-kg and --moved-po-shipment. Nothing is touched without them.');
    process.exit(1);
  }
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');
  const refuse = (why) => {
    console.error(`\nREFUSED: ${why}`);
    process.exit(2);
  };

  const rows = (await pool.query(
    `SELECT s.*, c.contract_id AS business_contract, c.po_number FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id WHERE s.id = ANY($1::uuid[])`,
    [[rowId, movedId]],
  )).rows;
  const R = rows.find((r) => String(r.id) === rowId);
  const S = rows.find((r) => String(r.id) === movedId);
  if (!R || !S) refuse('a shipment was not found');

  const [sao] = (await pool.query(`SELECT * FROM shipment_ata_overrides WHERE shipment_id = $1::uuid`, [rowId])).rows;
  const secondOp = String(R.operation_id || '').trim();
  const masters = (await pool.query(
    `SELECT id::text AS id, vessel_code, vessel_name, vessel_owner FROM master_vessels WHERE UPPER(TRIM(vessel_name)) = UPPER(TRIM($1))`,
    [firstVessel],
  )).rows;

  console.log('Row to restore as the FIRST voyage');
  console.log(`  ${rowId}  contract ${R.business_contract} po ${R.po_number}  status ${R.status}  vessel ${R.vessel_name}  operation ${secondOp}`);
  console.log(`  ETA discharge arrival/berthed/start/complete = ${['eta_discharge_arrival', 'eta_discharge_berthed', 'eta_discharge_start', 'eta_discharge_complete'].map((k) => day(R[k])).join(' / ')}`);
  console.log(`  ATA override discharge arrival/berthed/start/complete = ${sao ? ['ata_discharge_arrival', 'ata_discharge_berthed', 'ata_discharge_start', 'ata_discharge_complete'].map((k) => day(sao[k])).join(' / ') : '(none)'}`);
  console.log(`  Delivered (Klip) now ${R.quantity_delivered_klip}   Shipment Plan now ${R.quantity_shipment_plan}   SFAL ${R.sfal_qty}  SFBD ${R.sfbd_qty}`);
  console.log('PO shipment to move into the second voyage');
  console.log(`  ${movedId}  contract ${S.business_contract} po ${S.po_number}  status ${S.status}  operation ${S.operation_id}`);
  console.log(`Master vessel rows named "${firstVessel}": ${masters.length ? masters.map((m) => `${m.vessel_code} (${m.vessel_owner || 'no owner'})`).join(', ') : 'none'}`);

  if (!secondOp) refuse('the row has no operation id');
  if (/^cancel/i.test(String(R.status || '')) || /^cancel/i.test(String(S.status || ''))) refuse('a shipment is cancelled');
  if (String(S.operation_id || '').trim() === secondOp) refuse('the PO shipment is already in the second voyage operation');
  if (!(Number(R.quantity_shipment_plan) > 0) && !(Number(R.quantity_delivered_klip) > 0)) {
    refuse('the row carries no Shipment Plan or Delivered (Klip) - there is no second voyage on it to split off');
  }
  if (!sao || !sao.ata_discharge_complete) refuse('the row has no discharge-complete ATA - it is not a finished first voyage');
  if (masters.length > 1) refuse(`${masters.length} master vessels are named "${firstVessel}" - pick one and add --first-master-vessel=<id>`);

  const firstOp = `OP-${R.business_contract}-${Date.now().toString().slice(-8)}`;
  const secondShipmentId = `MNL-${(Date.now() + 1).toString().slice(-8)}-${R.business_contract}`;
  const master = masters[0];

  console.log('\nPlan' + (apply ? '' : rehearse ? ' (rehearsal: rolled back)' : ' (nothing written)') + ':');
  console.log(`  1. NEW shipment  ${secondShipmentId}  vessel ${R.vessel_name}  operation ${secondOp}  plan ${R.quantity_shipment_plan}  delivered (Klip) ${R.quantity_delivered_klip}  no ETA / ATA`);
  console.log(`  2. ${rowId.slice(0, 8)} becomes the first voyage: vessel ${firstVessel}${master ? ` (${master.vessel_code})` : ' (name only)'}  operation ${firstOp}  delivered (Klip) ${firstDeliveredKg}  plan cleared` + (moveSf ? `  SFAL ${firstSfal ?? R.sfal_qty} SFBD ${firstSfbd ?? R.sfbd_qty} (the second voyage gets SFAL ${R.sfal_qty} SFBD ${R.sfbd_qty})` : '  (SFAL / SFBD left as they are)'));
  console.log(`  3. ${movedId.slice(0, 8)} (po ${S.po_number}) moves to operation ${secondOp}`);
  if (!apply && !rehearse) {
    console.log('\nnothing written. Add --rehearse to run the writes and roll back, or --apply to commit.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let newId = null;
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO shipments (
         shipment_id, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner, vessel_draft, vessel_capacity,
         vessel_hull_type, charter_type, port_of_loading, port_of_discharge, quantity_delivered, quantity_delivered_klip, quantity_shipment_plan, sfal_qty, sfbd_qty, status)
       SELECT $2, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner, vessel_draft, vessel_capacity,
              vessel_hull_type, charter_type, port_of_loading, port_of_discharge, quantity_delivered_klip, quantity_delivered_klip, quantity_shipment_plan,
              CASE WHEN $3::boolean THEN sfal_qty END, CASE WHEN $3::boolean THEN sfbd_qty END, 'PLANNED'
         FROM shipments WHERE id = $1::uuid
       RETURNING id::text AS id`,
      [rowId, secondShipmentId, moveSf],
    );
    newId = ins.rows[0].id;
    // the second voyage keeps the master vessel link the row carries now
    await client.query(`UPDATE shipments n SET master_vessel_id = r.master_vessel_id FROM shipments r WHERE n.id = $2::uuid AND r.id = $1::uuid AND r.master_vessel_id IS NOT NULL`, [rowId, newId]);

    const upd = await client.query(
      `UPDATE shipments SET vessel_name = $2,
              vessel_code = $3, vessel_owner = $4, master_vessel_id = $5::uuid,
              operation_id = $6, operation_id_source = NULL,
              quantity_delivered = $7::numeric, quantity_delivered_klip = $7::numeric, quantity_shipment_plan = NULL,
              sfal_qty = COALESCE($9::numeric, sfal_qty), sfbd_qty = COALESCE($10::numeric, sfbd_qty),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND TRIM(COALESCE(operation_id, '')) = $8`,
      [rowId, master ? master.vessel_name : firstVessel, master ? master.vessel_code : null, master ? master.vessel_owner : null, master ? master.id : null, firstOp, firstDeliveredKg, secondOp, firstSfal, firstSfbd],
    );
    if (upd.rowCount !== 1) throw new Error(`expected to restore 1 row, restored ${upd.rowCount}`);

    const mv = await client.query(
      `UPDATE shipments SET operation_id = $2, operation_id_source = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
      [movedId, secondOp],
    );
    if (mv.rowCount !== 1) throw new Error(`expected to move 1 PO shipment, moved ${mv.rowCount}`);

    const check = await client.query(
      `SELECT s.id::text AS id, c.po_number, s.vessel_name, s.operation_id, s.status, s.quantity_delivered_klip, s.quantity_shipment_plan, s.sfal_qty, s.sfbd_qty,
              s.eta_discharge_complete, sao.ata_discharge_complete AS ata_override_complete
         FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
        WHERE s.id = ANY($1::uuid[]) ORDER BY s.operation_id, c.po_number`,
      [[rowId, newId, movedId]],
    );
    console.log('\nResulting rows:');
    for (const r of check.rows) {
      console.log(`  ${r.id.slice(0, 8)} po ${r.po_number}  ${r.vessel_name}  op ${r.operation_id}  status ${r.status}  delivered(Klip) ${r.quantity_delivered_klip}  plan ${r.quantity_shipment_plan}  SFAL ${r.sfal_qty} SFBD ${r.sfbd_qty}  ETC ${day(r.eta_discharge_complete)}  ATC override ${day(r.ata_override_complete)}`);
    }
    if (apply) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED');
    } else {
      await client.query('ROLLBACK');
      console.log('\nROLLED BACK (rehearsal) - nothing was changed');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  if (apply) {
    invalidateAfterShipmentWrite([rowId, newId, movedId]);
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
    console.log('NOTE: the running backend keeps its own in-memory list caches (about an hour); they expire on their own or clear on the next shipment save in the app.');
  }
  await pool.end();
})().catch((e) => {
  console.error('failed:', e);
  process.exit(1);
});
