import { query } from '../database/connection';
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

export async function countHybridBreakdown(
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

export async function resolveHybridShipmentsList(
  req: AuthRequest,
  ctx: UnplannedHybridListContext,
): Promise<ShipmentListResponseData & { unplannedBreakdown: UnplannedHybridBreakdown }> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));
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
