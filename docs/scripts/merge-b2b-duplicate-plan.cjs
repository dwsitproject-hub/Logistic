/*
 * Merge TWO shipment rows of one B2B cargo into ONE: the KLIP plan on the ORIGIN contract and the row SAP inserted on the CHILD when it assigned the STO.
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/merge-b2b-duplicate-plan.cjs | docker exec -i klip-backend node - --keep=<plan uuid> --drop=<SAP row uuid>
 *   add --apply to write (without it nothing is written). --force skips the vessel-name check only.
 *
 * Seen 2026-11-25 on production: MT. ARCADIA, PO 9141001942. Plan 271a1e58 (MNL-87115752-9144101942, origin contract 9144101942, entered by KLIP users) and row cd7976eb
 * (STO 1006021152, child contract 1004033142, SAP). Both are valid and are ONE shipment: the result is the plan row carrying the STO, the way the SAP import now does it
 * (findB2bOriginPlannedShipmentForSto) - KLIP-entered values stay, SAP values fill what the plan has empty and show under it with the SAP badge.
 *
 * What it does, in ONE transaction:
 *   1. KEEP row  : contract_id -> the child's, shipment_id -> the STO, status -> the higher of the two, and every column the plan has EMPTY is filled from the SAP row.
 *                  A column both rows have filled keeps the KEEP row's value (KLIP-entered). operation_id stays the plan's.
 *   2. Child rows: a table that points at the shipment (documents, vessel_loading_ports, ata overrides, pre-planned members...) is moved to the KEEP row when the KEEP row
 *                  has none in it; when both have rows the KEEP row's stay and the SAP row's are left where they are (printed, nothing is deleted).
 *   3. user_sto_contract_assignments keyed by the plan's MNL id are re-keyed to the STO (unless that key already exists).
 *   4. DROP row  : status CANCELLED and shipment_id renamed "<STO>-merged-<keep8>" (the unique index shipments_contract_id_shipment_id_uidx needs the STO free). Never deleted.
 *   5. audit_logs entry on the KEEP row, then the snapshots are refreshed.
 *
 * It REFUSES unless: both rows exist and are live; KEEP is an MNL-/MSEA- plan, DROP has a numeric STO; DROP's contract is a B2B child whose reference PO is KEEP's contract PO;
 * the two vessel names agree.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return (a ? a.slice(name.length + 3) : '').trim();
};
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
// --rehearse: run every write of --apply inside the transaction, print what the KEEP row looks like, then ROLLBACK. Proves the writes run; changes nothing.
const REHEARSE = process.argv.includes('--rehearse');
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const show = (v) => (v == null ? '-' : v instanceof Date ? v.toISOString().slice(0, 19) : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));

(async () => {
  const pool = dist('database/connection').default;
  const { sqlShipmentStatusRank } = dist('utils/shipmentStatus');
  const { invalidateAfterShipmentWrite } = dist('services/shipmentWriteInvalidation.service');
  const keepId = arg('keep');
  const dropId = arg('drop');
  const refuse = (why) => {
    console.error(`\nREFUSED: ${why}`);
    process.exit(2);
  };
  if (!/^[0-9a-f-]{36}$/i.test(keepId) || !/^[0-9a-f-]{36}$/i.test(dropId) || keepId === dropId) {
    console.error('Give both rows: --keep=<plan shipment uuid> --drop=<SAP shipment uuid>');
    process.exit(1);
  }

  const load = async (id) =>
    (await pool.query(`SELECT s.*, c.contract_id AS contract_number, c.po_number AS contract_po FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id WHERE s.id = $1::uuid`, [id])).rows[0];
  const keep = await load(keepId);
  const drop = await load(dropId);
  if (!keep || !drop) refuse('one of the shipments does not exist');
  const live = (r) => !/^CANCEL/i.test(String(r.status || ''));
  if (!live(keep) || !live(drop)) refuse('one of the rows is already cancelled');
  const keepSid = String(keep.shipment_id || '').trim();
  const dropSid = String(drop.shipment_id || '').trim();
  if (!/^(MNL|MSEA)-/.test(keepSid)) refuse(`KEEP row ${keepSid} is not a KLIP plan (MNL-/MSEA-)`);
  if (!/^[0-9]+$/.test(dropSid)) refuse(`DROP row ${dropSid} has no numeric STO`);
  if (keep.contract_id === drop.contract_id) refuse('both rows are on the same contract - this script is for an origin plan and its child');

  const link = await pool.query(
    `SELECT 1 FROM contract_latest_spd_snapshot chb
      WHERE chb.contract_number = $1 AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B' AND TRIM(chb.contract_reference_po_raw) = TRIM($2::text) LIMIT 1`,
    [drop.contract_number, keep.contract_po],
  );
  if (!link.rows.length) refuse(`contract ${drop.contract_number} is not a B2B child of a contract with PO ${keep.contract_po}`);
  const sameVessel = norm(keep.vessel_name) !== '' && norm(keep.vessel_name) === norm(drop.vessel_name);
  if (!sameVessel && !FORCE) refuse(`vessel names differ ("${keep.vessel_name}" / "${drop.vessel_name}") - use --force only if it is the same cargo`);

  console.log(`KEEP  ${keep.id}  ${keepSid}  op ${keep.operation_id || '-'}  contract ${keep.contract_number}  status ${keep.status}  vessel ${keep.vessel_name}`);
  console.log(`DROP  ${drop.id}  ${dropSid}  op ${drop.operation_id || '-'}  contract ${drop.contract_number}  status ${drop.status}  vessel ${drop.vessel_name}`);
  console.log(`B2B link verified: ${drop.contract_number} (child) -> PO ${keep.contract_po} (origin ${keep.contract_number}).  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  // 1. columns
  const cols = (await pool.query(
    `SELECT column_name, is_generated, identity_generation FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'shipments' ORDER BY ordinal_position`,
  )).rows;
  const SKIP = new Set(['id', 'created_at', 'updated_at', 'shipment_id', 'contract_id', 'operation_id', 'operation_id_source', 'status', 'contract_number', 'contract_po']);
  const fill = [];
  const kept = [];
  for (const c of cols) {
    const n = c.column_name;
    if (SKIP.has(n) || c.is_generated === 'ALWAYS' || c.identity_generation) continue;
    // A master port id follows the port TEXT: while the plan keeps its own (KLIP) port text, the SAP row's master id would point at another port than the text shows.
    if (n === 'loading_master_port_id' && !blank(keep.port_of_loading)) continue;
    if (n === 'discharge_master_port_id' && !blank(keep.port_of_discharge)) continue;
    if (blank(keep[n]) && !blank(drop[n])) fill.push(n);
    else if (!blank(keep[n]) && !blank(drop[n]) && JSON.stringify(keep[n]) !== JSON.stringify(drop[n])) kept.push(n);
  }
  console.log(`\n1. shipments columns: ${fill.length} filled from the SAP row, ${kept.length} differ and keep the plan's value`);
  for (const n of fill) console.log(`   fill   ${n.padEnd(34)} <- ${show(drop[n])}`);
  for (const n of kept) console.log(`   keep   ${n.padEnd(34)} plan ${show(keep[n])}   (SAP row ${show(drop[n])})`);
  const rankRes = await pool.query(`SELECT (${sqlShipmentStatusRank('$1::text')}) AS k, (${sqlShipmentStatusRank('$2::text')}) AS d`, [keep.status, drop.status]);
  const newStatus = Number(rankRes.rows[0].d) > Number(rankRes.rows[0].k) ? drop.status : keep.status;
  console.log(`   status ${keep.status} / ${drop.status} -> ${newStatus};  contract ${keep.contract_number} -> ${drop.contract_number};  shipment_id ${keepSid} -> ${dropSid};  operation_id stays ${keep.operation_id || '-'}`);

  // 2. tables pointing at the shipment
  const fks = (await pool.query(
    `SELECT con.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confrelid = 'shipments'::regclass AND array_length(con.conkey, 1) = 1
      ORDER BY 1`,
  )).rows;
  const moves = [];
  const vlpFills = [];
  console.log('\n2. tables that point at a shipment (rows on KEEP / on DROP):');
  for (const f of fks) {
    if (!/^[a-z0-9_."]+$/i.test(f.tbl) || !/^[a-z0-9_]+$/i.test(f.col)) continue;
    const k = Number((await pool.query(`SELECT count(*)::int AS n FROM ${f.tbl} WHERE "${f.col}" = $1::uuid`, [keep.id])).rows[0].n);
    const d = Number((await pool.query(`SELECT count(*)::int AS n FROM ${f.tbl} WHERE "${f.col}" = $1::uuid`, [drop.id])).rows[0].n);
    if (k === 0 && d === 0) continue;
    const action = d === 0 ? 'nothing to move' : k === 0 ? 'MOVE to KEEP' : 'both have rows: KEEP\'s stay, the SAP row\'s are left in place (port rows: see the pairing below)';
    console.log(`   ${f.tbl.padEnd(34)} ${String(k).padStart(4)} / ${String(d).padStart(4)}   ${action}`);
    if (d > 0 && k === 0) moves.push(f);
    // Both rows have port rows. The plan's are usually empty skeletons, the SAP row's carry the port-level dates. Pair them by kind (loading / discharge, in creation order) and
    // fill the dates and quantities the plan's port row has empty. The port NAME is not filled: the plan's typed port stays what the list shows as KLIP's.
    if (d > 0 && k > 0 && /vessel_loading_ports/.test(f.tbl)) {
      const load = async (id) =>
        (await pool.query(`SELECT to_jsonb(v) AS j FROM ${f.tbl} v WHERE v."${f.col}" = $1::uuid ORDER BY COALESCE(v.is_discharge_port, false), v.created_at, v.id`, [id])).rows.map((r) => r.j);
      const kRows = await load(keep.id);
      const dRows = await load(drop.id);
      const byKind = (rows, kind) => rows.filter((j) => Boolean(j.is_discharge_port) === kind);
      for (const kind of [false, true]) {
        const ks = byKind(kRows, kind);
        const ds = byKind(dRows, kind);
        ds.forEach((dj, i) => {
          const kj = ks[i];
          const label = `${kind ? 'discharge' : 'loading '} #${i + 1}`;
          if (!kj) {
            console.log(`      ${label}: SAP port row "${show(dj.port_name)}" has no partner on the plan - left in place`);
            return;
          }
          const cols = Object.keys(dj).filter((c) => /^[a-z0-9_]+$/.test(c) && /^(eta_|ata_|quantity)/.test(c) && blank(kj[c]) && !blank(dj[c]));
          console.log(`      ${label}: plan port "${show(kj.port_name)}", SAP port "${show(dj.port_name)}" -> ${cols.length ? 'fills ' + cols.map((c) => `${c}=${show(dj[c])}`).join(', ') : 'nothing to fill'}`);
          if (cols.length) vlpFills.push({ tbl: f.tbl, keepRow: kj.id, dropRow: dj.id, cols });
        });
      }
    }
  }

  // 3. assignments
  const keys = [keepSid, keep.operation_id, dropSid, drop.operation_id].filter(Boolean);
  const assigns = (await pool.query(
    `SELECT id::text AS id, sto_number, contract_number, po_number, sto_qty_assigned FROM user_sto_contract_assignments WHERE sto_number = ANY($1::text[]) ORDER BY sto_number`,
    [keys],
  )).rows;
  console.log(`\n3. user_sto_contract_assignments under these keys: ${assigns.length}`);
  for (const a of assigns) {
    const note = a.sto_number === keepSid ? '  -> re-keyed to the STO' : '';
    console.log(`   ${a.sto_number.padEnd(28)} contract ${a.contract_number} po ${a.po_number || '-'} qty ${a.sto_qty_assigned}${note}`);
  }

  if (!APPLY && !REHEARSE) {
    console.log('\ndry run - nothing written. Read the plan above, then add --rehearse (writes and rolls back) or --apply.');
    await pool.end();
    return;
  }

  let rehearsed = false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // the STO has to be free on the child before the KEEP row takes it
    await client.query(
      `UPDATE shipments SET status = 'CANCELLED', shipment_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
      [drop.id, `${dropSid}-merged-${keep.id.slice(0, 8)}`],
    );
    for (const f of moves) {
      await client.query(`UPDATE ${f.tbl} SET "${f.col}" = $1::uuid WHERE "${f.col}" = $2::uuid`, [keep.id, drop.id]);
    }
    for (const v of vlpFills) {
      await client.query(
        `UPDATE ${v.tbl} k SET ${v.cols.map((c) => `"${c}" = d."${c}"`).join(', ')}, updated_at = CURRENT_TIMESTAMP FROM ${v.tbl} d WHERE k.id = $1::uuid AND d.id = $2::uuid`,
        [v.keepRow, v.dropRow],
      );
    }
    const setFill = fill.map((n) => `"${n}" = d."${n}"`);
    await client.query(
      `UPDATE shipments k SET contract_id = d.contract_id, shipment_id = $3, status = $4${setFill.length ? ', ' + setFill.join(', ') : ''}, updated_at = CURRENT_TIMESTAMP
         FROM shipments d WHERE k.id = $1::uuid AND d.id = $2::uuid`,
      [keep.id, drop.id, dropSid, newStatus],
    );
    const re = await client.query(
      `UPDATE user_sto_contract_assignments a SET sto_number = $2, updated_at = CURRENT_TIMESTAMP
        WHERE a.sto_number = $1
          AND NOT EXISTS (SELECT 1 FROM user_sto_contract_assignments b WHERE b.sto_number = $2 AND b.contract_number = a.contract_number AND COALESCE(b.po_number, '') = COALESCE(a.po_number, ''))`,
      [keepSid, dropSid],
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_data, after_data)
       VALUES (NULL, 'UPDATE', 'SHIPMENT', $1::uuid, $2::jsonb, $3::jsonb)`,
      [
        keep.id,
        JSON.stringify({ shipment_id: keepSid, contract_id: keep.contract_number, status: keep.status }),
        JSON.stringify({ shipment_id: dropSid, contract_id: drop.contract_number, status: newStatus, merged_from: drop.id, note: 'B2B duplicate plan merged (merge-b2b-duplicate-plan.cjs)', filled_columns: fill }),
      ],
    );
    if (REHEARSE) {
      const after = (await client.query(
        `SELECT k.shipment_id, k.status, c.contract_id AS contract, k.operation_id, d.shipment_id AS dropped_id, d.status AS dropped_status
           FROM shipments k JOIN contracts c ON c.id = k.contract_id, shipments d WHERE k.id = $1::uuid AND d.id = $2::uuid`,
        [keep.id, drop.id],
      )).rows[0];
      await client.query('ROLLBACK');
      console.log(`\nREHEARSAL ok (rolled back, nothing changed). It would leave: ${JSON.stringify(after)}; ${re.rowCount} assignment(s) re-keyed, ${moves.length} table(s) moved.`);
      rehearsed = true;
    } else {
      await client.query('COMMIT');
      console.log(`\nmerged: ${keep.id.slice(0, 8)} now ${dropSid} on ${drop.contract_number}; ${fill.length} column(s) filled, ${moves.length} table(s) moved, ${re.rowCount} assignment(s) re-keyed; ${drop.id.slice(0, 8)} cancelled (kept, renamed).`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  if (rehearsed) {
    await pool.end();
    return;
  }

  invalidateAfterShipmentWrite([keep.id, drop.id]);
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
  console.log('NOTE: the running backend keeps in-memory list caches (about an hour); they expire on their own or clear on the next shipment save.');
  await pool.end();
})().catch((e) => {
  console.error('failed:', e && e.message ? e.message : e);
  process.exit(1);
});
