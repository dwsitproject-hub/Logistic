import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { parseColumnFiltersQuery, type ColumnFilterPayload } from '../utils/contractListFilters';
import { wrapTruckingListQueryWithStoExpansion } from '../utils/truckingListStoExpandSql';
import {
  appendTruckingUnplannedBacklogColumnFilters,
  appendTruckingUnplannedBacklogGlobalSearch,
  buildTruckingUnplannedBacklogCountQuery,
  buildTruckingUnplannedBacklogPageQuery,
  buildTruckingUnplannedContractToolbarScope,
} from '../utils/truckingUnplannedHybridSql';
import { computeHybridListPageSlices } from '../utils/hybridListPageSlices';
import {
  buildPaginatedListQuery,
  buildTruckingListQuery,
  type TruckingListBuiltQuery,
  type TruckingListResponseData,
  type TruckingListRow,
} from './truckingList.service';

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

export async function countTruckingUnplannedHybridBreakdown(
  ctx: TruckingUnplannedHybridContext,
): Promise<TruckingUnplannedHybridBreakdown> {
  const { contractScopeSql, params: contractParams, toolbarSql } = buildContractQueryParts(ctx);
  const executionExpanded = wrapTruckingListQueryWithStoExpansion(
    `${ctx.executionBuilt.preOuterQuery}${ctx.executionBuilt.outerSql}`,
    {
      selectOutstanding: false,
      skipSapJoin: ctx.executionBuilt.skipSapJoin,
      useStageSnapshot: ctx.executionBuilt.useStageSnapshot === true,
    },
  );
  const executionParams = [...ctx.executionBuilt.innerParams, ...ctx.executionBuilt.outerParams, 'UNPLANNED'];

  const [contractRes, executionRes] = await Promise.all([
    query(buildTruckingUnplannedBacklogCountQuery(contractScopeSql, toolbarSql), contractParams),
    query(
      `WITH trucking_filtered AS (
         SELECT * FROM (${executionExpanded}) expanded_sub
       )
       SELECT COUNT(*)::bigint AS c
       FROM trucking_filtered tf
       WHERE tf.status = $${executionParams.length}`,
      executionParams,
    ),
  ]);

  const contractRows = parseInt(String(contractRes.rows[0]?.c ?? '0'), 10) || 0;
  const executionRows = parseInt(String(executionRes.rows[0]?.c ?? '0'), 10) || 0;
  return { contractRows, executionRows, totalTableRows: contractRows + executionRows };
}

async function fetchContractBacklogPage(
  ctx: TruckingUnplannedHybridContext,
  limit: number,
  offset: number,
): Promise<TruckingListRow[]> {
  if (limit <= 0) return [];
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const text = buildTruckingUnplannedBacklogPageQuery(contractScopeSql, toolbarSql, limit, offset);
  const result = await query(text, params);
  return result.rows as TruckingListRow[];
}

async function fetchExecutionPage(
  ctx: TruckingUnplannedHybridContext,
  limit: number,
  offset: number,
): Promise<TruckingListRow[]> {
  if (limit <= 0) return [];
  const { text, params } = buildPaginatedListQuery(
    ctx.executionBuilt,
    ctx.sortKey,
    ctx.sortDir,
    limit,
    offset,
    'UNPLANNED',
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

  const breakdown = await countTruckingUnplannedHybridBreakdown(ctx);
  const { executionRows } = breakdown;

  const slices = computeHybridListPageSlices({
    offset,
    limit: limitNum,
    executionRows,
  });

  const [contractPage, executionPage] = await Promise.all([
    fetchContractBacklogPage(ctx, slices.contractLimit, slices.contractOffset),
    fetchExecutionPage(ctx, slices.executionLimit, slices.executionOffset),
  ]);

  for (const row of contractPage) {
    row.status = 'UNPLANNED';
    row.row_kind = 'contract_backlog';
  }

  const truckingOperations = [...executionPage, ...contractPage];

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

export function buildTruckingUnplannedHybridContext(
  req: AuthRequest,
  sortKey: string,
  sortDir: 'ASC' | 'DESC',
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

  return {
    executionBuilt:
      options?.executionBuilt ?? buildTruckingListQuery(req, { omitStatusFilter: true }),
    contractScope: { dateFrom, dateTo, contract, plants },
    globalSearch,
    colFilters,
    sortKey,
    sortDir,
  };
}
