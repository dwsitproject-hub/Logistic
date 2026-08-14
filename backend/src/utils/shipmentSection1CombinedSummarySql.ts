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
  shipmentPagePipelineVesselNamesSelectSql,
  shipmentPipelineEnrichedDisplayVesselKeyExpr,
} from './shipmentPagePipelineSql';
import {
  parseShipmentStatusContractQtyFromExecutionRow,
  parseShipmentStatusOutstandingQtyFromExecutionRow,
  type ShipmentStatusCardQtyBundle,
} from './shipmentStatusCardQtySql';
import { sqlShipmentExecutionOsPerContractCtes } from './shipmentOutstandingQtySummarySql';

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
  const qtySelect = shipmentListPageQtySelectSql('f');
  const spdAggCtes = shipmentListSpdAggCtes(false);
  const masterJoin = sqlMasterVesselLateralJoin(
    'COALESCE(f.vessel_code, sl.vessel_code_sap)',
    'COALESCE(f.vessel_name, sl.vessel_name_sap)',
    'mv',
    'f.master_vessel_id',
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
          FALSE AS is_unplanned_execution,
          ${qtySelect},
          sl.vessel_name_sap,
          sl.vessel_code_sap,
          mv.vessel_name_master,
          COALESCE(f.contract_source_type, sl.source_type) AS os_source_type,
          COALESCE(NULLIF(TRIM(f.incoterm::text), ''), NULLIF(TRIM(sl.incoterm::text), ''), '') AS os_incoterm
        FROM ${opts.summaryEnrichedFrom} f
        LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key::text) = TRIM(f.sto_key::text)
        LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(f.sto_key::text)
        LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(f.sto_key::text)
        ${masterJoin}
      ),
      ${sqlShipmentExecutionOsPerContractCtes('enriched')}`;
}

/**
 * Live vessel-name arrays + execution stage counts for pipeline cards.
 * Used to overlay stale daily snapshot counts with the same toolbar-scoped live scan.
 */
export function buildPipelineCardVesselNamesQuery(
  opts: ShipmentSection1CombinedSummaryQueryOpts,
): string {
  const displayVessel = shipmentPipelineEnrichedDisplayVesselKeyExpr('e');
  return `${buildShipmentSection1SummaryCteBlock(opts)}
      SELECT
        ${shipmentPagePipelineSummarySelectSql()},
        ${shipmentPagePipelineVesselNamesSelectSql(displayVessel)},
        ARRAY[]::text[] AS unplanned_vessel_names,
        0::bigint AS unplanned_shipment_execution_count
      FROM enriched e`;
}

/**
 * Live stage counts + distinct vessel names (master join, no SPD qty).
 * Overlay onto daily summary so At Loading Port / Sailed / etc. badges and vessel
 * lists match the live table when the daily rollup is stale.
 */
export function buildShipmentPipelineLiveStageCountsQuery(opts: {
  shipmentBaseCteSql: string;
  toolbarOuterSql: string;
}): string {
  const eff = shipmentEffectiveStatusExpr('f');
  const masterJoin = sqlMasterVesselLateralJoin(
    'f.vessel_code',
    'f.vessel_name',
    'mv',
    'f.master_vessel_id',
  );
  const displayVessel = shipmentPipelineEnrichedDisplayVesselKeyExpr('e');
  return `${opts.shipmentBaseCteSql}
      , filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${opts.toolbarOuterSql}
          AND COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'
      )
      , with_status AS (
        SELECT
          f.*,
          ${eff} AS effective_status,
          mv.vessel_name_master,
          NULL::text AS vessel_name_sap
        FROM filtered_shipments f
        ${masterJoin}
      )
      SELECT
        COUNT(*)::bigint AS total_count,
        ${shipmentPagePipelineSummarySelectSql()},
        ${shipmentPagePipelineVesselNamesSelectSql(displayVessel)},
        ARRAY[]::text[] AS unplanned_vessel_names
      FROM with_status e`;
}

const LIVE_STAGE_COUNT_KEYS = [
  'total_count',
  'planned_count',
  'at_loading_port_count',
  'sailed_count',
  'at_discharge_port_count',
  'completed_count',
  'cancelled_count',
  'loading_port_arrived_count',
  'loading_port_berthed_count',
  'loading_port_loading_count',
  'loading_port_completed_loading_count',
  'discharge_port_arrived_count',
  'discharge_port_berthed_count',
  'discharge_port_unloading_count',
] as const;

const LIVE_STAGE_VESSEL_KEYS = [
  'planned_vessel_names',
  'at_loading_port_vessel_names',
  'sailed_vessel_names',
  'at_discharge_port_vessel_names',
  'completed_vessel_names',
  'cancelled_vessel_names',
] as const;

/** Merge live execution stage counts and vessel-name arrays onto a daily summary row. */
export function overlayShipmentDailySummaryLiveStageCounts(
  dailyRow: Record<string, unknown>,
  liveRow: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!liveRow) return dailyRow;
  const out: Record<string, unknown> = { ...dailyRow };
  for (const key of LIVE_STAGE_COUNT_KEYS) {
    if (liveRow[key] != null) out[key] = liveRow[key];
  }
  for (const key of LIVE_STAGE_VESSEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(liveRow, key)) {
      out[key] = Array.isArray(liveRow[key]) ? liveRow[key] : [];
    }
  }
  return out;
}

/** Pipeline summary + status-card contract/OS qty in one SPD-joined scan. */
export function buildShipmentSection1CombinedSummaryQuery(
  opts: ShipmentSection1CombinedSummaryQueryOpts,
): string {
  const displayVessel = shipmentPipelineEnrichedDisplayVesselKeyExpr('e');

  return `${buildShipmentSection1SummaryCteBlock(opts)}
      SELECT
        COUNT(*)::bigint AS total_count,
        ${shipmentPagePipelineSummarySelectSql()},
        ${shipmentPagePipelineVesselNamesSelectSql(displayVessel)},
        ARRAY[]::text[] AS unplanned_vessel_names,
        (SELECT backlog_count FROM unplanned_contract_backlog_table)::bigint AS unplanned_contract_backlog_count,
        (SELECT preplanned_group_count FROM preplanned_contract_table)::bigint AS preplanned_count,
        (SELECT preplanned_contract_count FROM preplanned_contract_table)::bigint AS preplanned_contract_count,
        0::bigint AS unplanned_shipment_execution_count,
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
        COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE is_unplanned_execution), 0)::numeric AS unplanned_execution_outstanding_qty,
        COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE effective_status = 'PLANNED') FROM execution_os), 0)::numeric AS planned_outstanding_qty,
        COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${LOADING_STATUS_GROUP}) FROM execution_os), 0)::numeric AS at_loading_port_outstanding_qty,
        COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE effective_status = 'SAILED') FROM execution_os), 0)::numeric AS sailed_outstanding_qty,
        COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${DISCHARGE_STATUS_GROUP}) FROM execution_os), 0)::numeric AS at_discharge_port_outstanding_qty
      FROM enriched e`;
}

/** Execution-only status-card qty fields from a combined summary row (backlog merged separately). */
export function parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow(
  row: Record<string, unknown>,
): Pick<ShipmentStatusCardQtyBundle, 'statusContractQty' | 'statusOutstandingQty'> {
  const execution = parseShipmentStatusContractQtyFromExecutionRow(row);
  const outstanding = parseShipmentStatusOutstandingQtyFromExecutionRow(row);
  return {
    statusContractQty: {
      unplanned: 0,
      preplanned: 0,
      planned: execution.planned,
      completed: execution.completed,
      cancelled: execution.cancelled,
    },
    statusOutstandingQty: {
      unplanned: 0,
      preplanned: 0,
      planned: outstanding.planned,
      atLoadingPort: outstanding.atLoadingPort,
      sailed: outstanding.sailed,
      atDischargePort: outstanding.atDischargePort,
    },
  };
}
