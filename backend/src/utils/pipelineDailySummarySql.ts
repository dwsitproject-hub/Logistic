/**
 * SQL builders for trucking pipeline daily summary refresh.
 */

import { groupPlantExpr } from './groupPlantSql';
import { sqlRegionSiteRawForContract } from './regionSiteSql';
import {
  sqlPipelineIncotermKey,
  sqlPipelineProductKey,
} from './pipelineDailySummaryToolbarScope';
import { truckingPageListScopeWhereSql } from './truckingIncotermScope';
import { truckingListExcludeDedupedWhereSql } from './truckingOperationUniqueness';
import {
  buildTruckingListFromClause,
  buildTruckingListSelectClause,
  truckingListB2bExcludeSql,
} from './truckingListSelectSql';
import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';
import { buildTruckingUnplannedBacklogDailySummarySql } from './truckingUnplannedHybridSql';

const NULL_CONTRACT_DATE = `DATE '1970-01-01'`;

/**
 * Published tables the trucking refresh swaps into. The builders below take the target as an
 * argument so PipelineDailySummaryService can aim them at a staging copy and keep the heavy
 * INSERTs out of the transaction that publishes the result.
 */
export const TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE = 'trucking_pipeline_daily_summary';
export const TRUCKING_LIST_STAGE_SNAPSHOT_TABLE = 'trucking_list_stage_snapshot';

function buildTruckingExecutionSourceSql(): string {
  const innerSql = `
      SELECT
        ${buildTruckingListSelectClause(false)}
      ${buildTruckingListFromClause(false)}
      WHERE 1=1
        ${truckingListExcludeDedupedWhereSql}
        ${truckingListB2bExcludeSql(false)}
        ${truckingPageListScopeWhereSql}
    `;
  return wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: true,
    skipSapJoin: false,
  });
}

/** INSERT execution-row aggregates grouped by group_plant + contract_date. */
export function buildTruckingExecutionDailySummaryInsertSql(
  targetTable: string = TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE,
): string {
  const expanded = buildTruckingExecutionSourceSql();
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  return `
    INSERT INTO ${targetTable} (
      group_plant,
      contract_date,
      product,
      incoterm,
      total_count,
      unplanned_execution_count,
      planned_count,
      in_progress_count,
      loading_count,
      in_transit_count,
      unloading_count,
      completed_count,
      cancelled_count,
      completed_gr_closed_contract_qty,
      cancelled_gr_closed_contract_qty
    )
    WITH execution_rows AS (
      SELECT
        ${plant} AS group_plant,
        COALESCE(c.contract_date, src.contract_date, ${NULL_CONTRACT_DATE})::date AS contract_date,
        ${sqlPipelineProductKey('c.product')} AS product,
        ${sqlPipelineIncotermKey('c.incoterm')} AS incoterm,
        src.status,
        src.status_db,
        src.contract_number,
        src.contract_qty,
        COALESCE(src.is_contract_sap_closed, FALSE) AS is_contract_sap_closed
      FROM (${expanded}) src
      INNER JOIN contracts c ON c.id = src.contract_id
      -- Snapshot feeds the status circles only. Operations whose PO SAP cancelled or deleted
      -- must not count towards them; the trucking list still shows the rows.
      WHERE COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'
    ),
    per_contract AS (
      SELECT
        group_plant,
        contract_date,
        product,
        incoterm,
        status,
        contract_number,
        MAX(COALESCE(contract_qty, 0))::numeric AS contract_qty,
        BOOL_OR(is_contract_sap_closed) AS is_gr_closed
      FROM execution_rows
      WHERE NULLIF(TRIM(COALESCE(contract_number::text, '')), '') IS NOT NULL
      GROUP BY group_plant, contract_date, product, incoterm, status, contract_number
    ),
    qty AS (
      SELECT
        group_plant,
        contract_date,
        product,
        incoterm,
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'COMPLETED' AND is_gr_closed), 0)::numeric AS completed_gr_closed_contract_qty,
        COALESCE(SUM(contract_qty) FILTER (WHERE status = 'CANCELLED' AND is_gr_closed), 0)::numeric AS cancelled_gr_closed_contract_qty
      FROM per_contract
      GROUP BY group_plant, contract_date, product, incoterm
    ),
    counts AS (
      SELECT
        group_plant,
        contract_date,
        product,
        incoterm,
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE status = 'UNPLANNED')::bigint AS unplanned_execution_count,
        COUNT(*) FILTER (WHERE status = 'PLANNED')::bigint AS planned_count,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint AS in_progress_count,
        COUNT(*) FILTER (WHERE status_db = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE status_db = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE status_db = 'UNLOADING')::bigint AS unloading_count,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled_count
      FROM execution_rows
      GROUP BY group_plant, contract_date, product, incoterm
    )
    SELECT
      c.group_plant,
      c.contract_date,
      c.product,
      c.incoterm,
      c.total_count,
      c.unplanned_execution_count,
      c.planned_count,
      c.in_progress_count,
      c.loading_count,
      c.in_transit_count,
      c.unloading_count,
      c.completed_count,
      c.cancelled_count,
      COALESCE(q.completed_gr_closed_contract_qty, 0),
      COALESCE(q.cancelled_gr_closed_contract_qty, 0)
    FROM counts c
    LEFT JOIN qty q
      ON q.group_plant = c.group_plant
     AND q.contract_date = c.contract_date
     AND q.product = c.product
     AND q.incoterm = c.incoterm
    ON CONFLICT (group_plant, contract_date, product, incoterm) DO UPDATE SET
      total_count = EXCLUDED.total_count,
      unplanned_execution_count = EXCLUDED.unplanned_execution_count,
      planned_count = EXCLUDED.planned_count,
      in_progress_count = EXCLUDED.in_progress_count,
      loading_count = EXCLUDED.loading_count,
      in_transit_count = EXCLUDED.in_transit_count,
      unloading_count = EXCLUDED.unloading_count,
      completed_count = EXCLUDED.completed_count,
      cancelled_count = EXCLUDED.cancelled_count,
      completed_gr_closed_contract_qty = EXCLUDED.completed_gr_closed_contract_qty,
      cancelled_gr_closed_contract_qty = EXCLUDED.cancelled_gr_closed_contract_qty`;
}

