import { describe, expect, it } from 'vitest';
import { rowMatchesKmapsAvailability, type KmapsAvailabilityView } from './embedAvailable';

describe('rowMatchesKmapsAvailability', () => {
  it('mode none never matches', () => {
    expect(rowMatchesKmapsAvailability({ sto: '1' }, { mode: 'none' })).toBe(false);
  });

  it('mode all always matches', () => {
    expect(rowMatchesKmapsAvailability({}, { mode: 'all' })).toBe(true);
  });

  it('prefers op, then stoKey, then sto, then shipment', () => {
    const view: KmapsAvailabilityView = {
      mode: 'filter',
      ops: ['shp_a'],
      stoKeys: ['1001'],
      stos: ['4500'],
      shipments: ['SHP-1'],
    };
    expect(rowMatchesKmapsAvailability({ op: 'shp_a' }, view)).toBe(true);
    expect(rowMatchesKmapsAvailability({ stoKey: '1001' }, view)).toBe(true);
    expect(rowMatchesKmapsAvailability({ sto: '4500' }, view)).toBe(true);
    expect(rowMatchesKmapsAvailability({ shipment: 'SHP-1' }, view)).toBe(true);
    expect(rowMatchesKmapsAvailability({ sto: '9999', shipment: 'OTHER' }, view)).toBe(false);
  });
});
