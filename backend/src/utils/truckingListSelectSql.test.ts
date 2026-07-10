import { describe, expect, it } from 'vitest';
import { buildTruckingListSelectClause } from './truckingListSelectSql';

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
});
