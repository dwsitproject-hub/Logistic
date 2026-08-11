/**
 * Shipments Section 1 — single enriched scan for pipeline summary counts + status-card qty.
 */

import { shipmentEffectiveStatusExpr } from './shipmentListFilters';
import { shipmentListSpdAggCtes } from './shipmentListSapAggSql';
import { shipmentListPageQtySelectSql } from './shipmentListQtySql';
import { shipmentListQtyMoveCteFromPage } from './shipmentOutstandingQtySql';
import { sqlMasterVesselLateralJoin } from './masterVesselDisplaySql';
import {
  shipmentPagePipelineSummarySelectSql,
  shipmentPagePipelineUnplannedRowPredicate,
  shipmentPagePipelineVesselNamesSelectSql,
  shipmentPipelineEnrichedDisplayVesselKeyExpr,
} from './shipmentPagePipelineSql';
import {
  parseShipmentStatusContractQtyFromExecutionRow,
  parseShipmentStatusOutstandingQtyFromSqlRow,
  type ShipmentStatusCardQtyBundle,
} from './shipmentStatusCardQtySql';

const LOADING_STATUS_GROUP =
  "effective_status IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING')";
const DISCHARGE_STATUS_GROUP =
  "effective_status IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING')";

/** ETA bucket flags for Section 1 summary cards (alias = filtered/scoped shipment row). */
export function buildShipmentSummaryEtaEnrichmentSelect(alias = 'f'): string {
  return `
          ${shipmentEffectiveStatusExpr(alias)} AS effective_status,
          (
            ${alias}.eta_arrival IS NULL AND ${alias}.eta_berthed IS NULL AND ${alias}.eta_loading_start IS NULL AND ${alias}.eta_loading_complete IS NULL AND ${alias}.eta_sailed IS NULL
          ) AS loading_no_eta,
          (
            (${alias}.eta_arrival IS NOT NULL AND (${alias}.eta_arrival::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_berthed IS NOT NULL AND (${alias}.eta_berthed::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_loading_start IS NOT NULL AND (${alias}.eta_loading_start::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_loading_complete IS NOT NULL AND (${alias}.eta_loading_complete::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_sailed IS NOT NULL AND (${alias}.eta_sailed::date - CURRENT_DATE) < 0)
          ) AS loading_delay,
          (
            (${alias}.eta_arrival IS NOT NULL AND (${alias}.eta_arrival::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_berthed IS NOT NULL AND (${alias}.eta_berthed::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_loading_start IS NOT NULL AND (${alias}.eta_loading_start::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_loading_complete IS NOT NULL AND (${alias}.eta_loading_complete::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_sailed IS NOT NULL AND (${alias}.eta_sailed::date - CURRENT_DATE) = 0)
          ) AS loading_d,
          (
            (${alias}.eta_arrival IS NOT NULL AND (${alias}.eta_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_berthed IS NOT NULL AND (${alias}.eta_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_loading_start IS NOT NULL AND (${alias}.eta_loading_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_loading_complete IS NOT NULL AND (${alias}.eta_loading_complete::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_sailed IS NOT NULL AND (${alias}.eta_sailed::date - CURRENT_DATE) BETWEEN 1 AND 2)
          ) AS loading_d_minus_2,
          (
            (${alias}.eta_arrival IS NOT NULL AND (${alias}.eta_arrival::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_berthed IS NOT NULL AND (${alias}.eta_berthed::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_loading_start IS NOT NULL AND (${alias}.eta_loading_start::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_loading_complete IS NOT NULL AND (${alias}.eta_loading_complete::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_sailed IS NOT NULL AND (${alias}.eta_sailed::date - CURRENT_DATE) > 7)
          ) AS loading_more_than_7d,
          (
            ${alias}.eta_discharge_arrival IS NULL AND ${alias}.eta_discharge_berthed IS NULL AND ${alias}.eta_discharge_start IS NULL AND ${alias}.eta_vessel_complete_discharge IS NULL
          ) AS discharge_no_eta,
          (
            (${alias}.eta_discharge_arrival IS NOT NULL AND (${alias}.eta_discharge_arrival::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_discharge_berthed IS NOT NULL AND (${alias}.eta_discharge_berthed::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_discharge_start IS NOT NULL AND (${alias}.eta_discharge_start::date - CURRENT_DATE) < 0) OR
            (${alias}.eta_vessel_complete_discharge IS NOT NULL AND (${alias}.eta_vessel_complete_discharge::date - CURRENT_DATE) < 0)
          ) AS discharge_delay,
          (
            (${alias}.eta_discharge_arrival IS NOT NULL AND (${alias}.eta_discharge_arrival::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_discharge_berthed IS NOT NULL AND (${alias}.eta_discharge_berthed::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_discharge_start IS NOT NULL AND (${alias}.eta_discharge_start::date - CURRENT_DATE) = 0) OR
            (${alias}.eta_vessel_complete_discharge IS NOT NULL AND (${alias}.eta_vessel_complete_discharge::date - CURRENT_DATE) = 0)
          ) AS discharge_d,
          (
            (${alias}.eta_discharge_arrival IS NOT NULL AND (${alias}.eta_discharge_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_discharge_berthed IS NOT NULL AND (${alias}.eta_discharge_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_discharge_start IS NOT NULL AND (${alias}.eta_discharge_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (${alias}.eta_vessel_complete_discharge IS NOT NULL AND (${alias}.eta_vessel_complete_discharge::date - CURRENT_DATE) BETWEEN 1 AND 2)
          ) AS discharge_d_minus_2,
          (
            (${alias}.eta_discharge_arrival IS NOT NULL AND (${alias}.eta_discharge_arrival::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_discharge_berthed IS NOT NULL AND (${alias}.eta_discharge_berthed::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_discharge_start IS NOT NULL AND (${alias}.eta_discharge_start::date - CURRENT_DATE) > 7) OR
            (${alias}.eta_vessel_complete_discharge IS NOT NULL AND (${alias}.eta_vessel_complete_discharge::date - CURRENT_DATE) > 7)
          ) AS discharge_more_than_7d`;
}

