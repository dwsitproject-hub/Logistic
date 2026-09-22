import { describe, expect, it } from 'vitest';
import { fromDhmVesselData, toDhmVesselPayload } from './mapper';

describe('dhm vessel mapper', () => {
  it('maps KLIP fields to hub keys and omits local-only columns', () => {
    const payload = toDhmVesselPayload({
      vessel_code: 'MBGPSIV',
      vessel_name: 'MARINA BAY III',
      vessel_capacity_mt: 5000,
      heating: true,
      vessel_type: 'TANKER',
      lambung_type: 'DHDB',
      terms: 'V/C',
    });

    expect(payload).toEqual({
      Vessel_Name: 'MARINA BAY III',
      Vessel_Code_SAP: 'MBGPSIV',
      Vessel_Capacity_MT: 5000,
      Heater: true,
      Vessel_Type: 'tanker',
      Type_lambung: 'Double hull Double Bottom',
      Type_Charter: 'Voyage Charter',
    });
    expect(payload).not.toHaveProperty('vessel_owner');
    expect(payload).not.toHaveProperty('code');
  });

  it('includes DHM code only on PUT', () => {
    const payload = toDhmVesselPayload({ vessel_name: 'ALPHA' }, { code: 'VSL-0001' });
    expect(payload.code).toBe('VSL-0001');
    expect(payload.Vessel_Name).toBe('ALPHA');
  });

  it('maps hub data back to KLIP enums', () => {
    const mapped = fromDhmVesselData({
      code: 'VSL-0001',
      Vessel_Name: 'MARINA BAY III',
      Vessel_Code_SAP: 'MBGPSIV',
      Vessel_Capacity_MT: 5000,
      Heater: false,
      Vessel_Type: 'barge',
      Type_lambung: 'Single hull Double Bottom',
      Type_Charter: 'Time Charter',
    });
    expect(mapped).toEqual({
      dhm_code: 'VSL-0001',
      vessel_name: 'MARINA BAY III',
      vessel_code_sap: 'MBGPSIV',
      vessel_capacity_mt: 5000,
      heating: false,
      vessel_type: 'BARGE',
      lambung_type: 'SHDB',
      terms: 'T/C',
    });
  });
});
