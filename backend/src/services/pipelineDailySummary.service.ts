import { buildTruckingSection1FromSnapshotQuery } from '../utils/truckingStatusSummaryCombinedSql';
import { PoolClient } from 'pg';
import { getClient, query } from '../database/connection';
import { appendContractPerfSourceTypeFilter } from '../controllers/contractSqlFragments';
import { appendRegionSiteFilter } from '../utils/regionSiteSql';
import { sqlTruckingLateIndicatorSortExpr } from '../utils/truckingListSort';
import type { ColumnFilterPayload } from '../utils/contractListFilters';
import {
  extractToolbarScopeFromColumnFilters,
  hasNonToolbarColumnFilters,
} from '../utils/pipelineDailySummaryToolbarScope';
import {
  TRUCKING_LIST_STAGE_SNAPSHOT_TABLE,
  TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE,
  buildTruckingBacklogDailySummaryUpsertSql,
  buildTruckingExecutionDailySummaryInsertSql,
  buildTruckingStageSnapshotInsertSql,
} from '../utils/pipelineDailySummarySql';
import {
  SHIPMENT_LIST_STAGE_SNAPSHOT_TABLE,
  SHIPMENT_PIPELINE_DAILY_SUMMARY_TABLE,
  SHIPMENT_PIPELINE_VESSEL_STAGE_DAILY_TABLE,
  buildShipmentBacklogDailySummaryUpsertSql,
  buildShipmentExecutionDailySummaryInsertSql,
  buildShipmentStageSnapshotInsertSql,
  buildShipmentVesselStageDailyInsertSql,
} from '../utils/shipmentPipelineDailySummarySql';
import logger from '../utils/logger';

export type PipelineSummaryModule = 'trucking' | 'shipment';

/** Bump when trucking pipeline status SQL changes — forces daily summary refresh. */
/** v7: COMPLETED when |OS Qty| displays as 0 MT (≤499 kg) even if GR PO/STO still Open. */
/** v10: import status any-Open wins (blank GR no longer falls back to contracts.status per row). */
export const TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION = 13; // Unplanned backlog daily grouping = origin plant
/** Bump when shipmentEffectiveStatusExpr / daily base CTE shape changes (e.g. Delivery Qty → PLANNED). */
export const SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION = 11; // List vessel = latest KLIP edit when GR Open

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
  charterType?: string;
  sourceType?: string;
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
/**
 * A Region/Plant filter cannot be answered from this snapshot - it stores a different dimension.
 *
 * The toolbar's Region/Plant options are DISTINCT SAP **Discharge Destination**
 * (`REGION_SITE_FILTER_OPTIONS_SQL`), but `group_plant` here is written by
 * `groupPlantExpr('c.plant_code', 'c.company_name')` - the `master_plants` grouping. The README
 * has warned since the alias work that these are two different dimensions shown side by side,
 * and scoping one with values from the other silently returns nothing.
 *
 * Measured on the dev database: the dropdown offers **40** values, the snapshot holds **11**, and
 * only **4** overlap even case-insensitively (BEKASI, BONTANG, KARAWANG, TANJUNG PURA). The old
 * comparison was case-sensitive too, so even those 4 failed: `BONTANG` matched 0 rows against the
 * stored `Bontang` (2,237) and `TANJUNG PURA` 0 against `Tanjung Pura` (4,866).
 *
 * Making the comparison case-insensitive would have been the tempting fix and the wrong one: it
 * would repair 4 of 40 options and leave the other 36 silently empty, which is worse than being
 * uniformly broken because it looks fixed.
 *
 * **`trucking_list_stage_snapshot` no longer needs this guard** - migration 164 gives it a
 * `region_site` column written from the live filter's own expression, so the three loaders that
 * read it scope on the right dimension. The guard still applies to every table that does not
 * carry that column: both `*_pipeline_daily_summary` tables, whose grain is
 * (group_plant, contract_date, product, incoterm) and cannot be re-keyed without re-deriving the
 * aggregates - the exact change that inflated 7 of 13 figures in the migration 163 first attempt
 * - and `shipment_list_stage_snapshot`, which simply has no region_site yet.
 */
export function pipelineDailySummaryScopeHasPlantFilter(scope: {
  plants?: string[];
}): boolean {
  return Array.isArray(scope.plants) && scope.plants.length > 0;
}

/**
 * Is `region_site` populated, or is this a snapshot built before migration 164?
 *
 * An unpopulated column is all NULL, and a NULL never matches `UPPER(region_site) IN (...)` - so
 * the page would come back empty again, which is the failure this column exists to fix. Falling
 * back to live is slower and right.
 *
 * The test is "does any row have a value", **not** "is every row non-NULL". Those differ, and
 * the stricter form was wrong: after the first rebuild 41 of 15,562 rows were NULL, and they are
 * legitimate - a contract with no b2b ending row and no SAP discharge destination has no
 * Region/Site. Requiring zero NULLs would have refused the snapshot forever over 0.3% of rows
 * that no filter can match anyway. Those rows are excluded from a plant filter on both paths,
 * because the live form compares the same NULL through `appendRegionSiteFilter`.
 *
 * The insert writes every row in one statement, so a half-populated table is not a state that
 * can occur.
 */
