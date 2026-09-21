import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { sqlContractExecutionOutstandingKgExpr } from './contractExecutionOutstandingSql';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';

/**
 * Shipping Performance needs the CONTRACT's outstanding, valued the way the Shipments execution
 * arm values it, so the two pages can be reconciled without either recomputing the other's rule.
 *
 * A near-enough copy is what this guards against, and the cost is already measured: a first
 * diagnosis used the BACKLOG arm's formula as a stand-in and reported 5,162 MT where the residual
 * was 1,661 - the right shape, three times the size.
 */
const withQtyMove = async (select: string, params: unknown[] = []) => {
  const cte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT c_s.contract_id FROM contracts c_s',
  });
  return query(`WITH ${cte} ${select}`, params);
};

describe('contract execution outstanding', () => {
  /*
   * The expression reads `FROM qty_move qm`. Without that CTE spliced in it fails at runtime with
   * 42P01 while every string assertion still passes - the exact gap that took the Shipping
   * Performance page down once.
   */
  it('RUNS, given the qty_move CTE it assumes', async () => {
    const r = await withQtyMove(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE (${sqlContractExecutionOutstandingKgExpr('c.contract_id')}) > 0)::int AS with_os
       FROM contracts c`,
    );
    expect(Number(r.rows[0].n)).toBeGreaterThan(0);
    expect(Number(r.rows[0].with_os)).toBeGreaterThan(0);
  }, 120_000);

  it('never returns a negative - the formula clamps at zero', async () => {
    const r = await withQtyMove(
      `SELECT COUNT(*)::int AS n FROM contracts c
       WHERE (${sqlContractExecutionOutstandingKgExpr('c.contract_id')}) < 0`,
    );
    expect(Number(r.rows[0].n)).toBe(0);
  }, 120_000);

  /*
   * A contract whose own GR says Close carries no outstanding, whatever its STO group does.
   * 1004029445, 1004030942 and 1004030943 kept contributing 608 MT before that was tested per
   * contract rather than as a BOOL_AND across the group.
   */
  it('gives a SAP-closed contract nothing', async () => {
    const r = await withQtyMove(
      // Asserted through sqlIsContractSapClosedExpr itself. A hand-written
      // import_status IN ('CLOSE','CLOSED') is a fourth spelling of the rule, and writing one here
      // while arguing against copies elsewhere is how the first run of this test failed.
      `SELECT COUNT(*)::int AS leaking
       FROM contracts c
       WHERE ${sqlIsContractSapClosedExpr('c')}
         AND (${sqlContractExecutionOutstandingKgExpr('c.contract_id')}) <> 0`,
    );
    expect(Number(r.rows[0].leaking)).toBe(0);
  }, 120_000);

  it('reads the contract OWN incoterm, not a group value', () => {
    const sql = sqlContractExecutionOutstandingKgExpr('c.contract_id');
    expect(sql).toContain('c_i.incoterm');
    expect(sql).toContain('c_q.quantity_ordered');
  });
});
