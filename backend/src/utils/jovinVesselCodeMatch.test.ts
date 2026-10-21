import { describe, expect, it } from 'vitest';
import {
  assignSapRowIdentity,
  buildJovinSapMappingRows,
  formatJovinStyleDisplay,
  matchJovinVesselCodes,
  normalizeJovinVesselKey,
  vesselMatchKeys,
} from './jovinVesselCodeMatch';

const LUMINOR_SAP = [
  { name: 'BG LUMINOR 10', code: 'MLUMIN10' },
  { name: 'BG LUMINOR 10 / TB MAXIMUS 711', code: '' },
  { name: 'BG LUMINOR 10 / TB MAXIMUS 711', code: 'MLUMIN' },
  { name: 'BG LUMINOR 10 / TB MAXIMUS 711', code: 'MBGLM10' },
  { name: 'BG LUMINOR 10 / TB MAXIMUS 711', code: 'MLUMINOR10' },
];

const MARINA_SAP = [
  { name: 'As Marina 12', code: 'MMAR12' },
  { name: 'BG. AS MARINA 12', code: 'MMARINA12' },
  { name: 'BG. AS MARINA 12', code: 'MMMARINA12' },
  { name: 'TB. AS MARINA 9', code: 'MMARINA03' },
  { name: 'TB. AS MARINA 9 / BG. AS MARINA 12', code: 'MMARI12' },
  { name: 'TB. AS MARINA 9 / BG. AS MARINA 12', code: 'MASMARINA9' },
  { name: 'TB. AS MARINA 9/BG AS MARINA 12', code: 'MMARINA9' },
];

describe('jovinVesselCodeMatch', () => {
  it('normalizes BG. ADAMAS 405 to ADAMAS 405', () => {
    expect(normalizeJovinVesselKey('BG. ADAMAS 405')).toBe('ADAMAS 405');
    expect(vesselMatchKeys('BG LUMINOR 10 / TB MAXIMUS 711')).toEqual(
      expect.arrayContaining(['LUMINOR 10', 'MAXIMUS 711']),
    );
  });

  it('groups LUMINOR 10 companion-tug SAP aliases onto the barge', () => {
    const match = matchJovinVesselCodes('BG. LUMINOR 10', LUMINOR_SAP);
    expect(match.matchQuality).toBe('alias-group');
    expect(match.vesselCode).toBe('MLUMIN10, MLUMIN, MBGLM10, MLUMINOR10');
  });

  it('matches ADAMAS 405 to MADAMAS', () => {
    const match = matchJovinVesselCodes('BG. ADAMAS 405', [{ name: 'Adamas 405', code: 'MADAMAS' }]);
    expect(match.vesselCode).toBe('MADAMAS');
    expect(match.matchQuality).toBe('exact');
  });

  it('does not merge ILIR JAYA with ILIR JAYA III / IX', () => {
    const match = matchJovinVesselCodes('BG. ILIR JAYA', [
      { name: 'ILIR JAYA III', code: 'MILIRJAYA3' },
      { name: 'ILIR JAYA IX', code: 'MILIRJAYA9' },
    ]);
    expect(match.vesselCode).toBe('');
    expect(match.matchQuality).toBe('unmatched');
  });

  it('does not attach AS MARINA 9 tug codes to BG. AS MARINA 12', () => {
    const match = matchJovinVesselCodes('BG. AS MARINA 12', MARINA_SAP);
    expect(match.vesselCode).toBe('MMAR12, MMARINA12, MMMARINA12, MMARI12');
    expect(match.vesselCode).not.toContain('MASMARINA9');
    expect(match.vesselCode).not.toContain('MMARINA9');
    expect(match.vesselCode).not.toContain('MMARINA03');
  });

  it('assigns compound MARINA 9 codes to the TB identity', () => {
    expect(assignSapRowIdentity('TB. AS MARINA 9 / BG. AS MARINA 12', 'MASMARINA9')).toEqual({
      key: 'AS MARINA 9',
      display: 'TB. AS MARINA 9',
    });
    expect(assignSapRowIdentity('TB. AS MARINA 9', 'MMARINA03')?.key).toBe('AS MARINA 9');
    expect(formatJovinStyleDisplay('TB. AS MARINA 9')).toBe('TB. AS MARINA 9');
  });

  it('emits SAP-only mapping row TB. AS MARINA 9 when Jovin has no tug row', () => {
    const rows = buildJovinSapMappingRows(
      [{ 'Vessel Name': 'BG. AS MARINA 12', 'Company Name': 'X' }],
      MARINA_SAP,
    );
    const jovin = rows.find((r) => r.rowSource === 'Jovin');
    const sapOnly = rows.find((r) => r.rowSource === 'SAP only' && r.vesselName.includes('MARINA 9'));
    expect(jovin?.vesselCode).toBe('MMAR12, MMARINA12, MMMARINA12, MMARI12');
    expect(jovin?.source).toBe('Jovin, SAP');
    expect(sapOnly?.vesselName).toBe('TB. AS MARINA 9');
    expect(sapOnly?.vesselCode).toBe('MMARINA03, MASMARINA9, MMARINA9');
    expect(sapOnly?.source).toBe('SAP');
  });

  it('includes unmatched SAP vessels as Source=SAP rows', () => {
    const rows = buildJovinSapMappingRows(
      [{ 'Vessel Name': 'BG. AS MARINA 12' }],
      [...MARINA_SAP, { name: 'CNC SERVAL', code: 'MSERVAL' }],
    );
    const serval = rows.find((r) => String(r.vesselCode).includes('MSERVAL'));
    expect(serval?.source).toBe('SAP');
    expect(serval?.vesselName.toUpperCase()).toContain('SERVAL');
    expect(rows.filter((r) => r.source === 'SAP').length).toBeGreaterThanOrEqual(2);
  });

  it('does not fuzzy-merge ARCINDO 1 with Arcindo TK 1', () => {
    const match = matchJovinVesselCodes('BG. ARCINDO 1', [{ name: 'Arcindo TK 1', code: 'MARCTK1' }]);
    expect(match.matchQuality).toBe('unmatched');
  });

  it('matches punctuation variants of the same hull', () => {
    const match = matchJovinVesselCodes('BG. ANAK LAUT 289', [{ name: 'BG.ANAK LAUT 289', code: 'MLAUT289' }]);
    expect(match.vesselCode).toBe('MLAUT289');
    expect(match.matchQuality).toBe('exact');
  });
});
