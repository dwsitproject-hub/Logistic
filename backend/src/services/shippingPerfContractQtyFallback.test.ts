import { describe, expect, it } from 'vitest';
import { buildShippingPerformanceSql } from './shippingPerformance.service';
import { query } from '../database/connection';

/**
 * sto_metrics is keyed by STO, and a row can have no STO of its own. A B2B PARENT is the clearest
 * case: the child carries the STO while this page deliberately shows the parent. COALESCE(sm.…, 0)
 * then printed Contract Qty 0 for a real contract.
 *
 * Reported on 9194100035 - a parent of child PO 9191000035 holding 3,000 MT - displayed as 0.
 * Measured across the page before the fix: 40 rows of 887, whose contracts hold 108,970 MT.
 */
describe('Shipping Performance contract qty falls back when the STO metrics miss', () => {
  it('prefers sto_metrics and falls back to the contract, never straight to zero', async () => {
    const sql = await buildShippingPerformanceSql();
    expect(sql).toContain('COALESCE(sm.contract_qty, c.quantity_ordered, 0)');
    expect(sql).not.toContain('COALESCE(sm.contract_qty, 0)');
  });

  /*
   * Executed, not asserted on the string: a row with no sto_metrics match is exactly the shape
   * that produced the zero, and only running the query shows whether any remain.
   */
  it('leaves no row showing zero for a contract that has a quantity', async () => {
    const sql = await buildShippingPerformanceSql();
    const r = await query(
      `SELECT COUNT(*)::int AS n
       FROM (${sql}) q
       WHERE COALESCE(q.contract_qty, 0) = 0
         AND EXISTS (
           SELECT 1 FROM contracts c2
           WHERE c2.contract_id = q.contract_number
             AND COALESCE(c2.quantity_ordered, 0) > 0
         )`,
    );
    expect(Number(r.rows[0].n)).toBe(0);
  }, 300_000);
});
