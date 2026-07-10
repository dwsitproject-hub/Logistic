import { describe, expect, it } from 'vitest';
import {
  buildTruckingUnplannedBacklogCountQuery,
  buildTruckingUnplannedBacklogPageQuery,
  buildTruckingUnplannedContractToolbarScope,
  truckingUnplannedContractBacklogBaseWhereSql,
  truckingUnplannedContractBacklogRowSelectSql,
} from './truckingUnplannedHybridSql';

describe('truckingUnplannedHybridSql', () => {
  it('backlog base where excludes cancelled trucking ops and requires LAND/MIX', () => {
    const sql = truckingUnplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("IN ('LAND', 'MIX')");
    expect(sql).toContain('trucking_operations t_ns');
    expect(sql).toContain("<> 'CANCELLED'");
  });

  it('backlog row select marks contract_backlog with empty STO and operation_id', () => {
    const sql = truckingUnplannedContractBacklogRowSelectSql('0::numeric');
    expect(sql).toContain("'contract_backlog'");
    expect(sql).toContain('NULL::text AS operation_id');
    expect(sql).toContain('NULL::text AS sto_number');
    expect(sql).toContain("'UNPLANNED'");
  });

  it('count query scopes open contracts without active trucking', () => {
    const sql = buildTruckingUnplannedBacklogCountQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('unplanned_trucking_backlog');
    expect(sql).toContain('COUNT(*)::bigint');
    expect(sql).toContain('c.contract_date >= $1');
  });

  it('toolbar scope omits trailing AND when plant filter is empty', () => {
    const { sql } = buildTruckingUnplannedContractToolbarScope({
      dateFrom: '2026-01-01',
      dateTo: '2026-07-01',
      plants: [],
    });
    expect(sql).toContain('c.contract_date >= $1');
    expect(sql).toContain('c.contract_date <= $2');
    expect(sql).not.toMatch(/AND\s*\)/);
    expect(sql).not.toMatch(/AND\s*$/);
  });
});
