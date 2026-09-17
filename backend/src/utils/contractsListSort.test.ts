import { describe, expect, it } from 'vitest';
import {
  compareContractsListSortRows,
  computeStatusOverallSortValue,
  CONTRACTS_LIST_NODE_SORT_KEYS,
  CONTRACTS_LIST_SQL_SORT_COLUMNS,
  resolveContractsListSort,
} from './contractsListSort';

describe('resolveContractsListSort', () => {
  it('defaults unknown keys to contract_date SQL sort', () => {
    expect(resolveContractsListSort('not_a_column')).toEqual({
      sortKey: 'contract_date',
      orderExpr: CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date,
      mode: 'sql',
      needsCycleFields: false,
    });
  });

  it('maps former client-only table columns to SQL ORDER BY', () => {
    expect(resolveContractsListSort('po_number').orderExpr).toBe('po_numbers');
    expect(resolveContractsListSort('delivery_qty').orderExpr).toBe('quantity_delivery');
    expect(resolveContractsListSort('month_delivery_end').orderExpr).toContain('YYYY-MM');
    expect(resolveContractsListSort('contract_ext_no').mode).toBe('sql');
    expect(resolveContractsListSort('source_type').mode).toBe('sql');
  });

  it('does not interpolate the request sort key into SQL', () => {
    const resolved = resolveContractsListSort("contract_date; DROP TABLE contracts");
    expect(resolved.sortKey).toBe('contract_date');
    expect(resolved.orderExpr).toBe(CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date);
    for (const expr of Object.values(CONTRACTS_LIST_SQL_SORT_COLUMNS)) {
      expect(expr).not.toMatch(/;|--/);
    }
  });

  it('requires cycle fields on the base CTE for vessel / ETA / planning date sorts', () => {
    expect(resolveContractsListSort('vessel_name').needsCycleFields).toBe(true);
    expect(resolveContractsListSort('eta_vessel_completed_loading').needsCycleFields).toBe(true);
    expect(resolveContractsListSort('last_planning_delivery_date').needsCycleFields).toBe(true);
    expect(resolveContractsListSort('supplier').needsCycleFields).toBe(false);
  });

  it('routes cycle and computed status columns to node sort', () => {
    for (const key of CONTRACTS_LIST_NODE_SORT_KEYS) {
      const resolved = resolveContractsListSort(key);
      expect(resolved.mode).toBe('node');
      expect(resolved.needsCycleFields).toBe(true);
    }
  });
});

describe('compareContractsListSortRows', () => {
  const today = new Date(2026, 7, 28);

  it('sorts cycle days across rows with nulls last', () => {
    const rows = [
      { contract_id: 'A', trade_cycle_days: 5 },
      { contract_id: 'B', trade_cycle_days: null },
      { contract_id: 'C', trade_cycle_days: -2 },
    ];
    const sorted = [...rows].sort((a, b) =>
      compareContractsListSortRows(a, b, 'trade_cycle_days', 1, today),
    );
    expect(sorted.map((r) => r.contract_id)).toEqual(['C', 'A', 'B']);
  });

  it('sorts status overall Close+PAID ahead of raw CLOSE when ascending Close…', () => {
    expect(
      computeStatusOverallSortValue({ import_status: 'CLOSE', payment_status: 'PAID' }),
    ).toBe('Close');
    const rows = [
      { import_status: 'OPEN', payment_status: 'PENDING' },
      { import_status: 'CLOSE', payment_status: 'PAID' },
    ];
    const sorted = [...rows].sort((a, b) =>
      compareContractsListSortRows(a, b, 'status_overall', 1, today),
    );
    expect(computeStatusOverallSortValue(sorted[0])).toBe('Close');
  });
});
