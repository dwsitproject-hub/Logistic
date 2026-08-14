import { query } from '../database/connection';
import { registerListCacheInvalidator } from '../utils/listCacheRegistry';
import { AuthRequest } from '../middleware/auth';
import {
  buildShipmentListEnrichedPageQuery,
  normalizeShipmentListRows,
  type ShipmentListQueryContext,
  type ShipmentListResponseData,
} from './shipmentList.service';
import {
  hybridListUsesGlobalMergeSort,
  sortShipmentListRows,
} from '../utils/shipmentListSortSql';
import {
  appendUnplannedContractBacklogColumnFilters,
  appendUnplannedContractBacklogGlobalSearch,
  buildUnplannedContractBacklogCountQuery,
  buildUnplannedContractBacklogPageQuery,
  buildAllHybridContractBacklogCountQuery,
  buildAllHybridContractBacklogPageQuery,
  buildCompletedContractBacklogCountQuery,
  buildCompletedContractBacklogPageQuery,
  buildUnplannedShipmentExecutionCountQuery,
  buildUnplannedContractToolbarScope,
  buildPreplannedContractsCountQuery,
  buildPreplannedContractsPageQuery,
} from '../utils/shipmentUnplannedHybridSql';
import { computeHybridListPageSlices } from '../utils/hybridListPageSlices';
import type { ColumnFilterPayload } from '../utils/contractListFilters';

export interface UnplannedHybridListContext {
  shipmentCtx: ShipmentListQueryContext;
  contractScope: {
    dateFrom?: unknown;
    dateTo?: unknown;
    contract?: unknown;
    plants: string[];
  };
  globalSearch: string;
  colFilters: ColumnFilterPayload;
  /** ALL hybrid merges unplanned + preplanned + completed-OS backlog; UNPLANNED / COMPLETED are single-mode. */
  contractBacklogMode?: 'unplanned' | 'all' | 'completed';
}

export interface UnplannedHybridBreakdown {
  contractRows: number;
  shipmentRows: number;
  totalTableRows: number;
  /** Sum of quantity_ordered (kg) for the unplanned contract backlog (no shipment row yet). */
  contractQtyKg: number;
  /** Sum of outstanding qty (kg) for the unplanned contract backlog. */
  outstandingQtyKg: number;
}

export interface CompletedContractBacklogBreakdown {
  contractRows: number;
  totalTableRows: number;
  contractQtyKg: number;
  outstandingQtyKg: number;
}

export interface PreplannedContractsBreakdown {
  /** Contract rows shown in the Preplanned table. */
  contractRows: number;
  /** Unique accepted grouping suggestions — used for the Preplanned card badge. */
  groupCount: number;
  /** Alias of contractRows for list pagination. */
  totalTableRows: number;
  /** Sum of quantity_ordered (kg) for preplanned contracts. */
  contractQtyKg: number;
  /** Sum of outstanding qty (kg) for preplanned contracts. */
  outstandingQtyKg: number;
}

/** Contract-scope filters shared by Unplanned backlog and Preplanned list. */
export type PreplannedListContext = Pick<
  UnplannedHybridListContext,
  'contractScope' | 'globalSearch' | 'colFilters'
> & {
  /** Optional stable cache key (prefer filterCacheKey from the list request). */
  cacheKey?: string;
};

function buildContractQueryParts(ctx: PreplannedListContext): {
  contractScopeSql: string;
  toolbarSql: string;
  params: unknown[];
} {
  const scope = buildUnplannedContractToolbarScope(ctx.contractScope);
  let idx = scope.params.length + 1;
  const g = appendUnplannedContractBacklogGlobalSearch(ctx.globalSearch, idx);
  idx = g.nextIndex;
  const c = appendUnplannedContractBacklogColumnFilters(ctx.colFilters, idx);
  return {
    contractScopeSql: scope.sql,
    params: [...scope.params, ...g.params, ...c.params],
    toolbarSql: `${g.sql}${c.sql}`,
  };
}

/**
 * Unplanned card vessels — PO backlog has no vessel; always empty.
 * Kept for API compatibility with summary vessel-name loaders.
 */
export async function loadUnplannedExecutionVesselNames(
  _ctx: UnplannedHybridListContext,
): Promise<string[]> {
  return [];
}

