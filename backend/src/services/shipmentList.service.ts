import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { deriveShipmentStatus, SHIPMENT_STATUS_RANK } from '../utils/shipmentStatus';
import {
  isPipelineDailySummaryEligible,
  loadShipmentSummaryFromDaily,
  markPipelineDailySummaryStale,
  toPipelineDailySummaryScope,
  type PipelineDailySummaryFilterInput,
} from './pipelineDailySummary.service';
import { parseColumnFiltersQuery } from '../utils/shipmentListFilters';
import { resolveContractLogisticsStoNumber } from '../utils/contractLogisticsStoDisplay';
import { shipmentListSpdAggCtes } from '../utils/shipmentListSapAggSql';
import { SHIPMENT_LIST_STO_JOIN_SQL } from '../utils/shipmentListStoJoinSql';
import {
  shipmentListQtyMoveCteFromPage,
} from '../utils/shipmentOutstandingQtySql';
import { shipmentListPageQtySelectSql } from '../utils/shipmentListQtySql';
import { buildListOrderByWithSapStoPriority } from '../utils/listSapStoPrioritySql';
import {
  mergeShipmentVesselFromSapRow,
  queueShipmentVesselSapBackfill,
} from './shipmentVesselFromSap.service';
import { ListCacheKeepWarm } from '../utils/listCacheKeepWarm';
import { runQueriesInBatches } from '../utils/runQueriesInBatches';
import {
  buildShipmentOutstandingQtyBacklogAggregateQuery,
  buildShipmentOutstandingQtyExecutionAggregateQuery,
  mergeShipmentOutstandingQtySummaries,
  parseShipmentOutstandingQtySummaryRow,
  type ShipmentOutstandingQtySummary,
} from '../utils/shipmentOutstandingQtySummarySql';
import {
  appendUnplannedContractBacklogColumnFilters,
  appendUnplannedContractBacklogGlobalSearch,
  buildUnplannedContractToolbarScope,
} from '../utils/shipmentUnplannedHybridSql';
import {
  buildShipmentStatusCardQtyExecutionAggregateQuery,
  mergeShipmentStatusCardQtyParts,
  parseShipmentStatusContractQtyFromExecutionRow,
  parseShipmentStatusOutstandingQtyFromSqlRow,
  type ShipmentStatusCardQtyBundle,
  type ShipmentStatusContractQtyKg,
  type ShipmentStatusOutstandingQtyKg,
} from '../utils/shipmentStatusCardQtySql';
import {
  parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow,
} from '../utils/shipmentSection1CombinedSummarySql';
import {
  buildShipmentCarryOverInsightsQuery,
  buildShipmentOverdueBacklogAggregateQuery,
  buildShipmentOverdueBacklogTopSuppliersQuery,
  buildShipmentOverdueExecutionAggregateQuery,
  buildShipmentOverdueExecutionTopSuppliersQuery,
  buildShipmentOverdueTopVesselsQuery,
  parseShipmentAttentionInsights,
  type ShipmentAttentionInsightsRow,
} from '../utils/shipmentAttentionInsightsSql';

/**
 * Shipments compact list API:
 * - Summary: SQL aggregate only (handled in shipment.controller — not this module)
 * - Table page: DB pagination (limit/offset) + optional SAP join scoped to the current page
 * - skipSapJoin=true  → fast shell rows (no sap_processed_data)
 * - skipSapJoin=false → same page with SAP qty / contract ext no hydrated
 */

export type ShipmentListRow = Record<string, unknown>;

export interface ShipmentListQueryContext {
  /** Base CTE chain: full scan or STO-key paged (`shipmentBaseCteSqlList`). */
  shipmentBaseCteSql: string;
  /** Toolbar + card filters (status, ETA buckets, etc.) */
  outerSql: string;
  innerParams: unknown[];
  outerParams: unknown[];
  skipSapJoin: boolean;
  /** Page + SAP mode cache key */
  cacheKey: string;
  /** Filter-only cache key (shared count across shell/hydrate) */
  filterCacheKey: string;
  /** When true, `paged_sto` limits keys in base CTE; total from `ranked_sto`. */
  usesStoKeyPaging?: boolean;
  /** Active pipeline stage filter for table ordering (UNPLANNED / PLANNED STO priority). */
  tableStatusFilter?: string;
}

