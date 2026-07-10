import { describe, expect, it } from 'vitest';
import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';

describe('truckingListStoExpandSql', () => {
  it('wrapTruckingListQueryWithStoExpansion expands by contract_stos with WB-prefer qty', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('expanded');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("= 'FRC'");
    expect(sql).toContain("= 'LCO'");
  });

  it('recomputes pipeline status per expanded STO line (not passthrough)', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id');
    expect(sql).toContain('sto_line_resolved');
    expect(sql).toContain("'COMPLETED'");
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain("data->'contract'->>'sto_quantity'");
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

  it('expansion paging restricts expanded rows to paged keys', () => {
    const sql = wrapTruckingListQueryWithStoExpansion('SELECT 1 AS id', {
      skipSapJoin: true,
      expansionPaging: { limit: 10, offset: 20, orderBySql: 'ts.created_at DESC' },
    });
    expect(sql).toContain('WHERE rn > 20 AND rn <= 30');
    expect(sql).toContain('INNER JOIN paged_expansion pe');
  });
});
