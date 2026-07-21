import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { appendGroupPlantFilter, groupPlantExpr } from '../utils/groupPlantSql';
import {
  appendTruckingColumnFilters,
  appendTruckingGlobalSearch,
  appendTruckingLateIndicatorFilter,
  parseColumnFiltersQuery,
} from '../utils/truckingListFilters';
import {
  appendTruckingUnplannedBacklogColumnFilters,
  appendTruckingUnplannedBacklogGlobalSearch,
  buildTruckingUnplannedBacklogCountQuery,
  buildTruckingUnplannedContractToolbarScope,
} from '../utils/truckingUnplannedHybridSql';
import { deriveTruckingEffectiveStatus } from '../utils/truckingEffectiveStatus';
import {
  appendTruckingPipelineStageFilter,
  buildTruckingExpandedStatusFilterWhere,
  normalizeTruckingPagePipelineStageParam,
} from '../utils/truckingPagePipelineSql';
import { truckingPageListScopeWhereSql } from '../utils/truckingIncotermScope';
import { buildListOrderByWithSapStoPriority } from '../utils/listSapStoPrioritySql';
import { wrapTruckingListQueryWithStoExpansion, buildTruckingExpansionKeysCountSql } from '../utils/truckingListStoExpandSql';
import { ListCacheKeepWarm } from '../utils/listCacheKeepWarm';
import {
  buildTruckingExpansionKeyOrderBy,
  canUseTruckingStoKeyPaging,
} from '../utils/truckingListStoPaging';
import {
  buildTruckingListFromClause,
  buildTruckingListSelectClause,
  truckingListB2bExcludeSql,
} from '../utils/truckingListSelectSql';
import {
  buildTruckingOutstandingQtyBacklogAggregateQuery,
  buildTruckingOutstandingQtyExecutionAggregateQuery,
  mergeTruckingOutstandingQtySummaries,
  parseTruckingOutstandingQtySummaryRow,
  type TruckingOutstandingQtySummary,
} from '../utils/truckingOutstandingQtySummarySql';
import {
  isPipelineDailySummaryEligible,
  loadTruckingStagePageFromSnapshot,
  loadTruckingSummaryFromDaily,
  toPipelineDailySummaryScope,
  markPipelineDailySummaryStale,
  type PipelineDailySummaryFilterInput,
  type PipelineDailySummaryScope,
  isPipelineDailySummaryFresh,
} from './pipelineDailySummary.service';

/**
 * Trucking list API:
 * - Summary: SQL aggregate only (summaryOnly) — no full row scan
 * - Table page: DB pagination + optional SAP fields (skipSapJoin shell vs hydrate)
 */

export type TruckingListRow = Record<string, unknown>;

export interface TruckingListBuiltQuery {
  preOuterQuery: string;
  outerSql: string;
  innerParams: unknown[];
  outerParams: unknown[];
  skipSapJoin: boolean;
  cacheKey: string;
  filterCacheKey: string;
  /** Toolbar-only fast path: page expansion keys before full STO expansion. */
  usesStoKeyPaging?: boolean;
  expansionPaging?: { limit: number; offset: number; orderBySql: string };
  /** Resolve row stages from trucking_list_stage_snapshot (circles-consistent). */
  useStageSnapshot?: boolean;
}

export interface TruckingListResponseData {
  truckingOperations: TruckingListRow[];
  summary?: {
    total: number;
    status: {
      unplanned: number;
      planned: number;
      inProgress: number;
      loading: number;
      inTransit: number;
      unloading: number;
      completed: number;
      cancelled: number;
    };
    unplannedTable?: {
      contractRows: number;
      executionRows: number;
      totalTableRows: number;
    };
    outstandingQty?: TruckingOutstandingQtySummary;
  };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  unplannedBreakdown?: {
    contractRows: number;
    executionRows: number;
    totalTableRows: number;
  };
}

const PAGE_CACHE = new Map<string, { rows: TruckingListRow[]; total: number; expiresAt: number }>();
const COUNT_CACHE = new Map<string, { total: number; expiresAt: number }>();
const SUMMARY_CACHE = new Map<
  string,
  { summary: TruckingListResponseData['summary']; expiresAt: number }
>();
const MERGED_SUMMARY_CACHE = new Map<
  string,
  { summary: TruckingListResponseData['summary']; expiresAt: number }
>();
const UNPLANNED_BACKLOG_CACHE = new Map<string, { count: number; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 'trucking-list-v35';
const MAX_CACHE_ENTRIES = 80;

// Re-runs recent page loads in the background (refresh-ahead + re-warm after edits)
// so users are served from the cache instead of paying the full query cost. Does not
// change responses — it only re-runs the identical loader off the request path.
const PAGE_KEEP_WARM = new ListCacheKeepWarm({ cacheTtlMs: CACHE_TTL_MS });
// Status circles + Outstanding Qty strip: the merged summary's outstanding-qty pair is
// the heaviest cold cost on the page. Same registry pattern as PAGE_KEEP_WARM — it only
// re-runs the identical loader off the request path (refresh-ahead + after invalidation).
const SUMMARY_KEEP_WARM = new ListCacheKeepWarm({ cacheTtlMs: CACHE_TTL_MS, maxEntries: 4 });

const SORT_FIELD_BY_KEY: Record<string, string> = {
  created_at: 'created_at',
  operation_id: 'operation_id',
  status: 'status',
  contract_number: 'contract_number',
  po_number: 'po_number',
  sto_number: 'sto_number',
  supplier: 'supplier',
  trucking_owner: 'trucking_owner',
  loading_location: 'loading_location',
  unloading_location: 'unloading_location',
  trucking_start_date: 'trucking_start_date',
  trucking_completion_date: 'trucking_completion_date',
  delivery_start_date: 'delivery_start_date',
  delivery_end_date: 'delivery_end_date',
  quantity_delivered: 'quantity_delivered',
  quantity_receive: 'quantity_receive',
  outstanding_quantity: 'outstanding_quantity',
  outstanding_qty_mt: 'outstanding_quantity',
  quantity_sent: 'quantity_sent',
  contract_qty: 'contract_qty',
  incoterm: 'incoterm',
  oa_budget: 'oa_budget',
  oa_actual: 'oa_actual',
  gain_loss_percentage: 'gain_loss_percentage',
  gain_loss_amount: 'gain_loss_amount',
};

function stableColumnFiltersKey(colFilters: Record<string, unknown>): string {
  const keys = Object.keys(colFilters).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) norm[k] = colFilters[k];
  return JSON.stringify(norm);
}

