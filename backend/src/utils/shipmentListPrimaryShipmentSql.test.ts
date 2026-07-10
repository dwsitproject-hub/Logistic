import { describe, expect, it } from 'vitest';
import { sqlShipmentListPrimaryIdAgg } from './shipmentListPrimaryShipmentSql';

describe('shipmentListPrimaryShipmentSql', () => {
  it('prefers STO Type V and vessel_name in primary id agg', () => {
    const sql = sqlShipmentListPrimaryIdAgg();
    expect(sql).toContain("= 'V' THEN 0");
    expect(sql).toContain("= 'T' THEN 2");
    expect(sql).toContain('vessel_name');
  });

  it('prefers shipment_id matching sto key in array_agg order', () => {
    const sql = sqlShipmentListPrimaryIdAgg();
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('s.ata_loading_complete IS NOT NULL');
    expect(sql).toContain('s.created_at DESC');
  });
});
