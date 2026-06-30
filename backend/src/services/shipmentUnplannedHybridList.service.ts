import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import {
  normalizeShipmentListRows,
  type ShipmentListQueryContext,
  type ShipmentListResponseData,
} from './shipmentList.service';
import {
  appendUnplannedContractBacklogColumnFilters,
  appendUnplannedContractBacklogGlobalSearch,
  buildUnplannedContractBacklogCountQuery,
  buildUnplannedContractBacklogPageQuery,
  buildUnplannedShipmentExecutionCountQuery,
  buildUnplannedContractToolbarScope,
} from '../utils/shipmentUnplannedHybridSql';
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
}

export interface UnplannedHybridBreakdown {
  contractRows: number;
  shipmentRows: number;
  totalTableRows: number;
}

function buildContractQueryParts(ctx: UnplannedHybridListContext): {
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

export async function countUnplannedHybridBreakdown(
  ctx: UnplannedHybridListContext,
): Promise<UnplannedHybridBreakdown> {
  const { contractScopeSql, params: contractParams, toolbarSql } = buildContractQueryParts(ctx);
  const shipmentParams = [...ctx.shipmentCtx.innerParams, ...ctx.shipmentCtx.outerParams];

  const [contractRes, shipmentRes] = await Promise.all([
    query(
      buildUnplannedContractBacklogCountQuery(contractScopeSql, toolbarSql),
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
  return { contractRows, shipmentRows, totalTableRows: contractRows + shipmentRows };
}

async function fetchContractBacklogPage(
  ctx: UnplannedHybridListContext,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  if (limit <= 0) return [];
  const { contractScopeSql, params, toolbarSql } = buildContractQueryParts(ctx);
  const text = buildUnplannedContractBacklogPageQuery(contractScopeSql, toolbarSql, limit, offset);
  const result = await query(text, params);
  return result.rows as Record<string, unknown>[];
}

async function fetchShipmentExecutionPage(
  ctx: ShipmentListQueryContext,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  if (limit <= 0) return [];

  const baseParams = [...ctx.innerParams, ...ctx.outerParams];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;

  const text = `${ctx.shipmentBaseCteSql},
    filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${ctx.outerSql}
    ),
    shipment_page AS (
      SELECT fs.*
      FROM filtered_shipments fs
      ORDER BY fs.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    )
    SELECT sp.* FROM shipment_page sp`;

  const result = await query(text, [...baseParams, limit, offset]);
  const rows = normalizeShipmentListRows(result.rows as Record<string, unknown>[]);
  for (const row of rows) {
    row.row_kind = 'shipment_execution';
  }
  return rows;
}

export async function resolveUnplannedHybridShipmentsList(
  req: AuthRequest,
  ctx: UnplannedHybridListContext,
): Promise<ShipmentListResponseData & { unplannedBreakdown: UnplannedHybridBreakdown }> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));
  const offset = (pageNum - 1) * limitNum;

  const breakdown = await countUnplannedHybridBreakdown(ctx);
  const { contractRows, totalTableRows } = breakdown;

  let contractLimit = 0;
  let contractOffset = 0;
  let shipmentLimit = 0;
  let shipmentOffset = 0;

  if (offset < contractRows) {
    contractOffset = offset;
    contractLimit = Math.min(limitNum, contractRows - offset);
    shipmentLimit = limitNum - contractLimit;
    shipmentOffset = 0;
  } else {
    shipmentOffset = offset - contractRows;
    shipmentLimit = limitNum;
  }

  const [contractPage, shipmentPage] = await Promise.all([
    fetchContractBacklogPage(ctx, contractLimit, contractOffset),
    fetchShipmentExecutionPage(ctx.shipmentCtx, shipmentLimit, shipmentOffset),
  ]);

  for (const row of contractPage) {
    row.status = 'UNPLANNED';
  }

  const shipments = [...contractPage, ...shipmentPage] as ShipmentListResponseData['shipments'];

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

export function isUnplannedHybridListRequest(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'UNPLANNED';
}
