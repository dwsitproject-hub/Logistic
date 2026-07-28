/**
 * SQL builders for trucking pipeline daily summary refresh.
 */

import { groupPlantExpr } from './groupPlantSql';
import {
  sqlPipelineIncotermKey,
  sqlPipelineProductKey,
} from './pipelineDailySummaryToolbarScope';
import { truckingPageListScopeWhereSql } from './truckingIncotermScope';
import {
  buildTruckingListFromClause,
  buildTruckingListSelectClause,
  truckingListB2bExcludeSql,
} from './truckingListSelectSql';
import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';
import { buildTruckingUnplannedBacklogDailySummarySql } from './truckingUnplannedHybridSql';

const NULL_CONTRACT_DATE = `DATE '1970-01-01'`;

function buildTruckingExecutionSourceSql(): string {
  const innerSql = `
      SELECT
        ${buildTruckingListSelectClause(false)}
      ${buildTruckingListFromClause(false)}
      WHERE 1=1
        ${truckingListB2bExcludeSql(false)}
        ${truckingPageListScopeWhereSql}
    `;
  return wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: true,
    skipSapJoin: false,
  });
}

/** INSERT execution-row aggregates grouped by group_plant + contract_date. */
export function buildTruckingExecutionDailySummaryInsertSql(): string {
  const expanded = buildTruckingExecutionSourceSql();
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  return `
    INSERT INTO trucking_pipeline_daily_summary (
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
      cancelled_count
    )
    WITH execution_rows AS (
      SELECT
        ${plant} AS group_plant,
        COALESCE(c.contract_date, src.contract_date, ${NULL_CONTRACT_DATE})::date AS contract_date,
        ${sqlPipelineProductKey('c.product')} AS product,
        ${sqlPipelineIncotermKey('c.incoterm')} AS incoterm,
        src.status,
        src.status_db
      FROM (${expanded}) src
      INNER JOIN contracts c ON c.id = src.contract_id
      -- Snapshot feeds the status circles only. Operations whose PO SAP cancelled or deleted
      -- must not count towards them; the trucking list still shows the rows.
      WHERE COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'
    )
    SELECT
      group_plant,
      contract_date,
      product,
      incoterm,
      COUNT(*)::bigint,
      COUNT(*) FILTER (WHERE status = 'UNPLANNED')::bigint,
      COUNT(*) FILTER (WHERE status = 'PLANNED')::bigint,
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint,
      COUNT(*) FILTER (WHERE status_db = 'LOADING')::bigint,
      COUNT(*) FILTER (WHERE status_db = 'IN_TRANSIT')::bigint,
      COUNT(*) FILTER (WHERE status_db = 'UNLOADING')::bigint,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint
    FROM execution_rows
    GROUP BY group_plant, contract_date, product, incoterm
    ON CONFLICT (group_plant, contract_date, product, incoterm) DO UPDATE SET
      total_count = EXCLUDED.total_count,
      unplanned_execution_count = EXCLUDED.unplanned_execution_count,
      planned_count = EXCLUDED.planned_count,
      in_progress_count = EXCLUDED.in_progress_count,
      loading_count = EXCLUDED.loading_count,
      in_transit_count = EXCLUDED.in_transit_count,
      unloading_count = EXCLUDED.unloading_count,
      completed_count = EXCLUDED.completed_count,
      cancelled_count = EXCLUDED.cancelled_count`;
}

export function buildTruckingBacklogDailySummaryUpsertSql(): string {
  return buildTruckingUnplannedBacklogDailySummarySql();
}

/**
 * INSERT the pipeline stage per operation (PO grain), from the SAME source query the
 * circle counts aggregate — so the list can read circles-consistent stages.
 * Must never itself read from trucking_list_stage_snapshot (useStageSnapshot stays off
 * in buildTruckingExecutionSourceSql).
 */
export function buildTruckingStageSnapshotInsertSql(): string {
  const expanded = buildTruckingExecutionSourceSql();
  const plant = groupPlantExpr('c.plant_code', 'c.company_name');
  return `
    INSERT INTO trucking_list_stage_snapshot (
      operation_id, sto_line, stage, group_plant, contract_date, product, incoterm, supplier, created_at
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
      src.created_at
    FROM (${expanded}) src
    INNER JOIN contracts c ON c.id = src.contract_id
    WHERE src.id IS NOT NULL AND src.status IS NOT NULL
    ON CONFLICT (operation_id) DO NOTHING`;
}