async function truckingStageSnapshotRegionSiteReady(): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM ${TRUCKING_LIST_STAGE_SNAPSHOT_TABLE} WHERE region_site IS NOT NULL LIMIT 1`,
  );
  return res.rows.length > 0;
}

/**
 * Is the Late Indicator's due-date column populated, or is this a build from before migration 165?
 *
 * Only `late_due_date` is checked, and deliberately: it is the rule's first branch, so a NULL
 * there means '-' rather than a missing input. The other two are legitimately NULL in bulk -
 * `late_ata_date` only where nothing has been received yet - so "any row has a value" is the
 * right test for the column existing, and it is this one that must be there for the rule to mean
 * anything.
 */
async function truckingStageSnapshotLateIndicatorReady(): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM ${TRUCKING_LIST_STAGE_SNAPSHOT_TABLE} WHERE late_due_date IS NOT NULL LIMIT 1`,
  );
  return res.rows.length > 0;
}

/** Can this scope be served from the trucking stage snapshot, plant filter included? */
async function truckingStageSnapshotCanScope(scope: PipelineDailySummaryScope): Promise<boolean> {
  if (!pipelineDailySummaryScopeHasPlantFilter(scope)) return true;
  return truckingStageSnapshotRegionSiteReady();
}

/**
 * Each flag says "this caller can express that filter", and may only be passed by a caller that
 * actually does. They are deliberately separate rather than one "stage snapshot" flag, because
 * the three are true for different reasons:
 *
 * - `allowPlantFilter`: the stage snapshot carries `region_site` (migration 164) and the scope
 *   applies it.
 * - `allowSourceTypeFilter`: the stage snapshot carries `source_type` (migration 163) and the
 *   caller passes `sourceType` down so the same predicate is applied.
 * - `allowLateIndicatorFilter`: the stage snapshot carries the rule's three input dates
 *   (migration 165) and the caller passes `lateIndicator` down so the shared rule is applied to
 *   them. The dates are stored, never the label - its last branch compares against CURRENT_DATE.
 * - `allowStatusFilter`: no predicate is needed at all. The summary's own query is built with
 *   `omitStatusFilter: true`, so it reports every status regardless of the selected card - the
 *   snapshot form does the same, and refusing the filter only forced an identical answer to be
 *   computed the slow way.
 *
 * Getting this wrong is not a slow page but a wrong one: a filter the snapshot cannot express
 * reaching a snapshot read is what made a Source-filtered page show 116 rows of 1,236.
 */
