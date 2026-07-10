import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SAP_ONLY_STOS_SQL,
  SHIPMENT_SAP_STO_DETAIL_SQL,
  TRUCKING_SAP_STO_DETAIL_SQL,
  sqlSapQtyDeliveredAnyFromSpd,
  sqlSapQtyDeliveredKgFromSpd,
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

  it('uses trucking+vessel delivery in shared STO SQL fragments', () => {
    for (const sql of [
      SHIPMENT_SAP_STO_DETAIL_SQL,
      TRUCKING_SAP_STO_DETAIL_SQL,
      CONTRACT_SAP_ONLY_STOS_SQL,
    ]) {
      expect(sql).toContain('Quantity Delivery Trucking');
      expect(sql).not.toMatch(
        /NULLIF\(TRIM\(spd2?\.data->'raw'->>'Quantity Delivered'\), ''\),\s*\n\s*NULLIF\(TRIM\(spd2?\.data->'raw'->>'Quantity Delivery'\)/,
      );
    }
  });
});
