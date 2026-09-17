import { describe, expect, it } from 'vitest';
import { sqlContractOutstandingSignedExpr } from './sapIncotermMetrics';
import { sqlHasCycleCompletionDate } from './contractsListCycleSql';

describe('sqlHasCycleCompletionDate', () => {
  it('accepts inline outstanding expression for base/filtered CTE (no outstanding_quantity col)', () => {
    const outstanding = sqlContractOutstandingSignedExpr({
      contractQtyExpr: 'quantity_ordered',
      incotermExpr: 'incoterm',
      receiveExpr: 'quantity_receive',
      deliveryExpr: 'quantity_delivery',
    });
    const sql = sqlHasCycleCompletionDate('transport_mode', `(${outstanding})`);
    expect(sql).toContain('quantity_ordered');
    expect(sql).toContain('quantity_delivery');
    expect(sql).not.toMatch(/\boutstanding_quantity\b/);
  });
});
