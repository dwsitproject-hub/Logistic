import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { deriveShipmentStatus } from '../utils/shipmentStatus';
import { normalizeShipmentEtaBucketParam } from '../utils/shipmentListFilters';
import {
  buildShipmentListSummaryFromRows,
  filterShipmentListRows,
  sortShipmentListRows,
  type ShipmentListDerivedRow,
  type ShipmentListSummaryPayload,
} from '../utils/shipmentListDerived';

/**
 * Shipments list API — in-memory cache (TTL 5 min), compact path only:
 * - Toolbar-scoped rows loaded once per cache key
 * - Status / ETA card filters + pagination applied in memory (matches Trucking ROW_CACHE)
 * - summaryOnly computed from cached rows (no extra DB round-trip when warm)
 * Cache is cleared on shipment mutations via invalidateShipmentsListCache().
 */

export type ShipmentListRow = Record<string, unknown>;

export interface ShipmentListQueryContext {
  shipmentBaseCteSqlFull: string;
  toolbarOuterSql: string;
  innerParams: unknown[];
  toolbarOuterParams: unknown[];
  skipSapJoin: boolean;
  cacheKey: string;
}

export interface ShipmentListResponseData {
  shipments: ShipmentListRow[];
  summary?: ShipmentListSummaryPayload;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const ROW_CACHE = new Map<string, { rows: ShipmentListRow[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 'shipment-list-v1';
const MAX_CACHE_ENTRIES = 40;

const SPD_AGG_CTES_STUB = `
      spd_keyed AS (
        SELECT NULL::text AS sto_key, NULL::timestamptz AS created_at, NULL::jsonb AS data
        WHERE false
      ),
      contract_ext_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS contract_ext_no WHERE false
      ),
      po_numbers_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS po_numbers WHERE false
      ),
      sap_agg AS (
        SELECT NULL::text AS sto_key,
          0::numeric AS sto_quantity,
          0::numeric AS quantity_receive,
          0::numeric AS quantity_delivered_sap
        WHERE false
      ),
      sap_latest AS (
        SELECT NULL::text AS sto_key,
          NULL::text AS incoterm,
          NULL::text AS b2b_flag,
          NULL::text AS source_type
        WHERE false
      )`;

function stableColumnFiltersKey(colFilters: Record<string, unknown>): string {
  const keys = Object.keys(colFilters).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) norm[k] = colFilters[k];
  return JSON.stringify(norm);
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
  };
  return `${CACHE_VERSION}:${JSON.stringify(norm)}`;
}

function evictShipmentListCacheIfNeeded(): void {
  const now = Date.now();
  for (const [key, entry] of ROW_CACHE.entries()) {
    if (entry.expiresAt <= now) ROW_CACHE.delete(key);
  }
  if (ROW_CACHE.size <= MAX_CACHE_ENTRIES) return;
  const sorted = [...ROW_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const removeCount = ROW_CACHE.size - MAX_CACHE_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    ROW_CACHE.delete(sorted[i][0]);
  }
}

export function invalidateShipmentsListCache(): void {
  ROW_CACHE.clear();
}

export function normalizeShipmentListRows(rows: ShipmentListRow[]): ShipmentListRow[] {
  for (const row of rows) {
    delete (row as { __filter_total?: unknown }).__filter_total;
    if (Object.prototype.hasOwnProperty.call(row, 'contract_ext_no_merged')) {
      row.contract_ext_no = row.contract_ext_no_merged as string | null;
      delete (row as { contract_ext_no_merged?: unknown }).contract_ext_no_merged;
    }
    if (Object.prototype.hasOwnProperty.call(row, 'po_numbers_merged')) {
      row.po_numbers = row.po_numbers_merged as string | null;
      delete (row as { po_numbers_merged?: unknown }).po_numbers_merged;
    }

    if (String(row.status ?? '').trim().toUpperCase() === 'CANCELLED') {
      row.status = 'CANCELLED';
      continue;
    }

    const currentStoNumber = row.sto_number;
    const stoKeyStr = row.sto_key != null ? String(row.sto_key).trim() : '';

    if (
      (currentStoNumber == null || String(currentStoNumber).trim() === '') &&
      stoKeyStr &&
      /^\d+$/.test(stoKeyStr)
    ) {
      row.sto_number = stoKeyStr;
    }

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
    });
  }
  return rows;
}

