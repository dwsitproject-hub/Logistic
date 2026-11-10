import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { createManualPrePlannedGroup } from '../../services/prePlannedGroup.service';
import { revertPurchaseOrderFromShipment, REVERT_PO_CODES } from '../../services/shipmentPoRevert.service';

/**
 * Edit Shipment > Revert PO, against a real Postgres: one PO leaves an operation of several, the operation keeps everything it had, and the PO is Unplanned again.
 * The shape is the one reported (BG. LUMINOR 6): an operation named after its FIRST PO, which therefore holds the legs, the documents and the manual ATA.
 */

const P = 'ITEST-RPO';
let actorId = '';

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  return (await query(text, params)).rows[0] as T;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM pre_planned_group_members WHERE contract_number LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM pre_planned_groups WHERE group_code LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM jps_shipping_instructions WHERE sto_key LIKE $1`, [`OP-${P}%`]);
  await query(`DELETE FROM user_sto_contract_assignments WHERE sto_number LIKE $1`, [`OP-${P}%`]);
  await query(`DELETE FROM documents WHERE file_name LIKE $1`, [`${P}%`]);
  await query(`DELETE FROM shipments WHERE shipment_id LIKE $1`, [`MNL-${P}%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
}

interface Op {
  op: string;
  contracts: Record<string, string>;
  ships: Record<string, string>;
}

/** An operation with POs `keys`; the first is the origin (its row is the oldest and holds the shared data). */
async function operation(tag: string, keys: string[], extra: Record<string, unknown> = {}): Promise<Op> {
  const op = `OP-${P}-${tag}`;
  const contracts: Record<string, string> = {};
  const ships: Record<string, string> = {};
  for (const [i, key] of keys.entries()) {
    contracts[key] = (
      await one<{ id: string }>(
        `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm, status, transport_mode, plant_code, po_number, contract_date,
                                delivery_start_date, delivery_end_date)
         VALUES ($1, 'IT Buyer', 'IT Supplier', 'CPO', 5000000, 'KG', 'CIF', 'Open', 'SEA', 'ITRPO', $2, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + 30) RETURNING id`,
        [`${P}-${tag}-${key}`, `${P}-PO-${tag}-${key}`],
      )
    ).id;
    ships[key] = (
      await one<{ id: string }>(
        `INSERT INTO shipments (shipment_id, operation_id, contract_id, vessel_name, status, created_at, eta_arrival)
         VALUES ($1, $2, $3, 'IT RPO VESSEL', 'PLANNED', now() + ($4 || ' seconds')::interval, '2026-11-20') RETURNING id`,
        [`MNL-${P}-${tag}-${key}`, op, contracts[key], String(i)],
      )
    ).id;
    await query(`INSERT INTO user_sto_contract_assignments (sto_number, contract_number, po_number, sto_qty_assigned) VALUES ($1, $2, $3, 1000000)`, [
      op,
      `${P}-${tag}-${key}`,
      `${P}-PO-${tag}-${key}`,
    ]);
  }
  void extra;
  return { op, contracts, ships };
}

