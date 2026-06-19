import { describe, expect, it } from 'vitest';
import { mergeShipmentVesselFromSapRow } from './shipmentVesselFromSap.service';

describe('mergeShipmentVesselFromSapRow', () => {
  it('fills missing shipment vessel fields when SAP has both code and name', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: null,
      vessel_code: '',
      vessel_name_sap: 'MV TEST',
      vessel_code_sap: 'VT01',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('MV TEST');
    expect(row.vessel_code).toBe('VT01');
    expect(row.vessel_name_sap).toBeUndefined();
  });

  it('does not apply partial SAP vessel data', () => {
    const row: Record<string, unknown> = {
      vessel_name_sap: 'MV ONLY NAME',
      vessel_code_sap: '',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(false);
    expect(row.vessel_name).toBeUndefined();
  });
});