export interface ShipmentSection1CombinedSummaryQueryOpts {
  shipmentBaseCteSql: string;
  unplannedBacklogCountCteSql: string;
  toolbarOuterSql: string;
  summaryScopeCte: string;
  summaryEnrichedFrom: string;
}

function buildShipmentSection1SummaryCteBlock(opts: ShipmentSection1CombinedSummaryQueryOpts): string {
  const unplannedPred = shipmentPagePipelineUnplannedRowPredicate('f');
  const qtySelect = shipmentListPageQtySelectSql('f');
  const spdAggCtes = shipmentListSpdAggCtes(false);
  const masterJoin = sqlMasterVesselLateralJoin(
    'COALESCE(f.vessel_code, sl.vessel_code_sap)',
    'COALESCE(f.vessel_name, sl.vessel_name_sap)',
    'mv',
  );

  return `${opts.shipmentBaseCteSql}
      ${opts.unplannedBacklogCountCteSql}
      , filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${opts.toolbarOuterSql}
          AND COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'
      )${opts.summaryScopeCte}
      , ${shipmentListQtyMoveCteFromPage('filtered_shipments')}
      , shipment_page AS (
        SELECT * FROM ${opts.summaryEnrichedFrom}
      )
      , ${spdAggCtes}
      , enriched AS (
        SELECT
          f.*,
          ${buildShipmentSummaryEtaEnrichmentSelect('f')},
          (${unplannedPred}) AS is_unplanned_execution,
          ${qtySelect},
          sl.vessel_name_sap,
          sl.vessel_code_sap,
          mv.vessel_name_master
        FROM ${opts.summaryEnrichedFrom} f
        LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key::text) = TRIM(f.sto_key::text)
        LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(f.sto_key::text)
        LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(f.sto_key::text)
        ${masterJoin}
      )`;
}

/** Live vessel-name arrays for pipeline cards (master + SAP display, toolbar scope). */
export function buildPipelineCardVesselNamesQuery(
  opts: ShipmentSection1CombinedSummaryQueryOpts,
): string {
  const displayVessel = shipmentPipelineEnrichedDisplayVesselKeyExpr('e');
  const unplannedPred = shipmentPagePipelineUnplannedRowPredicate('e');
  return `${buildShipmentSection1SummaryCteBlock(opts)}
      SELECT
        ${shipmentPagePipelineVesselNamesSelectSql(displayVessel)},
        ARRAY_AGG(DISTINCT ${displayVessel}) FILTER (WHERE ${unplannedPred} AND ${displayVessel} IS NOT NULL) AS unplanned_vessel_names
      FROM enriched e`;
}

