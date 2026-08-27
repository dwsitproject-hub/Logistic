import { describe, expect, it } from 'vitest';
import type { PrePlannedGroup } from '@/lib/prePlannedGroups';
import {
  collectDistinctFormattedValues,
  formatPrePlannedGroupQtyMt,
  groupShipmentsByPrePlannedSuggestion,
  sumGroupQtyKg,
  sumGroupQtyKgForColumn,
} from '@/lib/prePlannedGroupTableRows';

const sampleGroup: PrePlannedGroup = {
  id: 'group-1',
  groupCode: 'PPG-001',
  partitionKey: 'p1',
  groupPlant: 'Plant A',
  buyer: 'Buyer',
  incoterm: 'CIF',
  product: 'CPO',
  supplier: 'Supplier A',
  supplierGroup: null,
  windowStart: '2026-01-01',
  windowEnd: '2026-01-31',
  binCapacityMt: 3000,
  totalOsMt: 2500,
  estVessels: 1,
  isPartial: false,
  mergeHintGroupIds: [],
  status: 'ACCEPTED',
  shipmentId: null,
  members: [
    { contractId: 'c1', contractNumber: '1001', osMtAtGrouping: 1000 },
    { contractId: 'c2', contractNumber: '1002', osMtAtGrouping: 1500 },
  ],
};

const lookup = new Map<string, PrePlannedGroup>([
  ['1001', sampleGroup],
  ['c1', sampleGroup],
  ['1002', sampleGroup],
  ['c2', sampleGroup],
]);

describe('prePlannedGroupTableRows', () => {
  it('groups rows by pre_planned_group_id or accepted lookup', () => {
    const rows = [
      { id: 'r1', contract_number: '1001', pre_planned_group_id: 'group-1' },
      { id: 'r2', contract_number: '1002', pre_planned_group_id: 'group-1' },
      { id: 'r3', contract_number: '2001', pre_planned_group_id: 'group-2' },
    ];
    const groups = groupShipmentsByPrePlannedSuggestion(rows, lookup);
    expect(groups).toHaveLength(2);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].members).toHaveLength(1);
  });

  it('collectDistinctFormattedValues stacks unique PO values', () => {
    const members = [
      { id: '1', po_numbers: 'PO-A' },
      { id: '2', po_numbers: 'PO-B' },
      { id: '3', po_numbers: 'PO-A' },
    ];
    expect(
      collectDistinctFormattedValues(members, (m) => m.po_numbers),
    ).toEqual(['PO-A', 'PO-B']);
  });

  it('sumGroupQtyKg totals contract qty across members', () => {
    const members = [
      { id: '1', contract_qty: 1_000_000 },
      { id: '2', contract_qty: 2_000_000 },
    ];
    expect(sumGroupQtyKg(members, (m) => m.contract_qty ?? null)).toBe(3_000_000);
    expect(formatPrePlannedGroupQtyMt(3_000_000)).toBe('3,000 MT');
    expect(formatPrePlannedGroupQtyMt(null)).toBe('0 MT');
  });

  it('sumGroupQtyKgForColumn sums outstanding_quantity', () => {
    const members = [
      { id: '1', outstanding_quantity: 500_000 },
      { id: '2', outstanding_quantity: 1_500_000 },
    ];
    expect(sumGroupQtyKgForColumn(members, 'outstanding_quantity')).toBe(2_000_000);
  });

  it('sumGroupQtyKgForColumn treats null Delivery as 0 outstanding when contract qty exists', () => {
    const members = [
      { id: '1', contract_qty: 1_000_000, incoterm: 'FOB', is_contract_sap_closed: true },
      { id: '2', outstanding_quantity: 500_000 },
    ];
    expect(sumGroupQtyKgForColumn(members, 'outstanding_quantity')).toBe(1_500_000);
  });
});
