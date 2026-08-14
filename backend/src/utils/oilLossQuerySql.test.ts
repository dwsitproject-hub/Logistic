import { describe, expect, it } from 'vitest';
import { buildOilLossGainSql, buildOilLossMainSql } from './oilLossQuerySql';
import {
  SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC,
  SAP_OIL_LOSS_QTY_VESSEL_NUMERIC,
  sqlOilLossUatQtyDeliveryExpr,
} from './oilLossSapSql';

describe('buildOilLossMainSql', () => {
  it('resolves qty from shipments when manual differs from SAP', () => {
    const sql = buildOilLossMainSql();
    expect(sql).toContain('oil_loss_closed');
    expect(sql).toContain('shipment_qty_delivered_kg');
    expect(sql).toContain('shipment_qty_receive_kg');
    expect(sql).toContain('with_qty');
    expect(sql).toContain('qty_delivery_resolved');
    expect(sql).toContain('qty_receive_resolved');
    expect(sql).toContain('qty_receive_resolved < qty_delivery_resolved');
    expect(sql).toContain('b2b_end');
    expect(sql).toContain('Truck Discharge Location');
    expect(sql).toContain('ABS');
  });

  it('uses SAP UAT quantity delivery trucking/vessel matrix', () => {
    const sql = buildOilLossMainSql();
    expect(sql).toContain('qty_trucking');
    expect(sql).toContain('qty_vessel');
    expect(sql).toContain('Quantity Delivery Trucking');
    expect(sql).toContain('Quantity Delivery Vessel');
    expect(sql).toContain('import_status');
    expect(sql).toContain('GR STO Status');
  });
});

describe('buildOilLossGainSql', () => {
  it('uses UAT delivery and incoterm-aware close filter', () => {
    const sql = buildOilLossGainSql();
    expect(sql).toContain('with_delivery');
    expect(sql).toContain('import_status');
  });
});

describe('sqlOilLossUatQtyDeliveryExpr', () => {
  it('prefers UAT matrix over legacy delivery', () => {
    const expr = sqlOilLossUatQtyDeliveryExpr({
      incotermExpr: 'inc',
      transportExpr: 'tm',
      truckingCol: 'qt',
      vesselCol: 'qv',
      legacyCol: 'ql',
    });
    expect(expr).toContain('WHEN COALESCE');
    expect(expr).toContain('ELSE COALESCE(ql, 0)');
  });
});

describe('oilLossSapSql UAT fields', () => {
  it('includes trucking and vessel SAP raw paths', () => {
    expect(SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC).toContain('Quantity Delivery Trucking');
    expect(SAP_OIL_LOSS_QTY_VESSEL_NUMERIC).toContain('Quantity Delivery Vessel');
  });
});
