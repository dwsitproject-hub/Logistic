import { describe, expect, it } from 'vitest';
import {
  shipmentListPageQtySelectSql,
  shipmentListRowContractQtySql,
  sqlShipmentListOutstandingKgExpr,
} from './shipmentListQtySql';

describe('shipmentListRowContractQtySql', () => {
  it('sums quantity_ordered via contract_numbers or sto_key linkage', () => {
    const sql = shipmentListRowContractQtySql('sp');
    expect(sql).toContain('contract_stos cs');
    expect(sql).toContain('sp.sto_key');
  });
});

describe('sqlShipmentListOutstandingKgExpr', () => {
  it('returns NULL when contract qty or fulfilled qty is unknown', () => {
    const sql = sqlShipmentListOutstandingKgExpr({
      contractQtyExpr: 'po.contract_qty',
      incotermExpr: 'po.incoterm',
      receiveExpr: 'po.receive_kg',
      deliveryExpr: 'po.delivery_kg',
      clampAtZero: true,
    });
    expect(sql).toContain('WHEN po.contract_qty IS NULL THEN NULL');
    expect(sql).toContain('THEN NULL');
    expect(sql).toContain('GREATEST(0');
  });
});

describe('shipmentListPageQtySelectSql', () => {
  it('does not coerce missing SAP qty to zero', () => {
    const sql = shipmentListPageQtySelectSql('sp');
    expect(sql).not.toContain('COALESCE(sm.contract_qty, 0)');
    expect(sql).toContain('COALESCE(sm.sto_qty, sa.sto_quantity) AS sto_quantity');
    expect(sql).toContain('quantity_ordered');
  });
});
