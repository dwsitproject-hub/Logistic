import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { parseColumnFiltersQuery, type ColumnFilterPayload } from '../utils/contractListFilters';
import { computeHybridListPageSlices } from '../utils/hybridListPageSlices';
import { registerListCacheInvalidator } from '../utils/listCacheRegistry';
import { hybridListUsesGlobalMergeSort } from '../utils/shipmentListSortSql';
import {
  buildTruckingExpansionKeysCountSql,
  wrapTruckingListQueryWithStoExpansion,
} from '../utils/truckingListStoExpandSql';
import { buildTruckingExpansionKeyOrderBy, canUseTruckingStoKeyPaging } from '../utils/truckingListStoPaging';
import {
  appendTruckingUnplannedBacklogColumnFilters,
  appendTruckingUnplannedBacklogGlobalSearch,
  buildTruckingUnplannedBacklogCountQuery,
  buildTruckingUnplannedBacklogPageQuery,
  buildTruckingUnplannedContractToolbarScope,
} from '../utils/truckingUnplannedHybridSql';
import {
  buildPaginatedListQuery,
  buildTruckingListQuery,
  sortTruckingListRows,
  type TruckingListBuiltQuery,
  type TruckingListResponseData,
  type TruckingListRow,
} from './truckingList.service';

export type TruckingHybridListMode = 'unplanned' | 'all';

export interface TruckingUnplannedHybridContext {
  executionBuilt: TruckingListBuiltQuery;
  contractScope: {
    dateFrom?: unknown;
    dateTo?: unknown;
    contract?: unknown;
    plants: string[];
  };
  globalSearch: string;
  colFilters: ColumnFilterPayload;
  sortKey: string;
  sortDir: 'ASC' | 'DESC';
  /** Unplanned = UNPLANNED ops + backlog. All = every visible op + same open-PO backlog. */
  mode: TruckingHybridListMode;
}

export interface TruckingUnplannedHybridBreakdown {
  contractRows: number;
  executionRows: number;
  totalTableRows: number;
}

function buildContractQueryParts(ctx: TruckingUnplannedHybridContext): {
  contractScopeSql: string;
  toolbarSql: string;
  params: unknown[];
} {
  const scope = buildTruckingUnplannedContractToolbarScope(ctx.contractScope);
  let idx = scope.params.length + 1;
  const g = appendTruckingUnplannedBacklogGlobalSearch(ctx.globalSearch, idx);
  idx = g.nextIndex;
  const c = appendTruckingUnplannedBacklogColumnFilters(ctx.colFilters, idx);
  return {
    contractScopeSql: scope.sql,
    params: [...scope.params, ...g.params, ...c.params],
    toolbarSql: `${g.sql}${c.sql}`,
  };
}

export function truckingHybridExecutionStageFilter(
  mode: TruckingHybridListMode,
): string | undefined {
  return mode === 'unplanned' ? 'UNPLANNED' : undefined;
}

export function buildTruckingHybridExecutionCountQuery(
  ctx: TruckingUnplannedHybridContext,
): { text: string; params: unknown[] } {
  const innerSql = `${ctx.executionBuilt.preOuterQuery}${ctx.executionBuilt.outerSql}`;
  const executionParams = [...ctx.executionBuilt.innerParams, ...ctx.executionBuilt.outerParams];
  const stage = truckingHybridExecutionStageFilter(ctx.mode);

  /** All = every op; expansion-keys count avoids a full STO/qty expansion. */
  if (!stage) {
    return {
      text: buildTruckingExpansionKeysCountSql(innerSql, true),
      params: executionParams,
    };
  }

  const executionExpanded = wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: false,
    skipSapJoin: true,
    useStageSnapshot: ctx.executionBuilt.useStageSnapshot === true,
  });
  const stageIdx = executionParams.length + 1;
  return {
    text: `WITH trucking_filtered AS (
         SELECT * FROM (${executionExpanded}) expanded_sub
       )
       SELECT COUNT(*)::bigint AS c
       FROM trucking_filtered tf
       WHERE tf.status = $${stageIdx}`,
    params: [...executionParams, stage],
  };
}

const BREAKDOWN_CACHE = new Map<string, { data: TruckingUnplannedHybridBreakdown; expiresAt: number }>();
const BREAKDOWN_IN_FLIGHT = new Map<string, Promise<TruckingUnplannedHybridBreakdown>>();
const BREAKDOWN_CACHE_TTL_MS = 5 * 60 * 1000;
const BREAKDOWN_MAX_CACHE_ENTRIES = 80;

