/**
 * One-off repairs for STOs split over several operations (production, 22 Oct 2026). Dry-run by default: the change runs in a transaction that is rolled back.
 *
 * Steps (run one at a time, in this order):
 *   sto-1006020666  STO 666 = PO 1001032425 + 1001032737, one vessel (AS MARINA 10).
 *                   - the AS MARINA 10 voyage KLIP planned first (MNL- row of PO 737, operation OP-1004032737-34122029) gets the STO: its contents and the SAP shell's
 *                     are exchanged, so the shell (shipment_id = STO) now holds AS MARINA 10 under ...34122029 and the MNL- row holds AS MARINA 12 under
 *                     OP-1004032737-05814565, which therefore has no STO;
 *                   - the shell of PO 425 (AS MARINA 10) moves from OP-1004032737-73921060 to ...34122029.
 *   sto-1006020342  STO 342 = PO 1001032269 + 1001032425, one vessel (AS MARINA 12, completed). PO 425's shell moves out of OP-1004032737-34122029 (the
 *                   AS MARINA 10 voyage) to the operation of PO 269's shell.
 *
 *   sto-1006020185  STO 185 = PO 968, 1128, 1286, 1426, 1610, one Eminence VII voyage. PO 1610's shell leaves OP-1004031610-45984098 for the operation of its sisters.
 *   sto-1006020396  STO 396, Widmarino voyage: PO 1610's shell (OP-SEA-300920260009) joins the four sisters in OP-1004031610-45984098. Run AFTER sto-1006020185.
 *
 * Every step checks the rows it expects (PO, STO, operation, vessel) and stops without changing anything when they are not exactly as expected.
 *
 * Usage (inside the backend container):
 *   node dist/scripts/repairStoOperationSplit.js --step sto-1006020666
 *   node dist/scripts/repairStoOperationSplit.js --step sto-1006020666 --apply
 */
import { getClient } from '../database/connection';
import { swapShipmentContents } from '../utils/swapShipmentContents';

type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

interface Row {
  id: string;
  po: string;
  shipment_id: string;
  operation_id: string | null;
  src: string | null;
  vessel: string | null;
  status: string | null;
}

async function findRows(db: Db, where: { po: string; shipmentId?: string; shipmentIdLike?: string; operationId?: string }): Promise<Row[]> {
  const r = await db.query(
    `SELECT s.id, c.po_number AS po, s.shipment_id, s.operation_id, s.operation_id_source AS src, s.vessel_name AS vessel, s.status
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE TRIM(c.po_number::text) = $1
        AND COALESCE(s.status, '') <> 'CANCELLED'
        AND ($2::text IS NULL OR s.shipment_id = $2)
        AND ($3::text IS NULL OR s.shipment_id LIKE $3)
        AND ($4::text IS NULL OR s.operation_id = $4)`,
    [where.po, where.shipmentId ?? null, where.shipmentIdLike ?? null, where.operationId ?? null],
  );
  return r.rows as Row[];
}

function exactlyOne(rows: Row[], label: string): Row {
  if (rows.length !== 1) throw new Error(`expected exactly one row for ${label}, found ${rows.length}`);
  return rows[0];
}

function vesselHas(row: Row, needle: string, label: string): void {
  if (!String(row.vessel ?? '').toLowerCase().includes(needle)) {
    throw new Error(`${label}: expected vessel containing "${needle}", found "${row.vessel ?? ''}"`);
  }
}

async function show(db: Db, pos: string[], stos: string[]): Promise<void> {
  const r = await db.query(
    `SELECT s.shipment_id AS shipment_id, c.po_number AS po, s.operation_id AS op, s.operation_id_source AS src, s.vessel_name AS vessel, s.status
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE TRIM(c.po_number::text) = ANY($1::text[]) AND (s.shipment_id = ANY($2::text[]) OR s.shipment_id LIKE 'MNL-%')
        AND COALESCE(s.status, '') <> 'CANCELLED'
      ORDER BY c.po_number, s.operation_id, s.shipment_id`,
    [pos, stos],
  );
  console.table(r.rows);
}

