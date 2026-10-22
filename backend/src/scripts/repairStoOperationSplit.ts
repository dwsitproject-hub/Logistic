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
 *   sto-1006020396-po347  STO 396 also holds PO 1001032347 (SAP: Widmarino 18). Its shell, stuck in the planned Eminence VII voyage, joins the Widmarino operation and takes
 *                   the Widmarino vessel identity. Run AFTER sto-1006020396.
 *   sto-1016011511  STO 1016011511 = six POs, one voyage (SAP: BG. LUMINOR 8 for all). PO 1011003251 alone still names PRIMA SAMUDRA IV (KLIP-planned 18 Sep): its vessel
 *                   identity is aligned to its siblings'. Run only after confirming that Luminor 8 is the vessel that really carried it.
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

interface VesselIdentity {
  vessel_name: string | null;
  vessel_code: string | null;
  vessel_owner: string | null;
  master_vessel_id: string | null;
}

/**
 * The vessel identity the STO's SAP rows in `operationId` agree on. Stops unless those rows are exactly `expectedPos` (excluding `excludeId`), all name a vessel
 * containing `needle`, and share one identity (name, code, owner, master vessel).
 */
async function siblingIdentity(
  db: Db,
  sto: string,
  operationId: string,
  excludeId: string | null,
  expectedPos: string[],
  needle: string,
  ignorePos: string[] = [],
  masterMustAgree = true,
): Promise<VesselIdentity & { rows: Array<{ id: string; po: string; master_vessel_id: string | null }> }> {
  const sib = await db.query(
    `SELECT s.id::text AS id, TRIM(c.po_number::text) AS po, s.vessel_name, s.vessel_code, s.vessel_owner, s.master_vessel_id::text AS master_vessel_id
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE s.shipment_id = $1 AND s.operation_id = $2 AND ($3::uuid IS NULL OR s.id <> $3::uuid) AND COALESCE(s.status, '') <> 'CANCELLED'
        AND NOT (TRIM(c.po_number::text) = ANY($4::text[]))
      ORDER BY TRIM(c.po_number::text)`,
    [sto, operationId, excludeId, ignorePos],
  );
  const poList = sib.rows.map((r) => String(r.po));
  if (poList.join(',') !== expectedPos.join(',')) throw new Error(`expected the sibling POs ${expectedPos.join(', ')}, found ${poList.join(', ') || 'none'}`);
  if (sib.rows.some((r) => !String(r.vessel_name ?? '').toLowerCase().includes(needle))) throw new Error(`a sibling row's vessel does not contain "${needle}"`);
  // `masterMustAgree` false: a row whose master vessel link contradicts its own vessel name is allowed (the caller realigns it), the name, code and owner must still agree.
  const identities = new Set(
    sib.rows.map((r) => JSON.stringify(masterMustAgree ? [r.vessel_name, r.vessel_code, r.vessel_owner, r.master_vessel_id] : [r.vessel_name, r.vessel_code, r.vessel_owner])),
  );
  if (identities.size !== 1) throw new Error(`the siblings do not share one vessel identity: ${[...identities].join(' | ')}`);
  const first = sib.rows[0];
  return {
    vessel_name: first.vessel_name,
    vessel_code: first.vessel_code,
    vessel_owner: first.vessel_owner,
    master_vessel_id: masterMustAgree ? first.master_vessel_id : null,
    rows: sib.rows.map((r) => ({ id: String(r.id), po: String(r.po), master_vessel_id: r.master_vessel_id ?? null })),
  };
}

/**
 * The master vessel the identity's code resolves to (primary code first, then an alias, as the SAP import resolves it). Stops when it is missing,
 * ambiguous, named differently from the identity, or different from the master vessel the identity already points at.
 */
