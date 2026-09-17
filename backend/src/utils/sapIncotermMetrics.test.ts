import { describe, expect, it } from 'vitest';
import {
  resolveContractActualQtySubtractedTs,
  resolveIncotermImportStatusTs,
  resolveIncotermOutstandingTs,
  resolveIncotermQuantityDeliveryTs,
  resolveUatQuantityDeliveryTs,
  sqlContractOutstandingFromFields,
  sqlContractOutstandingSignedExpr,
  sqlPoFulfilledKgCase,
  sqlIncotermImportStatusFromJson,
  sqlIncotermOutstandingCase,
  sqlIncotermQuantityDeliveryCase,
  sqlQtyMoveJoinIncotermDelivery,
  sqlSapGrPoStatusFromJson,
  sqlSapGrStoStatusFromJson,
  sqlUatQuantityDeliveryCase,
  usesGrPoStatus,
  usesTruckingQuantityDelivery,
  usesVesselQuantityDelivery,
} from './sapIncotermMetrics';

describe('sapIncotermMetrics', () => {
  it('routes status by incoterm', () => {
    expect(usesGrPoStatus('FRC')).toBe(true);
    expect(usesGrPoStatus('CIF')).toBe(true);
    expect(usesGrPoStatus('CFR')).toBe(true);
    expect(usesGrPoStatus('FOB')).toBe(false);
    expect(resolveIncotermImportStatusTs('FRC', 'Open', 'Close', 'ACTIVE')).toBe('Open');
    expect(resolveIncotermImportStatusTs('CFR', 'Close', 'Open', 'ACTIVE')).toBe('Close');
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
    expect(resolveUatQuantityDeliveryTs('FOB', 'MIX', 3000000, 3000000)).toBe(3000000);
    expect(resolveUatQuantityDeliveryTs('CIF', 'MIX', 300550, 500000)).toBe(500000);
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
    expect(sql).not.toMatch(/quantity_delivery_trucking\) \+ /);
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

  it('resolveContractActualQtySubtractedTs uses actual only (no STO fallback)', () => {
    expect(resolveContractActualQtySubtractedTs('FRC', 0, 500)).toBe(0);
    expect(resolveContractActualQtySubtractedTs('FOB', 100, 200)).toBe(200);
    expect(resolveContractActualQtySubtractedTs('EXW', 0, 300)).toBe(300);
    expect(resolveContractActualQtySubtractedTs('EXW', 0, 0)).toBe(0);
  });

  it('sqlContractOutstandingFromFields follows glossary incoterm matrix', () => {
    const sql = sqlContractOutstandingFromFields({
      contractQtyExpr: 'base.quantity_ordered',
      incotermExpr: 'base.incoterm',
      receiveExpr: 'base.quantity_receive',
      deliveryExpr: 'base.quantity_delivery',
    });
    expect(sql).toContain("'FRC', 'CIF', 'CFR'");
    expect(sql).toContain('base.quantity_receive');
    expect(sql).toContain("'LCO', 'FOB'");
    expect(sql).toContain('base.quantity_delivery');
    expect(sql).toContain('NULLIF(base.quantity_receive, 0)');
    expect(sql).not.toContain('total_sto_quantity');
    expect(sql).not.toContain('GREATEST(0');
  });

  it('sqlContractOutstandingSignedExpr uses incoterm Quantity Delivery (not vessel-first SAP COALESCE)', () => {
    const sql = sqlContractOutstandingSignedExpr({
      contractQtyExpr: 'base.quantity_ordered',
      incotermExpr: 'base.incoterm',
      receiveExpr: 'base.quantity_receive',
      deliveryExpr: 'base.quantity_delivery',
    });
    expect(sql).toContain('base.quantity_delivery');
    expect(sql).not.toContain('quantity_delivery_sap');
    expect(sql).not.toContain('GREATEST(0');
  });

  it('sqlPoFulfilledKgCase matches incoterm receive/delivery matrix', () => {
    const sql = sqlPoFulfilledKgCase('c.incoterm', 'c.quantity_receive', 'c.quantity_delivery_sap');
    expect(sql).toContain("'FRC', 'CIF', 'CFR'");
    expect(sql).toContain("'LCO', 'FOB'");
  });

  it('emits incoterm import status SQL', () => {
    const sql = sqlIncotermImportStatusFromJson('spd.data', 'c.incoterm', 'c.status');
    expect(sql).toContain('GR PO Status');
    expect(sql).toContain('GR STO Status');
    expect(sql).toContain("'FRC', 'CIF', 'CFR'");
    // GR PO uses dedicated fields only — not commercial Status
    expect(sql).not.toContain("->'raw'->>'Status'");
    // Raw GR columns preferred over stale contract.* JSON
    const stoIdx = sql.indexOf("->'raw'->>'GR STO Status'");
    const stoContractIdx = sql.indexOf("->'contract'->>'gr_sto_status'");
    expect(stoIdx).toBeGreaterThan(-1);
    expect(stoContractIdx).toBeGreaterThan(-1);
    expect(stoIdx).toBeLessThan(stoContractIdx);
  });

  it('overlays Cancelled on GR PO/STO when Delete flag is set', () => {
    const po = sqlSapGrPoStatusFromJson('spd.data');
    expect(po).toContain('Delete PO Status');
    expect(po).toContain("'Cancelled'");
    expect(po).toContain('GR PO Status');
    const sto = sqlSapGrStoStatusFromJson('spd.data');
    expect(sto).toContain('Delete STO Status');
    expect(sto).toContain("'Cancelled'");
    expect(sto).toContain('GR STO Status');
  });

  it('sqlQtyMoveJoinIncotermDelivery uses trucking/vessel columns not vessel-first COALESCE', () => {
    const sql = sqlQtyMoveJoinIncotermDelivery('c.incoterm', 'qm', 'c.transport_mode');
    expect(sql).toContain('qm.quantity_delivery_trucking');
    expect(sql).toContain('qm.quantity_delivery_vessel');
    expect(sql).not.toContain('qm.quantity_delivery)');
    expect(sql).not.toContain('qm.quantity_delivery,');
  });
});
