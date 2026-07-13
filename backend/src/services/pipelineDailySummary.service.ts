import { query } from '../database/connection';
import { appendGroupPlantFilter } from '../utils/groupPlantSql';
import type { ColumnFilterPayload } from '../utils/contractListFilters';
import {
  extractToolbarScopeFromColumnFilters,
  hasNonToolbarColumnFilters,
} from '../utils/pipelineDailySummaryToolbarScope';
import {
  buildTruckingBacklogDailySummaryUpsertSql,
  buildTruckingExecutionDailySummaryInsertSql,
} from '../utils/pipelineDailySummarySql';
import {
  buildShipmentBacklogDailySummaryUpsertSql,
  buildShipmentExecutionDailySummaryInsertSql,
  buildShipmentStageSnapshotInsertSql,
  buildShipmentVesselStageDailyInsertSql,
} from '../utils/shipmentPipelineDailySummarySql';
import logger from '../utils/logger';

export type PipelineSummaryModule = 'trucking' | 'shipment';

/** Bump when trucking pipeline status SQL changes — forces daily summary refresh. */
export const TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION = 4;

export interface PipelineDailySummaryScope {
  dateFrom?: string;
  dateTo?: string;
  plants: string[];
  products?: string[];
  incoterms?: string[];
  includeBlankProduct?: boolean;
  includeBlankIncoterm?: boolean;
}

export interface PipelineDailySummaryFilterInput extends PipelineDailySummaryScope {
  globalSearch?: string;
  colFilters?: ColumnFilterPayload;
  lateIndicator?: string;
  viewOption?: string;
  viewQuery?: string;
  status?: string;
  scopeStatus?: string;
  etaLoading?: string;
  etaDischarge?: string;
  vessel?: string;
  port?: string;
  sto?: string;
  contract?: string;
  delayed?: string;
  location?: string;
  loadingLocation?: string;
  unloadingLocation?: string;
}

const STALE_REFRESH_DEBOUNCE_MS = 60_000;
let lastStaleRefreshAt = 0;

function hasColumnFilters(colFilters?: ColumnFilterPayload): boolean {
  return hasNonToolbarColumnFilters(colFilters);
}

export function toPipelineDailySummaryScope(
  filters: PipelineDailySummaryFilterInput,
): PipelineDailySummaryScope {
  const toolbar = extractToolbarScopeFromColumnFilters(filters.colFilters);
  return {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    plants: filters.plants,
    products: toolbar.products,
    incoterms: toolbar.incoterms,
    includeBlankProduct: toolbar.includeBlankProduct,
    includeBlankIncoterm: toolbar.includeBlankIncoterm,
  };
}

/** Daily summary applies when filters are toolbar scope (date, plant, product, incoterm). */
export function isPipelineDailySummaryEligible(
  filters: PipelineDailySummaryFilterInput,
): boolean {
  if (String(filters.globalSearch ?? '').trim()) return false;
  if (hasColumnFilters(filters.colFilters)) return false;
  if (filters.lateIndicator && String(filters.lateIndicator).toUpperCase() !== 'ALL') return false;
  if (filters.viewOption || filters.viewQuery) return false;
  if (filters.scopeStatus && String(filters.scopeStatus).trim().toUpperCase() !== 'ALL') return false;
  if (filters.status && String(filters.status).trim().toUpperCase() !== 'ALL') return false;
  if (filters.etaLoading && String(filters.etaLoading).toUpperCase() !== 'ALL') return false;
  if (filters.etaDischarge && String(filters.etaDischarge).toUpperCase() !== 'ALL') return false;
  if (filters.vessel || filters.port || filters.sto || filters.contract) return false;
  if (filters.delayed === 'true') return false;
  if (filters.location || filters.loadingLocation || filters.unloadingLocation) return false;
  return true;
}

function appendDimensionScopeFilter(
  parts: string[],
  params: unknown[],
  idx: number,
  column: 'product' | 'incoterm',
  values: string[] | undefined,
  includeBlank: boolean | undefined,
): number {
  const list = (values ?? []).filter(Boolean);
  const wantBlank = Boolean(includeBlank);
  if (list.length === 0 && !wantBlank) return idx;

  const clauses: string[] = [];
  if (list.length > 0) {
    clauses.push(`${column} = ANY($${idx++}::text[])`);
    params.push(list);
  }
  if (wantBlank) {
    clauses.push(`${column} = 'Blank'`);
  }
  if (clauses.length === 1) {
    parts.push(clauses[0]);
  } else if (clauses.length > 1) {
    parts.push(`(${clauses.join(' OR ')})`);
  }
  return idx;
}

