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
import {
  sqlTruckingQuantityDeliveredCoalesce,
  sqlTruckingQuantityReceiveCoalesce,
  sqlTruckingQuantitySentCoalesce,
} from '../utils/truckingQuantitySql';
import {
  truckingPageSapStoTypeTWhereSql,
  truckingSapStoTypeTSapCteClause,
} from '../utils/truckingStoTypeSql';

/**
 * Trucking list API — in-memory cache (TTL 5 min), same response shape as before:
 * - A: summary / summaryOnly computed from cached rows (no extra DB round-trip)
 * - B: full filtered row set cached per toolbar filter key; page/sort applied in memory
 * Cache is cleared on trucking mutations via invalidateTruckingListCache().
 */

export type TruckingListRow = Record<string, unknown>;

export interface TruckingListBuiltQuery {
  preOuterQuery: string;
  outerSql: string;
  innerParams: unknown[];
  outerParams: unknown[];
  cacheKey: string;
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

const ROW_CACHE = new Map<string, { rows: TruckingListRow[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 'trucking-list-v1';
const MAX_CACHE_ENTRIES = 40;

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
  };
  return `${CACHE_VERSION}:${JSON.stringify(norm)}`;
}

function evictTruckingListCacheIfNeeded(): void {
  const now = Date.now();
  for (const [key, entry] of ROW_CACHE.entries()) {
    if (entry.expiresAt <= now) ROW_CACHE.delete(key);
  }
  if (ROW_CACHE.size <= MAX_CACHE_ENTRIES) return;
  const sorted = [...ROW_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const removeCount = ROW_CACHE.size - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    ROW_CACHE.delete(sorted[i][0]);
  }
}

export function invalidateTruckingListCache(): void {
  ROW_CACHE.clear();
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

    if (!isCancelled && !hasDateValue(truckingCompletion) && !hasDateValue(truckingStart)) {
      planned += 1;
    }
    if (!isCancelled && !hasDateValue(truckingCompletion) && hasDateValue(truckingStart)) {
      inProgress += 1;
    }
    if (status === 'LOADING') loading += 1;
    if (status === 'IN_TRANSIT') inTransit += 1;
    if (status === 'UNLOADING') unloading += 1;
    if (!isCancelled && hasDateValue(truckingCompletion)) {
      completed += 1;
    }
    if (isCancelled) cancelled += 1;
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

export function buildTruckingListQuery(req: AuthRequest): TruckingListBuiltQuery {
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

  let queryText = `
      WITH ${truckingSapStoTypeTSapCteClause}
      SELECT 
        t.id,
        t.operation_id,
        t.contract_id,
        t.location,
        t.loading_location,
        t.unloading_location,
        t.trucking_owner,
        t.cargo_readiness_date,
        ${sqlEffectiveTruckingStartDate('c')} AS trucking_start_date,
        ${sqlEffectiveTruckingCompletionDate('c')} AS trucking_completion_date,
        t.eta_trucking_start_date,
        t.eta_trucking_completion_date,
        t.eta_delivery_start_date,
        t.eta_delivery_end_date,
        ${sqlTruckingQuantitySentCoalesce()} AS quantity_sent,
        ${sqlTruckingQuantityDeliveredCoalesce()} AS quantity_delivered,
        ${sqlTruckingQuantityReceiveCoalesce()} AS quantity_receive,
        t.gain_loss_percentage,
        t.gain_loss_amount,
        t.oa_budget,
        t.oa_actual,
        t.status,
        t.created_at,
        t.updated_at,
        CASE
          WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT cc.contract_id, ', ' ORDER BY cc.contract_id)
              FROM contracts cc
              WHERE UPPER(COALESCE(NULLIF(TRIM(cc.transport_mode), ''), 'LAND')) = 'LAND'
                AND NULLIF(TRIM(cc.sto_number::text), '') = NULLIF(TRIM(c.sto_number::text), '')
            )
          WHEN NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT cc2.contract_id, ', ' ORDER BY cc2.contract_id)
              FROM trucking_operations t2
              INNER JOIN contracts cc2 ON t2.contract_id = cc2.id
              WHERE NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
            )
          ELSE c.contract_id
        END AS contract_number,
        c.po_number,
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), sa.sto_numbers) AS sto_number,
        sa.sto_numbers AS sto_numbers,
        c.quantity_ordered as sto_quantity,
        c.quantity_ordered as contract_qty,
        c.contract_date,
        c.delivery_start_date,
        c.delivery_end_date,
        c.supplier,
        c.buyer,
        c.product,
        c.incoterm,
        c.group_name,
        s.estimated_km,
        CASE
          WHEN NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT NULLIF(TRIM(z.v), ''), ', ' ORDER BY NULLIF(TRIM(z.v), ''))
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS v
                FROM sap_processed_data spd
                WHERE spd.contract_number IN (
                  SELECT cc.contract_id
                  FROM contracts cc
                  WHERE UPPER(COALESCE(NULLIF(TRIM(cc.transport_mode), ''), 'LAND')) = 'LAND'
                    AND NULLIF(TRIM(cc.sto_number::text), '') = NULLIF(TRIM(c.sto_number::text), '')
                )
              ) z
              WHERE NULLIF(TRIM(z.v), '') IS NOT NULL
            )
          WHEN NULLIF(TRIM(t.operation_id::text), '') IS NOT NULL THEN
            (
              SELECT STRING_AGG(DISTINCT NULLIF(TRIM(z.v), ''), ', ' ORDER BY NULLIF(TRIM(z.v), ''))
              FROM (
                SELECT COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS v
                FROM sap_processed_data spd
                WHERE spd.contract_number IN (
                  SELECT cc2.contract_id
                  FROM trucking_operations t2
                  INNER JOIN contracts cc2 ON t2.contract_id = cc2.id
                  WHERE NULLIF(TRIM(t2.operation_id::text), '') = NULLIF(TRIM(t.operation_id::text), '')
                )
              ) z
              WHERE NULLIF(TRIM(z.v), '') IS NOT NULL
            )
          ELSE
            (
              SELECT COALESCE(
                spd.data->'raw'->>'Contract Ext No',
                spd.data->>'Contract Ext No'
              )
              FROM sap_processed_data spd
              WHERE spd.contract_number = c.contract_id
              ORDER BY spd.created_at DESC NULLS LAST
              LIMIT 1
            )
        END AS contract_ext_no
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      LEFT JOIN shipments s ON t.shipment_id = s.id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            spd.data->'contract'->>'contract_type',
            spd.data->>'B2B Flag',
            spd.data->'raw'->>'B2B Flag',
            spd.data->>'Contract Type'
          ) AS b2b_flag_raw,
          COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po_raw
        FROM sap_processed_data spd
        WHERE spd.contract_number = c.contract_id
        ORDER BY spd.created_at DESC NULLS LAST
        LIMIT 1
      ) b2b ON true
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers
        FROM (
          SELECT NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
        ) x
        WHERE x.effective_sto IS NOT NULL AND x.effective_sto != ''
      ) sa ON true
      WHERE 1=1
        AND NOT (
          c.contract_id IS NOT NULL
          AND UPPER(NULLIF(TRIM(COALESCE(b2b.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
          AND NULLIF(TRIM(COALESCE(b2b.contract_reference_po_raw, '')), '') IS NOT NULL
        )
        ${truckingPageSapStoTypeTWhereSql}
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
  });

  return {
    preOuterQuery: queryText,
    outerSql,
    innerParams,
    outerParams,
    cacheKey,
  };
}

async function loadTruckingListRowsCached(built: TruckingListBuiltQuery): Promise<TruckingListRow[]> {
  const cached = ROW_CACHE.get(built.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.rows;
  }
  if (cached) ROW_CACHE.delete(built.cacheKey);

  const fullQuery = `${built.preOuterQuery}${built.outerSql}`;
  const params = [...built.innerParams, ...built.outerParams];
  const result = await query(fullQuery, params);
  const rows = result.rows as TruckingListRow[];

  ROW_CACHE.set(built.cacheKey, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  evictTruckingListCacheIfNeeded();
  return rows;
}

export async function resolveTruckingListForRequest(req: AuthRequest): Promise<TruckingListResponseData> {
  const { page = 1, limit = 10 } = req.query;
  const includeSummary =
    String((req.query as { includeSummary?: string }).includeSummary ?? 'true').toLowerCase() !== 'false';
  const summaryOnly =
    String((req.query as { summaryOnly?: string }).summaryOnly || '').toLowerCase() === 'true';
  const sortKey = String((req.query as { sortKey?: string }).sortKey || 'created_at');
  const sortDirRaw = String((req.query as { sortDir?: string }).sortDir || 'desc').toLowerCase();
  const sortDir: 'ASC' | 'DESC' = sortDirRaw === 'asc' ? 'ASC' : 'DESC';

  const built = buildTruckingListQuery(req);
  const allRows = await loadTruckingListRowsCached(built);
  const total = allRows.length;
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const summary = buildTruckingListSummaryFromRows(allRows);

  if (summaryOnly) {
    return {
      truckingOperations: [],
      summary,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 0,
      },
    };
  }

  const sorted = sortTruckingListRows(allRows, sortKey, sortDir);
  const offset = (pageNum - 1) * limitNum;
  const pageRows = sorted.slice(offset, offset + limitNum);

  return {
    truckingOperations: pageRows,
    ...(includeSummary ? { summary } : {}),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    },
  };
}
