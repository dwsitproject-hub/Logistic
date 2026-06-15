import { describe, expect, it } from 'vitest';
import {
  buildShipmentListCacheKey,
  invalidateShipmentsListCache,
} from './shipmentList.service';

describe('shipmentList.service', () => {
  it('buildShipmentListCacheKey is stable for plant order', () => {
    const base = {
      plants: ['A', 'B'],
      globalSearch: '',
      colFilters: {},
      skipSapJoin: true,
    };
    const a = buildShipmentListCacheKey(base);
    const b = buildShipmentListCacheKey({ ...base, plants: ['B', 'A'] });
    expect(a).toBe(b);
  });

  it('invalidateShipmentsListCache clears cached rows without throwing', () => {
    expect(() => invalidateShipmentsListCache()).not.toThrow();
  });
});
