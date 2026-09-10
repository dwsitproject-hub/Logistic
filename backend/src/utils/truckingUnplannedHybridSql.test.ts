import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildUnplannedContractBacklogLatestSpdCte } from './shipmentUnplannedHybridSql';
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

describe('trucking latest_spd_contract', () => {
  /**
   * This CTE was a second copy of three COALESCE families that `contractLatestSpdDerivedSql`
   * already defines, and migration 161 already stores all three on the snapshot. The copies still
   * agreed, which is the dangerous state: nothing would have failed if one had been edited. The
   * Trucking builder now delegates, so there is one definition and a fresh snapshot is read as
   * columns - which was 36,540ms of the cold page's 97,324ms of database time.
   */
  it('delegates to the shared builder rather than spelling the arms out again', () => {
    const src = readFileSync(join(__dirname, 'truckingUnplannedHybridSql.ts'), 'utf8');
    const fn = src.slice(src.indexOf('resolveTruckingUnplannedBacklogLatestSpdCte'));
    /* Up to the first closing brace: the delegating body contains none of its own. */
    const body = fn.split('}')[0] ?? '';
    expect(body).toContain('resolveUnplannedContractBacklogLatestSpdCte()');
    // No arm may be re-spelled here: that is how the two copies could drift apart again.
    expect(src).not.toContain("->>'B2B Flag'");
    expect(src).not.toContain("->>'Contract Ext No'");
    expect(src).not.toContain("->>'contract_reference_po'");
  });

  it('the shared fresh form reads the snapshot columns and touches no jsonb', () => {
    const sql = buildUnplannedContractBacklogLatestSpdCte(true);
    expect(sql).toContain('contract_latest_spd_snapshot');
    expect(sql).toContain('lss.b2b_flag_raw');
    expect(sql).toContain('lss.contract_reference_po_raw');
    expect(sql).toContain('lss.contract_ext_no_raw');
    expect(sql).not.toContain('->');
    expect(sql).not.toContain('sap_processed_data');
  });
});

describe('truckingUnplannedHybridSql', () => {
  it('backlog base where excludes cancelled trucking ops and requires LAND/MIX', async () => {
    const sql = truckingUnplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("IN ('LAND', 'MIX')");
    expect(sql).toContain('trucking_operations t_ns');
    expect(sql).toContain("<> 'CANCELLED'");
  });

  it('backlog row select marks contract_backlog with empty STO and operation_id', async () => {
    const sql = truckingUnplannedContractBacklogRowSelectSql('0::numeric');
    expect(sql).toContain("'contract_backlog'");
    expect(sql).toContain('NULL::text AS operation_id');
    expect(sql).toContain('NULL::text AS sto_number');
    expect(sql).toContain('unload_location');
    expect(sql).toContain('b2b_end.buyer');
    expect(sql).toContain("'UNPLANNED'");
  });

  it('count query scopes open contracts without active trucking', async () => {
    const sql = await buildTruckingUnplannedBacklogCountQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('unplanned_trucking_backlog');
    expect(sql).toContain('COUNT(*)::bigint');
    expect(sql).toContain('c.contract_date >= $1');
    expect(sql).toContain('b2b_ending_child_snapshot');
  });

  it('contract qty query sums quantity_ordered for backlog contracts', async () => {
    const sql = await buildTruckingUnplannedBacklogContractQtyQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('unplanned_trucking_backlog');
    expect(sql).toContain('quantity_ordered');
    expect(sql).toContain('contract_qty_kg');
  });

  it('toolbar scope omits trailing AND when plant filter is empty', async () => {
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

  it('toolbar plant filter uses Discharge Destination, not master plant code', async () => {
    const { sql } = buildTruckingUnplannedContractToolbarScope({ plants: ['Bontang'] });
    expect(sql).not.toContain("NULLIF(TRIM(b2b_end.plant_code), '')");
    expect(sql).toContain('Discharge Destination');
    expect(sql).toContain('discharge_destination');
    expect(sql).not.toContain('master_plants');
  });

  it('daily backlog summary groups by origin contract plant', async () => {
    const sql = await buildTruckingUnplannedBacklogDailySummarySql();
    expect(sql).not.toContain("NULLIF(TRIM(b2b_end.plant_code), '')");
    expect(sql).toContain('c.plant_code');
  });

  it('ids+OS query selects contract UUID with outstanding qty > 0', async () => {
    const sql = await buildTruckingUnplannedBacklogIdsWithOsQuery(' AND c.contract_date >= $1', '');
    expect(sql).toContain('SELECT c.id');
    expect(sql).toContain('> 0');
    expect(sql).toContain('c.contract_date >= $1');
    expect(sql).toContain('trucking_operations t_ns');
  });

  it('backlog page query defaults to contract_date DESC', async () => {
    const sql = await buildTruckingUnplannedBacklogPageQuery('', '', 20, 0);
    expect(sql).toContain('ORDER BY contract_date DESC NULLS LAST, contract_id ASC');
  });

  it('backlog page query follows list sort key for All hybrid merge', async () => {
    const sql = await buildTruckingUnplannedBacklogPageQuery('', '', 20, 0, 'supplier', 'ASC');
    expect(sql).toContain('ORDER BY supplier ASC NULLS LAST, contract_id ASC');
    expect(sql).not.toContain('ORDER BY contract_date DESC NULLS LAST, contract_id ASC');
  });
});
