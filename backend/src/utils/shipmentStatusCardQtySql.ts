/**
 * Shipments page Section 1 — per-card Contract Qty / Outstanding Qty aggregates (kg).
 */

import { shipmentEffectiveStatusExpr } from './shipmentListFilters';
import { shipmentListSpdAggCtes } from './shipmentListSapAggSql';
import { shipmentListPageQtySelectSql } from './shipmentListQtySql';
import { shipmentListQtyMoveCteFromPage } from './shipmentOutstandingQtySql';
import { shipmentPagePipelineUnplannedRowPredicate } from './shipmentPagePipelineSql';

export interface ShipmentStatusContractQtyKg {
  unplanned: number;
  preplanned: number;
  planned: number;
  completed: number;
  cancelled: number;
}

export interface ShipmentStatusOutstandingQtyKg {
  atLoadingPort: number;
  sailed: number;
  atDischargePort: number;
}

export interface ShipmentStatusCardQtyBundle {
  statusContractQty: ShipmentStatusContractQtyKg;
  statusOutstandingQty: ShipmentStatusOutstandingQtyKg;
}

const LOADING_STATUS_GROUP =
  "effective_status IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING')";
const DISCHARGE_STATUS_GROUP =
  "effective_status IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING')";

export function parseShipmentStatusContractQtyFromExecutionRow(
  row: Record<string, unknown> | undefined | null,
): Omit<ShipmentStatusContractQtyKg, 'preplanned' | 'unplanned'> & {
  unplannedExecution: number;
} {
  const r = row ?? {};
  return {
    unplannedExecution: Number(r.unplanned_execution_contract_qty || 0) || 0,
    planned: Number(r.planned_contract_qty || 0) || 0,
    completed: Number(r.completed_contract_qty || 0) || 0,
    cancelled: Number(r.cancelled_contract_qty || 0) || 0,
  };
}

export function parseShipmentStatusOutstandingQtyFromSqlRow(
  row: Record<string, unknown> | undefined | null,
): ShipmentStatusOutstandingQtyKg {
  const r = row ?? {};
  return {
    atLoadingPort: Number(r.at_loading_port_outstanding_qty || 0) || 0,
    sailed: Number(r.sailed_outstanding_qty || 0) || 0,
    atDischargePort: Number(r.at_discharge_port_outstanding_qty || 0) || 0,
  };
}

export function mergeShipmentStatusCardQtyParts(input: {
  execution: ReturnType<typeof parseShipmentStatusContractQtyFromExecutionRow>;
  unplannedBacklogContractQtyKg: number;
  preplannedContractQtyKg: number;
  outstanding: ShipmentStatusOutstandingQtyKg;
}): ShipmentStatusCardQtyBundle {
  return {
    statusContractQty: {
      unplanned:
        input.execution.unplannedExecution + (Number(input.unplannedBacklogContractQtyKg) || 0),
      preplanned: Number(input.preplannedContractQtyKg) || 0,
      planned: input.execution.planned,
      completed: input.execution.completed,
      cancelled: input.execution.cancelled,
    },
    statusOutstandingQty: input.outstanding,
  };
}

/** Toolbar-scoped execution rows with SAP qty enrich — contract + OS per pipeline card. */
export function buildShipmentStatusCardQtyExecutionAggregateQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
): string {
  const unplannedPred = shipmentPagePipelineUnplannedRowPredicate('sp');
  const eff = shipmentEffectiveStatusExpr('sp');
  const qtySelect = shipmentListPageQtySelectSql('sp');
  const spdAggCtes = shipmentListSpdAggCtes(false);

  return `
    ${shipmentBaseCteSql},
    filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${toolbarOuterSql}
        AND COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'
    ),
    shipment_page AS (
      SELECT fs.*
      FROM filtered_shipments fs
    ),
    ${shipmentListQtyMoveCteFromPage()},
    ${spdAggCtes},
    enriched AS (
      SELECT
        ${eff} AS effective_status,
        (${unplannedPred}) AS is_unplanned_execution,
        ${qtySelect}
      FROM shipment_page sp
      LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(sp.sto_key::text)
    )
    SELECT
      COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE is_unplanned_execution), 0)::numeric AS unplanned_execution_contract_qty,
      COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = 'PLANNED'), 0)::numeric AS planned_contract_qty,
      COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = 'COMPLETED'), 0)::numeric AS completed_contract_qty,
      COALESCE(SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = 'CANCELLED'), 0)::numeric AS cancelled_contract_qty,
      COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${LOADING_STATUS_GROUP}), 0)::numeric AS at_loading_port_outstanding_qty,
      COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE effective_status = 'SAILED'), 0)::numeric AS sailed_outstanding_qty,
      COALESCE(SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${DISCHARGE_STATUS_GROUP}), 0)::numeric AS at_discharge_port_outstanding_qty
    FROM enriched e`;
}
