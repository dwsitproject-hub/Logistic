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
  appendUnplannedContractBacklogColumnFilters,
  appendUnplannedContractBacklogGlobalSearch,
  buildUnplannedContractBacklogCountQuery,
  buildUnplannedContractBacklogPageQuery,
  buildAllHybridContractBacklogCountQuery,
  buildAllHybridContractBacklogPageQuery,
  buildUnplannedShipmentExecutionCountQuery,
  buildUnplannedContractToolbarScope,
  buildPreplannedContractsCountQuery,
  buildPreplannedContractsPageQuery,
  unplannedShipmentExecutionOuterSql,
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
  /** ALL hybrid merges unplanned + preplanned backlog; UNPLANNED hybrid uses unplanned only. */
  contractBacklogMode?: 'unplanned' | 'all';
}

export interface UnplannedHybridBreakdown {
  contractRows: number;
  shipmentRows: number;
  totalTableRows: number;
  /** Sum of quantity_ordered (kg) for the unplanned contract backlog (no shipment row yet). */
  contractQtyKg: number;
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
}

/** Contract-scope filters shared by Unplanned backlog and Preplanned list. */
export type PreplannedListContext = Pick<
  UnplannedHybridListContext,
  'contractScope' | 'globalSearch' | 'colFilters'
>;

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

/** Same scope as the Unplanned hybrid table (toolbar + backlog filters + execution predicate). */
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
}): UnplannedHybridListContext {
  return buildShipmentHybridListContext({
    ...input,
    executionOuterSql: unplannedShipmentExecutionOuterSql(input.toolbarOuterSql),
    cacheKeySuffix: 'unplanned-hybrid',
  });
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
}): UnplannedHybridListContext {
  return {
    ...buildShipmentHybridListContext({
      ...input,
      executionOuterSql: input.toolbarOuterSql,
      cacheKeySuffix: 'all-hybrid',
    }),
    contractBacklogMode: 'all',
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
    },
    contractScope: input.contractScope,
    globalSearch: input.globalSearch,
    colFilters: input.colFilters,
    contractBacklogMode: 'all',
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

export function invalidateHybridBreakdownCache(): void {
  BREAKDOWN_CACHE.clear();
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
  const shipmentParams = [...ctx.shipmentCtx.innerParams, ...ctx.shipmentCtx.outerParams];

  const [contractRes, shipmentRes] = await Promise.all([
    query(
      ctx.contractBacklogMode === 'all'
        ? buildAllHybridContractBacklogCountQuery(contractScopeSql, toolbarSql)
        : buildUnplannedContractBacklogCountQuery(contractScopeSql, toolbarSql),
      contractParams,
    ),
    query(
      buildUnplannedShipmentExecutionCountQuery(
        ctx.shipmentCtx.shipmentBaseCteSql,
        ctx.shipmentCtx.outerSql,
      ),
      shipmentParams,
    ),
  ]);

  const contractRows = parseInt(String(contractRes.rows[0]?.c ?? '0'), 10) || 0;
  const shipmentRows = parseInt(String(shipmentRes.rows[0]?.c ?? '0'), 10) || 0;
  const contractQtyKg = Number(contractRes.rows[0]?.contract_qty_kg ?? 0) || 0;
  return { contractRows, shipmentRows, totalTableRows: contractRows + shipmentRows, contractQtyKg };
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
  const text =
    ctx.contractBacklogMode === 'all'
      ? buildAllHybridContractBacklogPageQuery(contractScopeSql, toolbarSql, limit, offset)
      : buildUnplannedContractBacklogPageQuery(contractScopeSql, toolbarSql, limit, offset);
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

  const slices = computeHybridListPageSlices({
    offset,
    limit: limitNum,
    executionRows,
  });

  const [contractPage, shipmentPage] = await Promise.all([
    fetchContractBacklogPage(ctx, slices.contractLimit, slices.contractOffset),
    fetchShipmentExecutionPage(ctx.shipmentCtx, slices.executionLimit, slices.executionOffset),
  ]);

  for (const row of contractPage) {
    if (String(row.status ?? '').trim().toUpperCase() !== 'PREPLANNED') {
      row.status = 'UNPLANNED';
    }
    row.row_kind = 'contract_backlog';
  }

  const shipments = normalizeShipmentListRows([
    ...shipmentPage,
    ...contractPage,
  ] as Record<string, unknown>[]) as ShipmentListResponseData['shipments'];

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

export function isAllHybridListRequest(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return !normalized || normalized === 'ALL';
}

export function isUnplannedHybridListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'UNPLANNED';
}

export function isPreplannedListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'PREPLANNED';
}

export async function countPreplannedContracts(
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
  return { contractRows, groupCount, totalTableRows: contractRows, contractQtyKg };
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