export function isPipelineDailySummaryEligible(
  filters: PipelineDailySummaryFilterInput,
  options?: {
    allowPlantFilter?: boolean;
    allowSourceTypeFilter?: boolean;
    allowStatusFilter?: boolean;
    allowLateIndicatorFilter?: boolean;
  },
): boolean {
  if (options?.allowPlantFilter !== true && pipelineDailySummaryScopeHasPlantFilter(filters)) {
    return false;
  }
  if (String(filters.globalSearch ?? '').trim()) return false;
  if (hasColumnFilters(filters.colFilters)) return false;
  if (
    options?.allowLateIndicatorFilter !== true &&
    filters.lateIndicator &&
    String(filters.lateIndicator).toUpperCase() !== 'ALL'
  ) {
    return false;
  }
  if (filters.charterType && String(filters.charterType).toUpperCase() !== 'ALL') return false;
  if (
    options?.allowSourceTypeFilter !== true &&
    filters.sourceType &&
    String(filters.sourceType).toUpperCase() !== 'ALL'
  ) {
    return false;
  }
  if (filters.viewOption || filters.viewQuery) return false;
  if (filters.scopeStatus && String(filters.scopeStatus).trim().toUpperCase() !== 'ALL') return false;
  if (
    options?.allowStatusFilter !== true &&
    filters.status &&
    String(filters.status).trim().toUpperCase() !== 'ALL'
  ) {
    return false;
  }
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

/**
 * Scope predicate for the snapshot tables.
 *
 * `regionSiteColumn` says the table carries the toolbar's Region/Plant dimension (SAP Discharge
 * Destination) and a plant filter may be applied to it. Only `trucking_list_stage_snapshot` does,
 * via migration 164; the aggregate tables still key on the master_plants `group_plant`, which is a
 * different dimension and must not be scoped with these values - see
 * `pipelineDailySummaryScopeHasPlantFilter`. Callers without the column refuse the plant filter
 * before reaching here, so a plant filter arriving without one is a programming error rather than
 * something to silently drop: it would return an unfiltered page, which is the worst outcome.
 */
function buildDailySummaryWhere(
  scope: PipelineDailySummaryScope,
  options?: {
    regionSiteColumn?: string;
    sourceType?: string;
    sourceTypeColumn?: string;
    /** Late Indicator, computed at read time from the stored dates - never a stored label. */
    lateIndicator?: string;
    lateIndicatorColumns?: { deliveryEnd: string; completion: string; etaCompletion: string };
  },
): {
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
    if (!options?.regionSiteColumn) {
      throw new Error(
        'buildDailySummaryWhere: a Region/Plant filter needs a region_site column - this table ' +
          'stores the master_plants group_plant dimension, which the toolbar does not use.',
      );
    }
    // Same comparison as the live filter (appendRegionSiteFilter): UPPER on both sides, and the
    // migration-164 index is on UPPER(region_site) so it stays sargable.
    const regionFilter = appendRegionSiteFilter(scope.plants, idx, options.regionSiteColumn);
    if (regionFilter.sql) {
      parts.push(regionFilter.sql.replace(/^ AND /, ''));
      params.push(...regionFilter.params);
      idx += regionFilter.params.length;
    }
  }
  /*
   * The Source filter, applied through the *same* function the live query uses so the two cannot
   * drift - it takes a column expression, so the snapshot's own `source_type` slots straight in.
   * It matches only the literals the UI sends ('Interco', '3rd Party') and returns '' otherwise,
   * which is why a caller must gate on the filter being one of those rather than on it merely
   * being set.
   */
  /*
   * The Late Indicator, evaluated here rather than stored.
   *
   * `sqlTruckingLateIndicatorSortExpr` is the single definition of the rule - the live filter's
   * `lateIndicatorTruckingExpr` now delegates to it too - so applying it to the snapshot's own
   * columns cannot drift from what a live request would have decided. It has to be computed at
   * read time because its last branch compares against CURRENT_DATE.
   */
  if (options?.lateIndicator && options.lateIndicatorColumns) {
    const wanted = String(options.lateIndicator).trim().toUpperCase();
    const label =
      wanted === 'ON_TIME' ? 'On Time' : wanted === 'LATE' ? 'Late' : wanted === 'NA' ? '-' : null;
    if (label) {
      const cols = options.lateIndicatorColumns;
      const expr = sqlTruckingLateIndicatorSortExpr(cols.deliveryEnd, cols.completion, cols.etaCompletion);
      parts.push(`${expr} = $${idx++}::text`);
      params.push(label);
    }
  }

  if (options?.sourceType && options.sourceTypeColumn) {
    const sourceSql = appendContractPerfSourceTypeFilter(options.sourceType, options.sourceTypeColumn);
    if (sourceSql) parts.push(sourceSql.replace(/^ AND /, ''));
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

export function isPipelineDailySummaryMetaUsable(
  meta: { is_stale: boolean; logic_version: number } | null,
  module: PipelineSummaryModule,
): boolean {
  if (!meta) return false;
  if (module === 'trucking' && meta.logic_version < TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION) {
    return false;
  }
  if (module === 'shipment' && meta.logic_version < SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION) {
    return false;
  }
  return true;
}

export function isPipelineDailySummaryMetaFresh(
  meta: { is_stale: boolean; logic_version: number } | null,
  module: PipelineSummaryModule,
): boolean {
  if (!meta || !isPipelineDailySummaryMetaUsable(meta, module)) return false;
  return !meta.is_stale;
}

export async function isPipelineDailySummaryFresh(module: PipelineSummaryModule): Promise<boolean> {
  const meta = await getRefreshMeta(module);
  return isPipelineDailySummaryMetaFresh(meta, module);
}

/** Snapshot exists at current logic version — usable for Section 1 cards even if marked stale. */
export async function isPipelineDailySummaryUsable(module: PipelineSummaryModule): Promise<boolean> {
  const meta = await getRefreshMeta(module);
  return isPipelineDailySummaryMetaUsable(meta, module);
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

/**
 * True from the moment a background refresh is scheduled until it finishes.
 *
 * The debounce below is time-based: lastStaleRefreshAt is stamped when a refresh is *scheduled*,
 * not when it *completes*. The trucking half of refreshAll() generates a ~691KB INSERT that took
 * 48.5s on staging (2026-08-06), so a second trigger 61s later started another full refresh while
 * the first was still running - two of the heaviest statements in the app writing the same tables
 * at once, on a 2-vCPU host shared with a dozen containers.
 *
 * A completion-based guard makes overlap impossible however slow a refresh becomes. Skipping is
 * safe: the staleness flag stays set, so the next trigger after the in-flight run finishes will
 * refresh. Section 1 cards keep reading the last snapshot (with a live stage overlay) while stale;
 * table paging still requires a fresh snapshot.
 */
let refreshInFlight = false;

export function schedulePipelineDailySummaryRefreshIfNeeded(): void {
  // Completion-based guard first - it must hold even when the time debounce has expired.
  if (refreshInFlight) return;

  const now = Date.now();
  if (now - lastStaleRefreshAt < STALE_REFRESH_DEBOUNCE_MS) return;
  lastStaleRefreshAt = now;

  // Set synchronously, before yielding to setImmediate, or two callers in the same tick both
  // schedule a refresh.
  refreshInFlight = true;
  setImmediate(() => {
    PipelineDailySummaryService.refreshAll()
      .catch((err) => {
        logger.warn('Background pipeline daily summary refresh failed', { err });
      })
      .finally(() => {
        refreshInFlight = false;
      });
  });
}

async function upsertRefreshMeta(
  module: PipelineSummaryModule,
  rowCount: number,
  durationMs: number,
  client?: PoolClient,
): Promise<void> {
  const logicVersion =
    module === 'trucking'
      ? TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION
      : SHIPMENT_PIPELINE_SUMMARY_LOGIC_VERSION;
  const sql = `INSERT INTO pipeline_summary_refresh_meta (module, refreshed_at, is_stale, row_count, duration_ms, logic_version)
     VALUES ($1, NOW(), FALSE, $2, $3, $4)
     ON CONFLICT (module) DO UPDATE SET
       refreshed_at = EXCLUDED.refreshed_at,
       is_stale = FALSE,
       row_count = EXCLUDED.row_count,
       duration_ms = EXCLUDED.duration_ms,
       logic_version = EXCLUDED.logic_version`;
  const params = [module, rowCount, durationMs, logicVersion];
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}

/** A published table and the session-local staging table the next generation is built in. */
interface PipelineRefreshTable {
  /** Published table readers query. */
  real: string;
  /** TEMP table of identical shape, built outside the advisory lock. */
  stage: string;
}

/**
 * Refresh a pipeline summary as build-then-swap.
 *
 * The previous shape took the advisory lock, TRUNCATEd every published table and then ran the
 * whole rebuild inside that one transaction. The trucking rebuild is minutes long on SIT
 * (observed 2026-09-07: durationMs 1,070,125 and 1,634,073), and pg_locks during one of those
 * runs showed what that cost: the single transaction held the refresh advisory lock plus
 * ACCESS EXCLUSIVE on trucking_pipeline_daily_summary, trucking_list_stage_snapshot and every
 * one of their indexes and toast relations, continuously, for the whole build. So
 * `SELECT count(*) FROM trucking_list_stage_snapshot` could not complete at all while a refresh
 * ran, every trucking list and circle-count read behind it stalled, and the next refresh queued
 * on the advisory lock for as long as the build took (measured: 3m38s and still waiting).
 *
 * So: build into staging tables first, with no advisory lock, no transaction and no lock on
 * anything readers touch. Only the DELETE + INSERT swap runs inside the locked transaction -
 * sub-second for ~21k rows - which is the part that actually has to be serialised and atomic.
 * DELETE, not TRUNCATE, so readers keep seeing the previous generation until the swap commits
 * instead of blocking on ACCESS EXCLUSIVE (same reasoning as the qty_move snapshot refresh).
 *
 * Concurrent refreshes (UI stale kick, scheduler, cleanup scripts) do not serialise by waiting:
 * the second caller sees the advisory lock is taken and returns instead of queueing, since the
 * holder is already building the generation it wanted. Waiting parked pooled connections for
 * minutes at a time.
 */
async function runPipelineRefresh(
  module: PipelineSummaryModule,
  lockKey: string,
  tables: PipelineRefreshTable[],
  /**
   * May be async: the shipment backlog statement now resolves the latest-SPD source (snapshot vs
   * live) before it can be built, and that resolution reads the snapshot's freshness flag.
   */
  buildStatements: (stage: Record<string, string>) => string[] | Promise<string[]>,
): Promise<number> {
  const start = Date.now();
  const client = await getClient();
  const stageByReal: Record<string, string> = {};
  for (const t of tables) stageByReal[t.real] = t.stage;

  let buildLocked = false;
  try {
    /**
     * Build lock: session-scoped, and acquired with try_ rather than waiting. Whoever holds it
     * is already producing the generation this caller wanted, so queueing behind it buys nothing
     * and costs a pooled connection for the whole build - observed live with two page requests
     * parked 365s and 308s behind a trucking stage build, which is what made the Shipment and
     * Trucking pages look dead. Skipping returns the connection immediately; readers serve from
     * the usable snapshot meanwhile.
     */
    const lockRes = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1::text)) AS locked',
      [`${lockKey}:build`],
    );
    if (!lockRes.rows[0]?.locked) {
      logger.info(`Pipeline daily summary refresh skipped: ${module} - another build holds the lock`);
      return 0;
    }
    buildLocked = true;

    // INCLUDING ALL, not just DEFAULTS: the build statements rely on the published tables'
    // unique indexes as ON CONFLICT arbiters, and LIKE also pins column order so the swap below
    // can use SELECT * without naming every column.
    for (const t of tables) {
      await client.query(`DROP TABLE IF EXISTS pg_temp.${t.stage}`);
      await client.query(`CREATE TEMP TABLE ${t.stage} (LIKE ${t.real} INCLUDING ALL)`);
    }

    // Heavy part. No transaction open, nothing else waiting on us.
    let rowCount = 0;
    for (const sql of await buildStatements(stageByReal)) {
      const res = await client.query(sql);
      rowCount += res.rowCount ?? 0;
    }
    const buildMs = Date.now() - start;

    // Publish. Short, atomic, and the only part that holds the refresh lock transactionally.
    const swapStart = Date.now();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [lockKey]);
      for (const t of tables) {
        await client.query(`DELETE FROM ${t.real}`);
        await client.query(`INSERT INTO ${t.real} SELECT * FROM ${t.stage}`);
      }
      await upsertRefreshMeta(module, rowCount, Date.now() - start, client);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback errors */
      }
      throw error;
    }

    logger.info(`Pipeline daily summary refreshed: ${module}`, {
      rowCount,
      durationMs: Date.now() - start,
      buildMs,
      swapMs: Date.now() - swapStart,
    });
    return rowCount;
  } finally {
    for (const t of tables) {
      try {
        await client.query(`DROP TABLE IF EXISTS pg_temp.${t.stage}`);
      } catch {
        /* staging table is session-local; a leftover is dropped by the next refresh */
      }
    }
    if (buildLocked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1::text))', [`${lockKey}:build`]);
      } catch {
        // Session-scoped, so it also releases when the connection closes - but a pooled
        // connection can live for hours, so a failure here has to be visible.
        logger.error('Failed to release pipeline refresh build lock', { module, lockKey });
      }
    }
    client.release();
  }
}

