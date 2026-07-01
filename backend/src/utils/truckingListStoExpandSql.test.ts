import { describe, expect, it } from 'vitest';
import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';
import { sqlTruckingPagePipelineStageExpr } from './truckingPagePipelineSql';

describe('truckingListStoExpandSql', () => {
  it('wrapTruckingListQueryWithStoExpansion expands by contract_stos and qty_move', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('expanded');
  });

  it('recomputes pipeline status per expanded STO line (not passthrough)', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('sto_line_resolved');
    expect(sql).toContain(sqlTruckingPagePipelineStageExpr('c', `NULLIF(TRIM(e.sto_line_resolved::text), '')`));
    expect(sql).toContain('INNER JOIN contracts c ON c.id = e.contract_id');
    expect(sql).toContain('INNER JOIN trucking_operations t ON t.id = e.id');
    expect(sql).not.toMatch(/\be\.status\b/);
  });

  it('skipSapJoin shell mode avoids SAP qty_move and per-STO SAP subqueries', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id', { skipSapJoin: true });
    expect(sql).toContain('contract_stos');
    expect(sql).not.toContain('qty_move');
    expect(sql).toContain('e.quantity_delivered');
    expect(sql).not.toMatch(/FROM sap_processed_data spd\s+WHERE spd\.contract_number = e\.contract_number/);
  });
});