function buildTruckingListCacheKey(input: {
  status?: unknown;
  location?: unknown;
  loadingLocation?: unknown;
  unloadingLocation?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  sto?: unknown;
  contract?: unknown;
  plants: string[];
  globalSearch: string;
  colFilters: Record<string, unknown>;
  lateIndicator?: string;
  skipSapJoin: boolean;
  page?: number;
  limit?: number;
  sortKey?: string;
  sortDir?: string;
}): string {
  const norm = {
    status: input.status != null ? String(input.status) : '',
    location: input.location != null ? String(input.location) : '',
    loadingLocation: input.loadingLocation != null ? String(input.loadingLocation) : '',
    unloadingLocation: input.unloadingLocation != null ? String(input.unloadingLocation) : '',
    dateFrom: input.dateFrom != null ? String(input.dateFrom) : '',
    dateTo: input.dateTo != null ? String(input.dateTo) : '',
    sto: input.sto != null ? String(input.sto) : '',
    contract: input.contract != null ? String(input.contract) : '',
    plants: [...input.plants].sort(),
    globalSearch: input.globalSearch,
    columnFilters: stableColumnFiltersKey(input.colFilters),
    lateIndicator: input.lateIndicator != null ? String(input.lateIndicator) : '',
    skipSapJoin: input.skipSapJoin,
    page: input.page ?? 1,
    limit: input.limit ?? 20,
    sortKey: input.sortKey ?? 'supplier',
    sortDir: input.sortDir ?? 'asc',
  };
  return `${CACHE_VERSION}:${JSON.stringify(norm)}`;
}

export function buildTruckingListFilterCacheKey(input: {
  status?: unknown;
  location?: unknown;
  loadingLocation?: unknown;
  unloadingLocation?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  sto?: unknown;
  contract?: unknown;
  plants: string[];
  globalSearch: string;
  colFilters: Record<string, unknown>;
  lateIndicator?: string;
}): string {
  return buildTruckingListCacheKey({
    ...input,
    skipSapJoin: false,
    page: 1,
    limit: 1,
    sortKey: 'created_at',
    sortDir: 'desc',
  });
}

export function buildTruckingListCountCacheKey(filterCacheKey: string): string {
  return `${filterCacheKey}:count`;
}

export function buildTruckingSummaryCacheKey(filterCacheKey: string): string {
  return `${filterCacheKey}:summary`;
}

function buildTruckingMergedSummaryCacheKey(filterCacheKey: string): string {
  // Status-card osStatus no longer scopes OS; one merged summary per toolbar filters.
  return `${filterCacheKey}:summary-unplanned-merged:active-os`;
}

function buildTruckingUnplannedBacklogCacheKey(req: AuthRequest): string {
  const { dateFrom, dateTo, contract, plant, search, columnFilters } = req.query as Record<
    string,
    unknown
  >;
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  return `${CACHE_VERSION}:trucking-unplanned-backlog:${JSON.stringify({
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    contract: contract ?? null,
    plants: [...plants].sort(),
    search: typeof search === 'string' ? search.trim() : '',
    columnFilters: columnFilters ?? null,
  })}`;
}

