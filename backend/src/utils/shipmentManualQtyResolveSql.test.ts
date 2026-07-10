import { describe, expect, it } from 'vitest';
import {
  shipmentManualQtyResolveSql,
  shippingPerfResolvedDeliveredQtySql,
  shippingPerfResolvedFulfilledQtySql,
  shippingPerfSapFulfilledQtySql,
} from './shipmentManualQtyResolveSql';

describe('shipmentManualQtyResolveSql', () => {
  it('prefers manual when it differs from SAP', () => {
    const sql = shipmentManualQtyResolveSql('s.quantity_delivered', 'sa.quantity_delivered_sap');
    expect(sql).toContain('ABS');
    expect(sql).toContain('s.quantity_delivered');
    expect(sql).toContain('sa.quantity_delivered_sap');
    expect(sql).toContain('> 0.5');
  });
});

describe('shippingPerfSapFulfilledQtySql', () => {
  it('branches on incoterm for SAP fulfilled qty', () => {
    const sql = shippingPerfSapFulfilledQtySql('c.incoterm', 'sa.quantity_receive', 'sa.quantity_delivered_sap');
    expect(sql).toContain("IN ('FRC', 'CIF', 'CFR')");
    expect(sql).toContain("IN ('LCO', 'FOB')");
  });
});

describe('shippingPerfResolvedFulfilledQtySql', () => {
  it('uses manual LCO delivery vs CIF receive', () => {
    const sql = shippingPerfResolvedFulfilledQtySql('c.incoterm', 'sa.quantity_receive', 'sa.quantity_delivered_sap');
    expect(sql).toContain('s.quantity_delivered');
    expect(sql).toContain('s.actual_vessel_qty_receive');
    expect(sql).toContain('s.bl_quantity');
  });
});

describe('shippingPerfResolvedDeliveredQtySql', () => {
  it('resolves delivered qty from shipment row vs SAP', () => {
    const sql = shippingPerfResolvedDeliveredQtySql('s.quantity_delivered', 'sa.quantity_delivered_sap');
    expect(sql).toContain('s.quantity_delivered');
    expect(sql).toContain('sa.quantity_delivered_sap');
  });
});
