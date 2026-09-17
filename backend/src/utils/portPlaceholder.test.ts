import { describe, expect, it } from 'vitest';
import { isGenericKlipPortPlaceholder } from './portPlaceholder';

describe('isGenericKlipPortPlaceholder', () => {
  it('detects generic KLIP loading/discharge labels', () => {
    expect(isGenericKlipPortPlaceholder('Loading Port 1')).toBe(true);
    expect(isGenericKlipPortPlaceholder('loading port 2')).toBe(true);
    expect(isGenericKlipPortPlaceholder('Discharge Port')).toBe(true);
  });

  it('allows real port names', () => {
    expect(isGenericKlipPortPlaceholder('PORT TANJUNG PRIOK')).toBe(false);
    expect(isGenericKlipPortPlaceholder('Belawan')).toBe(false);
  });
});
