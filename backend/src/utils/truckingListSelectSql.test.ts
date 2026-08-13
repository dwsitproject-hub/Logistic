import { describe, expect, it } from 'vitest';
import {
  buildTruckingListFromClause,
  buildTruckingListSelectClause,
  TRUCKING_LIST_CONTRACT_EXT_NO_FULL,
  truckingListB2bExcludeSql,
} from './truckingListSelectSql';

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

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

  it('resolves each SAP receive date once via the LATERAL, not per expression', () => {
    // Before the LATERAL these lookups were correlated subqueries repeated across the select
    // list and twice more inside the pipeline-stage CASE - six identical row selections per
    // output row, which pinned the RDS instance at 100% CPU under concurrent page loads.
    // Counted on the normalized JSON key, which each lookup mentions exactly once - the display
    // key appears twice per lookup (data->'raw'->> and data->>), so it is a poor counter.
    const sql = buildTruckingListSelectClause(false) + buildTruckingListFromClause(false);
    expect(countOf(sql, "'trucking_start_receive_date'")).toBe(1);
    expect(countOf(sql, "'trucking_last_receive_date'")).toBe(1);
    expect(sql).toContain('sapd.start_val');
    expect(sql).toContain('sapd.last_val');
  });

  it('joins the SAP date LATERAL after contracts so it can correlate on c', () => {
    const from = buildTruckingListFromClause(false);
    expect(from).toContain(') sapd ON TRUE');
    expect(from.indexOf('LEFT JOIN contracts c')).toBeLessThan(from.indexOf(') sapd ON TRUE'));
  });

  it('shell mode joins no SAP date LATERAL', () => {
    expect(buildTruckingListFromClause(true)).not.toContain('sapd');
  });

  it('shell B2B exclusion keeps origin B2B rows without Contract Reff PO', () => {
    const sql = truckingListB2bExcludeSql(true);
    expect(sql).toContain("c.contract_type::text");
    expect(sql).toContain("data->'contract'->>'contract_reference_po'");
    expect(sql).toContain('IS NOT NULL');
  });
});
