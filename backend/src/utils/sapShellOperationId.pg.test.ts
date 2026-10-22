import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getClient } from '../database/connection';
import { convergeStoOperationIds, ensureSapShellOperationId, findPlannedOperationForMultiPoSto } from './sapShellOperationId';
import { stoSpansContractsOutsidePlan } from '../services/createShipment.service';

/**
 * The STO / operation merge rules, run against real Postgres inside one transaction that is rolled back.
 *
 * STO 1006020666 = PO 1001032425 + 1001032737 (one vessel, two POs). Operation OP-1004032737-34122029 is the AS MARINA 10 voyage a user planned in KLIP
 * for those two POs before SAP delivered the STO. A second plan (AS MARINA 12, PO 1001032737 only) must NOT take the STO.
 */
describe('one STO, one operation (run in Postgres)', () => {
  let client: PoolClient;
  let seq = 0;
  const tag = `${Date.now()}`.slice(-6);

  beforeAll(async () => {
    client = await getClient();
    await client.query('BEGIN');
  }, 60_000);

  afterAll(async () => {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  const sto = (n: number) => `9${tag}${String(n).padStart(3, '0')}`;
  const po = (n: number) => `8${tag}${String(n).padStart(3, '0')}`;

  async function contract(n: number): Promise<{ id: string; po: string }> {
    const r = await client.query(
      `INSERT INTO contracts (contract_id, po_number, buyer, supplier, product, quantity_ordered, unit)
       VALUES ($1, $2, 'b', 's', 'CPO', 1, 'MT') RETURNING id`,
      [`T${tag}-${n}-${++seq}`, po(n)],
    );
    return { id: r.rows[0].id as string, po: po(n) };
  }

  async function shipment(args: {
    contractId: string;
    shipmentId: string;
    op?: string | null;
    source?: string | null;
    vessel?: string | null;
    status?: string;
  }): Promise<string> {
    const r = await client.query(
      `INSERT INTO shipments (shipment_id, contract_id, operation_id, operation_id_source, vessel_name, status)
       VALUES ($1, $2::uuid, $3, $4, $5, $6) RETURNING id`,
      [args.shipmentId, args.contractId, args.op ?? null, args.source ?? null, args.vessel ?? null, args.status ?? 'PLANNED'],
    );
    return r.rows[0].id as string;
  }

  async function sapRow(stoNumber: string, poNumber: string): Promise<void> {
    await client.query(`INSERT INTO sap_processed_data (data, po_number, sto_number) VALUES ('{}'::jsonb, $1, $2)`, [poNumber, stoNumber]);
  }

  const opOf = async (id: string) => (await client.query(`SELECT operation_id FROM shipments WHERE id = $1::uuid`, [id])).rows[0].operation_id as string | null;

  it('a multi-PO STO takes the voyage planned for exactly its POs, for every one of its shells', async () => {
    const c425 = await contract(1);
    const c737 = await contract(2);
    const S = sto(1);
    const voyage = `OP-T${tag}-34122029`;
    await shipment({ contractId: c737.id, shipmentId: `MNL-1-${tag}a`, op: voyage, vessel: 'AS MARINA 10' });
    await shipment({ contractId: c425.id, shipmentId: `MNL-2-${tag}b`, op: voyage, vessel: 'AS MARINA 10' });
    // the later AS MARINA 12 plan for PO 737 alone
    await shipment({ contractId: c737.id, shipmentId: `MNL-3-${tag}c`, op: `OP-T${tag}-05814565`, vessel: 'AS MARINA 12' });
    await sapRow(S, c425.po);
    await sapRow(S, c737.po);
    const shell425 = await shipment({ contractId: c425.id, shipmentId: S });
    const shell737 = await shipment({ contractId: c737.id, shipmentId: S });

    expect(await ensureSapShellOperationId(client, shell737)).toBe(voyage);
    expect(await ensureSapShellOperationId(client, shell425)).toBe(voyage);
    expect(await opOf(shell737)).toBe(voyage);
    expect(await opOf(shell425)).toBe(voyage);
  }, 60_000);

  it('the operation of the one PO that does not match the STO never gets it', async () => {
    const c425 = await contract(3);
    const c737 = await contract(4);
    const S = sto(2);
    const own = `OP-T${tag}-1111`;
    await shipment({ contractId: c737.id, shipmentId: `MNL-4-${tag}`, op: own, vessel: 'AS MARINA 12' });
    await sapRow(S, c425.po);
    await sapRow(S, c737.po);
    const shell737 = await shipment({ contractId: c737.id, shipmentId: S });
    expect(await findPlannedOperationForMultiPoSto(client, shell737, S)).toBeNull();
    expect(await ensureSapShellOperationId(client, shell737)).toMatch(/^OP-SEA-/);
  }, 60_000);

  it('a voyage that already carries another STO\'s shell is a different voyage', async () => {
    const a = await contract(5);
    const b = await contract(6);
    const S = sto(3);
    const voyage = `OP-T${tag}-2222`;
    await shipment({ contractId: a.id, shipmentId: `MNL-5-${tag}`, op: voyage });
    await shipment({ contractId: b.id, shipmentId: `MNL-6-${tag}`, op: voyage });
    await shipment({ contractId: a.id, shipmentId: sto(99), op: voyage }); // another STO already sits in it
    await sapRow(S, a.po);
    await sapRow(S, b.po);
    const shell = await shipment({ contractId: a.id, shipmentId: S });
    expect(await findPlannedOperationForMultiPoSto(client, shell, S)).toBeNull();
  }, 60_000);

  it('a one-PO STO is never matched by PO set alone', async () => {
    const a = await contract(7);
    const S = sto(4);
    await shipment({ contractId: a.id, shipmentId: `MNL-7-${tag}`, op: `OP-T${tag}-3333` });
    await sapRow(S, a.po);
    const shell = await shipment({ contractId: a.id, shipmentId: S });
    expect(await findPlannedOperationForMultiPoSto(client, shell, S)).toBeNull();
  }, 60_000);

  it('two voyages with the same PO set are ambiguous: no guess', async () => {
    const a = await contract(8);
    const b = await contract(9);
    const S = sto(5);
    for (const op of [`OP-T${tag}-4441`, `OP-T${tag}-4442`]) {
      await shipment({ contractId: a.id, shipmentId: `MNL-8-${op}`, op });
      await shipment({ contractId: b.id, shipmentId: `MNL-9-${op}`, op });
    }
    await sapRow(S, a.po);
    await sapRow(S, b.po);
    const shell = await shipment({ contractId: a.id, shipmentId: S });
    expect(await findPlannedOperationForMultiPoSto(client, shell, S)).toBeNull();
  }, 60_000);

  describe('convergeStoOperationIds', () => {
    it('STO 1006020667: one STO on two OP-SEA ids, same vessel -> the id most of its rows carry', async () => {
      const cs = [await contract(10), await contract(11), await contract(12), await contract(13)];
      const S = sto(6);
      const main = `OP-SEA-T${tag}0001`;
      const stray = `OP-SEA-T${tag}0003`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push(await shipment({ contractId: cs[i].id, shipmentId: S, op: main, source: 'SAP_IMPORT', vessel: 'BG. PKPJ III' }));
      const strayId = await shipment({ contractId: cs[3].id, shipmentId: S, op: stray, source: 'SAP_IMPORT', vessel: 'bg. pkpj iii' });
      expect(await convergeStoOperationIds(client, S)).toBe(1);
      expect(await opOf(strayId)).toBe(main);
      for (const id of ids) expect(await opOf(id)).toBe(main);
      // idempotent
      expect(await convergeStoOperationIds(client, S)).toBe(0);
    }, 60_000);

    it('a user-planned operation of the STO wins over a SAP-assigned one (STO 1006020605)', async () => {
      const a = await contract(14);
      const b = await contract(15);
      const S = sto(7);
      const user = `OP-T${tag}-46264987`;
      await shipment({ contractId: a.id, shipmentId: S, op: user, source: null, vessel: 'LUMINOR 6' });
      const sap = await shipment({ contractId: b.id, shipmentId: S, op: `OP-SEA-T${tag}0004`, source: 'SAP_IMPORT', vessel: 'Luminor 6' });
      expect(await convergeStoOperationIds(client, S)).toBe(1);
      expect(await opOf(sap)).toBe(user);
    }, 60_000);

    it('never merges different vessels (STO 1006019958: SMS 3002 vs Luminor 6)', async () => {
      const a = await contract(16);
      const b = await contract(17);
      const S = sto(8);
      await shipment({ contractId: a.id, shipmentId: S, op: `OP-T${tag}-17019387`, source: null, vessel: 'SMS 3002' });
      const sap = await shipment({ contractId: b.id, shipmentId: S, op: `OP-SEA-T${tag}0045`, source: 'SAP_IMPORT', vessel: 'Luminor 6' });
      expect(await convergeStoOperationIds(client, S)).toBe(0);
      expect(await opOf(sap)).toBe(`OP-SEA-T${tag}0045`);
    }, 60_000);

    it('never moves a user-planned row, and never moves a row out of an operation another STO shares', async () => {
      const a = await contract(18);
      const b = await contract(19);
      const c = await contract(20);
      const d = await contract(24);
      const S = sto(9);
      const main = `OP-SEA-T${tag}0010`;
      const shared = `OP-SEA-T${tag}0011`;
      await shipment({ contractId: a.id, shipmentId: S, op: main, source: 'SAP_IMPORT', vessel: 'X' });
      await shipment({ contractId: d.id, shipmentId: S, op: main, source: 'SAP_IMPORT', vessel: 'X' });
      const userRow = await shipment({ contractId: b.id, shipmentId: S, op: `OP-T${tag}-5555`, source: null, vessel: 'X' });
      const sharedRow = await shipment({ contractId: c.id, shipmentId: S, op: shared, source: 'SAP_IMPORT', vessel: 'X' });
      await shipment({ contractId: c.id, shipmentId: sto(98), op: shared, source: 'SAP_IMPORT', vessel: 'X' }); // another STO shares it (same contract, other STO)
      await convergeStoOperationIds(client, S);
      expect(await opOf(userRow)).toBe(`OP-T${tag}-5555`);
      expect(await opOf(sharedRow)).toBe(shared);
    }, 60_000);
  });

  describe('a plan for one PO of a multi-PO STO does not take its shell', () => {
    it('stoSpansContractsOutsidePlan', async () => {
      const c425 = await contract(21);
      const c737 = await contract(22);
      const S = sto(10);
      const shell737 = await shipment({ contractId: c737.id, shipmentId: S });
      await shipment({ contractId: c425.id, shipmentId: S });
      // the AS MARINA 12 plan covers PO 737 only: the shell belongs to an STO that also covers PO 425
      expect(await stoSpansContractsOutsidePlan(shell737, [c737.id], client)).toBe(true);
      // a plan that covers both POs may fill it
      expect(await stoSpansContractsOutsidePlan(shell737, [c737.id, c425.id], client)).toBe(false);
      // a cancelled sibling does not count
      await client.query(`UPDATE shipments SET status = 'CANCELLED' WHERE shipment_id = $1 AND contract_id = $2::uuid`, [S, c425.id]);
      expect(await stoSpansContractsOutsidePlan(shell737, [c737.id], client)).toBe(false);
    }, 60_000);

    it('a single-PO STO and a manual MNL row are never held back', async () => {
      const a = await contract(23);
      const single = await shipment({ contractId: a.id, shipmentId: sto(11) });
      const manual = await shipment({ contractId: a.id, shipmentId: `MNL-9-${tag}z` });
      expect(await stoSpansContractsOutsidePlan(single, [a.id], client)).toBe(false);
      expect(await stoSpansContractsOutsidePlan(manual, [a.id], client)).toBe(false);
    }, 60_000);
  });
});