export interface ShipmentListResponseData {
  shipments: ShipmentListRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const PAGE_CACHE = new Map<string, { rows: ShipmentListRow[]; total: number; expiresAt: number }>();
const COUNT_CACHE = new Map<string, { total: number; expiresAt: number }>();
const SUMMARY_CACHE = new Map<
  string,
  { summaryRow: Record<string, unknown>; totalCount: number; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 'shipment-list-v33';
const MAX_CACHE_ENTRIES = 80;
const OUTSTANDING_QTY_CACHE = new Map<
  string,
  { summary: ShipmentOutstandingQtySummary; expiresAt: number }
>();

// Re-runs recent page loads in the background (refresh-ahead + re-warm after edits)
// so users are served from the cache instead of paying the full query cost. Does not
// change responses — it only re-runs the identical loader off the request path.
const PAGE_KEEP_WARM = new ListCacheKeepWarm({ cacheTtlMs: CACHE_TTL_MS });

function stableColumnFiltersKey(colFilters: Record<string, unknown>): string {
  const keys = Object.keys(colFilters).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) norm[k] = colFilters[k];
  return JSON.stringify(norm);
}

export function buildShipmentListFilterCacheKey(input: {
  vessel?: unknown;
  port?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  delayed?: unknown;
  sto?: unknown;
  contract?: unknown;
  plants: string[];
  globalSearch: string;
  colFilters: Record<string, unknown>;
  lateIndicator?: string;
  viewOption?: string;
  viewQuery?: string;
  status?: string;
  etaLoading?: string;
  etaDischarge?: string;
}): string {
  return buildShipmentListCacheKey({
    ...input,
    skipSapJoin: false,
    page: 1,
    limit: 1,
  });
}

export function buildShipmentListCacheKey(input: {
  vessel?: unknown;
  port?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  delayed?: unknown;
  sto?: unknown;
  contract?: unknown;
  plants: string[];
  globalSearch: string;
  colFilters: Record<string, unknown>;
  lateIndicator?: string;
  viewOption?: string;
  viewQuery?: string;
  skipSapJoin: boolean;
  page?: number;
  limit?: number;
  status?: string;
  etaLoading?: string;
  etaDischarge?: string;
}): string {
  const norm = {
    vessel: input.vessel != null ? String(input.vessel) : '',
    port: input.port != null ? String(input.port) : '',
    dateFrom: input.dateFrom != null ? String(input.dateFrom) : '',
    dateTo: input.dateTo != null ? String(input.dateTo) : '',
    delayed: input.delayed != null ? String(input.delayed) : '',
    sto: input.sto != null ? String(input.sto) : '',
    contract: input.contract != null ? String(input.contract) : '',
    plants: [...input.plants].sort(),
    globalSearch: input.globalSearch,
    columnFilters: stableColumnFiltersKey(input.colFilters),
    lateIndicator: input.lateIndicator != null ? String(input.lateIndicator) : '',
    viewOption: input.viewOption != null ? String(input.viewOption) : '',
    viewQuery: input.viewQuery != null ? String(input.viewQuery) : '',
    skipSapJoin: input.skipSapJoin,
    page: input.page ?? 1,
    limit: input.limit ?? 20,
    status: input.status != null ? String(input.status) : 'ALL',
    etaLoading: input.etaLoading != null ? String(input.etaLoading) : 'ALL',
    etaDischarge: input.etaDischarge != null ? String(input.etaDischarge) : 'ALL',
  };
  return `${CACHE_VERSION}:${JSON.stringify(norm)}`;
}

export function buildShipmentListCountCacheKey(filterCacheKey: string): string {
  return `${filterCacheKey}:count`;
}

export function buildShipmentSummaryCacheKey(filterCacheKey: string, scopeStatus?: string): string {
  return `${filterCacheKey}:summary:${scopeStatus ?? ''}:attention-v1`;
}

export function buildShipmentOutstandingQtyCacheKey(filterCacheKey: string): string {
  // OS strip is always active-scope (Unplanned … before Completed), not per status card.
  return `${filterCacheKey}:outstanding-qty:active`;
}

export type { ShipmentOutstandingQtySummary };
export type {
  ShipmentStatusCardQtyBundle,
  ShipmentStatusContractQtyKg,
  ShipmentStatusOutstandingQtyKg,
};

export function buildShipmentStatusCardQtyCacheKey(filterCacheKey: string): string {
  return `${filterCacheKey}:status-card-qty:v1`;
}

const STATUS_CARD_QTY_CACHE = new Map<
  string,
  { bundle: ShipmentStatusCardQtyBundle; expiresAt: number }
>();
const STATUS_CARD_QTY_IN_FLIGHT = new Map<string, Promise<ShipmentStatusCardQtyBundle>>();
const OUTSTANDING_QTY_IN_FLIGHT = new Map<string, Promise<ShipmentOutstandingQtySummary>>();

/** Backlog qty parts already computed by the Unplanned/Preplanned breakdown queries. */
export interface ShipmentStatusCardQtyBacklogParts {
  unplannedBacklogContractQtyKg: number;
  preplannedContractQtyKg: number;
}

/**
 * Merge backlog/preplanned into execution qty fields from a combined summary row.
 * `backlogParts` must come from the same-request Unplanned/Preplanned breakdown (Section 1
 * already computes those) — do NOT re-query here, that was firing the identical
 * Preplanned-count SQL twice per request.
 */
export async function mergeShipmentStatusCardQtyFromCombinedSummaryRow(
  summaryRow: Record<string, unknown>,
  backlogParts: ShipmentStatusCardQtyBacklogParts,
): Promise<ShipmentStatusCardQtyBundle> {
  const executionPartial = parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow(summaryRow);
  return mergeShipmentStatusCardQtyParts({
    execution: {
      unplannedExecution: executionPartial.statusContractQty.unplanned,
      planned: executionPartial.statusContractQty.planned,
      completed: executionPartial.statusContractQty.completed,
      cancelled: executionPartial.statusContractQty.cancelled,
    },
    unplannedBacklogContractQtyKg: backlogParts.unplannedBacklogContractQtyKg,
    preplannedContractQtyKg: backlogParts.preplannedContractQtyKg,
    outstanding: executionPartial.statusOutstandingQty,
  });
}

function summaryRowHasCombinedStatusCardQty(summaryRow: Record<string, unknown>): boolean {
  return (
    summaryRow.planned_contract_qty != null ||
    summaryRow.unplanned_execution_contract_qty != null ||
    summaryRow.at_loading_port_outstanding_qty != null
  );
}

/**
 * Per-card Contract Qty / Outstanding Qty for Section 1 status rectangles.
 * Scoped by Global Filters (toolbar) — same scope as status counts.
 */
export async function loadShipmentStatusCardQtyForRequest(
  opts: {
    shipmentBaseCteSql: string;
    toolbarOuterSql: string;
    innerParams: unknown[];
    toolbarOuterParams: unknown[];
    filterCacheKey: string;
  },
  backlogParts: ShipmentStatusCardQtyBacklogParts,
): Promise<ShipmentStatusCardQtyBundle> {
  const cacheKey = buildShipmentStatusCardQtyCacheKey(opts.filterCacheKey);
  const cached = STATUS_CARD_QTY_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.bundle;
  }
  if (cached) STATUS_CARD_QTY_CACHE.delete(cacheKey);