async function masterForIdentity(db: Db, identity: VesselIdentity): Promise<{ id: string; vessel_name: string; vessel_code: string }> {
  const code = String(identity.vessel_code ?? '').trim();
  if (!code) throw new Error('the siblings carry no vessel code');
  const byCode = await db.query(`SELECT id::text AS id, vessel_name, vessel_code, vessel_owner FROM master_vessels WHERE UPPER(BTRIM(vessel_code)) = UPPER($1) LIMIT 2`, [code]);
  const master =
    byCode.rows.length > 0
      ? byCode.rows
      : (
          await db.query(
            `SELECT mv.id::text AS id, mv.vessel_name, mv.vessel_code, mv.vessel_owner FROM master_vessel_code_aliases a JOIN master_vessels mv ON mv.id = a.master_vessel_id WHERE UPPER(BTRIM(a.vessel_code)) = UPPER($1) LIMIT 2`,
            [code],
          )
        ).rows;
  if (master.length !== 1) throw new Error(`expected exactly one master vessel for SAP code "${code}", found ${master.length}`);
  const squash = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (squash(master[0].vessel_name) !== squash(identity.vessel_name)) {
    throw new Error(`master vessel "${master[0].vessel_name}" (${code}) does not match the siblings' vessel "${identity.vessel_name}"`);
  }
  if (identity.master_vessel_id && identity.master_vessel_id !== master[0].id) {
    throw new Error(`the siblings point at master vessel ${identity.master_vessel_id}, not ${master[0].id} (${code})`);
  }
  console.log('master vessel:', JSON.stringify(master[0]));
  return master[0];
}

/** Sets name, code, owner and master vessel of one row to `identity`, printing the previous values so they can be put back. */
async function takeVesselIdentity(db: Db, shipmentUuid: string, po: string, identity: VesselIdentity, masterId: string, operationId: string | null = null): Promise<void> {
  const before = await db.query(`SELECT vessel_name, vessel_code, vessel_owner, master_vessel_id::text AS master_vessel_id, operation_id FROM shipments WHERE id = $1::uuid`, [shipmentUuid]);
  console.log('previous vessel identity and operation of PO', po, '(to restore):', JSON.stringify(before.rows[0]));
  await db.query(
    `UPDATE shipments SET vessel_name = $2, vessel_code = $3, vessel_owner = $4, master_vessel_id = $5::uuid, operation_id = COALESCE($6, operation_id), updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`,
    [shipmentUuid, identity.vessel_name, identity.vessel_code, identity.vessel_owner, masterId, operationId],
  );
}

/**
 * STO 1006020396 also holds PO 1001032347 (SAP: Widmarino 18, code MWIDM18 - an alias of master vessel BG. WIDMARINO R18). In KLIP that PO's shell sits in the Eminence VII
 * voyage OP-1004032347-29056503 that was planned on top of it, with the Eminence VII name and code but the Widmarino master vessel id, the Widmarino ATAs and the Widmarino
 * loading ports. The shell moves into the Widmarino operation and takes the Widmarino vessel identity; the three planned Eminence VII rows (PO 470, 621, 794) stay.
 * Run AFTER sto-1006020396 (PO 1610's shell must already be in the Widmarino operation). Its own ETAs (e.g. ETA arrival 24 Oct) are not touched.
 */
export async function stepSto396Po347(db: Db): Promise<void> {
  const STO = '1006020396';
  const TARGET = 'OP-1004031610-45984098';
  const FROM = 'OP-1004032347-29056503';
  const PO = '1001032347';
  const row = exactlyOne(await findRows(db, { po: PO, shipmentId: STO, operationId: FROM }), `STO ${STO} / PO ${PO} / ${FROM}`);
  if (row.src !== null) throw new Error(`PO ${PO} row has operation_id_source "${row.src}": expected NULL`);
  vesselHas(row, 'eminence', `shell ${STO} PO ${PO}`);
  exactlyOne(await findRows(db, { po: '1001031610', shipmentId: STO, operationId: TARGET }), `STO ${STO} / PO 1001031610 / ${TARGET} (run sto-1006020396 first)`);

  // PO 1610's own shell may spell the vessel differently ("Widmarino 18"): the four sister POs decide the identity.
  const target = await siblingIdentity(db, STO, TARGET, null, ['1001031763', '1001031908', '1001032031', '1001032184'], 'widmarino', ['1001031610']);
  const master = await masterForIdentity(db, target);
  await takeVesselIdentity(db, row.id, PO, target, master.id, TARGET);

  const check = await db.query(
    `SELECT COUNT(DISTINCT s.operation_id)::int AS n_ops FROM shipments s JOIN contracts c ON c.id = s.contract_id
      WHERE s.shipment_id = $1 AND COALESCE(s.status, '') <> 'CANCELLED'
        AND TRIM(c.po_number::text) IN ('1001031610', '1001031763', '1001031908', '1001032031', '1001032184', '1001032347')`,
    [STO],
  );
  if (check.rows[0].n_ops !== 1) throw new Error(`postcondition failed: STO ${STO} is in ${check.rows[0].n_ops} operations`);
  const left = await operationVessels(db, FROM);
  if (left.some((v) => !v.includes('eminence'))) throw new Error(`postcondition failed: ${FROM} holds ${left.join(', ')}`);
}

