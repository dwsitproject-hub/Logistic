import { describe, expect, it } from 'vitest';
import {
  sqlShippingPerfOutstandingActualExpr,
  sqlShippingPerfOutstandingPlanningExpr,
  sqlShippingPerfPlanningQtyExpr,
} from './shippingPerformanceOutstandingSql';

describe('shippingPerformanceOutstandingSql', () => {
  it('emits actual outstanding from STO minus fulfilled', () => {
    const sql = sqlShippingPerfOutstandingActualExpr({
      stoQtyExpr: 'sto',
      fulfilledExpr: 'fulfilled',
    });
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('sto');
    expect(sql).toContain('fulfilled');
  });

  it('emits planning qty from shipment and trucking daily deliverables', () => {
    const sql = sqlShippingPerfPlanningQtyExpr({});
    expect(sql).toContain('daily_deliverables');
    expect(sql).toContain('trucking_operations');
    expect(sql).toContain('contract_stos');
  });

  it('emits planning outstanding from contract minus SAP STO qty minus KLIP shipment planning', () => {
    const sql = sqlShippingPerfOutstandingPlanningExpr({
      contractQtyExpr: 'contract_qty',
      stoQtyExpr: 'sto_qty',
      shipmentPlanningQtyExpr: 'shipment_planning',
    });
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('contract_qty');
    expect(sql).toContain('sto_qty');
    expect(sql).toContain('shipment_planning');
  });
});
