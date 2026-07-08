import { describe, expect, it } from 'vitest';
import { isOfficialSapStoNumber } from './sapStoShipmentPlanning';

describe('sapStoShipmentPlanning', () => {
  it('detects official numeric SAP STO numbers', () => {
    expect(isOfficialSapStoNumber('1006018900')).toBe(true);
    expect(isOfficialSapStoNumber(' 1006018900 ')).toBe(true);
    expect(isOfficialSapStoNumber('SEA-20250101-001')).toBe(false);
    expect(isOfficialSapStoNumber('')).toBe(false);
    expect(isOfficialSapStoNumber(null)).toBe(false);
  });
});