/**
 * STO 1016011511 = PO 1011003026, 1011003084, 1011003192, 1011003251, 1011003268, 1011003269, one voyage in OP-SEA-180920260006.
 * SAP names BG. LUMINOR 8 (code MBGLUMINOR) for all six, and all six carry the same ATA (sailed / loading complete 15 Oct). Only PO 1011003251's row, planned in KLIP on
 * 18 Sep and so never overwritten by the SAP import (operation_id_source NULL), still says PRIMA SAMUDRA IV. Its vessel identity is set to the siblings' (name, code, owner)
 * and linked to the master vessel registered under that SAP code (MBGLUMINOR, an alias of master vessel MLUM8 "BG. LUMINOR 8"); the step stops when the master vessel is missing,
 * ambiguous or named differently. A sibling that names Luminor 8 but is linked to another master vessel (PO 1011003026 -> BG. ANAK LAUT 289) is re-linked. Dates, ports, documents and the operation are not touched. The old identity is printed so it can be put back.
 *
 * Only run it once it is confirmed that Luminor 8, not Prima Samudra IV, is the vessel that really carried PO 1011003251.
 */
export async function stepSto1511(db: Db): Promise<void> {
  const STO = '1016011511';
  const OP = 'OP-SEA-180920260006';
  const ODD_PO = '1011003251';
  const SIBLING_POS = ['1011003026', '1011003084', '1011003192', '1011003268', '1011003269'];

  const odd = exactlyOne(await findRows(db, { po: ODD_PO, shipmentId: STO, operationId: OP }), `STO ${STO} / PO ${ODD_PO} / ${OP}`);
  if (odd.src !== null) throw new Error(`PO ${ODD_PO} row has operation_id_source "${odd.src}": expected NULL (a KLIP-planned row)`);
  vesselHas(odd, 'prima samudra', `shell ${STO} PO ${ODD_PO}`);

  const target = await siblingIdentity(db, STO, OP, odd.id, SIBLING_POS, 'luminor', [], false);
  const master = await masterForIdentity(db, target);

  // A sibling whose name and code say Luminor 8 but whose master vessel link points at another vessel (production: PO 1011003026 -> BG. ANAK LAUT 289) is re-linked.
  // A sibling with no link at all is left alone.
  for (const r of target.rows) {
    if (r.master_vessel_id && r.master_vessel_id !== master.id) {
      console.log(`PO ${r.po}: master vessel link ${r.master_vessel_id} -> ${master.id} (previous link, to restore: ${r.master_vessel_id})`);
      await db.query(`UPDATE shipments SET master_vessel_id = $2::uuid, updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [r.id, master.id]);
    }
  }
  await takeVesselIdentity(db, odd.id, ODD_PO, target, master.id);

  const check = await db.query(
    `SELECT COUNT(DISTINCT LOWER(BTRIM(vessel_name)))::int AS n FROM shipments WHERE operation_id = $1 AND COALESCE(status, '') <> 'CANCELLED'`,
    [OP],
  );
  if (check.rows[0].n !== 1) throw new Error(`postcondition failed: ${OP} holds ${check.rows[0].n} vessel names`);
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
    'sto-1006020396-po347': { run: stepSto396Po347, pos: ['1001031610', '1001031763', '1001031908', '1001032031', '1001032184', '1001032347', '1001032470', '1001032621', '1001032794'], stos: ['1006020396'] },
    'sto-1016011511': { run: stepSto1511, pos: ['1011003026', '1011003084', '1011003192', '1011003251', '1011003268', '1011003269'], stos: ['1016011511'] },
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