async function countTruckingUnplannedContractBacklogForRequest(req: AuthRequest): Promise<number> {
  const cacheKey = buildTruckingUnplannedBacklogCacheKey(req);
  const cached = UNPLANNED_BACKLOG_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.count;
  }
  if (cached) UNPLANNED_BACKLOG_CACHE.delete(cacheKey);

  const { dateFrom, dateTo, contract, plant } = req.query;
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  const scope = buildTruckingUnplannedContractToolbarScope({ dateFrom, dateTo, contract, plants });
  let idx = scope.params.length + 1;
  const g = appendTruckingUnplannedBacklogGlobalSearch(globalSearch, idx);
  idx = g.nextIndex;
  const c = appendTruckingUnplannedBacklogColumnFilters(colFilters, idx);
  const res = await query(
    buildTruckingUnplannedBacklogCountQuery(scope.sql, `${g.sql}${c.sql}`),
    [...scope.params, ...g.params, ...c.params],
  );
  const count = parseInt(String(res.rows[0]?.c ?? '0'), 10) || 0;
  UNPLANNED_BACKLOG_CACHE.set(cacheKey, { count, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(UNPLANNED_BACKLOG_CACHE, MAX_CACHE_ENTRIES);
  return count;
}

/**
 * Warm the default-scope merged summary (status circles + Outstanding Qty) at startup
 * so the first visitor after a deploy/restart is served from memory. Uses the exact
 * query params the Trucking page sends on first load (YTD in Asia/Jakarta — the user
 * base's timezone, so the cache key matches the browser's default date scope).
 * Best-effort: a failed warm just means the next request runs cold, as today.
 */
export function startTruckingListCacheWarmer(): void {
  const jakartaNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const dateTo = jakartaNow.toISOString().slice(0, 10);
  const dateFrom = `${dateTo.slice(0, 4)}-01-01`;
  const req = {
    query: {
      skipSapJoin: 'true',
      limit: '1',
      page: '1',
      sortKey: 'supplier',
      sortDir: 'asc',
      dateFrom,
      dateTo,
      summaryOnly: 'true',
    },
  } as unknown as AuthRequest;
  // Running the live loader also registers the key with SUMMARY_KEEP_WARM, so it stays
  // fresh via refresh-ahead while the page is in use.
  void resolveTruckingListForRequest(req).catch(() => {});
}

export function invalidateTruckingListCache(): void {
  PAGE_CACHE.clear();
  COUNT_CACHE.clear();
  SUMMARY_CACHE.clear();
  MERGED_SUMMARY_CACHE.clear();
  UNPLANNED_BACKLOG_CACHE.clear();
  markPipelineDailySummaryStale(['trucking']).catch(() => {});
  // Rebuild the recently used pages in the background so the next viewer after an
  // edit is served from memory instead of paying the full query cost.
  PAGE_KEEP_WARM.rewarmRecentlyUsed();
  SUMMARY_KEEP_WARM.rewarmRecentlyUsed();
}

function buildPipelineDailyFilterInput(req: AuthRequest): PipelineDailySummaryFilterInput {
  const {
    status,
    location,
    loadingLocation,
    unloadingLocation,
    dateFrom,
    dateTo,
    sto,
    contract,
    plant,
  } = req.query;
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const lateIndicatorParam = (req.query as { lateIndicator?: string }).lateIndicator;
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  return {
    dateFrom: dateFrom != null ? String(dateFrom) : undefined,
    dateTo: dateTo != null ? String(dateTo) : undefined,
    plants,
    globalSearch,
    colFilters,
    lateIndicator: lateIndicatorParam != null ? String(lateIndicatorParam) : undefined,
    status: status != null ? String(status) : undefined,
    sto: sto != null ? String(sto) : undefined,
    contract: contract != null ? String(contract) : undefined,
    location: location != null ? String(location) : undefined,
    loadingLocation: loadingLocation != null ? String(loadingLocation) : undefined,
    unloadingLocation: unloadingLocation != null ? String(unloadingLocation) : undefined,
  };
}

function evictMapIfNeeded(map: Map<string, { expiresAt: number }>, max: number): void {
  const now = Date.now();
  for (const [key, entry] of map.entries()) {
    if (entry.expiresAt <= now) map.delete(key);
  }
  if (map.size <= max) return;
  const sorted = [...map.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const removeCount = map.size - max;
  for (let i = 0; i < removeCount; i += 1) {
    map.delete(sorted[i][0]);
  }
}

function normalizeSortValue(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : s.toLowerCase();
  }
  const n = Number(s);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return n;
  return s.toLowerCase();
}

function compareSortValues(a: unknown, b: unknown, dir: 'ASC' | 'DESC'): number {
  const av = normalizeSortValue(a);
  const bv = normalizeSortValue(b);
  const aNull = av === null;
  const bNull = bv === null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let cmp = 0;
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return dir === 'ASC' ? cmp : -cmp;
}

export function sortTruckingListRows(
  rows: TruckingListRow[],
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  options?: { prioritizeSapSto?: boolean },
): TruckingListRow[] {
  const field = SORT_FIELD_BY_KEY[sortKey] || 'created_at';
  const prioritizeSapSto = options?.prioritizeSapSto === true;
  return [...rows].sort((a, b) => {
    if (prioritizeSapSto) {
      const aHasSto =
        String((a as TruckingListRow & { row_kind?: string }).row_kind ?? '').trim() !==
          'contract_backlog' &&
        Boolean(String(a.sto_number ?? '').trim()) &&
        String(a.sto_number ?? '').trim() !== '-';
      const bHasSto =
        String((b as TruckingListRow & { row_kind?: string }).row_kind ?? '').trim() !==
          'contract_backlog' &&
        Boolean(String(b.sto_number ?? '').trim()) &&
        String(b.sto_number ?? '').trim() !== '-';
      if (aHasSto !== bHasSto) return aHasSto ? -1 : 1;
    }
    const primary = compareSortValues(a[field], b[field], sortDir);
    if (primary !== 0) return primary;
    return compareSortValues(b.created_at, a.created_at, 'DESC');
  });
}

export function buildTruckingListSummaryFromRows(rows: TruckingListRow[]) {
  let unplanned = 0;
  let planned = 0;
  let inProgress = 0;
  let loading = 0;
  let inTransit = 0;
  let unloading = 0;
  let completed = 0;
  let cancelled = 0;

  for (const row of rows) {
    const effective =
      row.status != null && String(row.status).trim() !== ''
        ? String(row.status).trim().toUpperCase()
        : deriveTruckingEffectiveStatus(
            row.status_db,
            row.trucking_start_date,
            row.trucking_completion_date,
            {
              dailyDeliverables: row.daily_deliverables,
              stoNumber: row.sto_number ?? row.sto_numbers,
              contractImportStatus: row.contract_import_status,
              outstandingQtyKg:
                row.outstanding_quantity != null ? Number(row.outstanding_quantity) : null,
            },
          );

    if (effective === 'CANCELLED') {
      cancelled += 1;
      continue;
    }
    if (effective === 'COMPLETED') {
      completed += 1;
    } else if (effective === 'IN_PROGRESS') {
      inProgress += 1;
    } else if (effective === 'PLANNED') {
      planned += 1;
    } else if (effective === 'UNPLANNED') {
      unplanned += 1;
    } else {
      planned += 1;
    }

    const dbStatus = String(row.status_db ?? row.status ?? '').toUpperCase();
    if (dbStatus === 'LOADING') loading += 1;
    if (dbStatus === 'IN_TRANSIT') inTransit += 1;
    if (dbStatus === 'UNLOADING') unloading += 1;
  }

  return {
    total: rows.length,
    status: {
      unplanned,
      planned,
      inProgress,
      loading,
      inTransit,
      unloading,
      completed,
      cancelled,
    },
  };
}

export function buildTruckingSummaryFromSqlRow(row: Record<string, unknown>) {
  const total = parseInt(String(row.total_count ?? '0'), 10) || 0;
  return {
    total,
    status: {
      unplanned: Number(row.unplanned_count || 0),
      planned: Number(row.planned_count || 0),
      inProgress: Number(row.in_progress_count || 0),
      loading: Number(row.loading_count || 0),
      inTransit: Number(row.in_transit_count || 0),
      unloading: Number(row.unloading_count || 0),
      completed: Number(row.completed_count || 0),
      cancelled: Number(row.cancelled_count || 0),
    },
  };
}

/** Align Section 2 Unplanned card with hybrid table row total. */
export function mergeTruckingUnplannedBreakdownIntoSummary(
  summary: TruckingListResponseData['summary'],
  breakdown: {
    contractRows: number;
    executionRows: number;
    totalTableRows: number;
  },
): TruckingListResponseData['summary'] {
  if (!summary) return summary;
  return {
    ...summary,
    status: {
      ...summary.status,
      unplanned: breakdown.totalTableRows,
    },
    unplannedTable: {
      contractRows: breakdown.contractRows,
      executionRows: breakdown.executionRows,
      totalTableRows: breakdown.totalTableRows,
    },
  };
}

export function buildTruckingListQuery(
  req: AuthRequest,
  options?: { skipSapJoin?: boolean; omitStatusFilter?: boolean },
): TruckingListBuiltQuery {
  const {
    status,
    location,
    loadingLocation,
    unloadingLocation,
    dateFrom,
    dateTo,
    sto,
    contract,
    plant,
    page = 1,
    limit = 20,
  } = req.query;
  const skipSapJoin =
    options?.skipSapJoin ??
    String((req.query as { skipSapJoin?: string }).skipSapJoin || '').toLowerCase() === 'true';
  const sortKey = String((req.query as { sortKey?: string }).sortKey || 'supplier');
  const sortDirRaw = String((req.query as { sortDir?: string }).sortDir || 'asc').toLowerCase();
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const lateIndicatorParam = (req.query as { lateIndicator?: string }).lateIndicator;

  let queryText = `
      SELECT 
        ${buildTruckingListSelectClause(skipSapJoin)}
      ${buildTruckingListFromClause(skipSapJoin)}
      WHERE 1=1
        ${truckingListB2bExcludeSql(skipSapJoin)}
        ${truckingPageListScopeWhereSql}
    `;

  const queryParams: unknown[] = [];
  let paramIndex = 1;

  const truckingStoExprForStatus = skipSapJoin
    ? `NULLIF(TRIM(c.sto_number::text), '')`
    : `NULLIF(TRIM(COALESCE(NULLIF(TRIM(c.sto_number::text), ''), sa.sto_numbers)), '')`;

  if (status && !options?.omitStatusFilter) {
    const stageFilter = appendTruckingPipelineStageFilter(
      String(status),
      truckingStoExprForStatus,
      paramIndex,
    );
    queryText += stageFilter.sql;
    queryParams.push(...stageFilter.params);
    paramIndex = stageFilter.nextIndex;
  }

  if (location) {
    queryText += ` AND t.location ILIKE $${paramIndex}`;
    queryParams.push(`%${location}%`);
    paramIndex += 1;
  }

  if (loadingLocation) {
    queryText += ` AND t.loading_location ILIKE $${paramIndex}`;
    queryParams.push(`%${loadingLocation}%`);
    paramIndex += 1;
  }

  if (unloadingLocation) {
    queryText += ` AND t.unloading_location ILIKE $${paramIndex}`;
    queryParams.push(`%${unloadingLocation}%`);
    paramIndex += 1;
  }

  if (dateFrom) {
    queryText += ` AND c.contract_date >= $${paramIndex}`;
    queryParams.push(dateFrom);
    paramIndex += 1;
  }

  if (dateTo) {
    queryText += ` AND c.contract_date <= $${paramIndex}`;
    queryParams.push(dateTo);
    paramIndex += 1;
  }

  if (sto) {
    queryText += ` AND (
        TRIM(COALESCE(c.sto_number::text, '')) = TRIM($${paramIndex}::text)
        OR EXISTS (
          SELECT 1 FROM contract_stos cs
          WHERE cs.contract_id = c.id AND TRIM(cs.sto_number::text) = TRIM($${paramIndex}::text)
        )
        OR EXISTS (
          SELECT 1 FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no'
            )) = TRIM($${paramIndex}::text)
        )
      )`;
    queryParams.push(sto);
    paramIndex += 1;
  }

  if (contract) {
    queryText += ` AND c.contract_id = $${paramIndex}`;
    queryParams.push(contract);
    paramIndex += 1;
  }

  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  const groupPlantFilter = appendGroupPlantFilter(
    plants,
    paramIndex,
    groupPlantExpr('c.plant_code', 'c.company_name'),
    'c.plant_code',
  );
  queryText += groupPlantFilter.sql;
  queryParams.push(...groupPlantFilter.params);
  paramIndex = groupPlantFilter.nextIndex;

  const innerParams = [...queryParams];
  const outerStart = paramIndex;

  let fp = outerStart;
  const gSearch = appendTruckingGlobalSearch(globalSearch, fp);
  fp = gSearch.nextIndex;
  const cCol = appendTruckingColumnFilters(colFilters, fp);
  fp = cCol.nextIndex;
  const li = appendTruckingLateIndicatorFilter(lateIndicatorParam, fp);
  fp = li.nextIndex;

  const outerSql = `${gSearch.sql}${cCol.sql}${li.sql}`;
  const outerParams = [...gSearch.params, ...cCol.params, ...li.params];

  const filterCacheKey = buildTruckingListFilterCacheKey({
    status,
    location,
    loadingLocation,
    unloadingLocation,
    dateFrom,
    dateTo,
    sto,
    contract,
    plants,
    globalSearch,
    colFilters,
    lateIndicator: lateIndicatorParam,
  });

  const cacheKey = buildTruckingListCacheKey({
    status,
    location,
    loadingLocation,
    unloadingLocation,
    dateFrom,
    dateTo,
    sto,
    contract,
    plants,
    globalSearch,
    colFilters,
    lateIndicator: lateIndicatorParam,
    skipSapJoin,
    page: Number(page),
    limit: Number(limit),
    sortKey,
    sortDir: sortDirRaw,
  });

  return {
    preOuterQuery: queryText,
    outerSql,
    innerParams,
    outerParams,
    skipSapJoin,
    cacheKey,
    filterCacheKey,
  };
}

export function buildTruckingSummaryQuery(built: TruckingListBuiltQuery): { text: string; params: unknown[] } {
  const innerSql = `${built.preOuterQuery}${built.outerSql}`;
  const expanded = wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: true,
    skipSapJoin: built.skipSapJoin,
  });
  const text = `
      WITH filtered AS (
        SELECT
          status,
          status_db,
          contract_number,
          trucking_start_date,
          trucking_completion_date
        FROM (
          ${expanded}
        ) trucking_source
      )
      SELECT
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE status = 'UNPLANNED')::bigint AS unplanned_count,
        COUNT(*) FILTER (WHERE status = 'PLANNED')::bigint AS planned_count,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint AS in_progress_count,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled_count,
        COUNT(*) FILTER (WHERE status_db = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE status_db = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE status_db = 'UNLOADING')::bigint AS unloading_count
      FROM filtered`;
  return { text, params: [...built.innerParams, ...built.outerParams] };
}