function breakdownCacheKey(ctx: TruckingUnplannedHybridContext): string {
  return `trucking-hybrid-bd:${ctx.mode}:${JSON.stringify({
    scope: ctx.contractScope,
    search: ctx.globalSearch,
    colFilters: ctx.colFilters,
  })}`;
}

export function invalidateTruckingHybridBreakdownCache(): void {
  BREAKDOWN_CACHE.clear();
  BREAKDOWN_IN_FLIGHT.clear();
}

registerListCacheInvalidator(invalidateTruckingHybridBreakdownCache);

export async function countTruckingUnplannedHybridBreakdown(
  ctx: TruckingUnplannedHybridContext,
): Promise<TruckingUnplannedHybridBreakdown> {
  const cacheKey = breakdownCacheKey(ctx);
  const cached = BREAKDOWN_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  if (cached) BREAKDOWN_CACHE.delete(cacheKey);

  const inFlight = BREAKDOWN_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = (async () => {
    const { contractScopeSql, params: contractParams, toolbarSql } = buildContractQueryParts(ctx);
    const executionCount = buildTruckingHybridExecutionCountQuery(ctx);

    const [contractRes, executionRes] = await Promise.all([
      query(buildTruckingUnplannedBacklogCountQuery(contractScopeSql, toolbarSql), contractParams),
      query(executionCount.text, executionCount.params),
    ]);

    const contractRows = parseInt(String(contractRes.rows[0]?.c ?? '0'), 10) || 0;
    const executionRows = parseInt(String(executionRes.rows[0]?.c ?? '0'), 10) || 0;
    const data = { contractRows, executionRows, totalTableRows: contractRows + executionRows };
    BREAKDOWN_CACHE.set(cacheKey, { data, expiresAt: Date.now() + BREAKDOWN_CACHE_TTL_MS });
    if (BREAKDOWN_CACHE.size > BREAKDOWN_MAX_CACHE_ENTRIES) {
      const oldest = [...BREAKDOWN_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) BREAKDOWN_CACHE.delete(oldest[0]);
    }
    return data;
  })().finally(() => {
    BREAKDOWN_IN_FLIGHT.delete(cacheKey);
  });

  BREAKDOWN_IN_FLIGHT.set(cacheKey, run);
  return run;
}

async function fetchContractBacklogPage(
  ctx: TruckingUnplannedHybridContext,
  limit: number,
  offset: number,
): Promise<TruckingListRow[]> {
  if (limit <= 0) return [];
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const text = buildTruckingUnplannedBacklogPageQuery(
    contractScopeSql,
    toolbarSql,
    limit,
    offset,
    ctx.sortKey,
    ctx.sortDir,
  );
  const result = await query(text, params);
  return result.rows as TruckingListRow[];
}

function canPageAllHybridExecutionKeys(ctx: TruckingUnplannedHybridContext): boolean {
  if (ctx.mode !== 'all') return false;
  return canUseTruckingStoKeyPaging({
    summaryOnly: false,
    stoIsSet: false,
    contractIsSet: Boolean(ctx.contractScope.contract),
    status: 'ALL',
    globalSearch: ctx.globalSearch,
    colFilters: ctx.colFilters,
  });
}

async function fetchExecutionPage(
  ctx: TruckingUnplannedHybridContext,
  limit: number,
  offset: number,
): Promise<TruckingListRow[]> {
  if (limit <= 0) return [];
  const executionBuilt = canPageAllHybridExecutionKeys(ctx)
    ? {
        ...ctx.executionBuilt,
        usesStoKeyPaging: true,
        expansionPaging: {
          limit,
          offset,
          orderBySql: buildTruckingExpansionKeyOrderBy(ctx.sortKey, ctx.sortDir),
        },
      }
    : ctx.executionBuilt;
  const { text, params } = buildPaginatedListQuery(
    executionBuilt,
    ctx.sortKey,
    ctx.sortDir,
    limit,
    offset,
    truckingHybridExecutionStageFilter(ctx.mode),
  );
  const result = await query(text, params);
  return result.rows.map((row) => {
    const copy = { ...row } as TruckingListRow & { __filter_total?: unknown };
    delete copy.__filter_total;
    return copy;
  });
}

