import { describe, expect, it } from 'vitest';
import { canonicalizeUserRegionSites, expandRegionSiteMatchNames } from './userRegionSite';

describe('canonicalizeUserRegionSites', () => {
  it('maps KIJING and mixed-case Tanjung Pura onto TANJUNG PURA and drops Blank', () => {
    expect(
      canonicalizeUserRegionSites(['KIJING', 'Tanjung Pura', 'TANJUNG PURA', 'Blank', '', 'Bontang']),
    ).toEqual(['TANJUNG PURA', 'Bontang']);
  });
});

describe('expandRegionSiteMatchNames', () => {
  it('includes alias reverse so TANJUNG PURA also matches KIJING master group_plant', () => {
    const expanded = expandRegionSiteMatchNames(['TANJUNG PURA']).map((name) => name.toUpperCase());
    expect(expanded).toEqual(expect.arrayContaining(['TANJUNG PURA', 'KIJING']));
  });
});