function buildTruckingFilteredExpansionSql(built: TruckingListBuiltQuery): string {
  const innerSql = `${built.preOuterQuery}${built.outerSql}`;
  return wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: !built.skipSapJoin,
    skipSapJoin: built.skipSapJoin,
    useStageSnapshot: built.useStageSnapshot === true,
    expansionPaging: built.expansionPaging,
  });
}

function buildTruckingExpansionKeysCountQuery(built: TruckingListBuiltQuery): { text: string; params: unknown[] } {
  const innerSql = `${built.preOuterQuery}${built.outerSql}`;
  return {
    text: buildTruckingExpansionKeysCountSql(innerSql, built.skipSapJoin),
    params: [...built.innerParams, ...built.outerParams],
  };
}

export function buildPaginatedListQuery(
  built: TruckingListBuiltQuery,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  limit: number,
  offset: number,
  stageFilter?: string | null,
): { text: string; params: unknown[] } {
  const field = SORT_FIELD_BY_KEY[sortKey] || 'created_at';
  const baseParams = [...built.innerParams, ...built.outerParams];
  const stageScoped = buildTruckingExpandedStatusFilterWhere(
    'tf.status',
    stageFilter,
    baseParams.length + 1,
  );
  const stageWhereSql = stageScoped.sql;
  const listParams =
    stageScoped.params.length > 0 ? [...baseParams, ...stageScoped.params] : [...baseParams];
  const limitIdx = listParams.length + 1;
  const offsetIdx = listParams.length + 2;
  const expanded = buildTruckingFilteredExpansionSql(built);
  const orderBy = buildListOrderByWithSapStoPriority(
    'tf.sto_number',
    `${field} ${sortDir} NULLS LAST, created_at DESC`,
    normalizeTruckingPagePipelineStageParam(stageFilter ?? undefined) ?? stageFilter,
  );
  const truckingPageCte = built.usesStoKeyPaging
    ? `trucking_page AS (
        SELECT tf.*
        FROM trucking_status_scoped tf
        ORDER BY ${orderBy}
      )`
    : `trucking_page AS (
        SELECT
          tf.*,
          (SELECT COUNT(*)::bigint FROM trucking_status_scoped) AS __filter_total
        FROM trucking_status_scoped tf
        ORDER BY ${orderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      )`;
  const text = `
      WITH trucking_filtered AS (
        SELECT * FROM (
          ${expanded}
        ) expanded_sub
      ),
      trucking_status_scoped AS (
        SELECT tf.*
        FROM trucking_filtered tf${stageWhereSql}
      ),
      ${truckingPageCte}
      SELECT * FROM trucking_page`;
  return {
    text,
    params: built.usesStoKeyPaging ? listParams : [...listParams, limit, offset],
  };
}

