import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildShipmentListCacheKey,
  buildShipmentListEmptyCountQuery,
  buildShipmentListPageQuery,
  buildShipmentListPageQueryWithoutInlineCount,
  buildShipmentPipelineDailyFilterInput,
  getCachedFilteredTotal,
  invalidateShipmentsListCache,
  loadShipmentSummaryBundle,
} from './shipmentList.service';
import {
  isPipelineDailySummaryEligible,
  loadShipmentSummaryFromDaily,
} from './pipelineDailySummary.service';

vi.mock('./pipelineDailySummary.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipelineDailySummary.service')>();
  return {
    ...actual,
    isPipelineDailySummaryEligible: vi.fn(actual.isPipelineDailySummaryEligible),
    loadShipmentSummaryFromDaily: vi.fn(actual.loadShipmentSummaryFromDaily),
    markPipelineDailySummaryStale: vi.fn(actual.markPipelineDailySummaryStale),
  };
});

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

  it('buildShipmentListPageQuery prioritizes STO rows for PLANNED', () => {
    const { text } = buildShipmentListPageQuery(
      { ...baseCtx, tableStatusFilter: 'PLANNED' },
      20,
      0,
    );
    expect(text).toContain('fs.sto_number');
    expect(text).toContain('THEN 0');
    expect(text).toContain('fs.created_at DESC');
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

  it('buildShipmentListPageQueryWithoutInlineCount omits __filter_total', () => {
    const { text } = buildShipmentListPageQueryWithoutInlineCount(baseCtx, 20, 0);
    expect(text).not.toContain('__filter_total');
    expect(text).toContain('LIMIT $3 OFFSET $4');
  });

  it('buildShipmentListPageQueryWithoutInlineCount omits LIMIT when STO paging', () => {
    const { text, params } = buildShipmentListPageQueryWithoutInlineCount(
      { ...baseCtx, usesStoKeyPaging: true, shipmentBaseCteSql: 'WITH ranked_sto AS (SELECT 1)' },
      20,
      0,
    );
    expect(text).not.toContain('__filter_total');
    expect(text).not.toMatch(/shipment_page AS[\s\S]*LIMIT \$/);
    expect(params).toEqual([...baseCtx.innerParams]);
  });

  it('getCachedFilteredTotal returns null when cache is empty', () => {
    invalidateShipmentsListCache();
    expect(getCachedFilteredTotal('missing-filter-key')).toBeNull();
  });

  it('buildShipmentPipelineDailyFilterInput maps toolbar query params', () => {
    const req = {
      query: {
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
        plant: ['PRC Karawang'],
        status: 'ALL',
        scopeStatus: 'ALL',
        etaLoading: 'ALL',
        etaDischarge: 'ALL',
        search: '',
      },
    } as Parameters<typeof buildShipmentPipelineDailyFilterInput>[0];
    const filters = buildShipmentPipelineDailyFilterInput(req);
    expect(filters.dateFrom).toBe('2026-01-01');
    expect(filters.plants).toEqual(['PRC Karawang']);
    expect(isPipelineDailySummaryEligible(filters)).toBe(true);
  });

  it('buildShipmentPipelineDailyFilterInput rejects card filters for daily eligibility', () => {
    const req = {
      query: { status: 'PLANNED', dateFrom: '2026-01-01' },
    } as Parameters<typeof buildShipmentPipelineDailyFilterInput>[0];
    expect(isPipelineDailySummaryEligible(buildShipmentPipelineDailyFilterInput(req))).toBe(false);
  });

  describe('loadShipmentSummaryBundle', () => {
    beforeEach(() => {
      invalidateShipmentsListCache();
      vi.mocked(isPipelineDailySummaryEligible).mockReturnValue(true);
      vi.mocked(loadShipmentSummaryFromDaily).mockReset();
    });

    it('uses daily summary without calling hybrid unplanned breakdown', async () => {
      vi.mocked(loadShipmentSummaryFromDaily).mockResolvedValue({
        summaryRow: { planned_count: 10, total_count: 20 },
        totalCount: 20,
        unplannedBreakdown: { contractRows: 3, shipmentRows: 2, totalTableRows: 5 },
      });
      const loadUnplannedBreakdown = vi.fn();
      const req = { query: { dateFrom: '2026-01-01', dateTo: '2026-06-30' } } as Parameters<
        typeof loadShipmentSummaryBundle
      >[0];

      const result = await loadShipmentSummaryBundle(req, {
        summaryCountQuery: 'SELECT 1',
        params: [],
        cacheKey: 'test-daily-bundle',
        loadUnplannedBreakdown,
      });

      expect(result.source).toBe('daily');
      expect(result.totalCount).toBe(20);
      expect(result.unplannedBreakdown.totalTableRows).toBe(5);
      expect(loadUnplannedBreakdown).not.toHaveBeenCalled();
      expect(loadShipmentSummaryFromDaily).toHaveBeenCalledOnce();
    });
  });
});
