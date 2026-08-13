import { describe, expect, it } from 'vitest';
import { groupMasterRowsByNormalizedName } from './masterVesselCleanup.service';
import { normalizeVesselName, shouldAutoMergeVesselNames } from '../utils/vesselNameNormalize';

function row(
  id: string,
  vessel_code: string,
  vessel_name: string,
): Parameters<typeof groupMasterRowsByNormalizedName>[0][number] {
  return {
    id,
    vessel_code,
    vessel_name,
    normalized_vessel_name: vessel_name,
    code_status: 'OFFICIAL',
    updated_at: '2026-08-13T00:00:00.000Z',
  };
}

describe('groupMasterRowsByNormalizedName', () => {
  it('groups SAP LUMINOR 8/9 and GLORY 7 code variants', () => {
    const groups = groupMasterRowsByNormalizedName([
      row('1', 'MBGLUMINOR', 'BG. LUMINOR 8'),
      row('2', 'MLUM8', 'Luminor 8'),
      row('3', 'MLUMIN9', 'BG LUMINOR 9'),
      row('4', 'MLUM9', 'LUMINOR 9'),
      row('5', 'MGLORY7', 'AS GLORY 7'),
      row('6', 'MMGLORY7', 'BG GLORY 7'),
    ]);

    expect(groups.get('LUMINOR 8')?.map((r) => r.vessel_code).sort()).toEqual(['MBGLUMINOR', 'MLUM8']);
    expect(groups.get('LUMINOR 9')?.map((r) => r.vessel_code).sort()).toEqual(['MLUM9', 'MLUMIN9']);
    expect(groups.get(normalizeVesselName('AS GLORY 7'))?.map((r) => r.vessel_code)).toEqual(['MGLORY7']);
    expect(groups.get(normalizeVesselName('BG GLORY 7'))?.map((r) => r.vessel_code)).toEqual(['MMGLORY7']);
    expect(shouldAutoMergeVesselNames('AS GLORY 7', 'GLORY 7')).toBe(true);
  });

  it('groups PRIMA SAMUDRA 9 spelling/roman variants', () => {
    const groups = groupMasterRowsByNormalizedName([
      row('1', 'MPRIMA9', 'PRIMA SAMUDERA 9'),
      row('2', 'MPRIMA91', 'PRIMA SAMUDRA IX'),
      row('3', 'MBGPSIV', 'BG.PRIMA SAMUDRA IV'),
      row('4', 'MPRIMA4', 'PRIMA SAMUDRA IV'),
    ]);
    expect(groups.get('PRIMA SAMUDRA 9')?.map((r) => r.vessel_code).sort()).toEqual(['MPRIMA9', 'MPRIMA91']);
    expect(groups.get('PRIMA SAMUDRA 4')?.map((r) => r.vessel_code).sort()).toEqual(['MBGPSIV', 'MPRIMA4']);
  });
});
