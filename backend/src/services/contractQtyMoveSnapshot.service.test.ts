import { describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { resolveContractsQtyMoveCte } from './contractQtyMoveSnapshot.service';

function mockSnapshotIsStale(isStale: boolean): void {
  queryMock.mockResolvedValueOnce({ rows: [{ is_stale: isStale }] });
}

describe('resolveContractsQtyMoveCte', () => {
  it('returns hybrid (snapshot fast-path + live) qty_move SQL when snapshot is fresh', async () => {
    mockSnapshotIsStale(false);
    const sql = await resolveContractsQtyMoveCte('contract_scope');
    expect(sql).toContain('qty_move AS');
    expect(sql).toContain('FROM contract_qty_move_snapshot');
    expect(sql).toContain('qty_move_fast_ids');
    expect(sql).toContain('qty_move_live_ids');
    expect(sql).toContain('qty_move_live_calc');
    expect(sql).toContain('trucking_wb_overlay');
    expect(sql).toContain('b2b_child_qty_rollup');
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
