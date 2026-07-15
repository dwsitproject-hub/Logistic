import { describe, expect, it } from 'vitest';
import {
  isTruckingPipelineCompleted,
  sqlNormalizeSapTruckingQtyToKg,
  sqlSapQtyDeliveryOnly,
  sqlSapQtyReceiveOnly,
  sqlTruckingExpandedStoLineQtyKgExpr,
  sqlTruckingOutstandingQtyByIncoterm,
  sqlTruckingOutstandingWithinToleranceExpr,
  sqlTruckingPipelineIsCompletedExpr,
  sqlTruckingPreferWbResolvedQty,
  sqlTruckingQuantityDeliveredCoalesce,
  sqlTruckingResolvedDeliveryQty,
  sqlTruckingResolvedReceiveQty,
  sqlWbActualDeliverySumKg,
  sqlWbActualReceiveSumKg,
} from './truckingQuantitySql';

describe('truckingQuantitySql', () => {
  it('sqlNormalizeSapTruckingQtyToKg multiplies MT-scale SAP values', () => {
    const sql = sqlNormalizeSapTruckingQtyToKg('sap.val', 'COALESCE(c.quantity_ordered, 0)');
    expect(sql).toContain('* 1000');
    expect(sql).toContain('COALESCE(c.quantity_ordered, 0)');
  });

  it('sqlTruckingQuantityDeliveredCoalesce prefers trucking_operations column', () => {
    const sql = sqlTruckingQuantityDeliveredCoalesce();
    expect(sql).toContain('t.quantity_delivered');
    expect(sql).toContain('Quantity Delivered via Trucking');
  });

  it('sqlSapQtyDeliveryOnly does not coalesce trucking_operations column', () => {
    const sql = sqlSapQtyDeliveryOnly();
    expect(sql).not.toContain('t.quantity_delivered');
    expect(sql).toContain('Quantity Delivery Trucking');
    expect(sql).toContain('Quantity Delivered via Trucking');
  });

  it('sqlSapQtyReceiveOnly reads receive keys only', () => {
    const sql = sqlSapQtyReceiveOnly();
    expect(sql).not.toContain('t.quantity_delivered');
    expect(sql).toContain('Quantity Receive');
    expect(sql).toContain('Qty Receive');
  });

  it('sqlTruckingOutstandingQtyByIncoterm uses receive for FRC and delivered for LCO', () => {
    const sql = sqlTruckingOutstandingQtyByIncoterm('qty_del', 'qty_recv');
    expect(sql).toContain("= 'FRC'");
    expect(sql).toContain('qty_recv');
    expect(sql).toContain("= 'LCO'");
    expect(sql).toContain('qty_del');
  });

  it('sqlWbActualDeliverySumKg falls back to quantity_kg', () => {
    const sql = sqlWbActualDeliverySumKg('e.id');
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('quantity_kg');
    expect(sql).toContain('e.id');
  });

  it('sqlWbActualReceiveSumKg sums quantity_receive_kg', () => {
    const sql = sqlWbActualReceiveSumKg('e.id');
    expect(sql).toContain('quantity_receive_kg');
    expect(sql).toContain('e.id');
  });

  it('sqlTruckingResolvedDeliveryQty uses WB delivery sum when Open+WB', () => {
    const sql = sqlTruckingResolvedDeliveryQty(
      'e.quantity_delivered',
      'sap_per_sto',
      'e.id',
      'c',
    );
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain('AND NOT (');
    expect(sql).not.toContain('NULLIF((sap_per_sto), 0)');
    expect(sql).toContain('sap_per_sto');
  });

  it('sqlTruckingResolvedReceiveQty uses WB receive sum when Open+WB', () => {
    const sql = sqlTruckingResolvedReceiveQty(
      'e.quantity_receive',
      'sap_recv',
      'e.id',
      'c',
    );
    expect(sql).toContain('quantity_receive_kg');
    expect(sql).toContain('sap_recv');
  });

  it('sqlTruckingPreferWbResolvedQty delegates to resolved delivery (Open→WB)', () => {
    const sql = sqlTruckingPreferWbResolvedQty('e.quantity_delivered', 'sap_per_sto');
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('AND NOT (');
  });

  it('sqlTruckingExpandedStoLineQtyKgExpr resolves SAP STO qty per expanded line', () => {
    const sql = sqlTruckingExpandedStoLineQtyKgExpr();
    expect(sql).toContain("data->'contract'->>'sto_quantity'");
    expect(sql).toContain('e.sto_line_resolved');
    expect(sql).toContain('e.contract_qty');
  });

  it('sqlTruckingOutstandingWithinToleranceExpr allows band around zero', () => {
    const sql = sqlTruckingOutstandingWithinToleranceExpr('os.outstanding');
    expect(sql).toContain('os.outstanding');
    expect(sql).toContain('ABS');
  });

  it('sqlTruckingPipelineIsCompletedExpr uses OR between GR Close and OS tolerance', () => {
    const sql = sqlTruckingPipelineIsCompletedExpr('c');
    expect(sql).toContain(' OR ');
  });

  it('isTruckingPipelineCompleted accepts GR Close or OS tolerance', () => {
    expect(isTruckingPipelineCompleted('Close', 5000)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', 0)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', 5000)).toBe(false);
  });
});