function buildDailySummaryWhere(scope: PipelineDailySummaryScope): {
  sql: string;
  params: unknown[];
} {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (scope.dateFrom) {
    parts.push(`contract_date >= $${idx++}::date`);
    params.push(scope.dateFrom);
  }
  if (scope.dateTo) {
    parts.push(`contract_date <= $${idx++}::date`);
    params.push(scope.dateTo);
  }
  if (scope.plants.length > 0) {
    const plantFilter = appendGroupPlantFilter(scope.plants, idx, 'group_plant', 'group_plant');
    if (plantFilter.sql) {
      parts.push(plantFilter.sql.replace(/^ AND /, ''));
      params.push(...plantFilter.params);
      idx += plantFilter.params.length;
    }
  }
  idx = appendDimensionScopeFilter(
    parts,
    params,
    idx,
    'product',
    scope.products,
    scope.includeBlankProduct,
  );
  idx = appendDimensionScopeFilter(
    parts,
    params,
    idx,
    'incoterm',
    scope.incoterms,
    scope.includeBlankIncoterm,
  );

  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  };
}

async function getRefreshMeta(module: PipelineSummaryModule): Promise<{
  refreshed_at: Date;
  is_stale: boolean;
  logic_version: number;
} | null> {
  const res = await query(
    `SELECT refreshed_at, is_stale, COALESCE(logic_version, 1)::int AS logic_version
     FROM pipeline_summary_refresh_meta WHERE module = $1`,
    [module],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as { refreshed_at: Date; is_stale: boolean; logic_version: number };
  return row;
}

export async function isPipelineDailySummaryFresh(module: PipelineSummaryModule): Promise<boolean> {
  const meta = await getRefreshMeta(module);
  if (!meta || meta.is_stale) return false;
  if (
    module === 'trucking' &&
    meta.logic_version < TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION
  ) {
    return false;
  }
  return true;
}

export async function markPipelineDailySummaryStale(
  modules: PipelineSummaryModule[] = ['trucking', 'shipment'],
): Promise<void> {
  await query(
    `UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = ANY($1::text[])`,
    [modules],
  );
  schedulePipelineDailySummaryRefreshIfNeeded();
}

function schedulePipelineDailySummaryRefreshIfNeeded(): void {
  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;
  setImmediate(() => {
    PipelineDailySummaryService.refreshAll().catch((err) => {
      logger.warn('Background pipeline daily summary refresh failed', { err });
    });
  });
}

async function upsertRefreshMeta(
  module: PipelineSummaryModule,
  rowCount: number,
  durationMs: number,
): Promise<void> {
  const logicVersion =
    module === 'trucking' ? TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION : 1;
  await query(
    `INSERT INTO pipeline_summary_refresh_meta (module, refreshed_at, is_stale, row_count, duration_ms, logic_version)
     VALUES ($1, NOW(), FALSE, $2, $3, $4)
     ON CONFLICT (module) DO UPDATE SET
       refreshed_at = EXCLUDED.refreshed_at,
       is_stale = FALSE,
       row_count = EXCLUDED.row_count,
       duration_ms = EXCLUDED.duration_ms,
       logic_version = EXCLUDED.logic_version`,
    [module, rowCount, durationMs, logicVersion],
  );
}

export class PipelineDailySummaryService {
  static async refreshTruckingPipelineDailySummary(): Promise<number> {
    const start = Date.now();
    await query('TRUNCATE trucking_pipeline_daily_summary');
    const execRes = await query(buildTruckingExecutionDailySummaryInsertSql());
    const backlogRes = await query(buildTruckingBacklogDailySummaryUpsertSql());
    const rowCount =
      (execRes.rowCount ?? 0) + (backlogRes.rowCount ?? 0);
    const durationMs = Date.now() - start;
    await upsertRefreshMeta('trucking', rowCount, durationMs);
    logger.info('Pipeline daily summary refreshed: trucking', { rowCount, durationMs });
    return rowCount;
  }

  static async refreshShipmentPipelineDailySummary(): Promise<number> {
    const start = Date.now();
    await query('TRUNCATE shipment_pipeline_daily_summary');
    await query('TRUNCATE shipment_pipeline_vessel_stage_daily');
    await query('TRUNCATE shipment_list_stage_snapshot');
    const execRes = await query(buildShipmentExecutionDailySummaryInsertSql());
    const backlogRes = await query(buildShipmentBacklogDailySummaryUpsertSql());
    const vesselRes = await query(buildShipmentVesselStageDailyInsertSql());
    const stageSnapshotRes = await query(buildShipmentStageSnapshotInsertSql());
    const rowCount =
      (execRes.rowCount ?? 0) +
      (backlogRes.rowCount ?? 0) +
      (vesselRes.rowCount ?? 0) +
      (stageSnapshotRes.rowCount ?? 0);
    const durationMs = Date.now() - start;
    await upsertRefreshMeta('shipment', rowCount, durationMs);
    logger.info('Pipeline daily summary refreshed: shipment', { rowCount, durationMs });
    return rowCount;
  }

  static async refreshAll(): Promise<void> {
    await this.refreshTruckingPipelineDailySummary();
    await this.refreshShipmentPipelineDailySummary();
  }
}

export async function loadTruckingSummaryFromDaily(
  scope: PipelineDailySummaryScope,
): Promise<{
  total: number;
  status: {
    unplanned: number;
    planned: number;
    inProgress: number;
    loading: number;
    inTransit: number;
    unloading: number;
    completed: number;
    cancelled: number;
  };
  unplannedTable: {
    contractRows: number;
    executionRows: number;
    totalTableRows: number;
  };
} | null> {
  if (!(await isPipelineDailySummaryFresh('trucking'))) return null;

  const { sql, params } = buildDailySummaryWhere(scope);
  const res = await query(
    `SELECT
      COALESCE(SUM(total_count), 0)::bigint AS total_count,
      COALESCE(SUM(unplanned_execution_count), 0)::bigint AS unplanned_execution_count,
      COALESCE(SUM(planned_count), 0)::bigint AS planned_count,
      COALESCE(SUM(in_progress_count), 0)::bigint AS in_progress_count,
      COALESCE(SUM(loading_count), 0)::bigint AS loading_count,
      COALESCE(SUM(in_transit_count), 0)::bigint AS in_transit_count,
      COALESCE(SUM(unloading_count), 0)::bigint AS unloading_count,
      COALESCE(SUM(completed_count), 0)::bigint AS completed_count,
      COALESCE(SUM(cancelled_count), 0)::bigint AS cancelled_count,
      COALESCE(SUM(unplanned_contract_backlog), 0)::bigint AS unplanned_contract_backlog
    FROM trucking_pipeline_daily_summary
    ${sql}`,
    params,
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const contractRows = Number(row.unplanned_contract_backlog || 0);
  const executionRows = Number(row.unplanned_execution_count || 0);
  const totalTableRows = contractRows + executionRows;

  return {
    total: Number(row.total_count || 0),
    status: {
      unplanned: totalTableRows,
      planned: Number(row.planned_count || 0),
      inProgress: Number(row.in_progress_count || 0),
      loading: Number(row.loading_count || 0),
      inTransit: Number(row.in_transit_count || 0),
      unloading: Number(row.unloading_count || 0),
      completed: Number(row.completed_count || 0),
      cancelled: Number(row.cancelled_count || 0),
    },
    unplannedTable: {
      contractRows,
      executionRows,
      totalTableRows,
    },
  };
}

/**
 * Page STO keys for a status-card list request from the stage snapshot.
 * Returns null when the snapshot is stale (caller falls back to the live query).
 * Freshness/staleness matches the status cards themselves (same refresh cycle).
 */
export async function loadShipmentStagePageFromSnapshot(
  scope: PipelineDailySummaryScope,
  stage: string,
  limit: number,
  offset: number,
): Promise<{ stoKeys: string[]; total: number } | null> {
  if (!(await isPipelineDailySummaryFresh('shipment'))) return null;

  const { sql, params } = buildDailySummaryWhere(scope);
  const stageIdx = params.length + 1;
  const whereSql = sql ? `${sql} AND stage = $${stageIdx}` : `WHERE stage = $${stageIdx}`;
  const pageRes = await query(
    `SELECT
      sto_key,
      COUNT(*) OVER ()::bigint AS filtered_total
    FROM shipment_list_stage_snapshot
    ${whereSql}
    ORDER BY last_created_at DESC NULLS LAST, sto_key
    LIMIT $${stageIdx + 1} OFFSET $${stageIdx + 2}`,
    [...params, stage, limit, offset],
  );

  if (pageRes.rows.length > 0) {
    return {
      stoKeys: pageRes.rows.map((r) => String((r as { sto_key: unknown }).sto_key)),
      total: Number((pageRes.rows[0] as { filtered_total?: unknown }).filtered_total || 0),
    };
  }

  // Page beyond the end (or empty stage): still need the accurate total.
  const countRes = await query(
    `SELECT COUNT(*)::bigint AS c FROM shipment_list_stage_snapshot ${whereSql}`,
    [...params, stage],
  );
  return { stoKeys: [], total: Number((countRes.rows[0] as { c?: unknown })?.c || 0) };
}

export async function loadShipmentSummaryFromDaily(
  scope: PipelineDailySummaryScope,
): Promise<{
  summaryRow: Record<string, unknown>;
  totalCount: number;
  unplannedBreakdown: {
    contractRows: number;
    shipmentRows: number;
    totalTableRows: number;
  };
} | null> {
  if (!(await isPipelineDailySummaryFresh('shipment'))) return null;

  const { sql, params } = buildDailySummaryWhere(scope);
  const res = await query(
    `SELECT
      COALESCE(SUM(total_count), 0)::bigint AS total_count,
      COALESCE(SUM(planned_count), 0)::bigint AS planned_count,
      COALESCE(SUM(at_loading_port_count), 0)::bigint AS at_loading_port_count,
      COALESCE(SUM(sailed_count), 0)::bigint AS sailed_count,
      COALESCE(SUM(at_discharge_port_count), 0)::bigint AS at_discharge_port_count,
      COALESCE(SUM(completed_count), 0)::bigint AS completed_count,
      COALESCE(SUM(cancelled_count), 0)::bigint AS cancelled_count,
      COALESCE(SUM(loading_port_arrived_count), 0)::bigint AS loading_port_arrived_count,
      COALESCE(SUM(loading_port_berthed_count), 0)::bigint AS loading_port_berthed_count,
      COALESCE(SUM(loading_port_loading_count), 0)::bigint AS loading_port_loading_count,
      COALESCE(SUM(loading_port_completed_loading_count), 0)::bigint AS loading_port_completed_loading_count,
      COALESCE(SUM(discharge_port_arrived_count), 0)::bigint AS discharge_port_arrived_count,
      COALESCE(SUM(discharge_port_berthed_count), 0)::bigint AS discharge_port_berthed_count,
      COALESCE(SUM(discharge_port_unloading_count), 0)::bigint AS discharge_port_unloading_count,
      COALESCE(SUM(unplanned_contract_backlog), 0)::bigint AS unplanned_contract_backlog_count,
      COALESCE(SUM(unplanned_shipment_execution), 0)::bigint AS unplanned_shipment_execution_count,
      COALESCE(SUM(eta_loading_more_than_7d), 0)::bigint AS eta_loading_more_than_7d,
      COALESCE(SUM(eta_loading_d_minus_2), 0)::bigint AS eta_loading_d_minus_2,
      COALESCE(SUM(eta_loading_d), 0)::bigint AS eta_loading_d,
      COALESCE(SUM(eta_loading_delay), 0)::bigint AS eta_loading_delay,
      COALESCE(SUM(eta_loading_no_eta), 0)::bigint AS eta_loading_no_eta,
      COALESCE(SUM(eta_discharge_more_than_7d), 0)::bigint AS eta_discharge_more_than_7d,
      COALESCE(SUM(eta_discharge_d_minus_2), 0)::bigint AS eta_discharge_d_minus_2,
      COALESCE(SUM(eta_discharge_d), 0)::bigint AS eta_discharge_d,
      COALESCE(SUM(eta_discharge_delay), 0)::bigint AS eta_discharge_delay,
      COALESCE(SUM(eta_discharge_no_eta), 0)::bigint AS eta_discharge_no_eta
    FROM shipment_pipeline_daily_summary
    ${sql}`,
    params,
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  // Distinct vessel names per stage from the companion fact table (same scope filters).
  // Distinct sets are not additive across days/plants, so they are aggregated at read
  // time from the stored (dims, stage, vessel) facts instead of summed from a rollup.
  const vesselRes = await query(
    `SELECT
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'UNPLANNED') AS unplanned_vessel_names,
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'PLANNED') AS planned_vessel_names,
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'AT_LOADING_PORT') AS at_loading_port_vessel_names,
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'SAILED') AS sailed_vessel_names,
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'AT_DISCHARGE_PORT') AS at_discharge_port_vessel_names,
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'COMPLETED') AS completed_vessel_names,
      ARRAY_AGG(DISTINCT vessel_key) FILTER (WHERE stage = 'CANCELLED') AS cancelled_vessel_names
    FROM shipment_pipeline_vessel_stage_daily
    ${sql}`,
    params,
  );
  const vesselRow = (vesselRes.rows[0] ?? {}) as Record<string, unknown>;

  const contractRows = Number(row.unplanned_contract_backlog_count || 0);
  const shipmentRows = Number(row.unplanned_shipment_execution_count || 0);

  return {
    summaryRow: { ...row, ...vesselRow },
    totalCount: Number(row.total_count || 0),
    unplannedBreakdown: {
      contractRows,
      shipmentRows,
      totalTableRows: contractRows + shipmentRows,
    },
  };
}