/** Page rows only — caller supplies total from COUNT_CACHE or a follow-up count query. */
export function buildTruckingListPageQueryWithoutInlineCount(
  built: TruckingListBuiltQuery,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  limit: number,
  offset: number,
  stageFilter?: string | null,
): { text: string; params: unknown[] } {
  const field = SORT_FIELD_BY_KEY[sortKey] || 'created_at';
  const baseParams = [...built.innerParams, ...built.outerParams];
  const stageScoped = buildTruckingExpandedStatusFilterWhere(
    'tf.status',
    stageFilter,
    baseParams.length + 1,
  );
  const stageWhereSql = stageScoped.sql;
  const listParams =
    stageScoped.params.length > 0 ? [...baseParams, ...stageScoped.params] : [...baseParams];
  const limitIdx = listParams.length + 1;
  const offsetIdx = listParams.length + 2;
  const expanded = buildTruckingFilteredExpansionSql(built);
  const orderBy = buildListOrderByWithSapStoPriority(
    'tf.sto_number',
    `${field} ${sortDir} NULLS LAST, created_at DESC`,
    normalizeTruckingPagePipelineStageParam(stageFilter ?? undefined) ?? stageFilter,
  );
  const truckingPageCte = built.usesStoKeyPaging
    ? `trucking_page AS (
        SELECT tf.*
        FROM trucking_status_scoped tf
        ORDER BY ${orderBy}
      )`
    : `trucking_page AS (
        SELECT tf.*
        FROM trucking_status_scoped tf
        ORDER BY ${orderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      )`;
  const text = `
      WITH trucking_filtered AS (
        SELECT * FROM (
          ${expanded}
        ) expanded_sub
      ),
      trucking_status_scoped AS (
        SELECT tf.*
        FROM trucking_filtered tf${stageWhereSql}
      ),
      ${truckingPageCte}
      SELECT * FROM trucking_page`;
  return {
    text,
    params: built.usesStoKeyPaging ? listParams : [...listParams, limit, offset],
  };
}

