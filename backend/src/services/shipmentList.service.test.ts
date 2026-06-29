import { describe, expect, it } from 'vitest';
import {
  buildShipmentListCacheKey,
  buildShipmentListEmptyCountQuery,
  buildShipmentListPageQuery,
  invalidateShipmentsListCache,
} from './shipmentList.service';

const baseCtx = {
  shipmentBaseCteSql: 'WITH shipment_base_core AS (SELECT 1)',
  outerSql: '',
  innerParams: ['2026-01-01', '2026-06-29'],
  outerParams: [] as unknown[],
  skipSapJoin: true,
  cacheKey: 'test',
  filterCacheKey: 'test-filter',
};

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

  it('buildShipmentListPageQuery embeds __filter_total in one query (C)', () => {
    const { text } = buildShipmentListPageQuery(baseCtx, 20, 0);
    expect(text).toContain('__filter_total');
    expect(text).toContain('FROM filtered_shipments');
    expect(text).toContain('LIMIT $3 OFFSET $4');
  });

  it('buildShipmentListPageQuery uses ranked_sto total when STO paging (A)', () => {
    const { text, params } = buildShipmentListPageQuery(
      { ...baseCtx, usesStoKeyPaging: true, shipmentBaseCteSql: 'WITH ranked_sto AS (SELECT 1), paged_sto AS (SELECT 1)' },
      20,
      0,
    );
    expect(text).toContain('FROM ranked_sto) AS __filter_total');
    expect(text).not.toMatch(/shipment_page AS[\s\S]*LIMIT \$/);
    expect(params).toEqual([...baseCtx.innerParams]);
  });

  it('buildShipmentListEmptyCountQuery counts ranked_sto when STO paging', () => {
    const { text } = buildShipmentListEmptyCountQuery({
      ...baseCtx,
      usesStoKeyPaging: true,
      shipmentBaseCteSql: 'WITH ranked_sto AS (SELECT 1), paged_sto AS (SELECT 1)',
    });
    expect(text).toContain('FROM ranked_sto');
    expect(text).not.toContain('paged_sto');
  });
});