/** Unplanned card/table: open PO backlog only (no STO execution rows). */
export function buildShipmentUnplannedHybridListContext(input: {
  shipmentBaseCteSql: string;
  toolbarOuterSql: string;
  innerParams: unknown[];
  toolbarOuterParams: unknown[];
  skipSapJoin: boolean;
  filterCacheKey: string;
  contractScope: UnplannedHybridListContext['contractScope'];
  globalSearch: string;
  colFilters: ColumnFilterPayload;
  sortKey?: string;
  sortDir?: 'ASC' | 'DESC';
  tableStatusFilter?: string;
}): UnplannedHybridListContext {
  return {
    ...buildShipmentHybridListContext({
      ...input,
      /** Unused for Unplanned list (backlog-only); kept for context shape. */
      executionOuterSql: input.toolbarOuterSql,
      cacheKeySuffix: 'unplanned-po-only-v1',
    }),
    contractBacklogMode: 'unplanned',
  };
}

/** ALL status: all execution rows (toolbar filters only) + unplanned/preplanned contract backlog. */
export function buildShipmentAllHybridListContext(input: {
  shipmentBaseCteSql: string;
  toolbarOuterSql: string;
  innerParams: unknown[];
  toolbarOuterParams: unknown[];
  skipSapJoin: boolean;
  filterCacheKey: string;
  contractScope: UnplannedHybridListContext['contractScope'];
  globalSearch: string;
  colFilters: ColumnFilterPayload;
  sortKey?: string;
  sortDir?: 'ASC' | 'DESC';
  tableStatusFilter?: string;
}): UnplannedHybridListContext {
  return {
    ...buildShipmentHybridListContext({
      ...input,
      executionOuterSql: input.toolbarOuterSql,
      cacheKeySuffix: 'all-hybrid-v2',
    }),
    contractBacklogMode: 'all',
  };
}

/** Completed card/table: execution COMPLETED + PO backlog with remaining OS ≤ 1 MT. */
export function buildShipmentCompletedHybridListContext(input: {
  shipmentBaseCteSql: string;
  toolbarOuterSql: string;
  innerParams: unknown[];
  toolbarOuterParams: unknown[];
  skipSapJoin: boolean;
  filterCacheKey: string;
  contractScope: UnplannedHybridListContext['contractScope'];
  globalSearch: string;
  colFilters: ColumnFilterPayload;
  sortKey?: string;
  sortDir?: 'ASC' | 'DESC';
  tableStatusFilter?: string;
}): UnplannedHybridListContext {
  return {
    ...buildShipmentHybridListContext({
      ...input,
      executionOuterSql: input.toolbarOuterSql,
      cacheKeySuffix: 'completed-hybrid-v1',
    }),
    contractBacklogMode: 'completed',
  };
}

function buildShipmentHybridListContext(input: {
  shipmentBaseCteSql: string;
  executionOuterSql: string;
  innerParams: unknown[];
  toolbarOuterParams: unknown[];
  skipSapJoin: boolean;
  filterCacheKey: string;
  cacheKeySuffix: string;
  contractScope: UnplannedHybridListContext['contractScope'];
  globalSearch: string;
  colFilters: ColumnFilterPayload;
  sortKey?: string;
  sortDir?: 'ASC' | 'DESC';
  tableStatusFilter?: string;
}): UnplannedHybridListContext {
  return {
    shipmentCtx: {
      shipmentBaseCteSql: input.shipmentBaseCteSql,
      outerSql: input.executionOuterSql,
      innerParams: input.innerParams,
      outerParams: input.toolbarOuterParams,
      skipSapJoin: input.skipSapJoin,
      cacheKey: `${input.filterCacheKey}:${input.cacheKeySuffix}`,
      filterCacheKey: input.filterCacheKey,
      usesStoKeyPaging: false,
      tableStatusFilter: input.tableStatusFilter,
      sortKey: input.sortKey ?? 'created_at',
      sortDir: input.sortDir ?? 'DESC',
    },
    contractScope: input.contractScope,
    globalSearch: input.globalSearch,
    colFilters: input.colFilters,
  };
}

