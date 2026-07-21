import { describe, expect, it } from 'vitest';
import {
  buildTruckingListSelectClause,
  TRUCKING_LIST_CONTRACT_EXT_NO_FULL,
  truckingListB2bExcludeSql,
} from './truckingListSelectSql';

describe('truckingListSelectSql', () => {
  it('contract_ext_no SQL is latest SAP by PO (no STRING_AGG)', () => {
    expect(TRUCKING_LIST_CONTRACT_EXT_NO_FULL).toContain('spd.po_number');
    expect(TRUCKING_LIST_CONTRACT_EXT_NO_FULL).toContain('c.po_number');
    expect(TRUCKING_LIST_CONTRACT_EXT_NO_FULL).toContain('LIMIT 1');
    expect(TRUCKING_LIST_CONTRACT_EXT_NO_FULL).toContain("data->'raw'->>'Contract Ext No'");
    expect(TRUCKING_LIST_CONTRACT_EXT_NO_FULL).not.toContain('STRING_AGG');
  });

  it('shell mode (skipSapJoin) resolves contract_ext_no from latest SAP by PO', () => {
    const sql = buildTruckingListSelectClause(true);
    expect(sql).not.toContain('NULL::text AS contract_ext_no');
    expect(sql).toContain("data->'raw'->>'Contract Ext No'");
    expect(sql).toContain('AS contract_ext_no');
    expect(sql).toContain('spd.po_number');
    expect(sql).toContain('c.po_number');
    expect(sql).toContain('LIMIT 1');
  });

  it('full SAP mode also selects contract_ext_no from latest SAP by PO', () => {
    const sql = buildTruckingListSelectClause(false);
    expect(sql).toContain("data->'raw'->>'Contract Ext No'");
    expect(sql).toContain('AS contract_ext_no');
    expect(sql).toContain('spd.po_number');
    expect(sql).toContain('LIMIT 1');
  });

  it('shell B2B exclusion keeps origin B2B rows without Contract Reff PO', () => {
    const sql = truckingListB2bExcludeSql(true);
    expect(sql).toContain("c.contract_type::text");
    expect(sql).toContain("data->'contract'->>'contract_reference_po'");
    expect(sql).toContain('IS NOT NULL');
  });
});
