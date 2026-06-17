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
      page: 1,
      limit: 20,
      status: 'ALL',
      etaLoading: 'ALL',
      etaDischarge: 'ALL',
    };
    const a = buildShipmentListCacheKey(base);
    const b = buildShipmentListCacheKey({ ...base, plants: ['B', 'A'] });
    expect(a).toBe(b);
  });

  it('buildShipmentListCacheKey differs for shell vs SAP hydrate', () => {
    const shell = buildShipmentListCacheKey({
      plants: [],
      globalSearch: '',
      colFilters: {},
      skipSapJoin: true,
      page: 1,
      limit: 20,
    });
    const sap = buildShipmentListCacheKey({
      plants: [],
      globalSearch: '',
      colFilters: {},
      skipSapJoin: false,
      page: 1,
      limit: 20,
    });
    expect(shell).not.toBe(sap);
  });

  it('invalidateShipmentsListCache clears cached rows without throwing', () => {
    expect(() => invalidateShipmentsListCache()).not.toThrow();
  });
});