/*
 * Breakdown cache.
 *
 * loadShipmentSummaryBundle awaits loadUnplannedBreakdown() + loadPreplannedBreakdown() in ALL
 * three of its branches - daily snapshot, cache hit and live - so these counts ran on every
 * summaryOnly request no matter what was cached. That was the entire remaining floor on the
 * Shipments page: ~2-3.3s per load with everything else served from memory in single-digit ms.
 *
 * Caching them on the same 5-minute TTL as the list is also more consistent than leaving them
 * live. The comment at the call site asks for live counts so the cards cannot diverge from the
 * hybrid table - but the table itself is now cached for 5 minutes, so live counts against a
 * cached table is precisely how they WOULD diverge. Sharing one TTL keeps card and table in step.
 */
const HYBRID_CACHE = new Map<string, { data: HybridListResult; expiresAt: number }>();
const HYBRID_IN_FLIGHT = new Map<string, Promise<HybridListResult>>();
const HYBRID_CACHE_TTL_MS = 5 * 60 * 1000;
const HYBRID_MAX_CACHE_ENTRIES = 80;

const BREAKDOWN_CACHE = new Map<string, { data: UnplannedHybridBreakdown; expiresAt: number }>();
const BREAKDOWN_IN_FLIGHT = new Map<string, Promise<UnplannedHybridBreakdown>>();

const PREPLANNED_BREAKDOWN_CACHE = new Map<
  string,
  { data: PreplannedContractsBreakdown; expiresAt: number }
>();
const PREPLANNED_BREAKDOWN_IN_FLIGHT = new Map<string, Promise<PreplannedContractsBreakdown>>();

const COMPLETED_BREAKDOWN_CACHE = new Map<
  string,
  { data: CompletedContractBacklogBreakdown; expiresAt: number }
>();
const COMPLETED_BREAKDOWN_IN_FLIGHT = new Map<string, Promise<CompletedContractBacklogBreakdown>>();

export function invalidateHybridBreakdownCache(): void {
  BREAKDOWN_CACHE.clear();
  PREPLANNED_BREAKDOWN_CACHE.clear();
  COMPLETED_BREAKDOWN_CACHE.clear();
}

registerListCacheInvalidator(invalidateHybridBreakdownCache);

export async function countHybridBreakdown(
  ctx: UnplannedHybridListContext,
): Promise<UnplannedHybridBreakdown> {
  const cacheKey = `${ctx.shipmentCtx.cacheKey}:breakdown:${ctx.contractBacklogMode ?? 'all'}`;

  const cached = BREAKDOWN_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  if (cached) BREAKDOWN_CACHE.delete(cacheKey);

  const inFlight = BREAKDOWN_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = computeHybridBreakdown(ctx)
    .then((data) => {
      BREAKDOWN_CACHE.set(cacheKey, { data, expiresAt: Date.now() + HYBRID_CACHE_TTL_MS });
      if (BREAKDOWN_CACHE.size > HYBRID_MAX_CACHE_ENTRIES) {
        const oldest = [...BREAKDOWN_CACHE.entries()].sort(
          (a, b) => a[1].expiresAt - b[1].expiresAt,
        )[0];
        if (oldest) BREAKDOWN_CACHE.delete(oldest[0]);
      }
      return data;
    })
    .finally(() => {
      BREAKDOWN_IN_FLIGHT.delete(cacheKey);
    });

  BREAKDOWN_IN_FLIGHT.set(cacheKey, run);
  return run;
}

/** Unchanged breakdown computation - extracted verbatim so the cache cannot alter it. */
async function computeHybridBreakdown(
  ctx: UnplannedHybridListContext,
): Promise<UnplannedHybridBreakdown> {
  const { contractScopeSql, params: contractParams, toolbarSql } = buildContractQueryParts(ctx);
  const isAllHybrid = ctx.contractBacklogMode === 'all';
  const isCompletedHybrid = ctx.contractBacklogMode === 'completed';

  const contractCountSql = isCompletedHybrid
    ? buildCompletedContractBacklogCountQuery(contractScopeSql, toolbarSql)
    : isAllHybrid
      ? buildAllHybridContractBacklogCountQuery(contractScopeSql, toolbarSql)
      : buildUnplannedContractBacklogCountQuery(contractScopeSql, toolbarSql);

  const contractRes = await query(contractCountSql, contractParams);

  const contractRows = parseInt(String(contractRes.rows[0]?.c ?? '0'), 10) || 0;
  const contractQtyKg = Number(contractRes.rows[0]?.contract_qty_kg ?? 0) || 0;
  const outstandingQtyKg = Number(contractRes.rows[0]?.outstanding_qty_kg ?? 0) || 0;

  /** Unplanned card/table = PO backlog only; ALL / Completed hybrid merge execution rows. */
  if (!isAllHybrid && !isCompletedHybrid) {
    return {
      contractRows,
      shipmentRows: 0,
      totalTableRows: contractRows,
      contractQtyKg,
      outstandingQtyKg,
    };
  }

  const shipmentParams = [...ctx.shipmentCtx.innerParams, ...ctx.shipmentCtx.outerParams];
  const shipmentRes = await query(
    buildUnplannedShipmentExecutionCountQuery(
      ctx.shipmentCtx.shipmentBaseCteSql,
      ctx.shipmentCtx.outerSql,
    ),
    shipmentParams,
  );
  const shipmentRows = parseInt(String(shipmentRes.rows[0]?.c ?? '0'), 10) || 0;
  return {
    contractRows,
    shipmentRows,
    totalTableRows: contractRows + shipmentRows,
    contractQtyKg,
    outstandingQtyKg,
  };
}

