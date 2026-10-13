import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getClient } from '../../database/connection';
import { shipmentListRowContractQtySql } from '../../utils/shipmentListQtySql';
import {
  sqlShipmentContractQtyOncePerContractCtes,
  sqlShipmentContractQtyOnceSelect,
} from '../../utils/shipmentStatusCardQtySql';

/**
 * The Shipments status cards' Contract Qty is counted ONCE PER CONTRACT.
 *
 * It was SUM(contract_qty) over the rows of each stage, and a CIF / CFR PO with several Type T STOs is several rows, each carrying the whole
 * PO's quantity - the cards counted the PO once per STO (1,020,900 MT against 240,925 MT on SIT, 2026-10-13). The string tests
 * (shipmentCifCfrStoGrain.regression.test.ts) pin the SQL shape; this runs it on real Postgres with real contracts / contract_stos, inside a
 * transaction that is rolled back.
 *
 * The enriched rows are what the page produces: one per STO key, with the contracts it covers and its effective status.
 */
describe('Shipments card Contract Qty, once per contract', () => {
  let client: PoolClient;

  beforeAll(async () => {
    client = await getClient();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  async function contract(contractId: string, qty: number): Promise<string> {
    const res = await client.query(
      `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm)
       VALUES ($1, 'B', 'S', 'P', $2, 'KG', 'CIF') RETURNING id`,
      [contractId, qty],
    );
    return res.rows[0].id as string;
  }

  async function sto(contractUuid: string, stoNumber: string) {
    await client.query(`INSERT INTO contract_stos (contract_id, sto_number) VALUES ($1, $2)`, [contractUuid, stoNumber]);
  }

  const ENRICHED = `enriched(sto_key, contract_numbers, effective_status, is_unplanned_execution) AS (VALUES
    ('T1', 'TST-X', 'PLANNED', false),
    ('T2', 'TST-X', 'PLANNED', false),
    ('T3', 'TST-X', 'COMPLETED', false),
    ('T4', 'TST-Y', 'COMPLETED', false),
    ('T5', 'TST-Y', 'CANCELLED', false),
    ('T6', 'TST-Z', 'CANCELLED', false),
    ('T7', 'TST-W', 'PLANNED', false),
    ('T8', 'TST-W', 'LOADING', false),
    ('T9', 'TST-W, TST-V', 'PLANNED', false)
  )`;

  it('counts a PO once however many STO rows it is on, at its furthest active stage; Completed beats Cancelled; a shared STO is not a second PO', async () => {
    // X: three STO rows (Planned, Planned, Completed)            -> Planned, once
    // Y: Completed + Cancelled                                   -> Completed (a cancelled leg does not undo a delivered one)
    // Z: Cancelled only                                          -> Cancelled
    // W: Planned, Loading, and a STO it shares with V           -> Loading (furthest), so on no card here
    // V: only the shared STO, which is Planned                  -> Planned
    const X = await contract('TST-X', 3_000_000);
    const Y = await contract('TST-Y', 2_000_000);
    const Z = await contract('TST-Z', 1_000_000);
    const W = await contract('TST-W', 4_000_000);
    const V = await contract('TST-V', 500_000);
    for (const s of ['T1', 'T2', 'T3']) await sto(X, s);
    for (const s of ['T4', 'T5']) await sto(Y, s);
    await sto(Z, 'T6');
    for (const s of ['T7', 'T8', 'T9']) await sto(W, s);
    await sto(V, 'T9');

    const once = (
      await client.query(
        `WITH ${ENRICHED}, ${sqlShipmentContractQtyOncePerContractCtes('enriched')}
         SELECT ${sqlShipmentContractQtyOnceSelect()}`,
      )
    ).rows[0];
    expect(Number(once.planned_contract_qty)).toBe(3_500_000); // X + V
    expect(Number(once.completed_contract_qty)).toBe(2_000_000); // Y
    expect(Number(once.cancelled_contract_qty)).toBe(1_000_000); // Z
    expect(Number(once.unplanned_execution_contract_qty)).toBe(0);

    // what it replaced: the same rows summed per row count X twice, W three times, and V's shared row on top
    const perRow = (
      await client.query(
        `WITH ${ENRICHED}
         SELECT effective_status, SUM(${shipmentListRowContractQtySql('enriched')}) AS qty FROM enriched GROUP BY 1`,
      )
    ).rows;
    const plannedPerRow = Number(perRow.find((r) => r.effective_status === 'PLANNED')?.qty);
    expect(plannedPerRow).toBeGreaterThan(Number(once.planned_contract_qty));
  });

  it('a contract on one row is counted exactly as before (nothing changes where the grain was already one row)', async () => {
    const solo = await contract('TST-SOLO', 750_000);
    await sto(solo, 'S1');
    const res = (
      await client.query(
        `WITH enriched(sto_key, contract_numbers, effective_status, is_unplanned_execution) AS (VALUES ('S1', 'TST-SOLO', 'PLANNED', false)),
              ${sqlShipmentContractQtyOncePerContractCtes('enriched')}
         SELECT ${sqlShipmentContractQtyOnceSelect()}`,
      )
    ).rows[0];
    expect(Number(res.planned_contract_qty)).toBe(750_000);
    expect(Number(res.completed_contract_qty)).toBe(0);
  });
});
