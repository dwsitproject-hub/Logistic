import { describe, expect, it } from 'vitest';
import {
  buildUnplannedContractBacklogCountQuery,
  buildUnplannedContractBacklogPageQuery,
  buildUnplannedContractBacklogTableCountCte,
  appendContractScopeToolbarFilters,
  appendUnplannedContractBacklogGlobalSearch,
  unplannedContractBacklogBaseWhereSql,
  unplannedShipmentExecutionOuterSql,
} from './shipmentUnplannedHybridSql';

describe('shipmentUnplannedHybridSql', () => {
  it('requires no shipment row for contract backlog', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('s_ns.contract_id = c.id');
  });

  it('limits contract backlog to CIF/FOB/CFR incoterms (not SEA/MIX or STO Type T)', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).not.toContain("IN ('SEA', 'MIX')");
    expect(sql).not.toMatch(/=\s*'T'/);
  });

  it('builds contract backlog count query with contract qty in the same scan', () => {
    const text = buildUnplannedContractBacklogCountQuery('AND c.contract_date >= $1', '');
    expect(text).toContain('unplanned_contract_backlog');
    expect(text).toContain('latest_spd_contract');
    expect(text).toContain('COUNT(*)::bigint AS c');
    expect(text).toContain('AS contract_qty_kg');
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
    expect(cte).toContain('preplanned_contract_table');
    expect(cte).toContain('preplanned_group_count');
    expect(cte).toContain('COUNT(DISTINCT pg.id)');
  });

  it('excludes ACCEPTED-unlinked (Preplanned) contracts from Unplanned backlog', () => {
    const sql = unplannedContractBacklogBaseWhereSql('c', 'l');
    expect(sql).toContain("pg.status = 'ACCEPTED'");
    expect(sql).toContain('pg.shipment_id IS NULL');
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

  it('limits unplanned shipment execution to CIF/FOB/CFR', () => {
    const sql = unplannedShipmentExecutionOuterSql('');
    expect(sql).toContain("'CIF'");
    expect(sql).toContain("'FOB'");
    expect(sql).toContain("'CFR'");
  });

  it('appendUnplannedContractBacklogGlobalSearch matches PO via ILIKE', () => {
    const { sql, params } = appendUnplannedContractBacklogGlobalSearch('1001031130', 3);
    expect(sql).toContain('c.po_number');
    expect(sql).toContain('ILIKE');
    expect(params).toEqual(['%1001031130%']);
  });
});

describe('buildAllHybridContractBacklogQuery', () => {
  it('counts unplanned and preplanned contract backlog together', async () => {
    const { buildAllHybridContractBacklogCountQuery } = await import('./shipmentUnplannedHybridSql');
    const text = buildAllHybridContractBacklogCountQuery('', '');
    expect(text).toContain('unplanned_contract_backlog');
    expect(text).toContain('preplanned_contract_backlog');
    expect(text).toContain('all_contract_backlog');
  });

  it('pages flat contract rows with both UNPLANNED and PREPLANNED statuses', async () => {
    const { buildAllHybridContractBacklogPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = buildAllHybridContractBacklogPageQuery('', '', 20, 0);
    expect(text).toContain('UNPLANNED');
    expect(text).toContain('PREPLANNED');
    expect(text).toContain('pre_planned_group_id');
    expect(text).toContain('ORDER BY contract_date DESC');
    expect(text).toContain('LIMIT 20 OFFSET 0');
  });
});

describe('buildPreplannedContractsPageQuery', () => {
  it('paginates by group_id and includes pre_planned_group_id on rows', async () => {
    const { buildPreplannedContractsPageQuery } = await import('./shipmentUnplannedHybridSql');
    const text = buildPreplannedContractsPageQuery('', '', 20, 0);
    expect(text).toContain('preplanned_groups_page');
    expect(text).toContain('pre_planned_group_id');
    expect(text).toContain('GROUP BY pre_planned_group_id');
    expect(text).not.toMatch(/preplanned_contracts[\s\S]*LIMIT 20 OFFSET 0[\s\S]*SELECT \* FROM preplanned_contracts/);
  });
});