/** @deprecated Use countHybridBreakdown */
export async function countUnplannedHybridBreakdown(
  ctx: UnplannedHybridListContext,
): Promise<UnplannedHybridBreakdown> {
  return countHybridBreakdown(ctx);
}

async function fetchContractBacklogPage(
  ctx: UnplannedHybridListContext,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  if (limit <= 0) return [];
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const sortKey = ctx.shipmentCtx.sortKey ?? 'created_at';
  const sortDir = ctx.shipmentCtx.sortDir ?? 'DESC';
  const text =
    ctx.contractBacklogMode === 'completed'
      ? buildCompletedContractBacklogPageQuery(
          contractScopeSql,
          toolbarSql,
          limit,
          offset,
          sortKey,
          sortDir,
        )
      : ctx.contractBacklogMode === 'all'
      ? buildAllHybridContractBacklogPageQuery(
          contractScopeSql,
          toolbarSql,
          limit,
          offset,
          sortKey,
          sortDir,
        )
      : buildUnplannedContractBacklogPageQuery(
          contractScopeSql,
          toolbarSql,
          limit,
          offset,
          sortKey,
          sortDir,
        );
  const result = await query(text, params);
  return result.rows as Record<string, unknown>[];
}

async function fetchShipmentExecutionPage(
  ctx: ShipmentListQueryContext,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  if (limit <= 0) return [];

  const { text, params } = buildShipmentListEnrichedPageQuery(ctx, limit, offset);
  const result = await query(text, params);
  const rows = normalizeShipmentListRows(result.rows as Record<string, unknown>[]);
  for (const row of rows) {
    row.row_kind = 'shipment_execution';
  }
  return rows;
}

type HybridListResult = ShipmentListResponseData & { unplannedBreakdown: UnplannedHybridBreakdown };

/*
 * Response cache for the hybrid list.
 *
 * The default Shipments request (status empty or 'ALL') is routed here by
 * isAllHybridListRequest, NOT through loadShipmentListPage - so it never touched PAGE_CACHE and
 * every single page load re-ran three queries: countHybridBreakdown plus the contract-backlog
 * and shipment-execution pages. Measured on a restore of staging: two identical back-to-back
 * requests both cost ~4s, and that repeated work is a direct contributor to the staging CPU
 * spikes, because the most-opened page in the app never served anything from memory.
 *
 * Same TTL and eviction bound as PAGE_CACHE so behaviour is consistent across list paths, plus
 * in-flight sharing: concurrent identical requests (several users, or a refresh burst) run the
 * queries once and all receive that result.
 *
 * Registered with the invalidation registry so an edit clears it - without that a cached list
 * would keep showing pre-edit rows.
 */

export function invalidateHybridShipmentsListCache(): void {
  HYBRID_CACHE.clear();
}

registerListCacheInvalidator(invalidateHybridShipmentsListCache);

function evictHybridCacheIfNeeded(): void {
  const now = Date.now();
  for (const [key, entry] of HYBRID_CACHE) {
    if (entry.expiresAt <= now) HYBRID_CACHE.delete(key);
  }
  if (HYBRID_CACHE.size <= HYBRID_MAX_CACHE_ENTRIES) return;
  const sorted = [...HYBRID_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let i = 0; i < HYBRID_CACHE.size - HYBRID_MAX_CACHE_ENTRIES; i += 1) {
    HYBRID_CACHE.delete(sorted[i][0]);
  }
}