const TRUCKING_REFRESH_TABLES: PipelineRefreshTable[] = [
  {
    real: TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE,
    stage: 'pipeline_stage_trucking_pipeline_daily_summary',
  },
  {
    real: TRUCKING_LIST_STAGE_SNAPSHOT_TABLE,
    stage: 'pipeline_stage_trucking_list_stage_snapshot',
  },
];

const SHIPMENT_REFRESH_TABLES: PipelineRefreshTable[] = [
  {
    real: SHIPMENT_PIPELINE_DAILY_SUMMARY_TABLE,
    stage: 'pipeline_stage_shipment_pipeline_daily_summary',
  },
  {
    real: SHIPMENT_PIPELINE_VESSEL_STAGE_DAILY_TABLE,
    stage: 'pipeline_stage_shipment_pipeline_vessel_stage_daily',
  },
  {
    real: SHIPMENT_LIST_STAGE_SNAPSHOT_TABLE,
    stage: 'pipeline_stage_shipment_list_stage_snapshot',
  },
];

export class PipelineDailySummaryService {
  static async refreshTruckingPipelineDailySummary(): Promise<number> {
    return runPipelineRefresh(
      'trucking',
      'pipeline_daily_summary:trucking',
      TRUCKING_REFRESH_TABLES,
      /* async: the backlog upsert now resolves whether the latest-SPD snapshot is fresh
         before it can render its CTE. */
      async (stage) => [
        // Execution aggregates first: the backlog upsert updates the rows this one lands.
        buildTruckingExecutionDailySummaryInsertSql(stage[TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE]),
        await buildTruckingBacklogDailySummaryUpsertSql(stage[TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE]),
        buildTruckingStageSnapshotInsertSql(stage[TRUCKING_LIST_STAGE_SNAPSHOT_TABLE]),
      ],
    );
  }