export async function stepSto666(db: Db): Promise<void> {
  const VOYAGE = 'OP-1004032737-34122029';
  const SECOND = 'OP-1004032737-05814565';
  const STRAY = 'OP-1004032737-73921060';
  const STO = '1006020666';

  const shell737 = exactlyOne(await findRows(db, { po: '1001032737', shipmentId: STO, operationId: SECOND }), `STO ${STO} / PO 1001032737 / ${SECOND}`);
  const mnl737 = exactlyOne(await findRows(db, { po: '1001032737', shipmentIdLike: 'MNL-%', operationId: VOYAGE }), `MNL- row of PO 1001032737 / ${VOYAGE}`);
  const shell425 = exactlyOne(await findRows(db, { po: '1001032425', shipmentId: STO, operationId: STRAY }), `STO ${STO} / PO 1001032425 / ${STRAY}`);
  vesselHas(shell737, 'marina 12', `shell ${STO} PO 1001032737`);
  vesselHas(mnl737, 'marina 10', `MNL- row PO 1001032737`);
  vesselHas(shell425, 'marina 10', `shell ${STO} PO 1001032425`);

  const moved = await swapShipmentContents(db, shell737.id, mnl737.id);
  console.log('child rows moved by the swap:', JSON.stringify(moved.childRowsMoved));
  await db.query(
    `UPDATE shipments SET operation_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
    [shell425.id, VOYAGE],
  );

  // Postconditions: the STO sits in ONE operation, and the second operation has no STO.
  const check = await db.query(
    `SELECT COUNT(DISTINCT s.operation_id)::int AS n_ops FROM shipments s WHERE s.shipment_id = $1 AND COALESCE(s.status, '') <> 'CANCELLED' AND s.contract_id IN (
       SELECT id FROM contracts WHERE TRIM(po_number::text) IN ('1001032425', '1001032737'))`,
    [STO],
  );
  if (check.rows[0].n_ops !== 1) throw new Error(`postcondition failed: STO ${STO} is in ${check.rows[0].n_ops} operations`);
  const second = await db.query(
    `SELECT COUNT(*)::int AS n FROM shipments WHERE operation_id = $1 AND shipment_id ~ '^[0-9]+$' AND COALESCE(status, '') <> 'CANCELLED'`,
    [SECOND],
  );
  if (second.rows[0].n !== 0) throw new Error(`postcondition failed: ${SECOND} still carries an STO shell`);
}

export async function stepSto342(db: Db): Promise<void> {
  const STO = '1006020342';
  const shell425 = exactlyOne(await findRows(db, { po: '1001032425', shipmentId: STO, operationId: 'OP-1004032737-34122029' }), `STO ${STO} / PO 1001032425`);
  const shell269 = exactlyOne(await findRows(db, { po: '1001032269', shipmentId: STO }), `STO ${STO} / PO 1001032269`);
  vesselHas(shell425, 'marina 12', `shell ${STO} PO 1001032425`);
  vesselHas(shell269, 'marina 12', `shell ${STO} PO 1001032269`);
  if (!shell269.operation_id) throw new Error(`shell ${STO} PO 1001032269 has no operation id`);
  if (shell269.operation_id === shell425.operation_id) throw new Error('already in the same operation');
  await db.query(
    `UPDATE shipments SET operation_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
    [shell425.id, shell269.operation_id],
  );
}

async function operationVessels(db: Db, operationId: string): Promise<string[]> {
  const r = await db.query(
    `SELECT DISTINCT LOWER(BTRIM(vessel_name)) AS v FROM shipments WHERE operation_id = $1 AND COALESCE(status, '') <> 'CANCELLED' AND NULLIF(BTRIM(vessel_name), '') IS NOT NULL`,
    [operationId],
  );
  return r.rows.map((x) => String(x.v));
}

/**
 * STO 1006020185 = PO 968, 1128, 1286, 1426, 1610: one Eminence VII voyage (ETA 15 Sep, all completed). PO 1001031610's shell sits in OP-1004031610-45984098,
 * the operation of the Widmarino voyage; it moves to the operation its four sister POs share. Run this BEFORE sto-1006020396.
 */
