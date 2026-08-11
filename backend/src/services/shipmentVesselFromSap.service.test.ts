import { describe, expect, it } from 'vitest';
import { mergeShipmentVesselFromSapRow } from './shipmentVesselFromSap.service';

describe('mergeShipmentVesselFromSapRow', () => {
  it('prefers master vessel name over SAP and KLIP for display', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: 'MV KLIP USER',
      vessel_code: 'K01',
      vessel_name_master: 'BG. ANDALAN 02',
      vessel_name_sap: 'MV SAP',
      vessel_code_sap: 'VT01',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('BG. ANDALAN 02');
    expect(row.vessel_code).toBe('K01');
  });

  it('prefers SAP vessel name over KLIP when master is missing', () => {
    const row: Record<string, unknown> = {
      id: 'ship-1',
      vessel_name: 'MV KLIP USER',
      vessel_code: 'K01',
      vessel_name_sap: 'MV SAP',
      vessel_code_sap: 'VT01',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(true);
    expect(row.vessel_name).toBe('MV SAP');
    expect(row.vessel_code).toBe('K01');
  });

  it('uses SAP vessel name when KLIP is empty', () => {
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
  });

  it('falls back to KLIP vessel name when master and SAP name are missing', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'MV KLIP ONLY',
      vessel_name_sap: '',
      vessel_code_sap: '',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(false);
    expect(row.vessel_name).toBe('MV KLIP ONLY');
  });

  it('uses SAP vessel name when only SAP name is present', () => {
    const row: Record<string, unknown> = {
      vessel_name: 'MV KLIP',
      vessel_name_sap: 'MV ONLY NAME',
      vessel_code_sap: '',
    };
    expect(mergeShipmentVesselFromSapRow(row)).toBe(false);
    expect(row.vessel_name).toBe('MV ONLY NAME');
  });
});
