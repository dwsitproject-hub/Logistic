import { describe, expect, it } from 'vitest';
import {
  compareContractsListSortRows,
  computeStatusOverallSortValue,
  CONTRACTS_LIST_NODE_SORT_KEYS,
  CONTRACTS_LIST_SQL_SORT_COLUMNS,
  resolveContractsListSort,
  resolveContractsListSortStack,
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

describe('resolveContractsListSortStack', () => {
  it('without `sort` it is exactly the single sort it always was', () => {
    const r = resolveContractsListSortStack({ sortKey: 'supplier', sortDir: 'asc' });
    expect(r.orderBySql).toBe('supplier ASC NULLS LAST');
    expect(r.primaryDir).toBe('ASC');
    expect(r.mode).toBe('sql');
    expect(r.ignoredExtraKeys).toBe(false);
    // the same expression the old ORDER BY was built from
    expect(resolveContractsListSortStack({ sortKey: 'contract_date', sortDir: 'desc' }).orderBySql).toBe(
      `${CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date} DESC NULLS LAST`,
    );
    // an unknown key still falls back to contract_date, and a missing direction to DESC
    expect(resolveContractsListSortStack({ sortKey: 'nope' }).orderBySql).toBe(
      `${CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date} DESC NULLS LAST`,
    );
  });

  it('orders by incoterm, then product, then supplier, each with its own direction', () => {
    const r = resolveContractsListSortStack({ sort: 'incoterm:asc,product:asc,supplier:desc' });
    expect(r.orderBySql).toBe('incoterm ASC NULLS LAST, product ASC NULLS LAST, supplier DESC NULLS LAST');
    expect(r.keys.map((k) => k.key)).toEqual(['incoterm', 'product', 'supplier']);
    expect(r.mode).toBe('sql');
    expect(r.primaryDir).toBe('ASC');
    expect(r.sortKey).toBe('incoterm');
  });

  it('uses the static expression of each column, never the request text', () => {
    const r = resolveContractsListSortStack({ sort: 'contract_date:desc,delivery_end:asc' });
    expect(r.orderBySql).toBe(
      `${CONTRACTS_LIST_SQL_SORT_COLUMNS.contract_date} DESC NULLS LAST, ${CONTRACTS_LIST_SQL_SORT_COLUMNS.delivery_end} ASC NULLS LAST`,
    );
  });

  it('keeps at most three keys, and drops repeated, unknown and malformed ones', () => {
    expect(resolveContractsListSortStack({ sort: 'a:asc,incoterm:asc,product:asc,supplier:asc,buyer:asc' }).keys).toHaveLength(3);
    const r = resolveContractsListSortStack({
      sort: 'incoterm:asc,incoterm:desc,product:sideways,supplier;DROP TABLE contracts:asc,buyer',
    });
    expect(r.keys.map((k) => k.key)).toEqual(['incoterm', 'buyer']);
    expect(r.orderBySql).not.toContain('DROP');
  });

  it('an unusable `sort` falls back to the single sort', () => {
    for (const sort of ['', 'zzz:asc', 'incoterm:sideways', undefined, 42]) {
      const r = resolveContractsListSortStack({ sort, sortKey: 'supplier', sortDir: 'asc' });
      expect(r.orderBySql).toBe('supplier ASC NULLS LAST');
    }
  });

  it('reads the first value when the parameter is repeated in the query string', () => {
    const r = resolveContractsListSortStack({ sort: ['incoterm:asc,product:asc', 'ignored:asc'] });
    expect(r.keys.map((k) => k.key)).toEqual(['incoterm', 'product']);
  });

  it('a node column never joins a stack: only the first key is honoured, and the request is told so', () => {
    const lowerNode = resolveContractsListSortStack({ sort: 'incoterm:asc,trade_cycle_days:desc,supplier:asc' });
    expect(lowerNode.keys.map((k) => k.key)).toEqual(['incoterm']);
    expect(lowerNode.mode).toBe('sql');
    expect(lowerNode.ignoredExtraKeys).toBe(true);

    const primaryNode = resolveContractsListSortStack({ sort: 'trade_cycle_days:desc,incoterm:asc' });
    expect(primaryNode.keys.map((k) => k.key)).toEqual(['trade_cycle_days']);
    expect(primaryNode.mode).toBe('node');
    expect(primaryNode.primaryDir).toBe('DESC');
    expect(primaryNode.ignoredExtraKeys).toBe(true);
  });

  it('every node column alone is still the node sort it was', () => {
    for (const key of CONTRACTS_LIST_NODE_SORT_KEYS) {
      const r = resolveContractsListSortStack({ sort: `${key}:asc` });
      expect(r.mode).toBe('node');
      expect(r.ignoredExtraKeys).toBe(false);
    }
  });

  it('asks for the cycle fields when any key in the stack needs them', () => {
    expect(resolveContractsListSortStack({ sort: 'incoterm:asc,product:asc' }).needsCycleFields).toBe(false);
    expect(resolveContractsListSortStack({ sort: 'incoterm:asc,vessel_name:asc' }).needsCycleFields).toBe(true);
    expect(resolveContractsListSortStack({ sort: 'vessel_name:asc,incoterm:asc' }).needsCycleFields).toBe(true);
  });
});
