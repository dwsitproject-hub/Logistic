import { describe, expect, it } from 'vitest';
import {
  shipmentManualQtyResolveSql,
  shippingPerfResolvedDeliveredQtySql,
  shippingPerfResolvedFulfilledQtySql,
  shippingPerfSapFulfilledQtySql,
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';

describe('sqlShipmentResolvedDeliveryKg', () => {
  it('Close uses SAP; Open prefers KLIP then SAP', () => {
    const sql = sqlShipmentResolvedDeliveryKg(
      'c.closed',
      's.quantity_delivered_klip',
      'sa.quantity_delivered_sap',
      's.quantity_delivered',
    );
    expect(sql).toContain('c.closed');
    expect(sql).toContain('s.quantity_delivered_klip');
    expect(sql).toContain('sa.quantity_delivered_sap');
    expect(sql).toContain('s.quantity_delivered');
    expect(sql).not.toContain('ABS');
  });
});

describe('sqlShipmentResolvedReceiveKg', () => {
  it('Close uses SAP; Open prefers vessel KLIP receive', () => {
    const sql = sqlShipmentResolvedReceiveKg(
      'c.closed',
      's.actual_vessel_qty_receive',
      'sa.quantity_receive',
    );
    expect(sql).toContain('c.closed');
    expect(sql).toContain('s.actual_vessel_qty_receive');
    expect(sql).toContain('sa.quantity_receive');
    expect(sql).not.toContain('> 0.5');
  });
});

describe('shipmentManualQtyResolveSql', () => {
  it('legacy helper still prefers manual when it differs from SAP', () => {
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
  it('uses Open/Close KLIP receive vs delivery by incoterm', () => {
    const sql = shippingPerfResolvedFulfilledQtySql(
      'c.incoterm',
      'sa.quantity_receive',
      'sa.quantity_delivered_sap',
      'FALSE',
    );
    expect(sql).toContain('s.quantity_delivered_klip');
    expect(sql).toContain('s.actual_vessel_qty_receive');
    expect(sql).toContain('s.bl_quantity');
  });
});

describe('shippingPerfResolvedDeliveredQtySql', () => {
  it('resolves delivered qty with Open/Close helpers', () => {
    const sql = shippingPerfResolvedDeliveredQtySql(
      's.quantity_delivered',
      'sa.quantity_delivered_sap',
      'FALSE',
    );
    expect(sql).toContain('s.quantity_delivered_klip');
    expect(sql).toContain('sa.quantity_delivered_sap');
  });
});
