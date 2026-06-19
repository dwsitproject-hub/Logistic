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
  sqlEffectiveTruckingCompletionDate,
  sqlEffectiveTruckingStartDate,
} from '../utils/truckingSapDates';
import { truckingPageListScopeWhereSql } from '../utils/truckingStoTypeSql';
import {
  buildTruckingListFromClause,
  buildTruckingListSelectClause,
} from '../utils/truckingListSelectSql';

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
}

export interface TruckingListResponseData {
  truckingOperations: TruckingListRow[];
  summary?: {
    total: number;
    status: {
      planned: number;
      inProgress: number;
      loading: number;
      inTransit: number;
      unloading: number;
      completed: number;
      cancelled: number;
    };
  };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const PAGE_CACHE = new Map<string, { rows: TruckingListRow[]; total: number; expiresAt: number }>();
const COUNT_CACHE = new Map<string, { total: number; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 'trucking-list-v4';
const MAX_CACHE_ENTRIES = 80;

const SORT_FIELD_BY_KEY: Record<string, string> = {
  created_at: 'created_at',
  operation_id: 'operation_id',
  status: 'status',
  contract_number: 'contract_number',
  po_number: 'po_number',
  sto_number: 'sto_number',
  trucking_owner: 'trucking_owner',
  loading_location: 'loading_location',
  unloading_location: 'unloading_location',
  trucking_start_date: 'trucking_start_date',
  trucking_completion_date: 'trucking_completion_date',
  delivery_start_date: 'delivery_start_date',
  delivery_end_date: 'delivery_end_date',
  quantity_delivered: 'quantity_delivered',
  quantity_sent: 'quantity_sent',
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
    sortKey: input.sortKey ?? 'created_at',
    sortDir: input.sortDir ?? 'desc',
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

export function invalidateTruckingListCache(): void {
  PAGE_CACHE.clear();
  COUNT_CACHE.clear();
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
): TruckingListRow[] {
  const field = SORT_FIELD_BY_KEY[sortKey] || 'created_at';
  return [...rows].sort((a, b) => {
    const primary = compareSortValues(a[field], b[field], sortDir);
    if (primary !== 0) return primary;
    return compareSortValues(b.created_at, a.created_at, 'DESC');
  });
}

function hasDateValue(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

/** Mirrors SQL COUNT(*) FILTER (...) aggregates on the list subquery. */
export function buildTruckingListSummaryFromRows(rows: TruckingListRow[]) {
  let planned = 0;
  let inProgress = 0;
  let loading = 0;
  let inTransit = 0;
  let unloading = 0;
  let completed = 0;
  let cancelled = 0;

  for (const row of rows) {
    const status = String(row.status ?? '');
    const isCancelled = status === 'CANCELLED';
    const truckingStart = row.trucking_start_date;
    const truckingCompletion = row.trucking_completion_date;

    if (isCancelled) {
      cancelled += 1;
      continue;
    }

    // Match list SQL filters (sqlEffectiveTruckingStartDate / sqlEffectiveTruckingCompletionDate):
    // PLANNED = no start & no completion; IN_PROGRESS = start only; COMPLETED = completion set.
    if (hasDateValue(truckingCompletion)) {
      completed += 1;
    } else if (hasDateValue(truckingStart)) {
      inProgress += 1;
    } else {
      planned += 1;
    }

    if (status === 'LOADING') loading += 1;
    if (status === 'IN_TRANSIT') inTransit += 1;
    if (status === 'UNLOADING') unloading += 1;
  }

  return {
    total: rows.length,
    status: {
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

export function buildTruckingListQuery(
  req: AuthRequest,
  options?: { skipSapJoin?: boolean },
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
  const sortKey = String((req.query as { sortKey?: string }).sortKey || 'created_at');
  const sortDirRaw = String((req.query as { sortDir?: string }).sortDir || 'desc').toLowerCase();
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
        AND NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(b2b.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
          AND NULLIF(TRIM(COALESCE(b2b.contract_reference_po_raw, '')), '') IS NOT NULL
        )
        ${truckingPageListScopeWhereSql}
    `;

  const queryParams: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    const s = String(status).toUpperCase();
    if (s === 'COMPLETED') {
      queryText += ` AND COALESCE(t.status, '') <> 'CANCELLED' AND ${sqlEffectiveTruckingCompletionDate('c')} IS NOT NULL`;
    } else if (s === 'IN_PROGRESS') {
      queryText += ` AND COALESCE(t.status, '') <> 'CANCELLED' AND ${sqlEffectiveTruckingCompletionDate('c')} IS NULL AND ${sqlEffectiveTruckingStartDate('c')} IS NOT NULL`;
    } else if (s === 'PLANNED') {
      queryText += ` AND COALESCE(t.status, '') <> 'CANCELLED' AND ${sqlEffectiveTruckingCompletionDate('c')} IS NULL AND ${sqlEffectiveTruckingStartDate('c')} IS NULL`;
    } else {
      queryText += ` AND t.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex += 1;
    }
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
    queryText += ` AND c.sto_number = $${paramIndex}`;
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
  const text = `
      WITH filtered AS (
        SELECT
          status,
          trucking_start_date,
          trucking_completion_date
        FROM (
          ${built.preOuterQuery}${built.outerSql}
        ) trucking_source
      )
      SELECT
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled_count,
        COUNT(*) FILTER (
          WHERE COALESCE(status, '') <> 'CANCELLED'
            AND trucking_completion_date IS NOT NULL
        )::bigint AS completed_count,
        COUNT(*) FILTER (
          WHERE COALESCE(status, '') <> 'CANCELLED'
            AND trucking_completion_date IS NULL
            AND trucking_start_date IS NOT NULL
        )::bigint AS in_progress_count,
        COUNT(*) FILTER (
          WHERE COALESCE(status, '') <> 'CANCELLED'
            AND trucking_completion_date IS NULL
            AND trucking_start_date IS NULL
        )::bigint AS planned_count,
        COUNT(*) FILTER (WHERE status = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE status = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE status = 'UNLOADING')::bigint AS unloading_count
      FROM filtered`;
  return { text, params: [...built.innerParams, ...built.outerParams] };
}

function buildPaginatedListQuery(
  built: TruckingListBuiltQuery,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  limit: number,
  offset: number,
): { text: string; params: unknown[] } {
  const field = SORT_FIELD_BY_KEY[sortKey] || 'created_at';
  const baseParams = [...built.innerParams, ...built.outerParams];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;
  const text = `
      SELECT * FROM (
        ${built.preOuterQuery}${built.outerSql}
      ) trucking_filtered
      ORDER BY ${field} ${sortDir} NULLS LAST, created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  return { text, params: [...baseParams, limit, offset] };
}

function buildFilteredCountQuery(built: TruckingListBuiltQuery): { text: string; params: unknown[] } {
  const text = `
      SELECT COUNT(*)::bigint AS c FROM (
        ${built.preOuterQuery}${built.outerSql}
      ) trucking_filtered`;
  return { text, params: [...built.innerParams, ...built.outerParams] };
}

async function loadFilteredTotal(built: TruckingListBuiltQuery): Promise<number> {
  const countKey = buildTruckingListCountCacheKey(built.filterCacheKey);
  const cached = COUNT_CACHE.get(countKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.total;
  }
  if (cached) COUNT_CACHE.delete(countKey);

  const { text, params } = buildFilteredCountQuery(built);
  const result = await query(text, params);
  const total = parseInt(String(result.rows[0]?.c ?? '0'), 10) || 0;
  COUNT_CACHE.set(countKey, { total, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(COUNT_CACHE, MAX_CACHE_ENTRIES);
  return total;
}

async function loadTruckingListPage(
  built: TruckingListBuiltQuery,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  page: number,
  limit: number,
): Promise<{ rows: TruckingListRow[]; total: number }> {
  const cached = PAGE_CACHE.get(built.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { rows: cached.rows, total: cached.total };
  }
  if (cached) PAGE_CACHE.delete(built.cacheKey);

  const offset = (page - 1) * limit;
  const total = await loadFilteredTotal(built);
  const { text, params } = buildPaginatedListQuery(built, sortKey, sortDir, limit, offset);
  const result = await query(text, params);
  const rows = result.rows as TruckingListRow[];

  PAGE_CACHE.set(built.cacheKey, { rows, total, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(PAGE_CACHE, MAX_CACHE_ENTRIES);
  return { rows, total };
}

export async function resolveTruckingListForRequest(req: AuthRequest): Promise<TruckingListResponseData> {
  const { page = 1, limit = 20 } = req.query;
  const summaryOnly =
    String((req.query as { summaryOnly?: string }).summaryOnly || '').toLowerCase() === 'true';
  const sortKey = String((req.query as { sortKey?: string }).sortKey || 'created_at');
  const sortDirRaw = String((req.query as { sortDir?: string }).sortDir || 'desc').toLowerCase();
  const sortDir: 'ASC' | 'DESC' = sortDirRaw === 'asc' ? 'ASC' : 'DESC';

  const built = buildTruckingListQuery(req);
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));

  if (summaryOnly) {
    const summaryBuilt = buildTruckingListQuery(req, { skipSapJoin: true });
    const { text, params } = buildTruckingSummaryQuery(summaryBuilt);
    const summaryResult = await query(text, params);
    const summary = buildTruckingSummaryFromSqlRow((summaryResult.rows[0] || {}) as Record<string, unknown>);
    return {
      truckingOperations: [],
      summary,
      pagination: {
        total: summary.total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(summary.total / limitNum) || 0,
      },
    };
  }

  const { rows, total } = await loadTruckingListPage(built, sortKey, sortDir, pageNum, limitNum);

  return {
    truckingOperations: rows,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    },
  };
}