  static async refreshShipmentPipelineDailySummary(): Promise<number> {
    return runPipelineRefresh(
      'shipment',
      'pipeline_daily_summary:shipment',
      SHIPMENT_REFRESH_TABLES,
      async (stage) => [
        buildShipmentExecutionDailySummaryInsertSql(stage[SHIPMENT_PIPELINE_DAILY_SUMMARY_TABLE]),
        await buildShipmentBacklogDailySummaryUpsertSql(stage[SHIPMENT_PIPELINE_DAILY_SUMMARY_TABLE]),
        buildShipmentVesselStageDailyInsertSql(stage[SHIPMENT_PIPELINE_VESSEL_STAGE_DAILY_TABLE]),
        buildShipmentStageSnapshotInsertSql(stage[SHIPMENT_LIST_STAGE_SNAPSHOT_TABLE]),
      ],
    );
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
  /** Contract qty (kg) for GR-Close Completed POs — live summary adds GR-Open remainder. */
  completedGrClosedContractQtyKg: number;
  cancelledGrClosedContractQtyKg: number;
} | null> {
  /**
   * Serve from a usable snapshot even when it is marked stale, and kick the refresh off in the
   * background - the same trade the Section 1 cards already make. A large SAP import marks both
   * modules stale at once and the trucking rebuild measured 880s (14.7 min); requiring freshness
   * here sent table paging down the live path for that whole window, at 45-104s per query with
   * several fired per page load. Stale-but-present shows figures from before the import for a
   * few minutes; the live fallback showed nothing at all in any usable time.
   */
  if (!(await isPipelineDailySummaryUsable('trucking'))) return null;
  // This table keys on the master_plants `group_plant` dimension, which the toolbar's
  // Region/Plant options are not drawn from - see pipelineDailySummaryScopeHasPlantFilter.
  if (pipelineDailySummaryScopeHasPlantFilter(scope)) return null;
  if (!(await isPipelineDailySummaryFresh('trucking'))) {
    schedulePipelineDailySummaryRefreshIfNeeded();
  }

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
      COALESCE(SUM(unplanned_contract_backlog), 0)::bigint AS unplanned_contract_backlog,
      COALESCE(SUM(completed_gr_closed_contract_qty), 0)::numeric AS completed_gr_closed_contract_qty,
      COALESCE(SUM(cancelled_gr_closed_contract_qty), 0)::numeric AS cancelled_gr_closed_contract_qty
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
    completedGrClosedContractQtyKg: Number(row.completed_gr_closed_contract_qty || 0) || 0,
    cancelledGrClosedContractQtyKg: Number(row.cancelled_gr_closed_contract_qty || 0) || 0,
  };
}

/**
 * Page STO keys for a status-card list request from the stage snapshot.
 * Returns null when the snapshot is stale (caller falls back to the live query).
 * Freshness/staleness matches the status cards themselves (same refresh cycle).
 */
/**
 * Page trucking expanded-row keys for a status-card list request from the stage
 * snapshot (populated by the same refresh as the circles, so totals match them).
 * Returns null when the snapshot is stale; ordering is the default list sort
 * (supplier, newest first) with deterministic tiebreakers.
 */