function buildCacheLoadQuery(ctx: ShipmentListQueryContext): { text: string; params: unknown[] } {
  const text = `${ctx.shipmentBaseCteSqlFull},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${ctx.toolbarOuterSql}
      ),
      shipment_page AS (
        SELECT fs.*
        FROM filtered_shipments fs
        ORDER BY fs.created_at DESC
      ),
      ${SPD_AGG_CTES_STUB}
      SELECT
        sp.*,
        COALESCE(sa.sto_quantity, 0) AS sto_quantity,
        COALESCE(sa.quantity_receive, 0) AS quantity_receive,
        COALESCE(sa.quantity_delivered_sap, 0) AS quantity_delivered_sap,
        COALESCE(sl.incoterm, sp.incoterm) AS incoterm,
        sl.b2b_flag AS b2b_flag,
        sl.source_type AS source_type,
        COALESCE(cex.contract_ext_no, sp.contract_ext_no) AS contract_ext_no_merged,
        COALESCE(NULLIF(TRIM(pna.po_numbers), ''), sp.po_numbers) AS po_numbers_merged
      FROM shipment_page sp
      LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN contract_ext_agg cex ON TRIM(cex.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN po_numbers_agg pna ON TRIM(pna.sto_key::text) = TRIM(sp.sto_key::text)`;
  return { text, params: [...ctx.innerParams, ...ctx.toolbarOuterParams] };
}

async function loadShipmentListRowsCached(ctx: ShipmentListQueryContext): Promise<ShipmentListRow[]> {
  const cached = ROW_CACHE.get(ctx.cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.rows;
  }
  if (cached) ROW_CACHE.delete(ctx.cacheKey);

  const { text, params } = buildCacheLoadQuery(ctx);
  const result = await query(text, params);
  const rows = normalizeShipmentListRows(result.rows as ShipmentListRow[]);

  ROW_CACHE.set(ctx.cacheKey, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  evictShipmentListCacheIfNeeded();
  return rows;
}

export async function resolveShipmentsListForRequest(
  req: AuthRequest,
  ctx: ShipmentListQueryContext,
): Promise<ShipmentListResponseData> {
  const { page = 1, limit = 10, status } = req.query;
  const includeSummary =
    String((req.query as { includeSummary?: string }).includeSummary ?? 'true').toLowerCase() !== 'false';
  const summaryOnly =
    String((req.query as { summaryOnly?: string }).summaryOnly || '').toLowerCase() === 'true';
  const scopeStatusParam =
    typeof (req.query as { scopeStatus?: string }).scopeStatus === 'string'
      ? (req.query as { scopeStatus?: string }).scopeStatus
      : undefined;
  const etaLoadingBucket = normalizeShipmentEtaBucketParam((req.query as any).etaLoading);
  const etaDischargeBucket = normalizeShipmentEtaBucketParam((req.query as any).etaDischarge);
  const statusFilter = typeof status === 'string' ? status : 'ALL';

  const allRows = await loadShipmentListRowsCached(ctx);
  const pageNum = Number(page);
  const limitNum = Number(limit);

  const toolbarSummary = buildShipmentListSummaryFromRows(allRows as ShipmentListDerivedRow[]);
  const scopedSummary =
    scopeStatusParam && scopeStatusParam !== 'ALL'
      ? buildShipmentListSummaryFromRows(allRows as ShipmentListDerivedRow[], {
          scopeStatus: scopeStatusParam,
        })
      : toolbarSummary;

  if (summaryOnly) {
    const summary =
      scopeStatusParam && scopeStatusParam !== 'ALL' ? scopedSummary : toolbarSummary;
    return {
      shipments: [],
      summary,
      pagination: {
        total: toolbarSummary.total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(toolbarSummary.total / limitNum) || 0,
      },
    };
  }

  const filtered = filterShipmentListRows(allRows as ShipmentListDerivedRow[], {
    statusFilter,
    etaLoadingFilter: etaLoadingBucket,
    etaDischargeFilter: etaDischargeBucket,
  });
  const total = filtered.length;
  const sortKey = String((req.query as { sortKey?: string }).sortKey || 'created_at');
  const sortDirRaw = String((req.query as { sortDir?: string }).sortDir || 'desc').toLowerCase();
  const sortDir: 'ASC' | 'DESC' = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
  const sorted = sortShipmentListRows(filtered, sortKey, sortDir);
  const offset = (pageNum - 1) * limitNum;
  const pageRows = sorted.slice(offset, offset + limitNum);

  return {
    shipments: pageRows as ShipmentListRow[],
    ...(includeSummary ? { summary: toolbarSummary } : {}),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 0,
    },
  };
}
