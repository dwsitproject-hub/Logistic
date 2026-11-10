import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import {
  PRE_PLANNED_RELEASABLE_HOLDER_SQL,
  createManualPrePlannedGroup,
  releasePrePlannedMembersOfCancelledShipments,
} from '../../services/prePlannedGroup.service';

/**
 * PO 1001032955 on production: "duplicate key value violates unique constraint ux_ppgm_active_contract" when a user pressed Preplanned.
 *
 * The PO had been in a manual Preplanned group that was linked to a shipment; the shipment was cancelled, the PO came back as Unplanned, and the group's member
 * row stayed active. These tests run the real tables and the real index: which holders are released, which are not, that a user can group the PO again, and
 * what the user reads when a live group really does hold it.
 */

const P = 'ITEST-PPG';
let actorId: string | undefined;

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  return (await query(text, params)).rows[0] as T;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM pre_planned_group_members WHERE contract_number LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM pre_planned_groups WHERE group_code LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM shipments WHERE shipment_id LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
}

async function contract(key: string): Promise<string> {
  return (
    await one<{ id: string }>(
      `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm, status, transport_mode, plant_code, po_number, contract_date,
                              delivery_start_date, delivery_end_date)
       VALUES ($1, 'IT Buyer', 'IT Supplier', 'CPO', 5000000, 'KG', 'CIF', 'Open', 'SEA', 'ITPPG', $2, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + 30) RETURNING id`,
      [`${P}-${key}`, `${P}-PO-${key}`],
    )
  ).id;
}

async function shipment(contractId: string, key: string, status: string): Promise<string> {
  return (
    await one<{ id: string }>(
      `INSERT INTO shipments (shipment_id, contract_id, vessel_name, status) VALUES ($1, $2, 'IT PPG VESSEL', $3) RETURNING id`,
      [`${P}-S-${key}`, contractId, status],
    )
  ).id;
}

async function group(code: string, status: string, shipmentId: string | null, contractId: string, active = true): Promise<string> {
  const id = (
    await one<{ id: string }>(
      `INSERT INTO pre_planned_groups (group_code, partition_key, group_plant, buyer, incoterm, product, supplier, window_start, window_end, bin_capacity_mt, total_os_mt,
                                       status, shipment_id, source)
       VALUES ($1, 'MANUAL', 'ITPPG', 'IT Buyer', 'CIF', 'CPO', 'IT Supplier', CURRENT_DATE, CURRENT_DATE, 5000, 5000, $2, $3, 'MANUAL') RETURNING id`,
      [`${P}-${code}`, status, shipmentId],
    )
  ).id;
  await query(
    `INSERT INTO pre_planned_group_members (group_id, contract_id, contract_number, os_mt_at_grouping, released_at) VALUES ($1, $2, $3, 5000, $4)`,
    [id, contractId, `${P}-${code}`, active ? null : new Date()],
  );
  return id;
}

const activeHolders = async (contractId: string) =>
  (
    await query(
      `SELECT pg.group_code, pg.status FROM pre_planned_group_members pgm JOIN pre_planned_groups pg ON pg.id = pgm.group_id
        WHERE pgm.contract_id = $1 AND pgm.released_at IS NULL ORDER BY pg.group_code`,
      [contractId],
    )
  ).rows as Array<{ group_code: string; status: string }>;

