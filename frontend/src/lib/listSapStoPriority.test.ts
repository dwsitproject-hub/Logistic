import { describe, expect, it } from 'vitest';
import {
  compareSapStoListRowPriority,
  hasSapStoListRow,
  shouldPrioritizeSapStoRows,
} from './listSapStoPriority';

describe('listSapStoPriority', () => {
  it('hasSapStoListRow ignores contract backlog rows', () => {
    expect(hasSapStoListRow({ row_kind: 'contract_backlog', sto_number: '1001' })).toBe(false);
    expect(hasSapStoListRow({ sto_number: '1006018900' })).toBe(true);
    expect(hasSapStoListRow({ sto_number: '' })).toBe(false);
  });

  it('compareSapStoListRowPriority puts STO rows first', () => {
    const withSto = { sto_number: '1006018900' };
    const backlog = { row_kind: 'contract_backlog' as const };
    expect(compareSapStoListRowPriority(withSto, backlog)).toBeLessThan(0);
    expect(compareSapStoListRowPriority(backlog, withSto)).toBeGreaterThan(0);
  });

  it('shouldPrioritizeSapStoRows matches UNPLANNED and PLANNED', () => {
    expect(shouldPrioritizeSapStoRows('UNPLANNED')).toBe(true);
    expect(shouldPrioritizeSapStoRows('PLANNED')).toBe(true);
    expect(shouldPrioritizeSapStoRows('COMPLETED')).toBe(false);
  });
});
