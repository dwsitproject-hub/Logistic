import { describe, expect, it } from 'vitest';
import {
  buildTruckingExpansionKeyOrderBy,
  resolveTruckingExpansionKeySortField,
  resolveTruckingListSortField,
  resolveTruckingListSortRowKey,
} from './truckingListSort';

describe('truckingListSort', () => {
  it('maps outstanding_qty_mt to ts.outstanding_quantity for expansion-key ORDER BY', () => {
    expect(resolveTruckingExpansionKeySortField('outstanding_qty_mt')).toBe(
      'ts.outstanding_quantity',
    );
    const orderBy = buildTruckingExpansionKeyOrderBy('outstanding_qty_mt', 'DESC', 'ALL');
    expect(orderBy).toContain('ts.outstanding_quantity DESC');
    expect(orderBy).not.toMatch(/^\s*ts\.created_at DESC/);
  });

  it('maps UI column ids that previously fell back to created_at', () => {
    expect(resolveTruckingExpansionKeySortField('contract_date')).toBe('ts.contract_date');
    expect(resolveTruckingExpansionKeySortField('contract_ext_no')).toBe('ts.contract_ext_no');
    expect(resolveTruckingExpansionKeySortField('product')).toBe('ts.product');
    expect(resolveTruckingExpansionKeySortField('sto_quantity')).toBe('ts.sto_quantity');
    expect(resolveTruckingExpansionKeySortField('location')).toBe('ts.location');
    expect(resolveTruckingExpansionKeySortField('buyer')).toBe('ts.buyer');
    expect(resolveTruckingExpansionKeySortField('group_name')).toBe('ts.group_name');
    expect(resolveTruckingExpansionKeySortField('quantity_receive')).toBe('ts.quantity_receive');
    expect(resolveTruckingExpansionKeySortField('late_indicator')).toContain('CASE');
  });

  it('maps expanded-list sort aliases including outstanding_qty_mt', () => {
    expect(resolveTruckingListSortField('outstanding_qty_mt')).toBe('outstanding_quantity');
    expect(resolveTruckingListSortField('late_indicator')).toContain('CASE');
    expect(resolveTruckingListSortRowKey('outstanding_qty_mt')).toBe('outstanding_quantity');
    expect(resolveTruckingListSortRowKey('late_indicator')).toBe('created_at');
  });
});
