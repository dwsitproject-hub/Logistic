import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import {
  invalidateContractQtyMoveSnapshotFreshness,
  resolveContractsQtyMoveCte,
} from './contractQtyMoveSnapshot.service';

beforeEach(() => {
  invalidateContractQtyMoveSnapshotFreshness();
});

function mockSnapshotIsStale(isStale: boolean): void {
  queryMock.mockResolvedValueOnce({ rows: [{ is_stale: isStale }] });
}

describe('resolveContractsQtyMoveCte', () => {
  /**
   * A fresh snapshot is read directly, with no live branch: the refresh materialises qty_move
   * for every contract, so keeping a live branch only to serve an empty id set still cost 85s
   * of the contracts-list row set's 85.4s - Postgres cannot know at plan time that the branch
   * has no input. Dropping it measured 105.8s -> 126ms with all 7,751 YTD rows identical.
   * The B2B rollup and the WB / KLIP overlays are guarded on the refresh path instead, in
   * contractGlobalOutstandingSql.test.ts - that is where they are applied to the stored values.
   */
  it('reads the snapshot directly, with no live calculation, when it is fresh', async () => {
    mockSnapshotIsStale(false);
    const sql = await resolveContractsQtyMoveCte('contract_scope');
    expect(sql).toContain('qty_move AS');
    expect(sql).toContain('FROM contract_qty_move_snapshot');
    expect(sql).not.toContain('qty_move_live_calc');
    expect(sql).not.toContain('trucking_wb_overlay');
    expect(sql).not.toContain('b2b_child_qty_rollup');
  });

  it('falls back to fully-live qty_move SQL when snapshot is stale', async () => {
    mockSnapshotIsStale(true);
    const sql = await resolveContractsQtyMoveCte('contract_scope');
    expect(sql).toContain('qty_move AS');
    expect(sql).toContain('trucking_wb_overlay');
    expect(sql).toContain('qty_move_sap');
    expect(sql).toContain('b2b_child_qty_rollup');
    expect(sql).not.toContain('FROM contract_qty_move_snapshot');
  });

  it('scopes hybrid CTE to the provided contract_scope name', async () => {
    mockSnapshotIsStale(false);
    const sql = await resolveContractsQtyMoveCte('my_contract_scope');
    expect(sql).toContain('my_contract_scope');
  });

  /**
   * The resolver used to hardcode `{ kind: 'join_scope' }`, which is why 29 call sites across 15
   * files still build the fully-live qty_move directly - measured 2026-09-04 at 42-75s for the
   * whole contract set, and the dominant cost behind the 40-56s Shipments backlog queries. Most
   * of those sites scope with `in_subquery`, so they could not reach the snapshot at all until
   * the resolver accepted the same filter union as the builders.
   */
  it('accepts an in_subquery filter so subquery-scoped callers can reach the snapshot', async () => {
    mockSnapshotIsStale(false);
    const sql = await resolveContractsQtyMoveCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_number FROM contract_candidates',
    });
    expect(sql).toContain('FROM contract_qty_move_snapshot');
    expect(sql).toContain('SELECT contract_number FROM contract_candidates');
    // No scope-CTE join should be emitted for the subquery shape.
    expect(sql).not.toContain('INNER JOIN contract_scope');
  });

  it('honours the in_subquery filter on the stale fallback too', async () => {
    mockSnapshotIsStale(true);
    const sql = await resolveContractsQtyMoveCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_id FROM contracts c2',
    });
    expect(sql).toContain('SELECT contract_id FROM contracts c2');
    expect(sql).not.toContain('FROM contract_qty_move_snapshot');
  });

  it('keeps the string form behaving exactly as before (existing callers unchanged)', async () => {
    // mockSnapshotIsStale uses mockResolvedValueOnce, so each resolver call needs its own.
    mockSnapshotIsStale(false);
    const viaString = await resolveContractsQtyMoveCte('contract_scope');
    mockSnapshotIsStale(false);
    const viaFilter = await resolveContractsQtyMoveCte({
      kind: 'join_scope',
      scopeCteName: 'contract_scope',
    });
    expect(viaString).toBe(viaFilter);
  });
});
