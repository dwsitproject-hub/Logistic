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
  sqlTruckingPoLevelSapDeliveryQty,
  sqlTruckingPoLevelSapReceiveQty,
  sqlTruckingPreferWbResolvedQty,
  sqlTruckingQuantityDeliveredCoalesce,
  sqlTruckingResolvedDeliveryQty,
  sqlTruckingResolvedReceiveQty,
  sqlWbActualDeliverySumKg,
  sqlWbActualReceiveSumKg,
  TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG,
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

  it('sqlWbActualDeliverySumKg falls back to quantity_kg and scopes by STO catalog', () => {
    const sql = sqlWbActualDeliverySumKg('e.id');
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('quantity_kg');
    expect(sql).toContain('e.id');
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('sap_processed_data');
  });

  it('sqlWbActualReceiveSumKg sums quantity_receive_kg with same STO scope', () => {
    const sql = sqlWbActualReceiveSumKg('e.id');
    expect(sql).toContain('quantity_receive_kg');
    expect(sql).toContain('e.id');
    expect(sql).toContain('contract_stos');
  });

  it('sqlTruckingResolvedDeliveryQty uses WB delivery sum when Open+WB delivery > 0', () => {
    const sql = sqlTruckingResolvedDeliveryQty(
      'e.quantity_delivered',
      'sap_per_sto',
      'e.id',
      'c',
    );
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain('AND NOT (');
    expect(sql).toContain(') > 0 THEN');
    expect(sql).not.toContain('NULLIF((sap_per_sto), 0)');
    expect(sql).toContain('sap_per_sto');
  });

  it('sqlTruckingResolvedReceiveQty uses WB receive sum only when Open+WB receive > 0', () => {
    const sql = sqlTruckingResolvedReceiveQty(
      'e.quantity_receive',
      'sap_recv',
      'e.id',
      'c',
    );
    expect(sql).toContain('quantity_receive_kg');
    expect(sql).toContain('sap_recv');
    expect(sql).toContain(') > 0 THEN');
  });

  it('sqlTruckingResolvedReceiveQty keeps SAP when WB receive is empty (null/0)', () => {
    const sql = sqlTruckingResolvedReceiveQty(
      'COALESCE(t.quantity_delivered, 0)',
      'sap_recv',
      't.id',
      'c',
    );
    expect(sql).toMatch(/AND NOT \(.*\) AND \(.*\) > 0 THEN/s);
    expect(sql).toContain('ELSE COALESCE(sap_recv, COALESCE(t.quantity_delivered, 0), 0)');
  });

  it('sqlTruckingPreferWbResolvedQty delegates to resolved delivery (Open→WB)', () => {
    const sql = sqlTruckingPreferWbResolvedQty('e.quantity_delivered', 'sap_per_sto');
    expect(sql).toContain('quantity_delivery_kg');
    expect(sql).toContain('AND NOT (');
  });

  it('sqlTruckingPoLevelSapDeliveryQty sums latest delivery per STO with MT→kg normalize and dedup', () => {
    const sql = sqlTruckingPoLevelSapDeliveryQty();
    expect(sql).toContain('Quantity Delivery Trucking');
    expect(sql).toContain("data->'raw'->>'PO No'");
    expect(sql).toContain('e.po_number');
    expect(sql).toContain('contract_sto_lines');
    expect(sql).toContain('DISTINCT ON');
    expect(sql).toContain('* 1000');
    expect(sql).toContain('sum_adj');
    expect(sql).toContain('max_qty');
    expect(sql).toContain('* 1.2');
    expect(sql).toContain('* 0.95');
  });

  it('sqlTruckingPoLevelSapReceiveQty sums latest receive per STO with MT→kg normalize and dedup', () => {
    const sql = sqlTruckingPoLevelSapReceiveQty();
    expect(sql).toContain('Quantity Receive');
    expect(sql).toContain('Qty Receive');
    expect(sql).toContain('e.po_number');
    expect(sql).toContain('DISTINCT ON');
    expect(sql).toContain('* 1000');
    expect(sql).toContain('sum_adj');
    expect(sql).toContain('WHEN a.sto_count > 1 AND a.sum_adj >');
  });

  it('sqlTruckingResolvedDeliveryQty keeps Open+WB (>0) before Close→SAP', () => {
    const sql = sqlTruckingResolvedDeliveryQty('e.quantity_delivered', 'sap_po', 'e.id', 'c');
    expect(sql).toContain('AND NOT (');
    expect(sql).toContain(') > 0 THEN');
    expect(sql).toContain('trucking_daily_actuals');
    expect(sql).toContain('sap_po');
    expect(sql).toContain('BOOL_OR');
  });

  it('sqlTruckingExpandedStoLineQtyKgExpr sums SAP STO qty across the PO', () => {
    const sql = sqlTruckingExpandedStoLineQtyKgExpr();
    expect(sql).toContain("data->'contract'->>'sto_quantity'");
    expect(sql).toContain('e.po_number');
    expect(sql).toContain('e.contract_qty');
    expect(sql).toContain('DISTINCT ON');
  });

  it('sqlTruckingOutstandingWithinToleranceExpr allows residual band and over-delivery', () => {
    const sql = sqlTruckingOutstandingWithinToleranceExpr('os.outstanding');
    expect(sql).toContain('os.outstanding');
    expect(sql).toContain(`<= ${TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG}`);
    expect(sql).not.toContain('ABS');
  });

  it('sqlTruckingPipelineIsCompletedExpr uses OR between GR Close and OS tolerance', () => {
    const sql = sqlTruckingPipelineIsCompletedExpr('c');
    expect(sql).toContain(' OR ');
  });

  it('isTruckingPipelineCompleted accepts GR Close, OS within 0 MT band, or over-delivery', () => {
    expect(isTruckingPipelineCompleted('Close', 5000)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', 0)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', 286)).toBe(true); // displays as 0 MT
    expect(isTruckingPipelineCompleted('Open', TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG + 1)).toBe(false);
    expect(isTruckingPipelineCompleted('Open', 5000)).toBe(false);
    // Over-delivery (negative OS / UI "+N MT") → Completed
    expect(isTruckingPipelineCompleted('Open', -3000)).toBe(true);
    expect(isTruckingPipelineCompleted('Open', -1)).toBe(true);
  });
});
