import { describe, expect, it } from 'vitest';
import { computeHybridListPageSlices } from './hybridListPageSlices';
import { hybridListUsesGlobalMergeSort } from './shipmentListSortSql';

describe('computeHybridListPageSlices', () => {
  it('returns execution rows first on page 1', () => {
    expect(
      computeHybridListPageSlices({ offset: 0, limit: 20, executionRows: 30 }),
    ).toEqual({
      executionOffset: 0,
      executionLimit: 20,
      contractLimit: 0,
      contractOffset: 0,
    });
  });

  it('fills remainder with contract backlog when execution spans page boundary', () => {
    expect(
      computeHybridListPageSlices({ offset: 20, limit: 20, executionRows: 30 }),
    ).toEqual({
      executionOffset: 20,
      executionLimit: 10,
      contractLimit: 10,
      contractOffset: 0,
    });
  });

  it('serves contract backlog after execution rows are exhausted', () => {
    expect(
      computeHybridListPageSlices({ offset: 40, limit: 20, executionRows: 30 }),
    ).toEqual({
      executionOffset: 0,
      executionLimit: 0,
      contractLimit: 20,
      contractOffset: 10,
    });
  });

  it('starts with contract backlog when there are no execution rows', () => {
    expect(
      computeHybridListPageSlices({ offset: 0, limit: 20, executionRows: 0 }),
    ).toEqual({
      executionOffset: 0,
      executionLimit: 0,
      contractLimit: 20,
      contractOffset: 0,
    });
  });
});

describe('hybridListUsesGlobalMergeSort', () => {
  it('keeps execution-first paging for default created_at', () => {
    expect(hybridListUsesGlobalMergeSort('created_at')).toBe(false);
  });

  it('uses global merge for contract_date but not heavy qty sorts', () => {
    expect(hybridListUsesGlobalMergeSort('contract_date')).toBe(true);
    expect(hybridListUsesGlobalMergeSort('outstanding_quantity')).toBe(false);
  });
});
