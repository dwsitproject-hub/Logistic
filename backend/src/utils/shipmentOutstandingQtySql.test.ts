import { describe, expect, it } from 'vitest';
import { shipmentListOutstandingQtySql, shipmentOutstandingQtyExpr } from './shipmentOutstandingQtySql';

describe('shipmentOutstandingQtySql', () => {
  it('applies incoterm branches for CIF and FOB', () => {
    const sql = shipmentOutstandingQtyExpr({
      stoQtyExpr: 'sto',
      receiveExpr: 'recv',
      deliveryExpr: 'del',
      incotermExpr: 'inc',
    });
    expect(sql).toContain("IN ('FRC', 'CIF', 'CFR') THEN recv");
    expect(sql).toContain("IN ('LCO', 'FOB') THEN del");
    expect(sql).toContain('GREATEST');
  });

  it('builds list projection with SAP and shipment manual resolve', () => {
    const sql = shipmentListOutstandingQtySql();
    expect(sql).toContain('sa.sto_quantity');
    expect(sql).toContain('sa.quantity_receive');
    expect(sql).toContain('sa.quantity_delivered_sap');
    expect(sql).toContain('sp.actual_vessel_qty_receive');
    expect(sql).toContain('sp.quantity_delivered');
    expect(sql).toContain('ABS');
    expect(sql).toContain('sl.incoterm');
  });
});
