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
});
