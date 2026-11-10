import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { resolveShipmentEditPayload } from '../../services/shipmentEditPayload.service';

/**
 * Edit Shipment's status for an operation of several POs follows the Shipments table: Completed only when EVERY PO has finished.
 * The shape reported on SIT (OP-1004030473-15277540): the first PO finished by a manual ATC on 15 Sep, four POs added on 2 Oct have no ATC, all stored PLANNED.
 * Through the real payload builder, against a real Postgres.
 */

const P = 'ITEST-EOS';

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  return (await query(text, params)).rows[0] as T;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM shipments WHERE shipment_id LIKE $1`, [`MNL-${P}%`]);
  await query(`DELETE FROM user_sto_contract_assignments WHERE sto_number LIKE $1`, [`OP-${P}%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
}

/** An operation of POs `keys`; `finished` lists the keys whose shipment has a manual discharge ATC. */
async function operation(tag: string, keys: string[], finished: string[], stored: Record<string, string> = {}): Promise<Record<string, string>> {
  const op = `OP-${P}-${tag}`;
  const ships: Record<string, string> = {};
  for (const [i, key] of keys.entries()) {
    const contract = (
      await one<{ id: string }>(
        `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm, status, transport_mode, po_number, contract_date)
         VALUES ($1, 'b', 's', 'CPO', 1000000, 'KG', 'CIF', 'Open', 'SEA', $2, CURRENT_DATE) RETURNING id`,
        [`${P}-${tag}-${key}`, `${P}-PO-${tag}-${key}`],
      )
    ).id;
    ships[key] = (
      await one<{ id: string }>(
        `INSERT INTO shipments (shipment_id, operation_id, contract_id, vessel_name, status, created_at, eta_arrival)
         VALUES ($1, $2, $3, 'IT EOS VESSEL', $4, now() + ($5 || ' seconds')::interval, '2026-09-01') RETURNING id`,
        [`MNL-${P}-${tag}-${key}`, op, contract, stored[key] ?? 'PLANNED', String(i)],
      )
    ).id;
    await query(`INSERT INTO user_sto_contract_assignments (sto_number, contract_number, po_number, sto_qty_assigned) VALUES ($1, $2, $3, 0)`, [
      op,
      `${P}-${tag}-${key}`,
      `${P}-PO-${tag}-${key}`,
    ]);
    if (finished.includes(key)) {
      await query(`INSERT INTO shipment_ata_overrides (shipment_id, ata_discharge_complete) VALUES ($1, '2026-09-15')`, [ships[key]]);
    }
  }
  return ships;
}

const statusOf = async (shipmentId: string) => (await resolveShipmentEditPayload(shipmentId))?.effectiveStatus;

beforeAll(async () => {
  await cleanup();
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('Edit Shipment status of an operation', () => {
  it('one finished PO among five: the modal reads Unloading whichever PO it opens (the reported case)', async () => {
    const s = await operation('A', ['FIRST', 'L1', 'L2', 'L3', 'L4'], ['FIRST']);
    expect(await statusOf(s.FIRST)).toBe('UNLOADING');
    expect(await statusOf(s.L1)).not.toBe('COMPLETED');
  });

  it('every PO finished: Completed', async () => {
    const s = await operation('B', ['ONE', 'TWO'], ['ONE', 'TWO']);
    expect(await statusOf(s.ONE)).toBe('COMPLETED');
    expect(await statusOf(s.TWO)).toBe('COMPLETED');
  });

  it('a stored Completed on one PO does not complete an operation whose other POs are unfinished', async () => {
    const s = await operation('C', ['ONE', 'TWO'], [], { ONE: 'COMPLETED' });
    expect(await statusOf(s.ONE)).not.toBe('COMPLETED');
  });

  it('a single-PO operation keeps reading its own ATC', async () => {
    const s = await operation('D', ['SOLO'], ['SOLO']);
    expect(await statusOf(s.SOLO)).toBe('COMPLETED');
  });

  it('an operation with no PO finished is not Completed', async () => {
    const s = await operation('E', ['ONE', 'TWO'], []);
    expect(await statusOf(s.ONE)).not.toBe('COMPLETED');
  });
});
