import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getClient } from '../database/connection';
import { shipmentListSeaDisplayStoNumberExpr, shipmentListSeaStoKeyExpr } from './shipmentStoTypeSql';

/**
 * The list row a shipment lands in (shipmentListSeaStoKeyExpr), run on fixtures in a rolled-back transaction.
 * STO 1006020396 showed two rows with the same STO and the same operation id: its SAP shell (operation_id_source
 * SAP_IMPORT) was keyed by the STO, its five sisters (source NULL, same operation id) by the OP- id.
 */
describe('shipmentListSeaStoKeyExpr groups the voyage of a SAP shell (run in Postgres)', () => {
  let client: PoolClient;
  const STO = '1006020396';
  const OP = 'OP-1004031610-45984098';
  const ids: Record<string, string> = {};

  async function contract(po: string, withSto = true): Promise<string> {
    const r = await client.query(
      `INSERT INTO contracts (contract_id, po_number, buyer, supplier, product, quantity_ordered, unit, incoterm)
       VALUES ($1, $2, 'b', 's', 'CPO', 1, 'MT', 'FOB') RETURNING id`,
      [`KEY-${po}`, po],
    );
    const id = r.rows[0].id as string;
    if (withSto) await client.query(`INSERT INTO contract_stos (contract_id, sto_number, sto_type) VALUES ($1::uuid, $2, 'V')`, [id, STO]);
    return id;
  }

  async function ship(key: string, contractId: string, shipmentId: string, op: string, source: string | null): Promise<void> {
    const r = await client.query(
      `INSERT INTO shipments (shipment_id, contract_id, operation_id, operation_id_source, vessel_name, status)
       VALUES ($1, $2::uuid, $3, $4, 'BG. WIDMARINO R18', 'COMPLETED') RETURNING id`,
      [shipmentId, contractId, op, source],
    );
    ids[key] = r.rows[0].id as string;
  }

  async function keys(): Promise<Record<string, string | null>> {
    const sql = `SELECT s.id::text AS id, (${shipmentListSeaStoKeyExpr('c', 'l', 's')}) AS key, (${shipmentListSeaDisplayStoNumberExpr('c', 'l', 's')}) AS sto
      FROM shipments s JOIN contracts c ON c.id = s.contract_id LEFT JOIN (SELECT NULL::text AS effective_sto) l ON true
      WHERE s.id = ANY($1::uuid[])`;
    const rows = (await client.query(sql, [Object.values(ids)])).rows as Array<{ id: string; key: string | null }>;
    const out: Record<string, string | null> = {};
    for (const [name, id] of Object.entries(ids)) out[name] = rows.find((r) => r.id === id)?.key ?? null;
    return out;
  }

  beforeAll(async () => {
    client = await getClient();
    await client.query('BEGIN');
    // the six POs of the voyage: PO 1610 is the SAP shell, the rest were touched by a user (source NULL), all in one operation
    await ship('shell', await contract('9901031610'), STO, OP, 'SAP_IMPORT');
    for (const po of ['9901031763', '9901031908', '9901032347']) await ship(`sister_${po}`, await contract(po), STO, OP, null);
    // another STO, imported as a shell in OP-SEA-A, with a later Add New voyage (own id, numeric shipment_id) on the same STO
    await ship('addnew', await contract('9901099001'), STO, 'OP-1004099001-11111111', null);
  }, 60_000);

  afterAll(async () => {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('the shell and the sisters planned in its operation are one row, keyed by the STO', async () => {
    const k = await keys();
    expect(k.shell).toBe(STO);
    expect(k.sister_9901031763).toBe(STO);
    expect(k.sister_9901031908).toBe(STO);
    expect(k.sister_9901032347).toBe(STO);
  });

  it('an Add New voyage whose operation id the shell does not carry is still a row of its own', async () => {
    const k = await keys();
    expect(k.addnew).toBe('OP-1004099001-11111111');
  });

  it('without a SAP_IMPORT shell in the operation the OP- rows stay a voyage of their own', async () => {
    await client.query(`UPDATE shipments SET operation_id_source = NULL WHERE id = $1::uuid`, [ids.shell]);
    const k = await keys();
    // every row of the operation is user-planned now: they all key by the OP- id, still one row
    expect(k.shell).toBe(OP);
    expect(k.sister_9901031763).toBe(OP);
    expect(k.sister_9901032347).toBe(OP);
  });

  it('a cancelled SAP shell does not pull the operation onto the STO', async () => {
    await client.query(`UPDATE shipments SET operation_id_source = 'SAP_IMPORT', status = 'CANCELLED' WHERE id = $1::uuid`, [ids.shell]);
    const k = await keys();
    expect(k.sister_9901031763).toBe(OP);
  });
});