/** Pipeline summary + status-card contract/OS qty in one SPD-joined scan. */
export function buildShipmentSection1CombinedSummaryQuery(
  opts: ShipmentSection1CombinedSummaryQueryOpts,
): string {
  const displayVessel = shipmentPipelineEnrichedDisplayVesselKeyExpr('e');
  const unplannedPred = shipmentPagePipelineUnplannedRowPredicate('e');

  return `${buildShipmentSection1SummaryCteBlock(opts)}
      SELECT
        COUNT(*)::bigint AS total_count,
        ${shipmentPagePipelineSummarySelectSql()},
        ${shipmentPagePipelineVesselNamesSelectSql(displayVessel)},
        ARRAY_AGG(DISTINCT ${displayVessel}) FILTER (WHERE ${unplannedPred} AND ${displayVessel} IS NOT NULL) AS unplanned_vessel_names,
        (SELECT backlog_count FROM unplanned_contract_backlog_table)::bigint AS unplanned_contract_backlog_count,
        (SELECT preplanned_group_count FROM preplanned_contract_table)::bigint AS preplanned_count,
        (SELECT preplanned_contract_count FROM preplanned_contract_table)::bigint AS preplanned_contract_count,
        COUNT(*) FILTER (WHERE ${shipmentPagePipelineUnplannedRowPredicate('e')})::bigint AS unplanned_shipment_execution_count,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND loading_no_eta)::bigint AS eta_loading_no_eta,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND loading_delay)::bigint AS eta_loading_delay,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND loading_d)::bigint AS eta_loading_d,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND loading_d_minus_2)::bigint AS eta_loading_d_minus_2,
        COUNT(*) FILTER (WHERE effective_status IN ('UNPLANNED', 'PLANNED', 'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') AND NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND NOT loading_d_minus_2 AND loading_more_than_7d)::bigint AS eta_loading_more_than_7d,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND discharge_no_eta)::bigint AS eta_discharge_no_eta,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND discharge_delay)::bigint AS eta_discharge_delay,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND discharge_d)::bigint AS eta_discharge_d,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND discharge_d_minus_2)::bigint AS eta_discharge_d_minus_2,
        COUNT(*) FILTER (WHERE effective_status IN ('SAILED', 'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') AND NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND NOT discharge_d_minus_2 AND discharge_more_than_7d)::bigint AS eta_discharge_more_than_7d,
        COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE is_unplanned_execution), 0)::numeric AS unplanned_execution_contract_qty,
        COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = 'PLANNED'), 0)::numeric AS planned_contract_qty,
        COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = 'COMPLETED'), 0)::numeric AS completed_contract_qty,
        COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = 'CANCELLED'), 0)::numeric AS cancelled_contract_qty,
        COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${LOADING_STATUS_GROUP}), 0)::numeric AS at_loading_port_outstanding_qty,
        COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE effective_status = 'SAILED'), 0)::numeric AS sailed_outstanding_qty,
        COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${DISCHARGE_STATUS_GROUP}), 0)::numeric AS at_discharge_port_outstanding_qty
      FROM enriched e`;
}

/** Execution-only status-card qty fields from a combined summary row (backlog merged separately). */
export function parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow(
  row: Record<string, unknown>,
): Pick<ShipmentStatusCardQtyBundle, 'statusContractQty' | 'statusOutstandingQty'> {
  const execution = parseShipmentStatusContractQtyFromExecutionRow(row);
  const outstanding = parseShipmentStatusOutstandingQtyFromSqlRow(row);
  return {
    statusContractQty: {
      unplanned: execution.unplannedExecution,
      preplanned: 0,
      planned: execution.planned,
      completed: execution.completed,
      cancelled: execution.cancelled,
    },
    statusOutstandingQty: outstanding,
  };
}
