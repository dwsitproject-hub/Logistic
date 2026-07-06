import { describe, expect, it } from 'vitest';
import {
  buildUnplannedContractBacklogCountQuery,
  buildUnplannedContractBacklogPageQuery,
  buildUnplannedContractBacklogTableCountCte,
  appendContractScopeToolbarFilters,
  unplannedContractBacklogBaseWhereSql,
} from './shipmentUnplannedHybridSql';

describe('shipmentUnplannedHybridSql', () => {
  it('requires no shipment row for contract backlog', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('s_ns.contract_id = c.id');
  });

  it('builds contract backlog count query', () => {
    const text = buildUnplannedContractBacklogCountQuery('AND c.contract_date >= $1', '');
    expect(text).toContain('unplanned_contract_backlog');
    expect(text).toContain('latest_spd_contract');
  });

  it('builds contract backlog page query with contract ext no and outstanding qty', () => {
    const text = buildUnplannedContractBacklogPageQuery('AND c.contract_date >= $1', '', 20, 0);
    expect(text).toContain('qty_move');
    expect(text).toContain('contract_ext_no_raw');
    expect(text).toContain('Contract Ext No');
    expect(text).toContain('AS outstanding_quantity');
    expect(text).toContain('c.quantity_ordered AS contract_qty');
    expect(text).not.toContain('NULL::text AS contract_ext_no');
  });

  it('builds summary table count CTE', () => {
    const cte = buildUnplannedContractBacklogTableCountCte('AND 1=1');
    expect(cte).toContain('unplanned_contract_backlog_table');
  });

  it('applies product multi filter on contract scope', () => {
    const { sql, params } = appendContractScopeToolbarFilters(
      { product: { type: 'multi', values: ['CPO'] } },
      1,
    );
    expect(sql).toContain('c.product');
    expect(sql).toContain('ANY($1');
    expect(params).toEqual([['CPO']]);
  });

  it('applies supplier multi filter on contract scope', () => {
    const { sql, params } = appendContractScopeToolbarFilters(
      { supplier: { type: 'multi', values: ['PT ABC'] } },
      1,
    );
    expect(sql).toContain('c.supplier');
    expect(params).toEqual([['PT ABC']]);
  });
});