export async function stepSto185(db: Db): Promise<void> {
  const STO = '1006020185';
  const sister = exactlyOne(await findRows(db, { po: '1001030968', shipmentId: STO }), `STO ${STO} / PO 1001030968`);
  const stray = exactlyOne(await findRows(db, { po: '1001031610', shipmentId: STO, operationId: 'OP-1004031610-45984098' }), `STO ${STO} / PO 1001031610`);
  vesselHas(sister, 'eminence', `shell ${STO} PO 1001030968`);
  vesselHas(stray, 'eminence', `shell ${STO} PO 1001031610`);
  if (!sister.operation_id) throw new Error(`shell ${STO} PO 1001030968 has no operation id`);
  const others = await operationVessels(db, sister.operation_id);
  if (others.some((v) => !v.includes('eminence'))) throw new Error(`${sister.operation_id} holds another vessel: ${others.join(', ')}`);
  await db.query(`UPDATE shipments SET operation_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [stray.id, sister.operation_id]);
}

/**
 * STO 1006020396, Widmarino voyage (ETA 3 Oct): PO 763, 908, 1032, 1184 are in OP-1004031610-45984098 and PO 1001031610 in OP-SEA-300920260009 (the same vessel,
 * spelled "Widmarino 18" there and "BG. WIDMARINO R18" here). PO 1001031610 joins the others. PO 347 (Eminence VII, ETA 24 Oct) is another voyage and stays.
 * Refuses to run while 45984098 still holds a vessel other than Widmarino (that is sto-1006020185's job, run it first).
 */
export async function stepSto396(db: Db): Promise<void> {
  const STO = '1006020396';
  const TARGET = 'OP-1004031610-45984098';
  const stray = exactlyOne(await findRows(db, { po: '1001031610', shipmentId: STO, operationId: 'OP-SEA-300920260009' }), `STO ${STO} / PO 1001031610`);
  const sister = exactlyOne(await findRows(db, { po: '1001031763', shipmentId: STO, operationId: TARGET }), `STO ${STO} / PO 1001031763`);
  vesselHas(stray, 'widmarino', `shell ${STO} PO 1001031610`);
  vesselHas(sister, 'widmarino', `shell ${STO} PO 1001031763`);
  const vessels = await operationVessels(db, TARGET);
  if (vessels.some((v) => !v.includes('widmarino'))) throw new Error(`${TARGET} still holds another vessel (${vessels.join(', ')}): run sto-1006020185 first`);
  await db.query(`UPDATE shipments SET operation_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [stray.id, TARGET]);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const stepIdx = args.indexOf('--step');
  const step = stepIdx >= 0 ? args[stepIdx + 1] : '';
  const steps: Record<string, { run: (db: Db) => Promise<void>; pos: string[]; stos: string[] }> = {
    'sto-1006020666': { run: stepSto666, pos: ['1001032425', '1001032737'], stos: ['1006020666'] },
    'sto-1006020342': { run: stepSto342, pos: ['1001032269', '1001032425', '1001032737'], stos: ['1006020342', '1006020666'] },
    'sto-1006020185': { run: stepSto185, pos: ['1001030968', '1001031128', '1001031286', '1001031426', '1001031610'], stos: ['1006020185', '1006020396'] },
    'sto-1006020396': { run: stepSto396, pos: ['1001031610', '1001031763', '1001031908', '1001032031', '1001032184', '1001032347'], stos: ['1006020396', '1006020185'] },
  };
  if (!steps[step]) {
    console.error(`Usage: --step <${Object.keys(steps).join('|')}> [--apply]`);
    process.exit(1);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    console.log('--- BEFORE ---');
    await show(client, steps[step].pos, steps[step].stos);
    await steps[step].run(client);
    console.log('--- AFTER ---');
    await show(client, steps[step].pos, steps[step].stos);
    if (apply) {
      await client.query('COMMIT');
      console.log('APPLIED (committed).');
    } else {
      await client.query('ROLLBACK');
      console.log('DRY-RUN: rolled back, nothing changed. Re-run with --apply to commit.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('STOPPED, nothing changed:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode ?? 0);
  }
}

if (require.main === module) void main();