export async function resolveTruckingUnplannedHybridList(
  req: AuthRequest,
  ctx: TruckingUnplannedHybridContext,
): Promise<TruckingListResponseData & { unplannedBreakdown: TruckingUnplannedHybridBreakdown }> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));
  const offset = (pageNum - 1) * limitNum;

  const hydrateOnly =
    String((req.query as { hydrateOnly?: string }).hydrateOnly || '').toLowerCase() === 'true';
  const breakdown = await countTruckingUnplannedHybridBreakdown(ctx);
  const { executionRows } = breakdown;
  const { sortKey, sortDir } = ctx;

  let contractPage: TruckingListRow[] = [];
  let executionPage: TruckingListRow[] = [];
  let truckingOperations: TruckingListRow[];

  const useGlobalSort = ctx.mode === 'all' && hybridListUsesGlobalMergeSort(sortKey);

  if (useGlobalSort) {
    const need = offset + limitNum;
    [contractPage, executionPage] = await Promise.all([
      hydrateOnly
        ? Promise.resolve([] as TruckingListRow[])
        : fetchContractBacklogPage(ctx, need, 0),
      fetchExecutionPage(ctx, need, 0),
    ]);
    for (const row of contractPage) {
      row.status = 'UNPLANNED';
      row.row_kind = 'contract_backlog';
    }
    truckingOperations = sortTruckingListRows(
      [...executionPage, ...contractPage],
      sortKey,
      sortDir,
    ).slice(offset, offset + limitNum);
  } else {
    const slices = computeHybridListPageSlices({
      offset,
      limit: limitNum,
      executionRows,
    });

    [contractPage, executionPage] = await Promise.all([
      hydrateOnly
        ? Promise.resolve([] as TruckingListRow[])
        : fetchContractBacklogPage(ctx, slices.contractLimit, slices.contractOffset),
      fetchExecutionPage(ctx, slices.executionLimit, slices.executionOffset),
    ]);

    for (const row of contractPage) {
      row.status = 'UNPLANNED';
      row.row_kind = 'contract_backlog';
    }

    truckingOperations = [...executionPage, ...contractPage];
  }

  return {
    truckingOperations,
    unplannedBreakdown: breakdown,
    pagination: {
      total: breakdown.totalTableRows,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(breakdown.totalTableRows / limitNum) || 0,
    },
  };
}

export function isTruckingUnplannedHybridListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'UNPLANNED';
}

export function isTruckingAllHybridListRequest(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return !normalized || normalized === 'ALL';
}

/**
 * ALL table merges execution ops + open-PO backlog (no trucking_operations).
 * Keep this true for 10-digit PO search — otherwise Unplanned POs vanish from ALL.
 */
export function shouldResolveAllHybridTruckingList(status: unknown): boolean {
  return isTruckingAllHybridListRequest(status);
}

function withHybridCacheKey(
  built: TruckingListBuiltQuery,
  suffix: string,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
): TruckingListBuiltQuery {
  return {
    ...built,
    cacheKey: `${built.cacheKey}:${suffix}:sap=${built.skipSapJoin ? 0 : 1}:sk=${sortKey}:${sortDir}`,
  };
}

function buildTruckingHybridContext(
  req: AuthRequest,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  mode: TruckingHybridListMode,
  options?: { executionBuilt?: TruckingListBuiltQuery },
): TruckingUnplannedHybridContext {
  const { dateFrom, dateTo, contract, plant } = req.query;
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  const executionBuilt =
    options?.executionBuilt ?? buildTruckingListQuery(req, { omitStatusFilter: true });
  const suffix = mode === 'all' ? 'all-hybrid' : 'unplanned-hybrid';

  return {
    executionBuilt: withHybridCacheKey(executionBuilt, suffix, sortKey, sortDir),
    contractScope: { dateFrom, dateTo, contract, plants },
    globalSearch,
    colFilters,
    sortKey,
    sortDir,
    mode,
  };
}

export function buildTruckingUnplannedHybridContext(
  req: AuthRequest,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  options?: { executionBuilt?: TruckingListBuiltQuery },
): TruckingUnplannedHybridContext {
  return buildTruckingHybridContext(req, sortKey, sortDir, 'unplanned', options);
}

export function buildTruckingAllHybridContext(
  req: AuthRequest,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
  options?: { executionBuilt?: TruckingListBuiltQuery },
): TruckingUnplannedHybridContext {
  return buildTruckingHybridContext(req, sortKey, sortDir, 'all', options);
}