export async function resolveHybridShipmentsList(
  req: AuthRequest,
  ctx: UnplannedHybridListContext,
): Promise<HybridListResult> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));

  // ctx.shipmentCtx.cacheKey already encodes every filter plus the hybrid mode suffix
  // ('all-hybrid' / 'unplanned-hybrid'); the result is paged, so page and limit complete it.
  const cacheKey = `${ctx.shipmentCtx.cacheKey}:p${pageNum}:l${limitNum}`;

  const cached = HYBRID_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  if (cached) HYBRID_CACHE.delete(cacheKey);

  const inFlight = HYBRID_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = computeHybridShipmentsList(ctx, pageNum, limitNum)
    .then((data) => {
      HYBRID_CACHE.set(cacheKey, { data, expiresAt: Date.now() + HYBRID_CACHE_TTL_MS });
      evictHybridCacheIfNeeded();
      return data;
    })
    .finally(() => {
      HYBRID_IN_FLIGHT.delete(cacheKey);
    });

  HYBRID_IN_FLIGHT.set(cacheKey, run);
  return run;
}

/** Unchanged hybrid list computation - extracted so the cache wraps it without altering it. */
async function computeHybridShipmentsList(
  ctx: UnplannedHybridListContext,
  pageNum: number,
  limitNum: number,
): Promise<HybridListResult> {
  const offset = (pageNum - 1) * limitNum;

  const breakdown = await countHybridBreakdown(ctx);
  const { shipmentRows: executionRows, totalTableRows } = breakdown;

  const sortKey = ctx.shipmentCtx.sortKey ?? 'created_at';
  const sortDir = ctx.shipmentCtx.sortDir ?? 'DESC';
  const isUnplannedPoOnly = ctx.contractBacklogMode === 'unplanned';

  let contractPage: Record<string, unknown>[];
  let shipmentPage: Record<string, unknown>[] = [];
  let shipments: ShipmentListResponseData['shipments'];

  /** Unplanned = PO backlog page only (no STO execution merge). */
  if (isUnplannedPoOnly) {
    contractPage = await fetchContractBacklogPage(ctx, limitNum, offset);
    for (const row of contractPage) {
      row.status = 'UNPLANNED';
      row.row_kind = 'contract_backlog';
    }
    shipments = normalizeShipmentListRows(
      contractPage as Record<string, unknown>[],
    ) as ShipmentListResponseData['shipments'];
    shipments = sortShipmentListRows(shipments, sortKey, sortDir);
  } else {
    const useGlobalSort = hybridListUsesGlobalMergeSort(sortKey);

    if (useGlobalSort) {
      /**
       * Fetch top (offset+limit) from each sorted stream, merge-sort, then page.
       * Any global top-K row is within the top-K of at least one side.
       */
      const need = offset + limitNum;
      const [contractPool, shipmentPool] = await Promise.all([
        fetchContractBacklogPage(ctx, need, 0),
        fetchShipmentExecutionPage(ctx.shipmentCtx, need, 0),
      ]);
      contractPage = contractPool;
      shipmentPage = shipmentPool;
      for (const row of contractPage) {
        if (
          String(row.status ?? '').trim().toUpperCase() !== 'PREPLANNED'
          && String(row.status ?? '').trim().toUpperCase() !== 'COMPLETED'
        ) {
          row.status = 'UNPLANNED';
        }
        row.row_kind = 'contract_backlog';
      }
      const mergedRows = normalizeShipmentListRows([
        ...shipmentPage,
        ...contractPage,
      ] as Record<string, unknown>[]) as ShipmentListResponseData['shipments'];
      shipments = sortShipmentListRows(mergedRows, sortKey, sortDir).slice(
        offset,
        offset + limitNum,
      );
    } else {
      const slices = computeHybridListPageSlices({
        offset,
        limit: limitNum,
        executionRows,
      });

      [contractPage, shipmentPage] = await Promise.all([
        fetchContractBacklogPage(ctx, slices.contractLimit, slices.contractOffset),
        fetchShipmentExecutionPage(ctx.shipmentCtx, slices.executionLimit, slices.executionOffset),
      ]);

      for (const row of contractPage) {
        if (
          String(row.status ?? '').trim().toUpperCase() !== 'PREPLANNED'
          && String(row.status ?? '').trim().toUpperCase() !== 'COMPLETED'
        ) {
          row.status = 'UNPLANNED';
        }
        row.row_kind = 'contract_backlog';
      }

      const mergedRows = normalizeShipmentListRows([
        ...shipmentPage,
        ...contractPage,
      ] as Record<string, unknown>[]) as ShipmentListResponseData['shipments'];
      shipments = sortShipmentListRows(mergedRows, sortKey, sortDir);
    }
  }

  return {
    shipments,
    pagination: {
      total: totalTableRows,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalTableRows / limitNum) || 0,
    },
    unplannedBreakdown: breakdown,
  };
}

