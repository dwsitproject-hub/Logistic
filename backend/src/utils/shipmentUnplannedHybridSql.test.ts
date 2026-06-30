import { describe, expect, it } from 'vitest';
import {
  buildUnplannedContractBacklogCountQuery,
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
});
