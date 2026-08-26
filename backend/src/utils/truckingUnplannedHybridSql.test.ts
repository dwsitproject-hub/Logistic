import { describe, expect, it } from 'vitest';
import {
  buildTruckingUnplannedBacklogContractQtyQuery,
  buildTruckingUnplannedBacklogCountQuery,
  buildTruckingUnplannedBacklogDailySummarySql,
  buildTruckingUnplannedBacklogIdsWithOsQuery,
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
    expect(sql).toContain('unload_location');
    expect(sql).toContain('b2b_end.buyer');
    expect(sql).toContain("'UNPLANNED'");
  });

  it('count query scopes open contracts without active trucking', () => {
    const sql = buildTruckingUnplannedBacklogCountQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('unplanned_trucking_backlog');
    expect(sql).toContain('COUNT(*)::bigint');
    expect(sql).toContain('c.contract_date >= $1');
    expect(sql).toContain('b2b_ending_child_snapshot');
  });

  it('contract qty query sums quantity_ordered for backlog contracts', () => {
    const sql = buildTruckingUnplannedBacklogContractQtyQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('unplanned_trucking_backlog');
    expect(sql).toContain('quantity_ordered');
    expect(sql).toContain('contract_qty_kg');
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

  it('toolbar plant filter uses origin contract plant, not B2B ending overlay', () => {
    const { sql } = buildTruckingUnplannedContractToolbarScope({ plants: ['Bontang'] });
    expect(sql).not.toContain("NULLIF(TRIM(b2b_end.plant_code), '')");
    expect(sql).toContain('c.plant_code');
  });

  it('daily backlog summary groups by origin contract plant', () => {
    const sql = buildTruckingUnplannedBacklogDailySummarySql();
    expect(sql).not.toContain("NULLIF(TRIM(b2b_end.plant_code), '')");
    expect(sql).toContain('c.plant_code');
  });

  it('ids+OS query selects contract UUID with outstanding qty > 0', () => {
    const sql = buildTruckingUnplannedBacklogIdsWithOsQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('SELECT c.id');
    expect(sql).toContain('> 0');
    expect(sql).toContain('c.contract_date >= $1');
    expect(sql).toContain('trucking_operations t_ns');
  });

  it('backlog page query defaults to contract_date DESC', () => {
    const sql = buildTruckingUnplannedBacklogPageQuery('', '', 20, 0);
    expect(sql).toContain('ORDER BY contract_date DESC NULLS LAST, contract_id ASC');
  });

  it('backlog page query follows list sort key for All hybrid merge', () => {
    const sql = buildTruckingUnplannedBacklogPageQuery('', '', 20, 0, 'supplier', 'ASC');
    expect(sql).toContain('ORDER BY supplier ASC NULLS LAST, contract_id ASC');
    expect(sql).not.toContain('ORDER BY contract_date DESC NULLS LAST, contract_id ASC');
  });
});