  const inFlight = STATUS_CARD_QTY_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = (async () => {
    const baseParams = [...opts.innerParams, ...opts.toolbarOuterParams];
    const execText = buildShipmentStatusCardQtyExecutionAggregateQuery(
      opts.shipmentBaseCteSql,
      opts.toolbarOuterSql,
    );
    const execRes = await query(execText, baseParams);
    const execution = parseShipmentStatusContractQtyFromExecutionRow(
      (execRes.rows[0] || {}) as Record<string, unknown>,
    );
    const outstanding = parseShipmentStatusOutstandingQtyFromSqlRow(
      (execRes.rows[0] || {}) as Record<string, unknown>,
    );
    const bundle = mergeShipmentStatusCardQtyParts({
      execution,
      unplannedBacklogContractQtyKg: backlogParts.unplannedBacklogContractQtyKg,
      preplannedContractQtyKg: backlogParts.preplannedContractQtyKg,
      outstanding,
    });
    STATUS_CARD_QTY_CACHE.set(cacheKey, {
      bundle,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    evictMapIfNeeded(STATUS_CARD_QTY_CACHE, MAX_CACHE_ENTRIES);
    return bundle;
  })().finally(() => STATUS_CARD_QTY_IN_FLIGHT.delete(cacheKey));

  STATUS_CARD_QTY_IN_FLIGHT.set(cacheKey, run);
  return run;
}

export { summaryRowHasCombinedStatusCardQty };

/**
 * Outstanding Qty strip for Section 1 (FOB/CIF × Interco / 3rd Party).
 * Scoped by Global Filters only — static across status cards (active stages only).
 */
export async function loadShipmentOutstandingQtyForRequest(
  req: AuthRequest,
  opts: {
    shipmentBaseCteSql: string;
    toolbarOuterSql: string;
    innerParams: unknown[];
    toolbarOuterParams: unknown[];
    filterCacheKey: string;
  },
): Promise<ShipmentOutstandingQtySummary> {
  const cacheKey = buildShipmentOutstandingQtyCacheKey(opts.filterCacheKey);
  const cached = OUTSTANDING_QTY_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.summary;
  }
  if (cached) OUTSTANDING_QTY_CACHE.delete(cacheKey);

  const inFlight = OUTSTANDING_QTY_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const run = (async () => {
    const baseParams = [...opts.innerParams, ...opts.toolbarOuterParams];
    const execQ = buildShipmentOutstandingQtyExecutionAggregateQuery(
      opts.shipmentBaseCteSql,
      opts.toolbarOuterSql,
      baseParams,
      null,
    );
    const execPromise = query(execQ.text, execQ.params).then((res) =>
      parseShipmentOutstandingQtySummaryRow((res.rows[0] || {}) as Record<string, unknown>),
    );

    const { dateFrom, dateTo, contract, plant } = req.query;
    const globalSearch =
      typeof (req.query as { search?: string }).search === 'string'
        ? (req.query as { search?: string }).search!.trim()
        : '';
    const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
    const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
    const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
    const scope = buildUnplannedContractToolbarScope({ dateFrom, dateTo, contract, plants });
    let idx = scope.params.length + 1;
    const g = appendUnplannedContractBacklogGlobalSearch(globalSearch, idx);
    idx = g.nextIndex;
    const c = appendUnplannedContractBacklogColumnFilters(colFilters, idx);
    const backlogText = buildShipmentOutstandingQtyBacklogAggregateQuery(
      scope.sql,
      `${g.sql}${c.sql}`,
    );
    const backlogParams = [...scope.params, ...g.params, ...c.params];

    const [execution, backlog] = await Promise.all([
      execPromise,
      query(backlogText, backlogParams).then((res) =>
        parseShipmentOutstandingQtySummaryRow((res.rows[0] || {}) as Record<string, unknown>),
      ),
    ]);
    const merged = mergeShipmentOutstandingQtySummaries(execution, backlog);
    OUTSTANDING_QTY_CACHE.set(cacheKey, {
      summary: merged,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    evictMapIfNeeded(OUTSTANDING_QTY_CACHE, MAX_CACHE_ENTRIES);
    return merged;
  })().finally(() => OUTSTANDING_QTY_IN_FLIGHT.delete(cacheKey));

  OUTSTANDING_QTY_IN_FLIGHT.set(cacheKey, run);
  return run;
}

export type { ShipmentAttentionInsightsRow };

/**
 * Attention Needed + Aging Overdue for Section 1 (toolbar-scoped, live SQL).
 */
export async function loadShipmentAttentionInsightsForRequest(
  req: AuthRequest,
  opts: {
    shipmentBaseCteSql: string;
    toolbarOuterSql: string;
    innerParams: unknown[];
    toolbarOuterParams: unknown[];
    filterCacheKey: string;
  },
  totalOutstandingKg?: number | null | Promise<number | null | undefined>,
): Promise<ShipmentAttentionInsightsRow> {
  const baseParams = [...opts.innerParams, ...opts.toolbarOuterParams];

  const { dateFrom, dateTo, contract, plant } = req.query;
  const globalSearch =
    typeof (req.query as { search?: string }).search === 'string'
      ? (req.query as { search?: string }).search!.trim()
      : '';
  const colFilters = parseColumnFiltersQuery((req.query as { columnFilters?: string }).columnFilters);
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  const scope = buildUnplannedContractToolbarScope({ dateFrom, dateTo, contract, plants });
  let idx = scope.params.length + 1;
  const g = appendUnplannedContractBacklogGlobalSearch(globalSearch, idx);
  idx = g.nextIndex;
  const c = appendUnplannedContractBacklogColumnFilters(colFilters, idx);
  const backlogParams = [...scope.params, ...g.params, ...c.params];
  const backlogToolbarSql = `${g.sql}${c.sql}`;

  const totalOsKgPromise =
    totalOutstandingKg != null && typeof (totalOutstandingKg as Promise<unknown>).then === 'function'
      ? (totalOutstandingKg as Promise<number | null | undefined>)
      : totalOutstandingKg != null
        ? Promise.resolve(totalOutstandingKg)
        : loadShipmentOutstandingQtyForRequest(req, opts).then((s) => s.totalKg);

  const [
    backlogAggRes,
    execAggRes,
    backlogTopRes,
    execTopRes,
    topVesselsRes,
    carryRes,
  ] = await runQueriesInBatches([
    () => query(
      buildShipmentOverdueBacklogAggregateQuery(scope.sql, backlogToolbarSql),
      backlogParams,
    ),
    () => query(buildShipmentOverdueExecutionAggregateQuery(opts.shipmentBaseCteSql, opts.toolbarOuterSql), baseParams),
    () => query(
      buildShipmentOverdueBacklogTopSuppliersQuery(scope.sql, backlogToolbarSql, 3),
      backlogParams,
    ),
    () => query(
      buildShipmentOverdueExecutionTopSuppliersQuery(opts.shipmentBaseCteSql, opts.toolbarOuterSql, 3),
      baseParams,
    ),
    () => query(
      buildShipmentOverdueTopVesselsQuery(opts.shipmentBaseCteSql, opts.toolbarOuterSql, 3),
      baseParams,
    ),
    () => query(buildShipmentCarryOverInsightsQuery(scope.sql, backlogToolbarSql), backlogParams),
  ]);

  const totalOsKg = await totalOsKgPromise;

  return parseShipmentAttentionInsights({
    backlogAggregateRow: (backlogAggRes.rows[0] || {}) as Record<string, unknown>,
    executionAggregateRow: (execAggRes.rows[0] || {}) as Record<string, unknown>,
    backlogTopSupplierRows: backlogTopRes.rows as Record<string, unknown>[],
    executionTopSupplierRows: execTopRes.rows as Record<string, unknown>[],
    topVesselRows: topVesselsRes.rows as Record<string, unknown>[],
    carryRow: (carryRes.rows[0] || {}) as Record<string, unknown>,
    lossRows: [],
    totalOutstandingKg: totalOsKg,
  });
}

export type ShipmentSummaryUnplannedBreakdown = {
  contractRows: number;
  shipmentRows: number;
  totalTableRows: number;
  contractQtyKg: number;
};

export type ShipmentSummaryPreplannedBreakdown = {
  contractRows: number;
  groupCount: number;
  totalTableRows: number;
  contractQtyKg: number;
};

export type ShipmentSummaryLoadSource = 'cache' | 'daily' | 'live';

export function buildShipmentPipelineDailyFilterInput(req: AuthRequest): PipelineDailySummaryFilterInput {
  const {
    status,
    vessel,
    port,
    dateFrom,
    dateTo,
    delayed,
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
  const viewOptionParam = (req.query as { viewOption?: string }).viewOption;
  const viewQueryParam = (req.query as { viewQuery?: string }).viewQuery;
  const scopeStatusParam = (req.query as { scopeStatus?: string }).scopeStatus;
  const etaLoadingParam = (req.query as { etaLoading?: string }).etaLoading;
  const etaDischargeParam = (req.query as { etaDischarge?: string }).etaDischarge;
  const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
  const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
  return {
    dateFrom: dateFrom != null ? String(dateFrom) : undefined,
    dateTo: dateTo != null ? String(dateTo) : undefined,
    plants,
    globalSearch,
    colFilters,
    lateIndicator: lateIndicatorParam != null ? String(lateIndicatorParam) : undefined,
    viewOption: viewOptionParam != null ? String(viewOptionParam) : undefined,
    viewQuery: viewQueryParam != null ? String(viewQueryParam) : undefined,
    scopeStatus: scopeStatusParam != null ? String(scopeStatusParam) : undefined,
    status: status != null ? String(status) : undefined,
    etaLoading: etaLoadingParam != null ? String(etaLoadingParam) : undefined,
    etaDischarge: etaDischargeParam != null ? String(etaDischargeParam) : undefined,
    vessel: vessel != null ? String(vessel) : undefined,
    port: port != null ? String(port) : undefined,
    sto: sto != null ? String(sto) : undefined,
    contract: contract != null ? String(contract) : undefined,
    delayed: delayed != null ? String(delayed) : undefined,
  };
}

export async function loadShipmentListSummary(
  summaryCountQuery: string,
  params: unknown[],
  cacheKey: string,
): Promise<{ summaryRow: Record<string, unknown>; totalCount: number }> {
  const cached = SUMMARY_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { summaryRow: cached.summaryRow, totalCount: cached.totalCount };
  }
  if (cached) SUMMARY_CACHE.delete(cacheKey);

  const result = await query(summaryCountQuery, params);
  const summaryRow = (result.rows[0] || {}) as Record<string, unknown>;
  const totalCount = parseInt(String(summaryRow.total_count ?? '0'), 10) || 0;
  SUMMARY_CACHE.set(cacheKey, {
    summaryRow,
    totalCount,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  evictMapIfNeeded(SUMMARY_CACHE, MAX_CACHE_ENTRIES);
  return { summaryRow, totalCount };
}

/**
 * Section 1 summary: daily table when toolbar-only + fresh; else live SQL + hybrid unplanned breakdown.
 */
export async function loadShipmentSummaryBundle(
  req: AuthRequest,
  opts: {
    summaryCountQuery: string;
    params: unknown[];
    cacheKey: string;
    loadUnplannedBreakdown: () => Promise<ShipmentSummaryUnplannedBreakdown>;
    loadPreplannedBreakdown?: () => Promise<ShipmentSummaryPreplannedBreakdown>;
  },
): Promise<{
  summaryRow: Record<string, unknown>;
  totalCount: number;
  unplannedBreakdown: ShipmentSummaryUnplannedBreakdown;
  preplannedBreakdown: ShipmentSummaryPreplannedBreakdown;
  source: ShipmentSummaryLoadSource;
}> {
  const emptyPreplanned: ShipmentSummaryPreplannedBreakdown = {
    contractRows: 0,
    groupCount: 0,
    totalTableRows: 0,
    contractQtyKg: 0,
  };
  const loadPreplanned = opts.loadPreplannedBreakdown ?? (async () => emptyPreplanned);

  const filters = buildShipmentPipelineDailyFilterInput(req);
  if (isPipelineDailySummaryEligible(filters)) {
    const fromDaily = await loadShipmentSummaryFromDaily(toPipelineDailySummaryScope(filters));
    if (fromDaily) {
      SUMMARY_CACHE.set(opts.cacheKey, {
        summaryRow: fromDaily.summaryRow,
        totalCount: fromDaily.totalCount,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      evictMapIfNeeded(SUMMARY_CACHE, MAX_CACHE_ENTRIES);
      // Live hybrid counts for Unplanned + Preplanned cards — daily SUM can be stale or
      // diverge from the hybrid table (e.g. preplanned moves, execution rows).
      const [unplannedBreakdown, preplannedBreakdown] = await Promise.all([
        opts.loadUnplannedBreakdown(),
        loadPreplanned(),
      ]);
      return {
        summaryRow: fromDaily.summaryRow,
        totalCount: fromDaily.totalCount,
        unplannedBreakdown,
        preplannedBreakdown,
        source: 'daily',
      };
    }
  }

  const cached = SUMMARY_CACHE.get(opts.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    const [unplannedBreakdown, preplannedBreakdown] = await Promise.all([
      opts.loadUnplannedBreakdown(),
      loadPreplanned(),
    ]);
    return {
      summaryRow: cached.summaryRow,
      totalCount: cached.totalCount,
      unplannedBreakdown,
      preplannedBreakdown,
      source: 'cache',
    };
  }
  if (cached) SUMMARY_CACHE.delete(opts.cacheKey);

  const [loaded, unplannedBreakdown, preplannedBreakdown] = await Promise.all([
    loadShipmentListSummary(opts.summaryCountQuery, opts.params, opts.cacheKey),
    opts.loadUnplannedBreakdown(),
    loadPreplanned(),
  ]);
  return {
    summaryRow: loaded.summaryRow,
    totalCount: loaded.totalCount,
    unplannedBreakdown,
    preplannedBreakdown,
    source: 'live',
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

export function invalidateShipmentsListCache(): void {
  PAGE_CACHE.clear();
  COUNT_CACHE.clear();
  SUMMARY_CACHE.clear();
  OUTSTANDING_QTY_CACHE.clear();
  STATUS_CARD_QTY_CACHE.clear();
  markPipelineDailySummaryStale(['shipment']).catch(() => {});
  // Oil Loss reads shipment quantities (sfal/sfbd/delivered/receive) — refresh its
  // cache after any shipment mutation so the page reflects the edit immediately.
  import('./oilLoss.service')
    .then(({ invalidateOilLossCache }) => invalidateOilLossCache())
    .catch(() => {});
  // Rebuild the recently used pages in the background so the next viewer after an
  // edit is served from memory instead of paying the full query cost.
  PAGE_KEEP_WARM.rewarmRecentlyUsed();
}

export function normalizeShipmentListRows(rows: ShipmentListRow[]): ShipmentListRow[] {
  for (const row of rows) {
    if (String(row.row_kind ?? '').trim() === 'contract_backlog') {
      const statusUpper = String(row.status ?? '').trim().toUpperCase();
      if (statusUpper !== 'PREPLANNED') {
        row.status = 'UNPLANNED';
      }
      continue;
    }
    delete (row as { __filter_total?: unknown }).__filter_total;
    delete (row as { contract_numbers_from_join?: unknown }).contract_numbers_from_join;
    delete (row as { po_numbers_from_join?: unknown }).po_numbers_from_join;
    delete (row as { contract_count_from_join?: unknown }).contract_count_from_join;
    delete (row as { contract_ext_no_from_join?: unknown }).contract_ext_no_from_join;
    if (Object.prototype.hasOwnProperty.call(row, 'contract_ext_no_merged')) {
      row.contract_ext_no = row.contract_ext_no_merged as string | null;
      delete (row as { contract_ext_no_merged?: unknown }).contract_ext_no_merged;
    }
    if (Object.prototype.hasOwnProperty.call(row, 'po_numbers_merged')) {
      row.po_numbers = row.po_numbers_merged as string | null;
      delete (row as { po_numbers_merged?: unknown }).po_numbers_merged;
    }
    if (Object.prototype.hasOwnProperty.call(row, 'suppliers_linked')) {
      const linked = String(row.suppliers_linked ?? '').trim();
      if (linked) row.suppliers = linked;
      delete (row as { suppliers_linked?: unknown }).suppliers_linked;
    }

    if (mergeShipmentVesselFromSapRow(row)) {
      queueShipmentVesselSapBackfill(row);
    }

    if (String(row.status ?? '').trim().toUpperCase() === 'CANCELLED') {
      row.status = 'CANCELLED';
      continue;
    }

    const displayedSto = resolveContractLogisticsStoNumber(row.sto_number);
    row.sto_number = displayedSto === '-' ? null : displayedSto;

    row.status = deriveShipmentStatus({
      eta_arrival_at_loading_port: row.eta_vessel_arrival_at_loading_port ?? row.eta_arrival,
      eta_berthed_at_loading_port: row.eta_vessel_berthed_at_loading_port ?? row.eta_berthed,
      eta_start_loading: row.eta_vessel_start_loading ?? row.eta_loading_start,
      eta_completed_loading: row.eta_vessel_completed_loading ?? row.eta_loading_complete,
      eta_sailed_from_loading_port: row.eta_vessel_sailed_from_loading_port ?? row.eta_sailed,
      eta_arrive_at_discharge_port: row.eta_vessel_arrive_at_discharge_port ?? row.eta_discharge_arrival,
      eta_berthed_at_discharge_port: row.eta_vessel_berthed_at_discharge_port ?? row.eta_discharge_berthed,
      eta_start_discharging: row.eta_vessel_start_discharging ?? row.eta_discharge_start,
      eta_complete_discharge: row.eta_vessel_complete_discharge ?? row.eta_discharge_complete,
      ata_arrival_at_loading_port: row.ata_vessel_arrival_at_loading_port,
      ata_berthed_at_loading_port: row.ata_vessel_berthed_at_loading_port,
      ata_start_loading: row.ata_vessel_start_loading,
      ata_completed_loading: row.ata_vessel_completed_loading,
      ata_sailed_from_loading_port: row.ata_vessel_sailed_from_loading_port,
      ata_arrive_at_discharge_port: row.ata_vessel_arrive_at_discharge_port,
      ata_berthed_at_discharge_port: row.ata_vessel_berthed_at_discharge_port,
      ata_start_discharging: row.ata_vessel_start_discharging,
      ata_complete_discharge: row.ata_vessel_complete_discharge,
      contract_import_status: row.is_contract_sap_closed
        ? 'Close'
        : row.contract_import_status,
      quantity_delivered: row.quantity_delivered,
      quantity_delivered_klip: row.quantity_delivered_klip,
      quantity_delivered_sap: row.quantity_delivered_sap,
    });

    // Multi-contract STO status floor (decision N-01 option b): milestone dates are
    // MAX-merged across the group, so the derive above reflects the MOST advanced
    // member. When members sit in different active stages, cap at the least-advanced
    // one — an STO is not Completed until every contract under it is done.
    // Mirrors the SQL floor in shipmentEffectiveStatusExpr (summary/filters).
    // GR Close (STO-scoped) is authoritative — stale sibling DB statuses must not floor down.
    const floor = String(row.group_status_floor ?? '').trim().toUpperCase();
    const mixedStatuses = Number(row.group_active_status_count ?? 0) > 1;
    if (mixedStatuses && floor && !row.is_contract_sap_closed) {
      const floorRank = SHIPMENT_STATUS_RANK[floor];
      const derivedRank = SHIPMENT_STATUS_RANK[String(row.status ?? '').trim().toUpperCase()];
      if (floorRank !== undefined && derivedRank !== undefined && floorRank >= 0 && floorRank < derivedRank) {
        row.status = floor;
      }
    }
    delete (row as { group_status_floor?: unknown }).group_status_floor;
    delete (row as { group_active_status_count?: unknown }).group_active_status_count;
  }
  return rows;
}

const LIST_PAGE_SELECT = `
      SELECT
        sp.*,
        ${shipmentListPageQtySelectSql('sp')},
        COALESCE(
          NULLIF(TRIM(slpa.sap_loading_ports), ''),
          NULLIF(TRIM(sp.loading_ports_klip), ''),
          NULLIF(TRIM(sp.port_of_loading), '')
        ) AS loading_ports,
        COALESCE(
          NULLIF(TRIM(sdpa.sap_discharge_ports), ''),
          NULLIF(TRIM(sp.discharge_ports_klip), ''),
          NULLIF(TRIM(sp.port_of_discharge), '')
        ) AS discharge_ports,
        slpa.sap_loading_ports,
        sdpa.sap_discharge_ports,
        NULLIF(TRIM(slpa.sap_loading_ports), '') AS sap_vessel_loading_port_1,
        NULLIF(TRIM(sdpa.sap_discharge_ports), '') AS sap_vessel_discharge_port,
        COALESCE(sl.incoterm, sp.incoterm) AS incoterm,
        sl.b2b_flag AS b2b_flag,
        sl.source_type AS source_type,
        COALESCE(cex.contract_ext_no, sp.contract_ext_no) AS contract_ext_no_merged,
        COALESCE(NULLIF(TRIM(pna.po_numbers), ''), sp.po_numbers) AS po_numbers_merged,
        sl.vessel_name_sap,
        sl.vessel_code_sap,
        sl.vessel_owner_sap
      ${SHIPMENT_LIST_STO_JOIN_SQL}`;

/** Single round-trip list query: page rows + __filter_total (C). */
export function buildShipmentListPageQuery(
  ctx: ShipmentListQueryContext,
  limit: number,
  offset: number,
): { text: string; params: unknown[] } {
  const baseParams = [...ctx.innerParams, ...ctx.outerParams];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;
  const spdAggCtes = shipmentListSpdAggCtes(ctx.skipSapJoin);
  const pageOrderBy = buildListOrderByWithSapStoPriority(
    'fs.sto_number',
    'fs.created_at DESC',
    ctx.tableStatusFilter,
  );

  const shipmentPageCte = ctx.usesStoKeyPaging
    ? `shipment_page AS (
        SELECT
          fs.*,
          (SELECT COUNT(*)::bigint FROM ranked_sto) AS __filter_total
        FROM filtered_shipments fs
        ORDER BY ${pageOrderBy}
      )`
    : `shipment_page AS (
        SELECT
          fs.*,
          (SELECT COUNT(*)::bigint FROM filtered_shipments) AS __filter_total
        FROM filtered_shipments fs
        ORDER BY ${pageOrderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      )`;

  const text = `${ctx.shipmentBaseCteSql},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${ctx.outerSql}
      ),
      ${shipmentPageCte},
      ${shipmentListQtyMoveCteFromPage()},
      ${spdAggCtes}
      ${LIST_PAGE_SELECT}`;

  return { text, params: ctx.usesStoKeyPaging ? baseParams : [...baseParams, limit, offset] };
}

/** Enriched page rows (SAP qty, contract ext no, outstanding) without __filter_total. */
export function buildShipmentListEnrichedPageQuery(
  ctx: ShipmentListQueryContext,
  limit: number,
  offset: number,
): { text: string; params: unknown[] } {
  const baseParams = [...ctx.innerParams, ...ctx.outerParams];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;
  const spdAggCtes = shipmentListSpdAggCtes(ctx.skipSapJoin);
  const pageOrderBy = buildListOrderByWithSapStoPriority(
    'fs.sto_number',
    'fs.created_at DESC',
    ctx.tableStatusFilter,
  );

  const text = `${ctx.shipmentBaseCteSql},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${ctx.outerSql}
      ),
      shipment_page AS (
        SELECT fs.*
        FROM filtered_shipments fs
        ORDER BY ${pageOrderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      ),
      ${shipmentListQtyMoveCteFromPage()},
      ${spdAggCtes}
      ${LIST_PAGE_SELECT}`;

  return { text, params: [...baseParams, limit, offset] };
}

/** When the page query returns zero rows, total still needed for pagination UI. */
export function buildShipmentListEmptyCountQuery(
  ctx: ShipmentListQueryContext,
): { text: string; params: unknown[] } {
  if (ctx.usesStoKeyPaging) {
    const beforePaged = ctx.shipmentBaseCteSql.split(/,\s*paged_sto AS\s*\(/)[0];
    return {
      text: `${beforePaged}
      SELECT COUNT(*)::bigint AS c FROM ranked_sto`,
      params: [...ctx.innerParams],
    };
  }
  return {
    text: `${ctx.shipmentBaseCteSql},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${ctx.outerSql}
      )
      SELECT COUNT(*)::bigint AS c FROM filtered_shipments`,
    params: [...ctx.innerParams, ...ctx.outerParams],
  };
}

function cacheFilteredTotal(filterCacheKey: string, total: number): void {
  COUNT_CACHE.set(buildShipmentListCountCacheKey(filterCacheKey), {
    total,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  evictMapIfNeeded(COUNT_CACHE, MAX_CACHE_ENTRIES);
}

/** Seed the filtered total from a pre-resolved source (e.g. the stage snapshot). */
export function seedShipmentListFilteredTotal(filterCacheKey: string, total: number): void {
  cacheFilteredTotal(filterCacheKey, total);
}

/** Reuse filtered total from a recent shell/hydrate request (same toolbar scope). */
export function getCachedFilteredTotal(filterCacheKey: string): number | null {
  const key = buildShipmentListCountCacheKey(filterCacheKey);
  const cached = COUNT_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.total;
  if (cached) COUNT_CACHE.delete(key);
  return null;
}

/** Page rows only — caller supplies total from COUNT_CACHE or a follow-up count query. */
export function buildShipmentListPageQueryWithoutInlineCount(
  ctx: ShipmentListQueryContext,
  limit: number,
  offset: number,
): { text: string; params: unknown[] } {
  const baseParams = [...ctx.innerParams, ...ctx.outerParams];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;
  const spdAggCtes = shipmentListSpdAggCtes(ctx.skipSapJoin);
  const pageOrderBy = buildListOrderByWithSapStoPriority(
    'fs.sto_number',
    'fs.created_at DESC',
    ctx.tableStatusFilter,
  );

  const shipmentPageCte = ctx.usesStoKeyPaging
    ? `shipment_page AS (
        SELECT fs.*
        FROM filtered_shipments fs
        ORDER BY ${pageOrderBy}
      )`
    : `shipment_page AS (
        SELECT fs.*
        FROM filtered_shipments fs
        ORDER BY ${pageOrderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      )`;

  const text = `${ctx.shipmentBaseCteSql},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${ctx.outerSql}
      ),
      ${shipmentPageCte},
      ${shipmentListQtyMoveCteFromPage()},
      ${spdAggCtes}
      ${LIST_PAGE_SELECT}`;

  return { text, params: ctx.usesStoKeyPaging ? baseParams : [...baseParams, limit, offset] };
}

// The SAP-hydrated variant (skipSapJoin=false) is a background refresh that can run
// for a minute or more. Rapid filter changes used to fire one per filter combination
// CONCURRENTLY, monopolizing DB connections/CPU so even the fast compact queries
// queued behind them. Serialize these hydration loads (concurrency 1) and share one
// execution per cache key. Pure scheduling — each request still gets the exact same
// result its query would have produced.
const HYDRATE_INFLIGHT = new Map<string, Promise<{ rows: ShipmentListRow[]; total: number }>>();
let hydrateChain: Promise<unknown> = Promise.resolve();

function loadShipmentListPageSerialized(
  ctx: ShipmentListQueryContext,
  page: number,
  limit: number,
): Promise<{ rows: ShipmentListRow[]; total: number }> {
  const existing = HYDRATE_INFLIGHT.get(ctx.cacheKey);
  if (existing) return existing;
  const run = hydrateChain
    .catch(() => {})
    .then(() => runShipmentListPageQuery(ctx, page, limit))
    .finally(() => {
      HYDRATE_INFLIGHT.delete(ctx.cacheKey);
    });
  HYDRATE_INFLIGHT.set(ctx.cacheKey, run);
  hydrateChain = run.catch(() => {});
  return run;
}

async function loadShipmentListPage(
  ctx: ShipmentListQueryContext,
  page: number,
  limit: number,
): Promise<{ rows: ShipmentListRow[]; total: number }> {
  const cached = PAGE_CACHE.get(ctx.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { rows: cached.rows, total: cached.total };
  }
  if (cached) PAGE_CACHE.delete(ctx.cacheKey);

  if (!ctx.skipSapJoin) {
    return loadShipmentListPageSerialized(ctx, page, limit);
  }
  return runShipmentListPageQuery(ctx, page, limit);
}

async function runShipmentListPageQuery(
  ctx: ShipmentListQueryContext,
  page: number,
  limit: number,
): Promise<{ rows: ShipmentListRow[]; total: number }> {
  // A queued hydration may have been satisfied by an identical run that finished
  // while it waited; serve the cache instead of re-running the query.
  const cached = PAGE_CACHE.get(ctx.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { rows: cached.rows, total: cached.total };
  }

  const offset = (page - 1) * limit;
  const cachedTotal = getCachedFilteredTotal(ctx.filterCacheKey);
  const { text, params } =
    cachedTotal != null
      ? buildShipmentListPageQueryWithoutInlineCount(ctx, limit, offset)
      : buildShipmentListPageQuery(ctx, limit, offset);
  const result = await query(text, params);

  let total = cachedTotal ?? 0;
  if (cachedTotal == null) {
    if (result.rows.length > 0) {
      const raw = (result.rows[0] as { __filter_total?: unknown }).__filter_total;
      total = parseInt(String(raw ?? '0'), 10) || 0;
    } else {
      const { text: countText, params: countParams } = buildShipmentListEmptyCountQuery(ctx);
      const countRes = await query(countText, countParams);
      total = parseInt(String(countRes.rows[0]?.c ?? '0'), 10) || 0;
    }
    cacheFilteredTotal(ctx.filterCacheKey, total);
  }
  const rows = normalizeShipmentListRows(result.rows as ShipmentListRow[]);

  PAGE_CACHE.set(ctx.cacheKey, { rows, total, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(PAGE_CACHE, MAX_CACHE_ENTRIES);
  // Remember how to re-run this exact load so the background warmer can refresh it
  // ahead of expiry / after invalidation. `ctx` is a plain built query context.
  PAGE_KEEP_WARM.register(ctx.cacheKey, async () => {
    PAGE_CACHE.delete(ctx.cacheKey);
    COUNT_CACHE.delete(ctx.filterCacheKey);
    await loadShipmentListPage(ctx, page, limit);
  });
  return { rows, total };
}

export async function resolveShipmentsListForRequest(
  req: AuthRequest,
  ctx: ShipmentListQueryContext,
): Promise<ShipmentListResponseData> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));

  // Request-path access only (the background refresher must not keep itself alive).
  PAGE_KEEP_WARM.touch(ctx.cacheKey);
  const { rows, total } = await loadShipmentListPage(ctx, pageNum, limitNum);

  return {
    shipments: rows,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    },
  };
}