function buildFilteredCountQuery(
  built: TruckingListBuiltQuery,
  stageFilter?: string | null,
): { text: string; params: unknown[] } {
  if (built.usesStoKeyPaging) {
    return buildTruckingExpansionKeysCountQuery(built);
  }
  const expanded = buildTruckingFilteredExpansionSql(built);
  const baseParams = [...built.innerParams, ...built.outerParams];
  const stageScoped = buildTruckingExpandedStatusFilterWhere(
    'tf.status',
    stageFilter,
    baseParams.length + 1,
  );
  const stageWhereSql = stageScoped.sql;
  const text = `
      WITH trucking_filtered AS (
        SELECT * FROM (
          ${expanded}
        ) expanded_sub
      )
      SELECT COUNT(*)::bigint AS c
      FROM trucking_filtered tf${stageWhereSql}`;
  return {
    text,
    params:
      stageScoped.params.length > 0 ? [...baseParams, ...stageScoped.params] : baseParams,
  };
}

function normalizeTruckingListRows(rows: TruckingListRow[]): TruckingListRow[] {
  for (const row of rows) {
    delete (row as { __filter_total?: unknown }).__filter_total;
  }
  return rows;
}

function cacheFilteredTotal(filterCacheKey: string, total: number): void {
  COUNT_CACHE.set(buildTruckingListCountCacheKey(filterCacheKey), {
    total,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  evictMapIfNeeded(COUNT_CACHE, MAX_CACHE_ENTRIES);
}

/** Reuse filtered total from a recent list request (same toolbar scope). */
export function getCachedFilteredTotal(filterCacheKey: string): number | null {
  const key = buildTruckingListCountCacheKey(filterCacheKey);
  const cached = COUNT_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.total;
  if (cached) COUNT_CACHE.delete(key);
  return null;
}

export async function loadTruckingListSummary(
  built: TruckingListBuiltQuery,
  req?: AuthRequest,
): Promise<TruckingListResponseData['summary']> {
  const summaryCacheKey = buildTruckingSummaryCacheKey(built.filterCacheKey);
  const cached = SUMMARY_CACHE.get(summaryCacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.summary;
  }
  if (cached) SUMMARY_CACHE.delete(summaryCacheKey);

  if (req) {
    const filters = buildPipelineDailyFilterInput(req);
    if (isPipelineDailySummaryEligible(filters)) {
      const fromDaily = await loadTruckingSummaryFromDaily(toPipelineDailySummaryScope(filters));
      if (fromDaily) {
        SUMMARY_CACHE.set(summaryCacheKey, {
          summary: fromDaily,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        evictMapIfNeeded(SUMMARY_CACHE, MAX_CACHE_ENTRIES);
        return fromDaily;
      }
    }
  }

  const { text, params } = buildTruckingSummaryQuery(built);
  const summaryResult = await query(text, params);
  const summary = buildTruckingSummaryFromSqlRow((summaryResult.rows[0] || {}) as Record<string, unknown>);
  SUMMARY_CACHE.set(summaryCacheKey, { summary, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(SUMMARY_CACHE, MAX_CACHE_ENTRIES);
  return summary;
}

async function loadTruckingOutstandingQtyForRequest(
  req: AuthRequest,
  built: TruckingListBuiltQuery,
): Promise<TruckingOutstandingQtySummary> {
  const executionBuilt: TruckingListBuiltQuery = {
    ...built,
    skipSapJoin: false,
  };
  // Always Unplanned + Planned + In Progress (ignore status-card osStatus).
  const execQ = buildTruckingOutstandingQtyExecutionAggregateQuery(executionBuilt, null);
  const execPromise = query(execQ.text, execQ.params).then((res) =>
    parseTruckingOutstandingQtySummaryRow((res.rows[0] || {}) as Record<string, unknown>),
  );

  const { dateFrom, dateTo, contract, plant } = req.query;
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  const scope = buildTruckingUnplannedContractToolbarScope({ dateFrom, dateTo, contract, plants });
  let idx = scope.params.length + 1;
  const g = appendTruckingUnplannedBacklogGlobalSearch(globalSearch, idx);
  idx = g.nextIndex;
  const c = appendTruckingUnplannedBacklogColumnFilters(colFilters, idx);
  const backlogText = buildTruckingOutstandingQtyBacklogAggregateQuery(
    scope.sql,
    `${g.sql}${c.sql}`,
  );
  const backlogParams = [...scope.params, ...g.params, ...c.params];

  const [execution, backlog] = await Promise.all([
    execPromise,
    query(backlogText, backlogParams).then((res) =>
      parseTruckingOutstandingQtySummaryRow((res.rows[0] || {}) as Record<string, unknown>),
    ),
  ]);
  return mergeTruckingOutstandingQtySummaries(execution, backlog);
}

export async function loadTruckingListSummaryWithBacklog(
  req: AuthRequest,
  built: TruckingListBuiltQuery,
): Promise<TruckingListResponseData['summary']> {
  const mergedCacheKey = buildTruckingMergedSummaryCacheKey(built.filterCacheKey);
  const cachedMerged = MERGED_SUMMARY_CACHE.get(mergedCacheKey);
  if (cachedMerged && Date.now() < cachedMerged.expiresAt) {
    SUMMARY_KEEP_WARM.touch(mergedCacheKey);
    return cachedMerged.summary;
  }
  if (cachedMerged) MERGED_SUMMARY_CACHE.delete(mergedCacheKey);

  const liveLoadStartedAt = Date.now();
  // Registered after a live load so refresh-ahead / invalidation re-runs the identical
  // loader (same req.query scope, same built query) off the request path.
  const registerKeepWarm = () => {
    SUMMARY_KEEP_WARM.register(
      mergedCacheKey,
      async () => {
        MERGED_SUMMARY_CACHE.delete(mergedCacheKey);
        await loadTruckingListSummaryWithBacklog(req, built);
      },
      Date.now() - liveLoadStartedAt,
    );
  };

  const outstandingQtyPromise = loadTruckingOutstandingQtyForRequest(req, built);

  const filters = buildPipelineDailyFilterInput(req);
  if (isPipelineDailySummaryEligible(filters)) {
    const fromDaily = await loadTruckingSummaryFromDaily(toPipelineDailySummaryScope(filters));
    if (fromDaily) {
      const outstandingQty = await outstandingQtyPromise;
      const merged: NonNullable<TruckingListResponseData['summary']> = {
        ...fromDaily,
        outstandingQty,
      };
      MERGED_SUMMARY_CACHE.set(mergedCacheKey, {
        summary: merged,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      evictMapIfNeeded(MERGED_SUMMARY_CACHE, MAX_CACHE_ENTRIES);
      registerKeepWarm();
      return merged;
    }
  }

  const [base, contractRows, outstandingQty] = await Promise.all([
    loadTruckingListSummary(built, req),
    countTruckingUnplannedContractBacklogForRequest(req),
    outstandingQtyPromise,
  ]);
  if (!base) return base;

  const executionRows = base.status?.unplanned ?? 0;
  const merged = mergeTruckingUnplannedBreakdownIntoSummary(base, {
    contractRows,
    executionRows,
    totalTableRows: contractRows + executionRows,
  });
  if (!merged) return base;
  const withOs: NonNullable<TruckingListResponseData['summary']> = {
    ...merged,
    outstandingQty,
  };
  MERGED_SUMMARY_CACHE.set(mergedCacheKey, {
    summary: withOs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  evictMapIfNeeded(MERGED_SUMMARY_CACHE, MAX_CACHE_ENTRIES);
  registerKeepWarm();
  return withOs;
}

async function loadTruckingListPage(
  built: TruckingListBuiltQuery,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  page: number,
  limit: number,
  stageFilter?: string | null,
): Promise<{ rows: TruckingListRow[]; total: number }> {
  const cached = PAGE_CACHE.get(built.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { rows: cached.rows, total: cached.total };
  }
  if (cached) PAGE_CACHE.delete(built.cacheKey);

  const offset = (page - 1) * limit;
  const cachedTotal = getCachedFilteredTotal(built.filterCacheKey);
  const { text, params } =
    cachedTotal != null
      ? buildTruckingListPageQueryWithoutInlineCount(built, sortKey, sortDir, limit, offset, stageFilter)
      : buildPaginatedListQuery(built, sortKey, sortDir, limit, offset, stageFilter);
  const result = await query(text, params);

  let total = cachedTotal ?? 0;
  if (cachedTotal == null) {
    if (result.rows.length > 0) {
      const raw = (result.rows[0] as { __filter_total?: unknown }).__filter_total;
      total = parseInt(String(raw ?? '0'), 10) || 0;
    } else {
      const { text: countText, params: countParams } = buildFilteredCountQuery(built, stageFilter);
      const countRes = await query(countText, countParams);
      total = parseInt(String(countRes.rows[0]?.c ?? '0'), 10) || 0;
    }
    cacheFilteredTotal(built.filterCacheKey, total);
  }
  const rows = normalizeTruckingListRows(result.rows as TruckingListRow[]);

  PAGE_CACHE.set(built.cacheKey, { rows, total, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(PAGE_CACHE, MAX_CACHE_ENTRIES);
  // Remember how to re-run this exact load so the background warmer can refresh it
  // ahead of expiry / after invalidation. `built` is a plain built query context.
  PAGE_KEEP_WARM.register(built.cacheKey, async () => {
    PAGE_CACHE.delete(built.cacheKey);
    COUNT_CACHE.delete(built.filterCacheKey);
    await loadTruckingListPage(built, sortKey, sortDir, page, limit, stageFilter);
  });
  return { rows, total };
}

/**
 * Status-card page served from the stage snapshot: row keys + total come from the
 * same daily refresh that computes the circles, so the filtered table total always
 * equals the clicked circle; only the visible page is enriched (full expansion).
 */
async function loadTruckingStageSnapshotPage(
  built: TruckingListBuiltQuery,
  scope: PipelineDailySummaryScope,
  stage: string,
  sortDir: 'ASC' | 'DESC',
  page: number,
  limit: number,
): Promise<{ rows: TruckingListRow[]; total: number } | null> {
  const cached = PAGE_CACHE.get(built.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { rows: cached.rows, total: cached.total };
  }
  if (cached) PAGE_CACHE.delete(built.cacheKey);

  const snapshotPage = await loadTruckingStagePageFromSnapshot(
    scope,
    stage,
    sortDir,
    limit,
    (page - 1) * limit,
  );
  if (!snapshotPage) return null;

  let rows: TruckingListRow[] = [];
  if (snapshotPage.keys.length > 0) {
    // Full-variant expansion restricted to the page keys (SAP-derived quantities so
    // row fields match what the circles were computed from).
    const expanded = wrapTruckingListQueryWithStoExpansion(
      `${built.preOuterQuery}${built.outerSql}`,
      {
        selectOutstanding: true,
        skipSapJoin: false,
        useStageSnapshot: true,
        resolvedExpansionKeys: snapshotPage.keys,
      },
    );
    const orderBy = buildListOrderByWithSapStoPriority(
      'tf.sto_number',
      `${SORT_FIELD_BY_KEY['supplier'] || 'supplier'} ${sortDir} NULLS LAST, created_at DESC`,
      stage,
    );
    const text = `
      WITH trucking_filtered AS (
        SELECT * FROM (
          ${expanded}
        ) expanded_sub
      )
      SELECT tf.* FROM trucking_filtered tf
      ORDER BY ${orderBy}`;
    const result = await query(text, [...built.innerParams, ...built.outerParams]);
    rows = normalizeTruckingListRows(result.rows as TruckingListRow[]);
  }

  const total = snapshotPage.total;
  cacheFilteredTotal(built.filterCacheKey, total);
  PAGE_CACHE.set(built.cacheKey, { rows, total, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(PAGE_CACHE, MAX_CACHE_ENTRIES);
  PAGE_KEEP_WARM.register(built.cacheKey, async () => {
    PAGE_CACHE.delete(built.cacheKey);
    COUNT_CACHE.delete(built.filterCacheKey);
    await loadTruckingStageSnapshotPage(built, scope, stage, sortDir, page, limit);
  });
  return { rows, total };
}

export async function resolveTruckingListForRequest(req: AuthRequest): Promise<TruckingListResponseData> {
  const { page = 1, limit = 20, status } = req.query;
  const summaryOnly =
    String((req.query as { summaryOnly?: string }).summaryOnly || '').toLowerCase() === 'true';
  const sortKey = String((req.query as { sortKey?: string }).sortKey || 'supplier');
  const sortDirRaw = String((req.query as { sortDir?: string }).sortDir || 'asc').toLowerCase();
  const sortDir: 'ASC' | 'DESC' = sortDirRaw === 'asc' ? 'ASC' : 'DESC';

  const stageFilter = typeof status === 'string' ? status : undefined;
  const isUnplannedHybrid = String(status ?? '').trim().toUpperCase() === 'UNPLANNED';
  /** Status cards need full SAP (GR/OS) — same path as Section 1 summary. */
  const statusScopedList =
    Boolean(stageFilter) &&
    !isUnplannedHybrid &&
    String(stageFilter).trim().toUpperCase() !== 'ALL';

  // Pipeline status is computed per operation (PO grain) — filter only after expansion.
  // Status-scoped requests force the full SAP variant (circle-consistent fallback).
  const built = buildTruckingListQuery(req, {
    omitStatusFilter: true,
    ...(statusScopedList ? { skipSapJoin: false } : {}),
  });
  // Resolve row stages from the daily-refresh snapshot when it is fresh so status
  // clicks are served in ~2s from the same source as the circles; when stale, the
  // full-SAP path above still keeps the totals circle-consistent (just slower).
  const useStageSnapshot = await isPipelineDailySummaryFresh('trucking');
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));

  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const lateIndicatorParam = (req.query as { lateIndicator?: string }).lateIndicator;
  const { location, loadingLocation, unloadingLocation, sto, contract } = req.query;

  const listUsesStoPaging = canUseTruckingStoKeyPaging({
    summaryOnly,
    stoIsSet: Boolean(sto),
    contractIsSet: Boolean(contract),
    status: typeof status === 'string' ? status : 'ALL',
    location: typeof location === 'string' ? location : undefined,
    loadingLocation: typeof loadingLocation === 'string' ? loadingLocation : undefined,
    unloadingLocation: typeof unloadingLocation === 'string' ? unloadingLocation : undefined,
    lateIndicator: lateIndicatorParam,
    globalSearch,
    colFilters,
    unplannedHybrid: isUnplannedHybrid,
  });

  const listBuilt: TruckingListBuiltQuery = {
    ...built,
    useStageSnapshot,
    cacheKey: `${built.cacheKey}:stagesnap=${useStageSnapshot ? 1 : 0}`,
    filterCacheKey: `${built.filterCacheKey}:sap=${built.skipSapJoin ? 0 : 1}:stagesnap=${useStageSnapshot ? 1 : 0}`,
    usesStoKeyPaging: listUsesStoPaging,
    expansionPaging: listUsesStoPaging
      ? {
          limit: limitNum,
          offset: (pageNum - 1) * limitNum,
          orderBySql: buildTruckingExpansionKeyOrderBy(sortKey, sortDir, stageFilter),
        }
      : undefined,
  };

  const includeSummary =
    String((req.query as { includeSummary?: string }).includeSummary ?? 'true').toLowerCase() !== 'false';

  const summaryBuilt: TruckingListBuiltQuery = {
    ...buildTruckingListQuery(req, {
      skipSapJoin: false,
      omitStatusFilter: true,
    }),
    useStageSnapshot,
  };

  if (summaryOnly) {
    const summary = await loadTruckingListSummaryWithBacklog(req, summaryBuilt);
    return {
      truckingOperations: [],
      summary,
      pagination: {
        total: summary?.total ?? 0,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil((summary?.total ?? 0) / limitNum) || 0,
      },
    };
  }

  if (isUnplannedHybrid) {
    const {
      buildTruckingUnplannedHybridContext,
      resolveTruckingUnplannedHybridList,
    } = await import('./truckingUnplannedHybridList.service');
    const ctx = buildTruckingUnplannedHybridContext(req, sortKey, sortDir, {
      executionBuilt: listBuilt,
    });
    const hybrid = await resolveTruckingUnplannedHybridList(req, ctx);
    let summary: TruckingListResponseData['summary'];
    if (includeSummary) {
      summary = await loadTruckingListSummary(summaryBuilt, req);
      summary = mergeTruckingUnplannedBreakdownIntoSummary(summary, hybrid.unplannedBreakdown);
    }
    return {
      truckingOperations: hybrid.truckingOperations,
      unplannedBreakdown: hybrid.unplannedBreakdown,
      summary,
      pagination: hybrid.pagination,
    };
  }

  // Request-path access only (the background refresher must not keep itself alive).
  PAGE_KEEP_WARM.touch(listBuilt.cacheKey);

  // Status-card clicks: serve keys + total from the stage snapshot so the filtered
  // table always equals the circle the user clicked. Applies to toolbar-only scope
  // with the default sort; anything else (or a stale snapshot) uses the live path.
  let snapshotServed: { rows: TruckingListRow[]; total: number } | null = null;
  const normalizedStageForSnapshot = normalizeTruckingPagePipelineStageParam(stageFilter);
  if (
    useStageSnapshot &&
    normalizedStageForSnapshot &&
    !isUnplannedHybrid &&
    sortKey === 'supplier' &&
    !listUsesStoPaging
  ) {
    const dailyFilters = buildPipelineDailyFilterInput(req);
    if (isPipelineDailySummaryEligible({ ...dailyFilters, status: 'ALL' })) {
      snapshotServed = await loadTruckingStageSnapshotPage(
        listBuilt,
        toPipelineDailySummaryScope(dailyFilters),
        normalizedStageForSnapshot,
        sortDir,
        pageNum,
        limitNum,
      );
    }
  }

  const { rows, total } =
    snapshotServed ??
    (await loadTruckingListPage(listBuilt, sortKey, sortDir, pageNum, limitNum, stageFilter));

  let summary: TruckingListResponseData['summary'];
  if (includeSummary) {
    summary = await loadTruckingListSummaryWithBacklog(req, summaryBuilt);
  }

  return {
    truckingOperations: rows,
    summary,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    },
  };
}
