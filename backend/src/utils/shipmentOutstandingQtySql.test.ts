import { describe, expect, it } from 'vitest';
import {
  shipmentListOutstandingQtySql,
  shipmentListQtyMoveCteFromPage,
  shipmentListRowGlobalOutstandingSql,
  shipmentOutstandingQtyExpr,
} from './shipmentOutstandingQtySql';

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

  it('builds list projection with Contract Qty base and Open/Close SAP/KLIP resolve', () => {
    const sql = shipmentListOutstandingQtySql();
    expect(sql).toContain('sa.contract_qty');
    expect(sql).toContain('sp.contract_qty');
    expect(sql).not.toContain('sa.sto_quantity');
    expect(sql).toContain('sa.quantity_receive');
    expect(sql).toContain('sa.quantity_delivered_sap');
    expect(sql).toContain('sp.actual_vessel_qty_receive');
    expect(sql).toContain('sp.quantity_delivered_klip');
    expect(sql).toContain('sp.is_contract_sap_closed');
    expect(sql).not.toContain('ABS');
    expect(sql).toContain('sl.incoterm');
  });

  it('builds page-scoped qty_move CTE from shipment_page contracts', () => {
    const sql = shipmentListQtyMoveCteFromPage();
    expect(sql).toContain('qty_move AS');
    expect(sql).toContain('FROM shipment_page sp');
    expect(sql).toContain('contract_numbers');
  });

  it('sums contract-global outstanding per list row', () => {
    const sql = shipmentListRowGlobalOutstandingSql('sp');
    expect(sql).toContain('FROM contracts c');
    expect(sql).toContain('qty_move qm');
    expect(sql).toContain('sp.contract_numbers');
  });
});