export async function resolveAllHybridShipmentsList(
  req: AuthRequest,
  ctx: UnplannedHybridListContext,
): Promise<ShipmentListResponseData & { unplannedBreakdown: UnplannedHybridBreakdown }> {
  return resolveHybridShipmentsList(req, ctx);
}

export async function resolveUnplannedHybridShipmentsList(
  req: AuthRequest,
  ctx: UnplannedHybridListContext,
): Promise<ShipmentListResponseData & { unplannedBreakdown: UnplannedHybridBreakdown }> {
  return resolveHybridShipmentsList(req, ctx);
}

export async function resolveCompletedHybridShipmentsList(
  req: AuthRequest,
  ctx: UnplannedHybridListContext,
): Promise<ShipmentListResponseData & { unplannedBreakdown: UnplannedHybridBreakdown }> {
  return resolveHybridShipmentsList(req, ctx);
}

export function isAllHybridListRequest(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return !normalized || normalized === 'ALL';
}

export function isUnplannedHybridListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'UNPLANNED';
}

export function isCompletedHybridListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'COMPLETED';
}

/**
 * ALL table merges execution + Unplanned/Preplanned/Completed-OS backlog.
 * Keep this true for 10-digit PO/STO search — otherwise Unplanned POs vanish from ALL.
 */
export function shouldResolveAllHybridShipmentsList(status: unknown): boolean {
  return isAllHybridListRequest(status);
}

/** Completed card also includes PO backlog with remaining OS ≤ 1 MT (no shipment row). */
export function shouldResolveCompletedHybridShipmentsList(status: unknown): boolean {
  return isCompletedHybridListRequest(status);
}

export function isPreplannedListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'PREPLANNED';
}

function buildPreplannedBreakdownCacheKey(ctx: PreplannedListContext): string {
  if (ctx.cacheKey && ctx.cacheKey.trim()) return ctx.cacheKey;
  return `preplanned-breakdown:${JSON.stringify({
    contractScope: ctx.contractScope,
    globalSearch: ctx.globalSearch,
    colFilters: ctx.colFilters,
  })}`;
}

async function computePreplannedContractsBreakdown(
  ctx: PreplannedListContext,
): Promise<PreplannedContractsBreakdown> {
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const res = await query(
    buildPreplannedContractsCountQuery(contractScopeSql, toolbarSql),
    params,
  );
  const contractRows = parseInt(String(res.rows[0]?.contract_count ?? '0'), 10) || 0;
  const groupCount = parseInt(String(res.rows[0]?.group_count ?? '0'), 10) || 0;
  const contractQtyKg = Number(res.rows[0]?.contract_qty_kg ?? 0) || 0;
  const outstandingQtyKg = Number(res.rows[0]?.outstanding_qty_kg ?? 0) || 0;
  return { contractRows, groupCount, totalTableRows: contractRows, contractQtyKg, outstandingQtyKg };
}