/**
 * Section 1's quantities from the precomputed rows, instead of expanding them per request.
 *
 * The live query is the most expensive thing on the Trucking page - measured 2026-09-10 at
 * ~23-37s and ~3.0M root buffers, with `SELECT count(*) FROM filtered` costing the same as the
 * whole summary, so producing the rows is the cost and aggregating them is free. The pipeline
 * refresh already runs that expansion to write `stage`, so migration 163 has it store the Section
 * 1 inputs alongside, at the same grain (verified: 6,496 rows for the default YTD window, the
 * identical count to the live `filtered` CTE).
 *
 * Only the source changes; every rule above it is the shared aggregate block. The dedup MAX
 * deliberately stays here at read time - `contract_number` is a STRING_AGG of every LAND contract
 * sharing the STO, and grouping finer than the whole string inflates the totals.
 *
 * Serves a usable snapshot even when marked stale, and kicks the refresh off behind it - the same
 * policy loadTruckingSummaryFromDaily uses, and the reason the caller reports an as-of to the
 * page rather than pretending the figures are live.
 */
export async function loadTruckingSection1FromStageSnapshot(
  scope: PipelineDailySummaryScope,
  opts: { includeCounts?: boolean; sourceType?: string; lateIndicator?: string } = {},
): Promise<{
  row: Record<string, unknown>;
  refreshedAt: string | null;
  isStale: boolean;
} | null> {
  if (!(await isPipelineDailySummaryUsable('trucking'))) return null;
  if (!(await truckingStageSnapshotCanScope(scope))) return null;
  // A Late Indicator filter needs migration 165's columns actually written.
  if (opts.lateIndicator && String(opts.lateIndicator).trim().toUpperCase() !== 'ALL') {
    if (!(await truckingStageSnapshotLateIndicatorReady())) return null;
  }
  if (!(await isPipelineDailySummaryFresh('trucking'))) {
    schedulePipelineDailySummaryRefreshIfNeeded();
  }

  const meta = await getRefreshMeta('trucking');
  const { sql, params } = buildDailySummaryWhere(scope, {
    regionSiteColumn: 'region_site',
    sourceType: opts.sourceType,
    sourceTypeColumn: 'source_type',
    lateIndicator: opts.lateIndicator,
    lateIndicatorColumns: {
      deliveryEnd: 'late_due_date',
      completion: 'late_ata_date',
      etaCompletion: 'late_eta_date',
    },
  });
  /*
   * A snapshot written before migration 163 has these columns NULL, which would silently read as
   * zero quantities. Require one non-null before trusting it; until the refresh has run since
   * 163, the caller falls back to the live path exactly as before.
   */
  const ready = await query(
    `SELECT 1 FROM ${TRUCKING_LIST_STAGE_SNAPSHOT_TABLE} WHERE contract_number IS NOT NULL LIMIT 1`,
    [],
  );
  if (ready.rows.length === 0) return null;

  const text = buildTruckingSection1FromSnapshotQuery({
    tableName: TRUCKING_LIST_STAGE_SNAPSHOT_TABLE,
    whereSql: sql,
    includeCounts: opts.includeCounts === true,
  });
  const res = await query(text, params);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    row,
    refreshedAt: meta ? new Date(meta.refreshed_at).toISOString() : null,
    isStale: meta ? meta.is_stale === true : true,
  };
}

/**
 * The ALL view's execution row count, from the stage snapshot.
 *
 * The live form is `buildTruckingExpansionKeysCountSql` - `COUNT(DISTINCT ts.id)` over the whole
 * list select joined to contracts - and it measured **24,609 ms** on the cold Trucking page,
 * making it one of the two queries that bound the wall time. The stage snapshot answers the same
 * question from an index: it holds exactly one row per operation, written from the same expansion
 * and with the same `INNER JOIN contracts`, so `COUNT(*)` over it is the same number by
 * construction.
 *
 * Deliberately counted from the *stage snapshot* and not from
 * `trucking_pipeline_daily_summary.total_count`: that column filters
 * `COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'` because it feeds the status circles, which must
 * exclude SAP-cancelled POs - while the list still shows those rows. Using it would quietly
 * undercount the table. The stage snapshot applies no such filter, which is what the list needs.
 *
 * Same stale-but-usable policy as the paging loader above: a rebuild is scheduled behind the read
 * rather than sending the page down a 24s path for the duration of it.
 */
