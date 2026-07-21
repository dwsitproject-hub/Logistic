import { describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

import { resolveContractsQtyMoveCte } from './contractQtyMoveSnapshot.service';

describe('resolveContractsQtyMoveCte', () => {
  it('always returns live qty_move SQL (not snapshot join)', async () => {
    const sql = await resolveContractsQtyMoveCte('contract_scope');
    expect(sql).toContain('qty_move AS');
    expect(sql).toContain('trucking_wb_overlay');
    expect(sql).toContain('qty_move_sap');
    expect(sql).not.toContain('FROM contract_qty_move_snapshot');
  });

  it('scopes live CTE to the provided contract_scope name', async () => {
    const sql = await resolveContractsQtyMoveCte('my_contract_scope');
    expect(sql).toContain('my_contract_scope');
  });
});
