import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_DOCS_SQL_SORT_COLUMNS,
  resolveCommercialDocumentsListSort,
} from './commercialDocumentsListSort';

describe('resolveCommercialDocumentsListSort', () => {
  it('defaults to contract_date desc', () => {
    const resolved = resolveCommercialDocumentsListSort(undefined, undefined);
    expect(resolved.sortKey).toBe('contract_date');
    expect(resolved.orderExpr).toBe(COMMERCIAL_DOCS_SQL_SORT_COLUMNS.contract_date);
    expect(resolved.sortDir).toBe('desc');
  });

  it('maps known columns and accepts asc', () => {
    const resolved = resolveCommercialDocumentsListSort('po_number', 'asc');
    expect(resolved.sortKey).toBe('po_number');
    expect(resolved.orderExpr).toBe('e.po_number');
    expect(resolved.sortDir).toBe('asc');
  });

  it('rejects unknown sortKey (no SQL interpolation)', () => {
    const resolved = resolveCommercialDocumentsListSort('e.contract_date; DROP TABLE', 'desc');
    expect(resolved.sortKey).toBe('contract_date');
    expect(resolved.orderExpr).toBe(COMMERCIAL_DOCS_SQL_SORT_COLUMNS.contract_date);
  });

  it('maps contract_qty and total_price to quantity expressions', () => {
    expect(resolveCommercialDocumentsListSort('contract_qty', 'desc').orderExpr).toBe(
      'e.quantity_ordered',
    );
    expect(resolveCommercialDocumentsListSort('total_price', 'asc').orderExpr).toContain(
      'quantity_ordered',
    );
  });
});
