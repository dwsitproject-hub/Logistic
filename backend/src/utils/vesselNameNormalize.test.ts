import { describe, expect, it } from 'vitest';
import {
  extractVesselHullKey,
  isSafeNoiseTokenContainment,
  isVesselNameTokenContained,
  normalizeVesselName,
  pickPreferredVesselDisplayName,
  resolveCanonicalVesselDisplayName,
  shouldAutoMergeVesselNames,
  shouldReviewVesselNamePair,
  vesselNameSimilarity,
} from './vesselNameNormalize';

describe('resolveCanonicalVesselDisplayName', () => {
  it('returns BG segment from SAP tug/barge compound', () => {
    expect(resolveCanonicalVesselDisplayName('TB. AS MARINA 9 / BG. AS MARINA 12')).toBe(
      'BG. AS MARINA 12',
    );
  });

  it('picks glued BG segment without space after the dot', () => {
    expect(resolveCanonicalVesselDisplayName('TB.AREK SUROBOYO 3/BG.BOSS 3')).toBe('BG.BOSS 3');
  });

  it('passes through simple vessel names', () => {
    expect(resolveCanonicalVesselDisplayName('BG. AS MARINA 10')).toBe('BG. AS MARINA 10');
  });
});

describe('normalizeVesselName', () => {
  it('strips BG./MT. prefixes with a required-looking dot', () => {
    expect(normalizeVesselName('BG. ANDALAN 02')).toBe('ANDALAN 02');
    expect(normalizeVesselName('MT. GIAT ARMADA 02')).toBe('GIAT ARMADA 02');
    expect(normalizeVesselName('BG. LUMINOR 9')).toBe('LUMINOR 9');
    expect(normalizeVesselName('Luminor 9')).toBe('LUMINOR 9');
  });

  it('strips BG/MT prefixes without a dot (SAP variants)', () => {
    expect(normalizeVesselName('BG LUMINOR 9')).toBe('LUMINOR 9');
    expect(normalizeVesselName('BG GLORY 7')).toBe('GLORY 7');
    expect(normalizeVesselName('BG.ANAK LAUT 289')).toBe('ANAK LAUT 289');
  });

  it('strips KLM/TK type prefixes', () => {
    expect(normalizeVesselName('KLM SUMBER UTAMA KELUARGA')).toBe('SUMBER UTAMA KELUARGA');
    expect(normalizeVesselName('KLM.MORUT')).toBe('MORUT');
    expect(normalizeVesselName('TK.BERLIAN UTAMA')).toBe('BERLIAN UTAMA');
  });

  it('normalizes SAMUDERA spelling and trailing roman numerals', () => {
    expect(normalizeVesselName('PRIMA SAMUDERA 9')).toBe('PRIMA SAMUDRA 9');
    expect(normalizeVesselName('PRIMA SAMUDRA IX')).toBe('PRIMA SAMUDRA 9');
    expect(normalizeVesselName('BG.PRIMA SAMUDRA IV')).toBe('PRIMA SAMUDRA 4');
    expect(normalizeVesselName('PRIMA SAMUDRA VIII')).toBe('PRIMA SAMUDRA 8');
  });

  it('uses the barge segment of a tug/barge compound', () => {
    expect(normalizeVesselName('TB. OPTIMUS 777/BG. LUMINOR 6')).toBe('LUMINOR 6');
    expect(normalizeVesselName('TB. MAXIMUS 710 / BG. LUMINOR 5')).toBe('LUMINOR 5');
  });

  it('keeps LUMINOR 8 and LUMINOR 9 distinct', () => {
    expect(normalizeVesselName('BG. LUMINOR 8')).toBe('LUMINOR 8');
    expect(normalizeVesselName('Luminor 8')).toBe('LUMINOR 8');
    expect(normalizeVesselName('BG. LUMINOR 8')).not.toBe(normalizeVesselName('BG LUMINOR 9'));
  });
});

describe('vessel name fuzzy merge guards', () => {
  it('auto-merges AS GLORY 7 with GLORY 7 (same hull, noise-token prefix)', () => {
    expect(shouldAutoMergeVesselNames('AS GLORY 7', 'GLORY 7')).toBe(true);
    expect(isSafeNoiseTokenContainment('AS GLORY 7', 'GLORY 7')).toBe(true);
    expect(isVesselNameTokenContained('AS GLORY 7', 'GLORY 7')).toBe(true);
    expect(extractVesselHullKey('AS GLORY 7')).toBe('7');
  });

  it('does not auto-merge PRIMA SAMUDRA 9 with SAMUDRA 9', () => {
    expect(shouldAutoMergeVesselNames('PRIMA SAMUDRA 9', 'SAMUDRA 9')).toBe(false);
    expect(isSafeNoiseTokenContainment('PRIMA SAMUDRA 9', 'SAMUDRA 9')).toBe(false);
  });

  it('never auto-merges different hull numbers', () => {
    expect(shouldAutoMergeVesselNames('LUMINOR 8', 'LUMINOR 9')).toBe(false);
    expect(shouldAutoMergeVesselNames('SAHABAT SETIA 1689', 'SAHABAT SETIA 2689')).toBe(false);
    expect(shouldAutoMergeVesselNames('PRIMA SAMUDRA 8', 'PRIMA SAMUDRA 9')).toBe(false);
  });

  it('does not auto-merge high-similarity names with missing hull', () => {
    expect(shouldAutoMergeVesselNames('MED PACIFIC', 'PACIFIC')).toBe(false);
  });

  it('does not put LUMINOR 8 vs 9 in the auto-merge or 90% review queue', () => {
    expect(shouldAutoMergeVesselNames('LUMINOR 8', 'LUMINOR 9')).toBe(false);
    expect(shouldReviewVesselNamePair('LUMINOR 8', 'LUMINOR 9')).toBe(false);
    expect(vesselNameSimilarity('LUMINOR 8', 'LUMINOR 9')).toBeLessThan(0.9);
  });
});

describe('pickPreferredVesselDisplayName', () => {
  it('keeps clean master name when SAP sends compound string', () => {
    expect(
      pickPreferredVesselDisplayName('BG. AS MARINA 12', 'TB. AS MARINA 9 / BG. AS MARINA 12'),
    ).toBe('BG. AS MARINA 12');
  });

  it('canonicalizes when both names are compound', () => {
    expect(
      pickPreferredVesselDisplayName(
        'TB. AS MARINA 9 / BG. AS MARINA 12',
        'TB. AS MARINA 9 / BG. AS MARINA 12',
      ),
    ).toBe('BG. AS MARINA 12');
  });
});
