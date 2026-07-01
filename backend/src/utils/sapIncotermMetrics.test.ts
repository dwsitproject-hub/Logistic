import { describe, expect, it } from 'vitest';
import {
  resolveIncotermImportStatusTs,
  resolveIncotermOutstandingTs,
  resolveIncotermQuantityDeliveryTs,
  resolveUatQuantityDeliveryTs,
  sqlIncotermImportStatusFromJson,
  sqlIncotermOutstandingCase,
  sqlIncotermQuantityDeliveryCase,
  sqlUatQuantityDeliveryCase,
  usesGrPoStatus,
  usesTruckingQuantityDelivery,
  usesVesselQuantityDelivery,
} from './sapIncotermMetrics';

describe('sapIncotermMetrics', () => {
  it('routes status by incoterm', () => {
    expect(usesGrPoStatus('FRC')).toBe(true);
    expect(usesGrPoStatus('CIF')).toBe(true);
    expect(usesGrPoStatus('FOB')).toBe(false);
    expect(resolveIncotermImportStatusTs('FRC', 'Open', 'Close', 'ACTIVE')).toBe('Open');
    expect(resolveIncotermImportStatusTs('FOB', 'Open', 'Close', 'ACTIVE')).toBe('Close');
  });

  it('routes quantity delivery by incoterm', () => {
    expect(usesTruckingQuantityDelivery('LCO')).toBe(true);
    expect(usesVesselQuantityDelivery('CIF')).toBe(true);
    expect(resolveIncotermQuantityDeliveryTs('FRC', 100, 200)).toBe(100);
    expect(resolveIncotermQuantityDeliveryTs('FOB', 100, 200)).toBe(200);
    expect(resolveIncotermOutstandingTs(1000, 'LCO', 300, 500)).toBe(700);
    expect(resolveIncotermOutstandingTs(1000, 'CIF', 300, 400)).toBe(600);
  });

  it('routes quantity delivery by transport (UAT matrix)', () => {
    expect(resolveUatQuantityDeliveryTs('FRC', 'LAND', 100060, 0)).toBe(100060);
    expect(resolveUatQuantityDeliveryTs('CIF', 'SEA', 0, 500000)).toBe(500000);
    expect(resolveUatQuantityDeliveryTs('CIF', 'MIX', 300550, 0)).toBe(300550);
    expect(resolveUatQuantityDeliveryTs('FOB', 'MIX', 0, 249490)).toBe(249490);
    expect(resolveUatQuantityDeliveryTs('LCO', 'LAND', 0, 0)).toBe(0);
    expect(resolveUatQuantityDeliveryTs('FOB', 'SEA', 100, 200)).toBe(200);

    const sql = sqlUatQuantityDeliveryCase({
      incotermExpr: 'c.incoterm',
      transportExpr: 'c.transport_mode',
      truckingQtyExpr: 'qm.quantity_delivery_trucking',
      vesselQtyExpr: 'qm.quantity_delivery_vessel',
    });
    expect(sql).toContain("'MIX'");
    expect(sql).toContain('quantity_delivery_trucking');
    expect(sql).toContain('quantity_delivery_vessel');
  });

  it('emits SQL CASE for delivery and outstanding', () => {
    const delivery = sqlIncotermQuantityDeliveryCase('c.incoterm', 'db.quantity_delivery_trucking', 'db.quantity_delivery_vessel');
    expect(delivery).toContain('FRC');
    expect(delivery).toContain('quantity_delivery_trucking');
    expect(delivery).toContain('CIF');

    const outstanding = sqlIncotermOutstandingCase({
      contractQtyExpr: 'c.quantity_ordered',
      incotermExpr: 'c.incoterm',
      truckingQtyExpr: 'qm.quantity_delivery_trucking',
      vesselQtyExpr: 'qm.quantity_delivery_vessel',
    });
    expect(outstanding).toContain('GREATEST');
    expect(outstanding).toContain('quantity_delivery_vessel');
  });

  it('emits incoterm import status SQL', () => {
    const sql = sqlIncotermImportStatusFromJson('spd.data', 'c.incoterm', 'c.status');
    expect(sql).toContain('GR PO Status');
    expect(sql).toContain('GR STO Status');
  });
});
