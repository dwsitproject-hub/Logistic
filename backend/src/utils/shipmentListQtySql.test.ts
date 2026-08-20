import { describe, expect, it } from 'vitest';
import {
  shipmentListPageQtySelectSql,
  shipmentListRowContractQtySql,
  sqlCoalesceNonZeroQty,
  sqlGreatestPositiveQty,
  sqlShipmentListOutstandingKgExpr,
} from './shipmentListQtySql';

describe('sqlCoalesceNonZeroQty', () => {
  it('does not let a 0 preferred value hide the fallback', () => {
    const sql = sqlCoalesceNonZeroQty('sm.delivered_qty', 'sa.quantity_delivered_sap');
    expect(sql).toContain('NULLIF((sm.delivered_qty)::numeric, 0)');
    expect(sql).toContain('sa.quantity_delivered_sap');
  });
});

describe('sqlGreatestPositiveQty', () => {
  it('takes the largest non-zero among SAP, header SUM, and qty_move', () => {
    const sql = sqlGreatestPositiveQty(['sm.delivered_qty', 'sp.quantity_delivered']);
    expect(sql).toContain('GREATEST(');
    expect(sql).toContain('sm.delivered_qty');
    expect(sql).toContain('sp.quantity_delivered');
  });
});

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
  it('prefers Open/Close fulfilled OS over qty_move stubs and sto_metrics last', () => {
    const sql = shipmentListPageQtySelectSql('sp');
    expect(sql).not.toContain('COALESCE(sm.contract_qty, 0)');
    expect(sql).toContain('COALESCE(sm.sto_qty, sa.sto_quantity) AS sto_quantity');
    expect(sql).toContain('qty_move qm');
    expect(sql).toContain('sm.outstanding_qty_actual');
    expect(sql).toContain('COALESCE(sm.contract_qty');
    expect(sql).toContain('quantity_delivered_klip');
    expect(sql).toContain('is_contract_sap_closed');
    expect(sql).toContain('AS outstanding_quantity');
    const osAssign = sql.indexOf('AS outstanding_quantity');
    expect(osAssign).toBeGreaterThan(-1);
    expect(sql.indexOf('quantity_delivered_klip')).toBeGreaterThan(-1);
  });

  it('maps hydrated SAP qty from sto_metrics without letting 0 hide sap_agg or header SUM', () => {
    const sql = shipmentListPageQtySelectSql('sp');
    expect(sql).toContain('sm.delivered_qty');
    expect(sql).toContain('sm.received_qty');
    expect(sql).toContain('GREATEST(');
    expect(sql).toContain('quantity_delivered_sap');
    expect(sql).toContain('quantity_receive');
    expect(sql).toContain('quantity_delivery_vessel');
    expect(sql).toContain('qm.quantity_receive');
    expect(sql).toContain('sp.quantity_delivered');
    expect(sql).toContain('sp.actual_vessel_qty_receive');
  });
});
