import { describe, expect, it } from 'vitest';
import {
  JOVIN_TEMPLATE_HEADERS,
  KLIP_TEMPLATE_HEADERS,
  masterVesselToJovinRow,
  masterVesselToKlipRow,
} from './masterVesselExcelTemplate';

describe('masterVesselExcelTemplate', () => {
  const sample = {
    vessel_name: 'BG. LUMINOR 9',
    vessel_code: 'MLUM9',
    sap_vendor_code: 'V001',
    vessel_owner: 'OWNER CO',
    vessel_capacity_mt: 5000,
    vessel_type: 'TANKER',
    heating: true,
    lambung_type: 'DOUBLE',
    terms: 'T/C' as const,
  };

  it('maps master row to Jovin sheet columns', () => {
    const row = masterVesselToJovinRow(sample);
    expect(row).toHaveLength(JOVIN_TEMPLATE_HEADERS.length);
    expect(row[0]).toBe('BG. LUMINOR 9');
    expect(row[1]).toBe('MLUM9');
    expect(row[2]).toBe('V001');
    expect(row[3]).toBe('OWNER CO');
    expect(row[6]).toBe('Yes');
    expect(row[8]).toBe('T/C');
  });

  it('omits provisional codes from export', () => {
    const row = masterVesselToJovinRow({ ...sample, vessel_code: 'TMP-LUMINOR9' });
    expect(row[1]).toBe('');
  });

  it('maps KLIP sheet with official code only', () => {
    expect(masterVesselToKlipRow(sample)).toEqual(['BG. LUMINOR 9', 'MLUM9']);
    expect(masterVesselToKlipRow({ ...sample, vessel_code: 'TMP-X' })).toEqual([]);
    expect(KLIP_TEMPLATE_HEADERS).toEqual(['Vessel Name', 'Vessel Code']);
  });
});
