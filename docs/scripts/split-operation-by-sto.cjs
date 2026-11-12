/*
 * One voyage, one shipment (Ryan, 2026-11-12): split the STO(s) you name out of an operation that holds more than one SAP STO, into an operation of their own.
 *
 *   cd /opt/klip && cat docs/scripts/split-operation-by-sto.cjs | docker exec -i klip-backend node - --op=OP-1004032450-17019387 --move-sto=1006019958
 *   ... --rehearse   performs every write inside a transaction, prints the resulting operations and ROLLS BACK
 *   ... --apply      commits
 *   ... --into=OP-...   (optional) puts the moved STO(s) into an existing / chosen OP- key instead of a generated one
 *
 * Needs no deploy: it calls the code already in the running image. Three modes: no flag = plan only, --rehearse, --apply.
 *
 * Why: OP-1004032450-17019387 holds the four POs of STO 1006020800 (BG. SMS 3000, loading from 24 Oct) AND the two POs of STO 1006019958 (Luminor 6, discharged 24 Sep in SAP).
 * The app treats every member of an operation as one group: ETA / ATA fan out to all of them (shipmentAtaStoFanOut), so the 24 Oct loading ATA was written over the finished
 * voyage's loading ATA and its discharge ATA of 24 Sep ended up on the new voyage's POs.
 *
 * What it changes, in one transaction:
 *   1. shipments.operation_id of the LIVE shipments of the named STO(s) -> one new OP-<contract>-<8 digits> (the format Add New Shipment writes), or --into.
 *      operation_id_source is left AS IT IS: a non-SAP-import id switches the SAP re-import's field protection on (hasKlipShipmentActivity), and this must not change silently.
 *   2. user_sto_contract_assignments: the moved POs' rows under the old key are re-keyed to the new one (they hold the PO's Shipment Plan Qty and are how Edit Shipment finds
 *      the PO of an operation).
 * Nothing else: no quantity, status, ATA, port, SAP row or document. Cancelled shipments stay where they are.
 *
 * It REFUSES unless: every --move-sto is a SAP STO (digits) held by a live member, the operation keeps at least one live member, and the operation really holds more than one STO.
 * It does NOT clean the dates the fan-out already wrote (a separate step, with the user's confirmation of the real state).
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

(async () => {
  const pool = dist('database/connection').default;
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');

  const flag = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3).trim() : '';
  };
  const apply = process.argv.includes('--apply');
  const rehearse = process.argv.includes('--rehearse');
  const op = flag('op');
  const moveSto = flag('move-sto').split(',').map((s) => s.trim()).filter(Boolean);
  const into = flag('into');
  if (!op || moveSto.length === 0) {
    console.error('Needs --op=OP-... and --move-sto=<STO>[,<STO>]. Nothing is touched without them.');
    process.exit(1);
  }
  const refuse = (why) => {
    console.error(`\nREFUSED: ${why}`);
    process.exit(2);
  };
  if (!/^OP-/i.test(op)) refuse('--op is not an OP- operation key');
  if (moveSto.some((s) => !/^\d+$/.test(s))) refuse('--move-sto must be SAP STO numbers (digits only)');
  if (into && (!/^OP-/i.test(into) || into === op)) refuse('--into must be an OP- key different from --op');
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');

  const loadMembers = async (db, key) =>
    (await db.query(
      `SELECT s.id::text AS id, c.contract_id, c.po_number, TRIM(s.shipment_id::text) AS sto, s.status, s.vessel_name, s.operation_id_source AS source, s.created_at,
              (SELECT COUNT(*) FROM user_sto_contract_assignments a WHERE a.sto_number = s.operation_id AND a.contract_number = c.contract_id
                  AND COALESCE(a.po_number, '') = COALESCE(c.po_number, ''))::int AS assignments
         FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id
        WHERE TRIM(COALESCE(s.operation_id, '')) = $1
        ORDER BY TRIM(s.shipment_id::text), c.po_number`,
      [key],
    )).rows;
  const isLive = (m) => !/^cancel/i.test(String(m.status || ''));
  const printMembers = (title, rows) => {
    console.log(title);
    for (const m of rows) {
      console.log(`  ${m.id.slice(0, 8)}  STO ${m.sto}  PO ${m.po_number}  contract ${m.contract_id}  ${String(m.status).padEnd(10)}  vessel ${m.vessel_name || '-'}  source ${m.source || '-'}  assignment rows ${m.assignments}`);
    }
  };

  const members = await loadMembers(pool, op);
  printMembers(`operation ${op}: ${members.length} shipment(s)`, members);
  const live = members.filter(isLive);
  const stos = [...new Set(live.map((m) => m.sto))];
  console.log(`\nlive members: ${live.length}, STOs among them: ${stos.join(', ') || '-'}`);
  if (stos.length < 2) refuse('the operation holds fewer than two STOs among its live members: nothing to split');
  for (const sto of moveSto) {
    if (!stos.includes(sto)) refuse(`STO ${sto} is not held by a live member of ${op}`);
  }
  const moved = live.filter((m) => moveSto.includes(m.sto));
  const kept = live.filter((m) => !moveSto.includes(m.sto));
  if (kept.length === 0) refuse('this would empty the operation: name the STO(s) that LEAVE, not all of them');

  const newKey = into || `OP-${moved[0].contract_id}-${Date.now().toString().slice(-8)}`;
  if (!into) {
    const taken = await pool.query(`SELECT 1 FROM shipments WHERE TRIM(COALESCE(operation_id, '')) = $1 LIMIT 1`, [newKey]);
    if (taken.rows.length) refuse(`generated key ${newKey} already exists - run again`);
  }
  console.log(`\nPlan${apply ? '' : rehearse ? ' (rehearsal, rolled back)' : ' (dry run)'}:`);
  console.log(`  STAY in ${op}: ${kept.map((m) => `${m.po_number}(${m.sto})`).join(', ')}`);
  console.log(`  MOVE to ${newKey}: ${moved.map((m) => `${m.po_number}(${m.sto})`).join(', ')}`);
  console.log(`  user_sto_contract_assignments: ${moved.reduce((a, m) => a + m.assignments, 0)} row(s) re-keyed`);

  if (!apply && !rehearse) {
    console.log('\ndry run - nothing written. Add --rehearse to try every write and roll back, or --apply to move them.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const ids = moved.map((m) => m.id);
    const u = await client.query(
      `UPDATE shipments SET operation_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::uuid[]) AND TRIM(COALESCE(operation_id, '')) = $3 AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('CANCELLED', 'CANCELED')`,
      [ids, newKey, op],
    );
    if (u.rowCount !== ids.length) throw new Error(`expected to update ${ids.length} shipment(s), updated ${u.rowCount}`);
    let rekeyed = 0;
    for (const m of moved) {
      const a = await client.query(
        `UPDATE user_sto_contract_assignments SET sto_number = $4, updated_at = CURRENT_TIMESTAMP
          WHERE sto_number = $1 AND contract_number = $2 AND COALESCE(po_number, '') = COALESCE($3, '')`,
        [op, m.contract_id, m.po_number, newKey],
      );
      rekeyed += a.rowCount;
    }
    console.log(`\nwritten: ${u.rowCount} shipment(s) re-keyed, ${rekeyed} assignment row(s) re-keyed`);
    printMembers(`\nafter, ${op}:`, await loadMembers(client, op));
    printMembers(`after, ${newKey}:`, await loadMembers(client, newKey));
    if (apply) {
      await client.query('COMMIT');
      committed = true;
      console.log('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nREHEARSAL: rolled back, nothing was changed.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  if (committed) {
    // Fire-and-forget: it SCHEDULES the snapshot refreshes, which still need this connection; poll the stale flags and close only when they are clear.
    invalidateAfterShipmentWrite(moved.map((m) => m.id));
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
    console.log(`to undo: UPDATE shipments SET operation_id = '${op}' WHERE operation_id = '${newKey}';  and re-key user_sto_contract_assignments from '${newKey}' back to '${op}'.`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