export async function countPreplannedContracts(
  ctx: PreplannedListContext,
): Promise<PreplannedContractsBreakdown> {
  const cacheKey = buildPreplannedBreakdownCacheKey(ctx);
  const cached = PREPLANNED_BREAKDOWN_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  if (cached) PREPLANNED_BREAKDOWN_CACHE.delete(cacheKey);

  const inFlight = PREPLANNED_BREAKDOWN_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = computePreplannedContractsBreakdown(ctx)
    .then((data) => {
      PREPLANNED_BREAKDOWN_CACHE.set(cacheKey, {
        data,
        expiresAt: Date.now() + HYBRID_CACHE_TTL_MS,
      });
      if (PREPLANNED_BREAKDOWN_CACHE.size > HYBRID_MAX_CACHE_ENTRIES) {
        const oldest = [...PREPLANNED_BREAKDOWN_CACHE.entries()].sort(
          (a, b) => a[1].expiresAt - b[1].expiresAt,
        )[0];
        if (oldest) PREPLANNED_BREAKDOWN_CACHE.delete(oldest[0]);
      }
      return data;
    })
    .finally(() => {
      PREPLANNED_BREAKDOWN_IN_FLIGHT.delete(cacheKey);
    });

  PREPLANNED_BREAKDOWN_IN_FLIGHT.set(cacheKey, run);
  return run;
}

export async function resolvePreplannedContractsList(
  req: AuthRequest,
  ctx: PreplannedListContext,
): Promise<ShipmentListResponseData & { preplannedBreakdown: PreplannedContractsBreakdown }> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));
  const offset = (pageNum - 1) * limitNum;

  const breakdown = await countPreplannedContracts(ctx);
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const text = buildPreplannedContractsPageQuery(
    contractScopeSql,
    toolbarSql,
    limitNum,
    offset,
  );
  const result = await query(text, params);
  const contractPage = result.rows as Record<string, unknown>[];

  for (const row of contractPage) {
    row.status = 'PREPLANNED';
    row.row_kind = 'contract_backlog';
  }

  const shipments = normalizeShipmentListRows(contractPage) as ShipmentListResponseData['shipments'];
  // normalizeShipmentListRows defaults contract_backlog → UNPLANNED; restore PREPLANNED.
  for (const row of shipments) {
    (row as { status?: string }).status = 'PREPLANNED';
  }

  return {
    shipments,
    pagination: {
      total: breakdown.groupCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(breakdown.groupCount / limitNum) || 0,
    },
    preplannedBreakdown: breakdown,
  };
}

function buildCompletedBreakdownCacheKey(ctx: PreplannedListContext): string {
  if (ctx.cacheKey && ctx.cacheKey.trim()) return ctx.cacheKey;
  return `completed-backlog:${JSON.stringify({
    contractScope: ctx.contractScope,
    globalSearch: ctx.globalSearch,
    colFilters: ctx.colFilters,
  })}`;
}

async function computeCompletedContractBacklogBreakdown(
  ctx: PreplannedListContext,
): Promise<CompletedContractBacklogBreakdown> {
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const res = await query(
    buildCompletedContractBacklogCountQuery(contractScopeSql, toolbarSql),
    params,
  );
  const contractRows = parseInt(String(res.rows[0]?.c ?? '0'), 10) || 0;
  const contractQtyKg = Number(res.rows[0]?.contract_qty_kg ?? 0) || 0;
  const outstandingQtyKg = Number(res.rows[0]?.outstanding_qty_kg ?? 0) || 0;
  return { contractRows, totalTableRows: contractRows, contractQtyKg, outstandingQtyKg };
}

export async function countCompletedContractBacklog(
  ctx: PreplannedListContext,
): Promise<CompletedContractBacklogBreakdown> {
  const cacheKey = buildCompletedBreakdownCacheKey(ctx);
  const cached = COMPLETED_BREAKDOWN_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  if (cached) COMPLETED_BREAKDOWN_CACHE.delete(cacheKey);

  const inFlight = COMPLETED_BREAKDOWN_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = computeCompletedContractBacklogBreakdown(ctx)
    .then((data) => {
      COMPLETED_BREAKDOWN_CACHE.set(cacheKey, {
        data,
        expiresAt: Date.now() + HYBRID_CACHE_TTL_MS,
      });
      if (COMPLETED_BREAKDOWN_CACHE.size > HYBRID_MAX_CACHE_ENTRIES) {
        const oldest = [...COMPLETED_BREAKDOWN_CACHE.entries()].sort(
          (a, b) => a[1].expiresAt - b[1].expiresAt,
        )[0];
        if (oldest) COMPLETED_BREAKDOWN_CACHE.delete(oldest[0]);
      }
      return data;
    })
    .finally(() => {
      COMPLETED_BREAKDOWN_IN_FLIGHT.delete(cacheKey);
    });

  COMPLETED_BREAKDOWN_IN_FLIGHT.set(cacheKey, run);
  return run;
}
