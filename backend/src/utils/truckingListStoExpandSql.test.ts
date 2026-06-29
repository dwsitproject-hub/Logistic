import { describe, expect, it } from 'vitest';
import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';

describe('truckingListStoExpandSql', () => {
  it('wrapTruckingListQueryWithStoExpansion expands by contract_stos and qty_move', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('expanded');
  });
});
