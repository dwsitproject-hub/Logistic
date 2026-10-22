import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getClient } from '../database/connection';
import { stepSto342, stepSto666 } from './repairStoOperationSplit';
import { swapShipmentContents } from '../utils/swapShipmentContents';

/**
 * The production repair of STO 1006020666 / 1006020342 replayed on a copy of its rows, inside a transaction that is rolled back.
 */
describe('repairStoOperationSplit (run in Postgres)', () => {
  let client: PoolClient;
  const VOYAGE = 'OP-1004032737-34122029';
  const SECOND = 'OP-1004032737-05814565';
  const STRAY = 'OP-1004032737-73921060';
  const OP269 = 'OP-1004032269-31300699';
  const ids: Record<string, string> = {};
  const contractIds: Record<string, string> = {};

  async function contractFor(po: string): Promise<string> {
    const found = await client.query(`SELECT id FROM contracts WHERE TRIM(po_number::text) = $1 LIMIT 1`, [po]);
    if (found.rows[0]) return found.rows[0].id as string;
    const r = await client.query(
      `INSERT INTO contracts (contract_id, po_number, buyer, supplier, product, quantity_ordered, unit)
       VALUES ($1, $2, 'b', 's', 'CPO', 1, 'MT') RETURNING id`,
      [`T-${po}-${Date.now()}`, po],
    );
    return r.rows[0].id as string;
  }

  async function ship(key: string, po: string, shipmentId: string, op: string, vessel: string, status = 'PLANNED'): Promise<void> {
    const r = await client.query(
      `INSERT INTO shipments (shipment_id, contract_id, operation_id, vessel_name, status, quantity_shipped)
       VALUES ($1, $2::uuid, $3, $4, $5, $6) RETURNING id`,
      [shipmentId, contractIds[po], op, vessel, status, vessel.endsWith('10') ? 10 : 12],
    );
    ids[key] = r.rows[0].id as string;
  }

  const row = async (key: string) =>
    (await client.query(`SELECT shipment_id, operation_id, vessel_name, quantity_shipped::int AS qty FROM shipments WHERE id = $1::uuid`, [ids[key]])).rows[0];

  beforeAll(async () => {
    client = await getClient();
    await client.query('BEGIN');
    for (const po of ['1001032425', '1001032737', '1001032269']) contractIds[po] = await contractFor(po);
    await ship('M', '1001032737', 'MNL-56416716-1004032737', VOYAGE, 'BG. AS MARINA 10');
    await ship('S737', '1001032737', '1006020666', SECOND, 'BG. AS MARINA 12');
    await ship('S425', '1001032425', '1006020666', STRAY, 'BG. AS MARINA 10');
    await ship('S342_425', '1001032425', '1006020342', VOYAGE, 'BG. AS MARINA 12', 'COMPLETED');
    await ship('S342_269', '1001032269', '1006020342', OP269, 'BG. AS MARINA 12', 'COMPLETED');
    // children: a port row on each voyage, and an ATA override on the AS MARINA 12 row (unique per shipment)
    await client.query(`INSERT INTO vessel_loading_ports (shipment_id, port_name) VALUES ($1::uuid, 'PORT OF M'), ($2::uuid, 'PORT OF S737')`, [ids.M, ids.S737]);
    await client.query(`INSERT INTO shipment_ata_overrides (shipment_id, ata_arrival) VALUES ($1::uuid, DATE '2026-10-01')`, [ids.S737]);
  }, 60_000);

  afterAll(async () => {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('STO 666: AS MARINA 10 ends up on the STO shell, AS MARINA 12 on its own MNL- row with no STO, and the STO is in one operation', async () => {
    await stepSto666(client);

    const shell737 = await row('S737');
    expect(shell737).toMatchObject({ shipment_id: '1006020666', operation_id: VOYAGE, vessel_name: 'BG. AS MARINA 10', qty: 10 });
    const mnl = await row('M');
    expect(mnl).toMatchObject({ shipment_id: 'MNL-56416716-1004032737', operation_id: SECOND, vessel_name: 'BG. AS MARINA 12', qty: 12 });
    expect(await row('S425')).toMatchObject({ shipment_id: '1006020666', operation_id: VOYAGE, vessel_name: 'BG. AS MARINA 10' });

    // children follow the contents: M's port is now on the shell, the shell's port and its ATA override on the MNL- row
    const ports = await client.query(`SELECT shipment_id, port_name FROM vessel_loading_ports WHERE shipment_id = ANY($1::uuid[]) ORDER BY port_name`, [[ids.M, ids.S737]]);
    expect(ports.rows).toEqual([
      { shipment_id: ids.S737, port_name: 'PORT OF M' },
      { shipment_id: ids.M, port_name: 'PORT OF S737' },
    ]);
    const ov = await client.query(`SELECT shipment_id FROM shipment_ata_overrides WHERE shipment_id = ANY($1::uuid[])`, [[ids.M, ids.S737]]);
    expect(ov.rows).toEqual([{ shipment_id: ids.M }]);

    // the second operation carries no STO shell any more
    const stoInSecond = await client.query(`SELECT 1 FROM shipments WHERE operation_id = $1 AND shipment_id ~ '^[0-9]+$'`, [SECOND]);
    expect(stoInSecond.rows).toHaveLength(0);
  }, 60_000);

  it('STO 342: the PO 425 shell leaves the AS MARINA 10 voyage for the operation of PO 269', async () => {
    await stepSto342(client);
    expect((await row('S342_425')).operation_id).toBe(OP269);
    expect((await row('S342_269')).operation_id).toBe(OP269);
    // the voyage keeps only the AS MARINA 10 rows
    const vessels = await client.query(`SELECT DISTINCT vessel_name FROM shipments WHERE operation_id = $1`, [VOYAGE]);
    expect(vessels.rows).toEqual([{ vessel_name: 'BG. AS MARINA 10' }]);
  }, 60_000);

  it('stops without changing anything when the rows are not as expected', async () => {
    // after the steps above STO 666 / PO 737 is no longer on the second operation: running the step again must refuse
    await client.query('SAVEPOINT s1');
    await expect(stepSto666(client)).rejects.toThrow(/expected exactly one row/);
    await client.query('ROLLBACK TO SAVEPOINT s1');
  }, 60_000);

  it('swapShipmentContents refuses the same row twice', async () => {
    await expect(swapShipmentContents(client, ids.M, ids.M)).rejects.toThrow(/same row/);
  });
});
