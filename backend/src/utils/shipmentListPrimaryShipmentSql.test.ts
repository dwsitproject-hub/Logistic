import { describe, expect, it } from 'vitest';
import {
  sqlShipmentListPrimaryFieldAgg,
  sqlShipmentListPrimaryIdAgg,
} from './shipmentListPrimaryShipmentSql';

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

  it('primary field agg uses the same ranking as primary id', () => {
    const idSql = sqlShipmentListPrimaryIdAgg('sto_key', 'c', 'l', 's', 'cs_sto');
    const nameSql = sqlShipmentListPrimaryFieldAgg(
      's.vessel_name',
      'sto_key',
      'c',
      'l',
      's',
      'cs_sto',
    );
    expect(nameSql).toContain('s.vessel_name');
    expect(nameSql).toContain("= 'V' THEN 0");
    expect(nameSql).toContain('s.created_at DESC');
    expect(nameSql).toContain('ata_discharge_complete IS NOT NULL');
    expect(idSql).toContain('array_agg(s.id');
  });
});
