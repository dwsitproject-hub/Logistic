import { describe, expect, it } from 'vitest';
import {
  pickPreferredVesselDisplayName,
  resolveCanonicalVesselDisplayName,
} from './vesselNameNormalize';

describe('resolveCanonicalVesselDisplayName', () => {
  it('returns BG segment from SAP tug/barge compound', () => {
    expect(resolveCanonicalVesselDisplayName('TB. AS MARINA 9 / BG. AS MARINA 12')).toBe(
      'BG. AS MARINA 12',
    );
  });

  it('passes through simple vessel names', () => {
    expect(resolveCanonicalVesselDisplayName('BG. AS MARINA 10')).toBe('BG. AS MARINA 10');
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