beforeAll(async () => {
  await cleanup();
  actorId = (await one<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).id;
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('which holders are dead', () => {
  it('the rule releases SUGGESTED, SUPERSEDED, DISMISSED and ACCEPTED-linked-to-a-CANCELLED-shipment, and keeps every other holder', async () => {
    const dead = ['SUGGESTED', 'SUPERSEDED', 'DISMISSED'];
    const ids: Record<string, string> = {};
    for (const status of dead) {
      ids[status] = await contract(`R-${status}`);
      await group(`R-${status}`, status, null, ids[status]);
    }
    ids.CANCELLED = await contract('R-CANC');
    await group('R-CANC', 'ACCEPTED', await shipment(ids.CANCELLED, 'R-CANC', 'CANCELLED'), ids.CANCELLED);
    // the holders that must stay
    ids.UNLINKED = await contract('K-UNLINKED');
    await group('K-UNLINKED', 'ACCEPTED', null, ids.UNLINKED);
    ids.PLANNED = await contract('K-PLANNED');
    await group('K-PLANNED', 'ACCEPTED', await shipment(ids.PLANNED, 'K-PLANNED', 'PLANNED'), ids.PLANNED);
    ids.COMPLETED = await contract('K-COMPLETED');
    await group('K-COMPLETED', 'ACCEPTED', await shipment(ids.COMPLETED, 'K-COMPLETED', 'COMPLETED'), ids.COMPLETED);

    await query(
      `UPDATE pre_planned_group_members pgm SET released_at = now() FROM pre_planned_groups pg
        WHERE pgm.group_id = pg.id AND pgm.released_at IS NULL AND pg.group_code LIKE $1 AND ${PRE_PLANNED_RELEASABLE_HOLDER_SQL}`,
      [`${P}-%`],
    );

    for (const k of ['SUGGESTED', 'SUPERSEDED', 'DISMISSED', 'CANCELLED']) expect(await activeHolders(ids[k]), k).toEqual([]);
    for (const k of ['UNLINKED', 'PLANNED', 'COMPLETED']) expect(await activeHolders(ids[k]), k).toHaveLength(1);
  });

  it('cancelling a shipment releases the members of the group linked to it, and only those', async () => {
    const mine = await contract('C-MINE');
    const mineShipment = await shipment(mine, 'C-MINE', 'PLANNED');
    await group('C-MINE', 'ACCEPTED', mineShipment, mine);
    const other = await contract('C-OTHER');
    await group('C-OTHER', 'ACCEPTED', await shipment(other, 'C-OTHER', 'PLANNED'), other);

    expect(await releasePrePlannedMembersOfCancelledShipments([mineShipment])).toBe(0); // not cancelled yet: nothing to release
    await query(`UPDATE shipments SET status = 'CANCELLED' WHERE id = $1`, [mineShipment]);
    expect(await releasePrePlannedMembersOfCancelledShipments([mineShipment])).toBe(1);
    expect(await activeHolders(mine)).toEqual([]);
    expect(await activeHolders(other)).toHaveLength(1);
    expect(await releasePrePlannedMembersOfCancelledShipments([])).toBe(0);
    expect(await releasePrePlannedMembersOfCancelledShipments([mineShipment])).toBe(0); // idempotent
  });
});

describe('one group holding several POs', () => {
  it('a group linked to a cancelled shipment frees the POs with no live shipment, and keeps the PO that went on another live shipment', async () => {
    const freed = await contract('G-FREED');
    const kept = await contract('G-KEPT');
    const cancelled = await shipment(freed, 'G-FREED', 'CANCELLED');
    await shipment(kept, 'G-KEPT-LIVE', 'PLANNED');
    const groupId = await group('G-MULTI', 'ACCEPTED', cancelled, freed);
    await query(
      `INSERT INTO pre_planned_group_members (group_id, contract_id, contract_number, os_mt_at_grouping) VALUES ($1, $2, $3, 5000)`,
      [groupId, kept, `${P}-G-KEPT`],
    );

    expect(await releasePrePlannedMembersOfCancelledShipments([cancelled])).toBe(1);
    expect(await activeHolders(freed)).toEqual([]);
    expect(await activeHolders(kept)).toHaveLength(1);

    // the manual-grouping rule agrees: the live PO's membership is not a dead holder
    await query(
      `UPDATE pre_planned_group_members pgm SET released_at = now() FROM pre_planned_groups pg
        WHERE pgm.group_id = pg.id AND pgm.released_at IS NULL AND pg.group_code = $1 AND ${PRE_PLANNED_RELEASABLE_HOLDER_SQL}`,
      [`${P}-G-MULTI`],
    );
    expect(await activeHolders(kept)).toHaveLength(1);
  });
});

describe('the fault itself', () => {
  it('a stale ACCEPTED holder of a cancelled shipment makes a second active member violate the index (what the user saw)', async () => {
    const c = await contract('F-REPRO');
    await group('F-REPRO-OLD', 'ACCEPTED', await shipment(c, 'F-REPRO', 'CANCELLED'), c);
    // the old rule released only SUGGESTED holders, so this insert is exactly what the old code attempted
    await expect(group('F-REPRO-NEW', 'ACCEPTED', null, c)).rejects.toMatchObject({ code: '23505', constraint: 'ux_ppgm_active_contract' });
  });
});

describe('grouping the PO again', () => {
  it('a PO left held by the group of a cancelled shipment can be Preplanned again (the production case)', async () => {
    const c = await contract('M-STALE');
    const cancelled = await shipment(c, 'M-STALE', 'CANCELLED');
    await group('M-STALE-OLD', 'ACCEPTED', cancelled, c);
    expect(await activeHolders(c)).toHaveLength(1);

    const created = await createManualPrePlannedGroup([c], actorId);
    expect(created.status).toBe('ACCEPTED');
    expect(created.shipmentId ?? null).toBeNull();

    const holders = await activeHolders(c);
    expect(holders).toHaveLength(1);
    expect(holders[0].group_code).toBe(created.groupCode);
    // the old group keeps its history: the member row is there, released
    const old = await one<{ released_at: string | null }>(
      `SELECT pgm.released_at FROM pre_planned_group_members pgm JOIN pre_planned_groups pg ON pg.id = pgm.group_id WHERE pg.group_code = $1`,
      [`${P}-M-STALE-OLD`],
    );
    expect(old.released_at).not.toBeNull();
    await query(`DELETE FROM pre_planned_group_members WHERE group_id = $1`, [created.id]);
    await query(`DELETE FROM pre_planned_groups WHERE id = $1`, [created.id]);
  });

  it('a PO a LIVE group really holds is refused with the group named, not the raw index name', async () => {
    const c = await contract('M-LIVE');
    const elsewhere = await contract('M-LIVE-OTHER');
    const liveShipment = await shipment(elsewhere, 'M-LIVE-OTHER', 'PLANNED');
    await group('M-LIVE-HOLDER', 'ACCEPTED', liveShipment, c);

    let message = '';
    try {
      await createManualPrePlannedGroup([c], actorId);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('ux_ppgm_active_contract');
    expect(message).not.toContain('duplicate key');
    expect(message).toContain(`${P}-M-LIVE-HOLDER`);
    expect(message).toContain(`${P}-PO-M-LIVE`);
    expect(await activeHolders(c)).toHaveLength(1);
  });
});