export async function loadTruckingExecutionCountFromSnapshot(
  scope: PipelineDailySummaryScope,
): Promise<number | null> {
  if (!(await isPipelineDailySummaryUsable('trucking'))) return null;
  if (!(await truckingStageSnapshotCanScope(scope))) return null;
  /**
   * Serve a usable snapshot even when it is marked stale, and refresh behind.
   *
   * Requiring freshness here was tried on 2026-09-11 and reverted the same day. The reasoning was
   * sound - a WB upload marks this stale, the rebuild takes 150-240s, and a row missing from the
   * table for that window reads as the upload having failed, which is worse than a figure being a
   * few minutes behind. The measurement was not: every write marks it stale, and on the dev box
   * **14,591 of 16,552** operations had been touched since the last successful rebuild, so the
   * rule sent essentially every request down the live path and the page took 25-190s. It made the
   * page unusable in order to fix a gap it only closes while a rebuild happens to be current.
   *
   * The requirement is real and is **not met by this loader**: rows created by an upload do not
   * appear until the next rebuild. Closing it properly means refreshing the affected operations
   * on write - the pattern `contractPerformanceSnapshot.service` already uses in
   * `refreshForTruckingOperationIds` - so the catch-up is seconds rather than minutes. Until that
   * exists, this serves fast and slightly behind, which is what it did before today.
   */
  if (!(await isPipelineDailySummaryFresh('trucking'))) {
    schedulePipelineDailySummaryRefreshIfNeeded();
  }

  const { sql, params } = buildDailySummaryWhere(scope, { regionSiteColumn: 'region_site' });
  const res = await query(
    `SELECT COUNT(*)::bigint AS c FROM ${TRUCKING_LIST_STAGE_SNAPSHOT_TABLE} ${sql}`,
    params,
  );
  const row = res.rows[0] as { c?: string } | undefined;
  if (!row) return null;
  return parseInt(String(row.c ?? '0'), 10) || 0;
}

/**
 * The contract-backlog row count for the same scope, from the daily summary.
 *
 * The live form is one of the three `latest_spd_contract` queries that cost 10-19s each on the
 * cold page. `unplanned_contract_backlog` is written by the same backlog builder, so this is the
 * same predicate rather than an approximation of it - and it is verified against the live count
 * before being trusted, because "same builder" is an argument and the parity check is evidence.
 */
export async function loadTruckingBacklogCountFromSnapshot(
  scope: PipelineDailySummaryScope,
): Promise<number | null> {
  if (!(await isPipelineDailySummaryUsable('trucking'))) return null;
  // This table keys on the master_plants `group_plant` dimension, which the toolbar's
  // Region/Plant options are not drawn from - see pipelineDailySummaryScopeHasPlantFilter.
  if (pipelineDailySummaryScopeHasPlantFilter(scope)) return null;
  const { sql, params } = buildDailySummaryWhere(scope);
  const res = await query(
    `SELECT COALESCE(SUM(unplanned_contract_backlog), 0)::bigint AS c
     FROM trucking_pipeline_daily_summary ${sql}`,
    params,
  );
  const row = res.rows[0] as { c?: string } | undefined;
  if (!row) return null;
  return parseInt(String(row.c ?? '0'), 10) || 0;
}

/**
 * The sorts a snapshot-served page can order by - the only two the snapshot stores a column for.
 * Every other sort keeps the live ranking, which reads columns the snapshot does not carry.
 */
export type TruckingSnapshotPageSortField = 'supplier' | 'created_at';

/**
 * A page of row keys from the stage snapshot, plus the total for that scope.
 *
 * `stage` selects the status card; pass **null** for the ALL view, which applies no stage
 * predicate and so enumerates the whole list row set. That is the same set the live ALL page
 * builds, and the expensive part of building it live is deciding *which* keys the page holds -
 * the live query materialises `trucking_source` and `contract_sto_lines` to get there, measured
 * at 12,567 ms on the cold page, while this reads one indexed row per operation.
 *
 * Both callers depend on this ORDER BY matching the live key order exactly, and getting there
 * meant fixing the live side rather than bending this one: it had no unique tiebreaker, so tied
 * rows came out in whatever order the plan produced. See buildTruckingExpansionKeyOrderBy.
 *
 * `sortField` is limited to the two the snapshot stores a column for. `created_at` needs no
 * second clause: the live order repeats `created_at DESC` after it, which is redundant on the
 * same column, so `created_at <dir> NULLS LAST, operation_id` is the identical ordering.
 */
