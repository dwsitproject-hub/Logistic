import { query } from '../database/connection';
import {
  loadTruckingBacklogCountFromSnapshot,
  loadTruckingExecutionCountFromSnapshot,
  toPipelineDailySummaryScope,
} from './pipelineDailySummary.service';
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

/**
 * The two ALL/Unplanned row counts from the snapshot, or null when this request cannot use it.
 *
 * The execution count comes from `trucking_list_stage_snapshot` rather than
 * `trucking_pipeline_daily_summary.total_count`: that column filters
 * `COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'` because it feeds the status circles, which
 * must drop SAP-cancelled POs - while the *list* still shows those rows. Using it would quietly
 * undercount the table.
 *
 * Unplanned mode is deliberately excluded for now: its execution half counts only UNPLANNED ops,
 * and the snapshot column that answers that (`unplanned_execution_count`) carries the
 * sap_presence filter for the same reason. Only the ALL view is served here; Unplanned keeps its
 * live counts until that is measured too.
 */
async function loadTruckingHybridCountsFromSnapshot(
  ctx: TruckingUnplannedHybridContext,
): Promise<{ contractRows: number; executionRows: number } | null> {
  if (ctx.mode !== 'all') return null;
  if (String(ctx.globalSearch ?? '').trim()) return null;
  if (ctx.colFilters && Object.keys(ctx.colFilters).length > 0) return null;
  if (ctx.contractScope.contract) return null;

  const scope = toPipelineDailySummaryScope({
    dateFrom: ctx.contractScope.dateFrom,
    dateTo: ctx.contractScope.dateTo,
    plants: ctx.contractScope.plants,
    colFilters: ctx.colFilters,
  } as Parameters<typeof toPipelineDailySummaryScope>[0]);

  const [executionRows, contractRows] = await Promise.all([
    loadTruckingExecutionCountFromSnapshot(scope),
    loadTruckingBacklogCountFromSnapshot(scope),
  ]);
  if (executionRows === null || contractRows === null) return null;
  return { executionRows, contractRows };
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
    /**
     * Both halves of this total come from the snapshot when the request is toolbar-only.
     *
     * Live, they were two of the queries that bound the cold Trucking page: the execution count
     * (`COUNT(DISTINCT ts.id)` over the whole list select) measured 10-25s, and the backlog count
     * is one of the `latest_spd_contract` queries at 7-19s. Verified against the live forms on a
     * scope with a non-zero backlog, because a 0-vs-0 comparison proves nothing:
     *
     *   execution count   live 9,066 (15,632ms)   snapshot 9,066 (57ms)
     *   backlog count     live     3 ( 7,294ms)   snapshot     3 ( 8ms)
     *
     * Only when there is no global search and no column filters: those cannot be answered from
     * the columns the snapshot carries, and a wrong total is worse than a slow one. Anything else
     * falls through to the live counts below, unchanged.
     */
    const snapshotCounts = await loadTruckingHybridCountsFromSnapshot(ctx);
    if (snapshotCounts) {
      const data = {
        contractRows: snapshotCounts.contractRows,
        executionRows: snapshotCounts.executionRows,
        totalTableRows: snapshotCounts.contractRows + snapshotCounts.executionRows,
      };
      BREAKDOWN_CACHE.set(cacheKey, { data, expiresAt: Date.now() + BREAKDOWN_CACHE_TTL_MS });
      return data;
    }

    const { contractScopeSql, params: contractParams, toolbarSql } = buildContractQueryParts(ctx);
    const executionCount = buildTruckingHybridExecutionCountQuery(ctx);

    const [contractRes, executionRes] = await Promise.all([
      query(await buildTruckingUnplannedBacklogCountQuery(contractScopeSql, toolbarSql), contractParams),
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
  const text = await buildTruckingUnplannedBacklogPageQuery(
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

  /**
   * No backlog rows in scope means no backlog page query.
   *
   * `breakdown.contractRows` is counted from the same scope and toolbar predicate the page query
   * uses, so a count of zero means the page query provably returns nothing - and it was being run
   * anyway. Measured on the cold Trucking page, default YTD, where the backlog is genuinely
   * empty: `buildTruckingUnplannedBacklogPageQuery` cost **8,309 ms** to return no rows. The
   * count that makes this decision now costs 8 ms from the snapshot.
   */
  const hasBacklogRows = breakdown.contractRows > 0;

  let contractPage: TruckingListRow[] = [];
  let executionPage: TruckingListRow[] = [];
  let truckingOperations: TruckingListRow[];

  const useGlobalSort = ctx.mode === 'all' && hybridListUsesGlobalMergeSort(sortKey);

  if (useGlobalSort) {
    const need = offset + limitNum;
    [contractPage, executionPage] = await Promise.all([
      hydrateOnly || !hasBacklogRows
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
      hydrateOnly || !hasBacklogRows
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