const countOf = async (table: string, shipmentId: string) =>
  (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE shipment_id = $1::uuid`, [shipmentId])).n;
const shipmentExists = async (id: string) => (await query(`SELECT 1 FROM shipments WHERE id = $1::uuid`, [id])).rows.length > 0;

beforeAll(async () => {
  await cleanup();
  actorId = (await one<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).id;
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('Revert PO', () => {
  it('takes the ORIGIN PO out of an operation of three: its row is deleted, the shared data moves to a remaining row, the PO is Unplanned and can be Preplanned again', async () => {
    const o = await operation('A', ['ORIGIN', 'SECOND', 'THIRD']);
    // the data the modal saved on the origin row
    await query(
      `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, eta_vessel_arrival) VALUES ($1, 'IT PORT', 1, '2026-11-20 10:00:00')`,
      [o.ships.ORIGIN],
    );
    await query(`INSERT INTO documents (document_type, file_name, file_path, shipment_id) VALUES ('OTHER', $1, '/x/y.pdf', $2)`, [`${P}-doc.pdf`, o.ships.ORIGIN]);
    await query(`INSERT INTO shipment_ata_overrides (shipment_id, ata_arrival) VALUES ($1, '2026-11-21')`, [o.ships.ORIGIN]);
    await query(`INSERT INTO remarks (text, category, related_entity_type, related_entity_id) VALUES ('keep me', 'EDIT_SHIPMENT', 'SHIPMENT', $1)`, [o.ships.ORIGIN]);
    // the PO sits in a Preplanned group that is linked to this operation's shipment
    const group = (
      await one<{ id: string }>(
        `INSERT INTO pre_planned_groups (group_code, partition_key, group_plant, buyer, incoterm, product, supplier, window_start, window_end, bin_capacity_mt, total_os_mt, status,
                                         shipment_id, source)
         VALUES ($1, 'MANUAL', 'ITRPO', 'b', 'CIF', 'CPO', 's', CURRENT_DATE, CURRENT_DATE, 5000, 5000, 'ACCEPTED', $2, 'MANUAL') RETURNING id`,
        [`${P}-GRP-A`, o.ships.ORIGIN],
      )
    ).id;
    await query(`INSERT INTO pre_planned_group_members (group_id, contract_id, contract_number, os_mt_at_grouping) VALUES ($1, $2, $3, 5000)`, [
      group,
      o.contracts.ORIGIN,
      `${P}-A-ORIGIN`,
    ]);

    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.SECOND, contractRowId: o.contracts.ORIGIN, userId: actorId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;

    // the PO's row and plan qty are gone, the others stay
    expect(await shipmentExists(o.ships.ORIGIN)).toBe(false);
    expect(await shipmentExists(o.ships.SECOND)).toBe(true);
    expect(await shipmentExists(o.ships.THIRD)).toBe(true);
    expect((await query(`SELECT 1 FROM user_sto_contract_assignments WHERE sto_number = $1 AND contract_number = $2`, [o.op, `${P}-A-ORIGIN`])).rows).toHaveLength(0);
    expect((await query(`SELECT 1 FROM user_sto_contract_assignments WHERE sto_number = $1`, [o.op])).rows).toHaveLength(2);

    // everything the row held survives, on the member returned as the survivor
    const survivor = res.survivorShipmentId;
    expect([o.ships.SECOND, o.ships.THIRD]).toContain(survivor);
    expect(await countOf('vessel_loading_ports', survivor)).toBe(1);
    expect(await countOf('documents', survivor)).toBe(1);
    expect(await countOf('shipment_ata_overrides', survivor)).toBe(1);
    expect(
      (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM remarks WHERE related_entity_type = 'SHIPMENT' AND related_entity_id = $1::uuid AND text = 'keep me'`, [survivor])).n,
    ).toBe(1);

    // the operation did not change: same id, same vessel
    const left = await query(`SELECT operation_id, vessel_name FROM shipments WHERE id = ANY($1::uuid[])`, [[o.ships.SECOND, o.ships.THIRD]]);
    expect(left.rows.every((r: { operation_id: string; vessel_name: string }) => r.operation_id === o.op && r.vessel_name === 'IT RPO VESSEL')).toBe(true);

    // the PO's Preplanned membership was released, so it is not held and can be grouped again
    expect(res.releasedPrePlannedMembers).toBe(1);
    const again = await createManualPrePlannedGroup([o.contracts.ORIGIN], actorId);
    expect(again.status).toBe('ACCEPTED');
    await query(`DELETE FROM pre_planned_group_members WHERE group_id = $1`, [again.id]);
    await query(`DELETE FROM pre_planned_groups WHERE id = $1`, [again.id]);

    // the history of the remaining rows says what happened
    const audit = await query(`SELECT action, after_data FROM audit_logs WHERE action = 'REVERT_PO' AND entity_id = $1::uuid`, [o.ships.SECOND]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].after_data).toMatchObject({ returnedTo: 'UNPLANNED' });
  });

  it('reverting a PO that holds no shared data leaves the shared data where it was', async () => {
    const o = await operation('B', ['ONE', 'TWO']);
    await query(`INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence) VALUES ($1, 'IT PORT B', 1)`, [o.ships.ONE]);
    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.ONE, contractRowId: o.contracts.TWO, userId: actorId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await shipmentExists(o.ships.TWO)).toBe(false);
    expect(await countOf('vessel_loading_ports', o.ships.ONE)).toBe(1);
  });

  it('legs the remaining rows already carry are not duplicated by the move', async () => {
    const o = await operation('C', ['ONE', 'TWO']);
    await query(`INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence) VALUES ($1, 'P', 1), ($2, 'P', 1)`, [o.ships.ONE, o.ships.TWO]);
    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.TWO, contractRowId: o.contracts.ONE, userId: actorId });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await countOf('vessel_loading_ports', o.ships.TWO)).toBe(1);
  });

  it('is refused for the only PO on the operation (Cancel is the way)', async () => {
    const o = await operation('D', ['SOLO']);
    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.SOLO, contractRowId: o.contracts.SOLO, userId: actorId });
    expect(res).toMatchObject({ ok: false, status: 409, code: REVERT_PO_CODES.ONLY_PO });
    expect(await shipmentExists(o.ships.SOLO)).toBe(true);
  });

  it('is refused when the PO already has an SAP STO', async () => {
    const o = await operation('E', ['ONE', 'TWO']);
    await query(`UPDATE contracts SET sto_number = '1006099777' WHERE id = $1`, [o.contracts.TWO]);
    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.ONE, contractRowId: o.contracts.TWO, userId: actorId });
    expect(res).toMatchObject({ ok: false, status: 403, code: REVERT_PO_CODES.SAP });
    expect(await shipmentExists(o.ships.TWO)).toBe(true);
  });

  it('is refused for a row that came from the SAP import', async () => {
    const o = await operation('F', ['ONE', 'TWO']);
    await query(`UPDATE shipments SET operation_id_source = 'SAP_IMPORT' WHERE id = $1`, [o.ships.TWO]);
    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.ONE, contractRowId: o.contracts.TWO, userId: actorId });
    expect(res).toMatchObject({ ok: false, status: 403, code: REVERT_PO_CODES.SAP });
  });

  it('is refused once the operation has finished discharging, by ATC or by status', async () => {
    const o = await operation('G', ['ONE', 'TWO']);
    await query(`UPDATE shipments SET ata_discharge_complete = '2026-11-01' WHERE id = $1`, [o.ships.ONE]);
    expect(await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.ONE, contractRowId: o.contracts.TWO, userId: actorId })).toMatchObject({
      ok: false,
      code: REVERT_PO_CODES.COMPLETED,
    });
    await query(`UPDATE shipments SET ata_discharge_complete = NULL WHERE id = $1`, [o.ships.ONE]);
    await query(`UPDATE shipments SET status = 'COMPLETED' WHERE id = $1`, [o.ships.ONE]);
    expect(await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.TWO, contractRowId: o.contracts.TWO, userId: actorId })).toMatchObject({
      ok: false,
      code: REVERT_PO_CODES.COMPLETED,
    });
    expect(await shipmentExists(o.ships.TWO)).toBe(true);
  });

  it('is refused once the operation was sent to JPS', async () => {
    const o = await operation('H', ['ONE', 'TWO']);
    await query(
      `INSERT INTO jps_shipping_instructions (sto_key, external_reference, state, jps_id, jps_status, submitted_at) VALUES ($1, $2, 'SUBMITTED', 4711, 'Pending', now())`,
      [o.op, `${P}-EXT-H`],
    );
    const res = await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.ONE, contractRowId: o.contracts.TWO, userId: actorId });
    expect(res).toMatchObject({ ok: false, status: 409, code: REVERT_PO_CODES.SENT_TO_JPS });
    expect(await shipmentExists(o.ships.TWO)).toBe(true);
  });

  it('a PO that is not on the shipment is a 404, and a bad id a 400', async () => {
    const o = await operation('I', ['ONE', 'TWO']);
    const stranger = await operation('J', ['X', 'Y']);
    expect(await revertPurchaseOrderFromShipment({ anchorShipmentUuid: o.ships.ONE, contractRowId: stranger.contracts.X })).toMatchObject({ ok: false, status: 404 });
    expect(await revertPurchaseOrderFromShipment({ anchorShipmentUuid: 'nope', contractRowId: o.contracts.ONE })).toMatchObject({ ok: false, status: 400 });
  });
});
