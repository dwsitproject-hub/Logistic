import { describe, expect, it } from 'vitest';
import {
  sqlWbActualDeliverySumKg,
  sqlWbActualReceiveSumKg,
  sqlWbActualRowIncludedPredicate,
  sqlWbStoMatchesContractCatalog,
} from './truckingWbActualSumSql';

describe('truckingWbActualSumSql', () => {
  it('sqlWbStoMatchesContractCatalog checks contract_stos and SAP STOs', () => {
    const sql = sqlWbStoMatchesContractCatalog('da', 't.id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('sap_processed_data');
    expect(sql).toContain('t.id');
  });

  it('sqlWbActualRowIncludedPredicate prefers catalog then tagged then all', () => {
    const sql = sqlWbActualRowIncludedPredicate('da', 'e.id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('e.id');
    expect(sql).toContain('sto_number');
  });

  it('delivery/receive sums apply include predicate', () => {
    expect(sqlWbActualDeliverySumKg('t.id')).toContain('quantity_delivery_kg');
    expect(sqlWbActualDeliverySumKg('t.id')).toContain('contract_stos');
    expect(sqlWbActualReceiveSumKg('t.id')).toContain('quantity_receive_kg');
    expect(sqlWbActualReceiveSumKg('t.id')).toContain(sqlWbActualRowIncludedPredicate('da', 't.id'));
  });
});
