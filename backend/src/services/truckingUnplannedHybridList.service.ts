import { query } from '../database/connection';
import {
  isPipelineDailySummaryEligible,
  loadTruckingBacklogCountFromSnapshot,
  loadTruckingExecutionCountFromSnapshot,
  loadTruckingStagePageFromSnapshot,
  toPipelineDailySummaryScope,
  type PipelineDailySummaryScope,
  type TruckingSnapshotPageSortField,
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
  buildPipelineDailyFilterInput,
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
  /**
   * May the row counts come from the snapshot for this request?
   *
   * The counts used to check only search / column filters / contract, and the context carries
   * nothing about Source, Late Indicator or location - so a Source filter produced a page of
   * **116 rows reporting a total of 6,496**, the unfiltered figure, with 324 phantom pages behind
   * it. The rows were filtered live; the count never saw the filter.
   *
   * Decided where `req` is in scope, by the same predicate that gates every other snapshot read,
   * so a filter the snapshot cannot express can no longer slip through a context that does not
   * mention it.
   */
  snapshotCountsEligible: boolean;
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
function truckingHybridSnapshotScope(
  ctx: TruckingUnplannedHybridContext,
): PipelineDailySummaryScope {
  return toPipelineDailySummaryScope({
    dateFrom: ctx.contractScope.dateFrom,
    dateTo: ctx.contractScope.dateTo,
    plants: ctx.contractScope.plants,
    colFilters: ctx.colFilters,
  } as Parameters<typeof toPipelineDailySummaryScope>[0]);
}

async function loadTruckingHybridCountsFromSnapshot(
  ctx: TruckingUnplannedHybridContext,
): Promise<{ contractRows: number; executionRows: number } | null> {
  if (ctx.mode !== 'all') return null;
  /*
   * `snapshotCountsEligible` is the whole test, and it already covers global search, contract,
   * status, Source, Late Indicator and any column filter the scope cannot express.
   *
   * The raw `Object.keys(ctx.colFilters).length > 0` check that used to sit here was wrong, not
   * redundant: Product and Incoterm arrive as *column filters* from the toolbar, and
   * `toPipelineDailySummaryScope` folds them into the scope, which then applies them. Counting
   * keys refused them anyway, so a scoped user filtered to one product paid the live count -
   * 9,914 ms of the 25,305 ms it took to draw their page, with cards reading zero until it
   * returned. `hasNonToolbarColumnFilters`, which `isPipelineDailySummaryEligible` uses, is the
   * distinction that matters.
   */
  if (!ctx.snapshotCountsEligible) return null;
  if (String(ctx.globalSearch ?? '').trim()) return null;
  if (ctx.contractScope.contract) return null;

  const scope = truckingHybridSnapshotScope(ctx);
  /*
   * The execution half reads `trucking_list_stage_snapshot`, which carries region_site since
   * migration 164, so it can answer a Region/Plant filter. The backlog half reads
   * `trucking_pipeline_daily_summary`, which still keys on the master_plants `group_plant`
   * dimension and cannot - it returns null, and both counts then come from live together rather
   * than mixing one snapshot figure with one live one.
   */
  const [executionRows, snapshotContractRows] = await Promise.all([
    loadTruckingExecutionCountFromSnapshot(scope),
    loadTruckingBacklogCountFromSnapshot(scope),
  ]);
  if (executionRows === null) return null;

  /*
   * The two halves come from different tables, so they are allowed to come from different places.
   *
   * The backlog count reads `trucking_pipeline_daily_summary`, which keys on the master_plants
   * `group_plant` and so refuses a Region/Plant filter. Requiring both from the snapshot meant one
   * refusal dragged the other to live as well - and the live execution count is the expensive one:
   * measured 9,668 ms against 717 rows the snapshot had already counted, while the live backlog
   * count for the same scope is 1,887 ms. Asking the database only for the half the snapshot
   * cannot answer is what the combined backlog query already does a few lines away.
   */
  let contractRows = snapshotContractRows;
  if (contractRows === null) {
    const { contractScopeSql, params: contractParams, toolbarSql } = buildContractQueryParts(ctx);
    const res = await query(
      await buildTruckingUnplannedBacklogCountQuery(contractScopeSql, toolbarSql),
      contractParams,
    );
    contractRows = parseInt(String((res.rows[0] as { c?: unknown })?.c ?? '0'), 10) || 0;
  }
  return { executionRows, contractRows };
}

const BREAKDOWN_CACHE = new Map<string, { data: TruckingUnplannedHybridBreakdown; expiresAt: number }>();
const BREAKDOWN_IN_FLIGHT = new Map<string, Promise<TruckingUnplannedHybridBreakdown>>();
const BREAKDOWN_CACHE_TTL_MS = 5 * 60 * 1000;
const BREAKDOWN_MAX_CACHE_ENTRIES = 80;

/**
 * The counts are cached per request shape, and the shape has to include every filter that
 * changes them.
 *
 * It used to key on scope + search + column filters only, so Source, Late Indicator, location and
 * status were invisible to it - a request filtered to Source=Interco was served the count cached
 * for the unfiltered page, and vice versa. `executionBuilt.filterCacheKey` is built by
 * `buildTruckingListFilterCacheKey` from all of them, which is exactly the discriminator this
 * needs, and it cannot drift as filters are added because the page query is keyed by the same
 * string.
 */
function breakdownCacheKey(ctx: TruckingUnplannedHybridContext): string {
  return `trucking-hybrid-bd:${ctx.mode}:${ctx.executionBuilt.filterCacheKey}:${JSON.stringify({
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

/** The request's sort, when the snapshot can order by it; null sends the page to live. */
function snapshotPageSortField(sortKey: string): TruckingSnapshotPageSortField | null {
  if (sortKey === 'supplier' || sortKey === 'created_at') return sortKey;
  return null;
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

  /**
   * Which rows are on this page comes from the snapshot; only those rows are then expanded.
   *
   * Deciding membership is what the live query spends its time on - it materialises
   * `trucking_source` and `contract_sto_lines` to rank the whole scope before taking 20 rows,
   * measured at 12,567 ms on the cold ALL page - and the snapshot holds one indexed row per
   * operation. With the keys handed over, `trucking_source` is referenced once and the planner
   * pushes the key restriction into it.
   *
   * Only `supplier` and `created_at`: those are the columns the snapshot carries, and the two
   * orders were each compared against live before being wired. Anything else keeps the live
   * ranking below.
   *
   * Verified on pages 1 and 2 of the default YTD scope: same 20 ids in the same order as the
   * live path. That only became true after the live ordering was made deterministic - see
   * buildTruckingExpansionKeyOrderBy for what it was doing instead, and note that the live path
   * was the broken one, not this.
   */
  const snapshotSort = snapshotPageSortField(ctx.sortKey);
  const snapshotScope = truckingHybridSnapshotScope(ctx);
  const snapshotKeys =
    ctx.mode === 'all' &&
    snapshotSort &&
    /*
     * The keys must be drawn from the same row set the page is meant to show.
     *
     * `canPageAllHybridExecutionKeys` delegates to `canUseTruckingStoKeyPaging` without passing
     * Source or Late Indicator, so it said yes to a Source-filtered request: the snapshot handed
     * back 500 keys chosen with no Source predicate, the expansion then applied it, and the page
     * showed **116 rows of a filtered set of 1,236** - rows silently missing, not merely a wrong
     * total. That gate is still right for the *live* branch below, which ranks trucking_source
     * with the filter applied; it is this branch that needs the stricter test.
     */
    ctx.snapshotCountsEligible
      ? await loadTruckingStagePageFromSnapshot(
          snapshotScope,
          null,
          ctx.sortDir,
          limit,
          offset,
          snapshotSort,
        )
      : null;
  if (snapshotKeys && snapshotKeys.keys.length === 0) return [];

  const executionBuilt = snapshotKeys
    ? {
        ...ctx.executionBuilt,
        usesStoKeyPaging: true,
        resolvedExpansionKeys: snapshotKeys.keys,
      }
    : canPageAllHybridExecutionKeys(ctx)
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

  /**
   * Merging two halves is only worth anything when both halves have rows.
   *
   * The global merge fetches `offset + limit` rows from the execution side and sorts in Node, so
   * page 10 fetches 200 rows to show 20. With an empty backlog there is nothing to interleave -
   * the sliced branch asks the database for exactly the 20 rows it needs and returns the same
   * page, because `sortTruckingListRows` now breaks ties the way the SQL does.
   */
  const useGlobalSort =
    ctx.mode === 'all' && hasBacklogRows && hybridListUsesGlobalMergeSort(sortKey);

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
    // Plants are allowed: the stage snapshot carries region_site (migration 164). Everything
    // else this predicate refuses - Source, Late Indicator, location, status - is a filter the
    // snapshot cannot express, and answering it with an unfiltered count is how the total came
    // to disagree with the rows.
    snapshotCountsEligible: isPipelineDailySummaryEligible(buildPipelineDailyFilterInput(req), {
      allowPlantFilter: true,
    }),
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
