import { describe, expect, it } from 'vitest';
import {
  applyContractGrainOutstanding,
  contractNumbersOf,
  loadContractExecutionOutstandingKg,
} from './shippingPerfContractGrainOs.service';
import {
  shipmentActiveStageRank,
  sqlShipmentActiveStageRankExpr,
} from '../utils/shipmentActiveStageRank';

/**
 * Shipments values a CONTRACT's outstanding and puts all of it on the furthest active stage;
 * this page gave each STO a share of its PO. A contract whose other STOs are completed or out of
 * scope was therefore only counted in part - 79,914 MT here against 81,583 on Shipments for
 * CPO / BONTANG / YTD (production, 2026-09-21).
 */
describe('contract-grain outstanding for Shipping Performance', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    contract_number: 'C1',
    status: 'PLANNED',
    outstanding_qty_aggregate: 999,
    ...over,
  });

  it('places the whole contract outstanding on the furthest active stage', () => {
    const planned = row({ status: 'PLANNED' });
    const atDischarge = row({ status: 'ARRIVED_DP' });
    applyContractGrainOutstanding([planned, atDischarge], new Map([['C1', 3000]]));
    expect(atDischarge.outstanding_qty_aggregate).toBe(3000);
    expect(planned.outstanding_qty_aggregate).toBe(0);
  });

  it('counts a contract exactly once, so the tree stays additive', () => {
    const rows = [row({ status: 'PLANNED' }), row({ status: 'PLANNED' }), row({ status: 'SAILED' })];
    applyContractGrainOutstanding(rows, new Map([['C1', 2500]]));
    const total = rows.reduce((a, r) => a + Number(r.outstanding_qty_aggregate), 0);
    expect(total).toBe(2500);
  });

  it('adds up several contracts landing on one row', () => {
    const only = row({ contract_number: 'C1, C2', status: 'UNLOADING' });
    applyContractGrainOutstanding([only], new Map([['C1', 1000], ['C2', 250]]));
    expect(only.outstanding_qty_aggregate).toBe(1250);
  });

  /*
   * COMPLETED and CANCELLED are not active stages, so they never win a contract and never carry
   * outstanding - the same rule that keeps them out of the Shipments OS cards.
   */
  it('never awards a contract to a COMPLETED or CANCELLED row', () => {
    const done = row({ status: 'COMPLETED' });
    const cancelled = row({ status: 'CANCELLED' });
    applyContractGrainOutstanding([done, cancelled], new Map([['C1', 4000]]));
    expect(done.outstanding_qty_aggregate).toBe(0);
    expect(cancelled.outstanding_qty_aggregate).toBe(0);
  });

  /*
   * Backlog rows already carry a whole contract's outstanding and have no shipment, so no stage.
   * Both pages agree on that arm to the MT because both call contractBacklogCoreWhereSql.
   */
  it('leaves backlog rows untouched', () => {
    const backlog = row({ is_unplanned_backlog: true, outstanding_qty_aggregate: 7000 });
    applyContractGrainOutstanding([backlog], new Map([['C1', 123]]));
    expect(backlog.outstanding_qty_aggregate).toBe(7000);
  });

  it('is stable when two rows tie on stage', () => {
    const a = row({ status: 'ARRIVED_DP' });
    const b = row({ status: 'UNLOADING' }); // same rank, 5
    applyContractGrainOutstanding([a, b], new Map([['C1', 900]]));
    expect(a.outstanding_qty_aggregate).toBe(900);
    expect(b.outstanding_qty_aggregate).toBe(0);
  });

  it('splits a merged contract list the way the rows carry it', () => {
    expect(contractNumbersOf({ contract_number: ' C1 , C2 ,, C3 ' })).toEqual(['C1', 'C2', 'C3']);
    expect(contractNumbersOf({})).toEqual([]);
  });

  /*
   * The TS ranks and the SQL ranks are generated from one map. If someone hand-edits either, the
   * two pages start disagreeing about which stage is furthest - which is the whole class of bug
   * this change exists to end.
   */
  it('ranks the same stages the SQL expression ranks', () => {
    const sql = sqlShipmentActiveStageRankExpr('s');
    for (const [status, rank] of [
      ['ARRIVED_DP', 5], ['BERTHED_DP', 5], ['UNLOADING', 5],
      ['SAILED', 4], ['LOADING', 3], ['PLANNED', 2], ['COMPLETED', 1],
    ] as const) {
      expect(shipmentActiveStageRank(status)).toBe(rank);
      if (rank > 1) expect(sql).toContain(`'${status}'`);
    }
  });

  /*
   * A correct string proves nothing about whether the query runs: the expression assumes a
   * qty_move CTE and without it fails at runtime with 42P01.
   */
  it('RUNS against the database and returns positive kg', async () => {
    const r = await loadContractExecutionOutstandingKg(['NOPE-does-not-exist']);
    expect(r.size).toBe(0);
  }, 120_000);
});