export async function loadTruckingStagePageFromSnapshot(
  scope: PipelineDailySummaryScope,
  stage: string | null,
  sortDir: 'ASC' | 'DESC',
  limit: number,
  offset: number,
  sortField: TruckingSnapshotPageSortField = 'supplier',
): Promise<{ keys: Array<{ operationId: string; stoLine: string }>; total: number } | null> {
  /**
   * Serve from a usable snapshot even when it is marked stale, and kick the refresh off in the
   * background - the same trade the Section 1 cards already make. A large SAP import marks both
   * modules stale at once and the trucking rebuild measured 880s (14.7 min); requiring freshness
   * here sent table paging down the live path for that whole window, at 45-104s per query with
   * several fired per page load. Stale-but-present shows figures from before the import for a
   * few minutes; the live fallback showed nothing at all in any usable time.
   */
  if (!(await isPipelineDailySummaryUsable('trucking'))) return null;
  if (!(await truckingStageSnapshotCanScope(scope))) return null;
  /**
   * Serve a usable snapshot even when it is marked stale, and refresh behind.
   *
   * Requiring freshness here was tried on 2026-09-11 and reverted the same day. The reasoning was
   * sound - a WB upload marks this stale, the rebuild takes 150-240s, and a row missing from the
   * table for that window reads as the upload having failed, which is worse than a figure being a
   * few minutes behind. The measurement was not: every write marks it stale, and on the dev box
   * **14,591 of 16,552** operations had been touched since the last successful rebuild, so the
   * rule sent essentially every request down the live path and the page took 25-190s. It made the
   * page unusable in order to fix a gap it only closes while a rebuild happens to be current.
   *
   * The requirement is real and is **not met by this loader**: rows created by an upload do not
   * appear until the next rebuild. Closing it properly means refreshing the affected operations
   * on write - the pattern `contractPerformanceSnapshot.service` already uses in
   * `refreshForTruckingOperationIds` - so the catch-up is seconds rather than minutes. Until that
   * exists, this serves fast and slightly behind, which is what it did before today.
   */
  if (!(await isPipelineDailySummaryFresh('trucking'))) {
    schedulePipelineDailySummaryRefreshIfNeeded();
  }

  const { sql, params } = buildDailySummaryWhere(scope, { regionSiteColumn: 'region_site' });
  const normalizedStage = stage == null ? null : String(stage).trim().toUpperCase();
  // PLANNED never occurs on its own (see klip-trucking-planned-equals-in-progress); the card
  // shows PLANNED + IN_PROGRESS, so it takes no parameter. ALL takes no predicate at all.
  const isPlannedCard = normalizedStage === 'PLANNED';
  const stageParam = normalizedStage !== null && !isPlannedCard ? stage : null;
  const stagePredicate =
    normalizedStage === null
      ? ''
      : isPlannedCard
        ? `stage IN ('PLANNED', 'IN_PROGRESS')`
        : `stage = $${params.length + 1}`;
  const whereSql = stagePredicate
    ? sql
      ? `${sql} AND ${stagePredicate}`
      : `WHERE ${stagePredicate}`
    : sql;
  const baseParams = stageParam === null ? [...params] : [...params, stageParam];
  const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';
  const orderBy =
    sortField === 'created_at'
      ? `created_at ${dir} NULLS LAST, operation_id`
      : `supplier ${dir} NULLS LAST, created_at DESC NULLS LAST, operation_id`;
  const limitIdx = baseParams.length + 1;
  const offsetIdx = limitIdx + 1;
  const pageParams = [...baseParams, limit, offset];
  const pageRes = await query(
    `SELECT
      operation_id,
      sto_line,
      COUNT(*) OVER ()::bigint AS filtered_total
    FROM trucking_list_stage_snapshot
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    pageParams,
  );

  if (pageRes.rows.length > 0) {
    return {
      keys: pageRes.rows.map((r) => ({
        operationId: String((r as { operation_id: unknown }).operation_id),
        stoLine: String((r as { sto_line: unknown }).sto_line ?? ''),
      })),
      total: Number((pageRes.rows[0] as { filtered_total?: unknown }).filtered_total || 0),
    };
  }

  const countParams = [...baseParams];
  const countRes = await query(
    `SELECT COUNT(*)::bigint AS c FROM trucking_list_stage_snapshot ${whereSql}`,
    countParams,
  );
  return { keys: [], total: Number((countRes.rows[0] as { c?: unknown })?.c || 0) };
}

export async function loadShipmentStagePageFromSnapshot(
  scope: PipelineDailySummaryScope,
  stage: string,
  limit: number,
  offset: number,
): Promise<{ stoKeys: string[]; total: number } | null> {
  /**
   * Serve from a usable snapshot even when it is marked stale, and kick the refresh off in the
   * background - the same trade the Section 1 cards already make. A large SAP import marks both
   * modules stale at once and the trucking rebuild measured 880s (14.7 min); requiring freshness
   * here sent table paging down the live path for that whole window, at 45-104s per query with
   * several fired per page load. Stale-but-present shows figures from before the import for a
   * few minutes; the live fallback showed nothing at all in any usable time.
   */
  if (!(await isPipelineDailySummaryUsable('shipment'))) return null;
  // This table keys on the master_plants `group_plant` dimension, which the toolbar's
  // Region/Plant options are not drawn from - see pipelineDailySummaryScopeHasPlantFilter.
  if (pipelineDailySummaryScopeHasPlantFilter(scope)) return null;
  if (!(await isPipelineDailySummaryFresh('shipment'))) {
    schedulePipelineDailySummaryRefreshIfNeeded();
  }

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
  preplannedBreakdown: {
    contractRows: number;
    groupCount: number;
    totalTableRows: number;
  };
} | null> {
  if (!(await isPipelineDailySummaryUsable('shipment'))) return null;
  // This table keys on the master_plants `group_plant` dimension, which the toolbar's
  // Region/Plant options are not drawn from - see pipelineDailySummaryScopeHasPlantFilter.
  if (pipelineDailySummaryScopeHasPlantFilter(scope)) return null;
  if (!(await isPipelineDailySummaryFresh('shipment'))) {
    schedulePipelineDailySummaryRefreshIfNeeded();
  }

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
      COALESCE(SUM(preplanned_contract_count), 0)::bigint AS preplanned_count,
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
  const preplannedRows = Number(row.preplanned_count || 0);

  return {
    summaryRow: {
      ...row,
      ...vesselRow,
      /** Unplanned vessels are PO-only (none); clear stale UNPLANNED stage facts. */
      unplanned_vessel_names: [],
      unplanned_shipment_execution_count: 0,
    },
    totalCount: Number(row.total_count || 0),
    unplannedBreakdown: {
      contractRows,
      shipmentRows: 0,
      totalTableRows: contractRows,
    },
    preplannedBreakdown: {
      contractRows: preplannedRows,
      groupCount: preplannedRows,
      totalTableRows: preplannedRows,
    },
  };
}