export function buildTruckingBacklogDailySummaryUpsertSql(
  targetTable: string = TRUCKING_PIPELINE_DAILY_SUMMARY_TABLE,
): Promise<string> {
  return buildTruckingUnplannedBacklogDailySummarySql(targetTable);
}

/**
 * INSERT the pipeline stage per operation (PO grain), from the SAME source query the
 * circle counts aggregate — so the list can read circles-consistent stages.
 * Must never itself read from trucking_list_stage_snapshot (useStageSnapshot stays off
 * in buildTruckingExecutionSourceSql).
 */
export function buildTruckingStageSnapshotInsertSql(
  targetTable: string = TRUCKING_LIST_STAGE_SNAPSHOT_TABLE,
): string {
  const expanded = buildTruckingExecutionSourceSql();
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  /*
   * The toolbar's Region/Plant dimension, stored next to - not instead of - `group_plant`.
   *
   * `group_plant` is the master_plants grouping; the filter's options are SAP Discharge
   * Destination. Only 4 of the dropdown's 40 values exist in both, which is why filtering the
   * snapshot by Region/Plant returned an empty page (migration 164).
   *
   * This is the *same expression the live filter evaluates*, inlined rather than re-derived, so
   * the stored value cannot drift from what a live request would have matched. Timed over all
   * 18,751 contracts first: 5.2s against a 227s build.
   */
  const regionSite = sqlRegionSiteRawForContract('c.contract_id', 'c.po_number');
  return `
    INSERT INTO ${targetTable} (
      operation_id, sto_line, stage, group_plant, contract_date, product, incoterm, supplier, created_at,
      contract_number, contract_qty, outstanding_quantity, source_type, incoterm_eff, sap_presence, status_db,
      region_site
    )
    SELECT
      src.id,
      COALESCE(NULLIF(TRIM(src.sto_number::text), ''), ''),
      src.status,
      COALESCE(${plant}, 'Blank'),
      COALESCE(c.contract_date, src.contract_date, ${NULL_CONTRACT_DATE})::date,
      ${sqlPipelineProductKey('c.product')},
      ${sqlPipelineIncotermKey('c.incoterm')},
      NULLIF(TRIM(COALESCE(src.supplier, c.supplier)), ''),
      src.created_at,
      /*
       * Section 1's inputs, at the grain the expansion produces them. Every one of these is
       * already on src - this expansion is built with selectOutstanding and the full SAP join
       * because the stage column needs it - so storing them costs the write and nothing else.
       *
       * They are stored raw, not aggregated: contract_number is a STRING_AGG of every LAND
       * contract sharing the STO, so the dedup MAX has to be taken over the whole group at read
       * time. Pre-aggregating per dimension was tried and inflated the totals - see migration 163.
       */
      src.contract_number,
      src.contract_qty,
      src.outstanding_quantity,
      src.source_type,
      src.incoterm,
      src.sap_presence,
      src.status_db,
      ${regionSite}
    FROM (${expanded}) src
    INNER JOIN contracts c ON c.id = src.contract_id
    WHERE src.id IS NOT NULL AND src.status IS NOT NULL
    ON CONFLICT (operation_id) DO NOTHING`;
}
