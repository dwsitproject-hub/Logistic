import { describe, expect, it } from 'vitest';
import { buildTruckingListSelectClause, truckingListB2bExcludeSql } from './truckingListSelectSql';

describe('truckingListSelectSql', () => {
  it('shell mode (skipSapJoin) resolves contract_ext_no from SAP subquery', () => {
    const sql = buildTruckingListSelectClause(true);
    expect(sql).not.toContain('NULL::text AS contract_ext_no');
    expect(sql).toContain("data->'raw'->>'Contract Ext No'");
    expect(sql).toContain('AS contract_ext_no');
  });

  it('full SAP mode also selects contract_ext_no from SAP', () => {
    const sql = buildTruckingListSelectClause(false);
    expect(sql).toContain("data->'raw'->>'Contract Ext No'");
    expect(sql).toContain('AS contract_ext_no');
  });

  it('shell B2B exclusion keeps origin B2B rows without Contract Reff PO', () => {
    const sql = truckingListB2bExcludeSql(true);
    expect(sql).toContain("c.contract_type::text");
    expect(sql).toContain("data->'contract'->>'contract_reference_po'");
    expect(sql).toContain('IS NOT NULL');
  });
});
