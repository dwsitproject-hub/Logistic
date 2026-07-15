import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SAP_ONLY_STOS_SQL,
  SHIPMENT_SAP_STO_DETAIL_SQL,
  TRUCKING_SAP_STO_DETAIL_SQL,
  sqlSapQtyDeliveredAnyFromSpd,
  sqlSapQtyDeliveredForStoKeyExpr,
  sqlSapQtyDeliveredKgFromSpd,
  sqlSapQtyReceiveForStoKeyExpr,
  sqlSapStoKeyMatchExpr,
  sqlSapStoQtyForContractPoExpr,
} from './contractLogisticsStoDetailSql';

describe('contractLogisticsStoDetailSql', () => {
  it('includes SAP trucking delivery field aliases', () => {
    const expr = sqlSapQtyDeliveredAnyFromSpd('spd');
    expect(expr).toContain('Quantity Delivery Trucking');
    expect(expr).toContain('Quantity Delivered Trucking');
    expect(expr).toContain('quantity_delivery_trucking');
  });

  it('includes SAP vessel delivery field aliases', () => {
    const expr = sqlSapQtyDeliveredAnyFromSpd('spd');
    expect(expr).toContain('Quantity Delivery Vessel');
    expect(expr).toContain('Quantity Delivered');
  });

  it('normalizes MT-scale SAP delivery to kg', () => {
    const expr = sqlSapQtyDeliveredKgFromSpd('spd2', 'c.quantity_ordered');
    expect(expr).toContain('* 1000');
    expect(expr).toContain('quantity_ordered');
  });

  it('builds SAP STO qty by PO without falling back to contract quantity_ordered', () => {
    const expr = sqlSapStoQtyForContractPoExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
    });
    expect(expr).toContain("->>'STO Quantity'");
    expect(expr).toContain('po_number');
    expect(expr).toContain('OP-|MNL-|MSEA-');
    expect(expr).not.toContain('quantity_ordered');
  });

  it('matches Operation ID keys to SAP rows by PO when STO/Operation ID is null', () => {
    const match = sqlSapStoKeyMatchExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
    });
    expect(match).toContain('OP-|MNL-|MSEA-');
    expect(match).toContain('po_number');
    expect(match).toContain('Operation ID');
    expect(match).toContain('IS NULL');
  });

  it('builds SAP delivery/receive qty for Operation ID fallback by PO', () => {
    const delivered = sqlSapQtyDeliveredForStoKeyExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
      contractQtyExpr: 'c.quantity_ordered',
    });
    const receive = sqlSapQtyReceiveForStoKeyExpr({
      contractAlias: 'c',
      stoKeyExpr: 'sk.sto_key',
    });
    expect(delivered).toContain('Quantity Delivery Trucking');
    expect(delivered).toContain('OP-|MNL-|MSEA-');
    expect(receive).toContain('Quantity Receive');
    expect(receive).toContain('po_number');
  });
});
