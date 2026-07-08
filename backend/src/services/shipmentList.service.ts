import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import { markPipelineDailySummaryStale } from './pipelineDailySummary.service';
import { resolveContractLogisticsStoNumber } from '../utils/contractLogisticsStoDisplay';
import { shipmentListSpdAggCtes } from '../utils/shipmentListSapAggSql';
import {
  shipmentListQtyMoveCteFromPage,
} from '../utils/shipmentOutstandingQtySql';
import { shipmentListPageQtySelectSql } from '../utils/shipmentListQtySql';
import { buildListOrderByWithSapStoPriority } from '../utils/listSapStoPrioritySql';
import {
  mergeShipmentVesselFromSapRow,
  queueShipmentVesselSapBackfill,
} from './shipmentVesselFromSap.service';

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
const CACHE_VERSION = 'shipment-list-v25';
const MAX_CACHE_ENTRIES = 80;

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
  return `${filterCacheKey}:summary:${scopeStatus ?? ''}`;
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
  markPipelineDailySummaryStale(['shipment']).catch(() => {});
}

export function normalizeShipmentListRows(rows: ShipmentListRow[]): ShipmentListRow[] {
  for (const row of rows) {
    if (String(row.row_kind ?? '').trim() === 'contract_backlog') {
      row.status = 'UNPLANNED';
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
    });
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
      FROM shipment_page sp
      LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_loading_ports_agg slpa ON TRIM(slpa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_discharge_ports_agg sdpa ON TRIM(sdpa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN contract_ext_agg cex ON TRIM(cex.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN po_numbers_agg pna ON TRIM(pna.sto_key::text) = TRIM(sp.sto_key::text)`;

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

  const offset = (page - 1) * limit;
  const { text, params } = buildShipmentListPageQuery(ctx, limit, offset);
  const result = await query(text, params);

  let total = 0;
  if (result.rows.length > 0) {
    const raw = (result.rows[0] as { __filter_total?: unknown }).__filter_total;
    total = parseInt(String(raw ?? '0'), 10) || 0;
  } else {
    const { text: countText, params: countParams } = buildShipmentListEmptyCountQuery(ctx);
    const countRes = await query(countText, countParams);
    total = parseInt(String(countRes.rows[0]?.c ?? '0'), 10) || 0;
  }

  cacheFilteredTotal(ctx.filterCacheKey, total);
  const rows = normalizeShipmentListRows(result.rows as ShipmentListRow[]);

  PAGE_CACHE.set(ctx.cacheKey, { rows, total, expiresAt: Date.now() + CACHE_TTL_MS });
  evictMapIfNeeded(PAGE_CACHE, MAX_CACHE_ENTRIES);
  return { rows, total };
}

export async function resolveShipmentsListForRequest(
  req: AuthRequest,
  ctx: ShipmentListQueryContext,
): Promise<ShipmentListResponseData> {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(500, Number(limit) || 20));

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
