/**
 * Shipments page Section 1 — per-card Contract Qty / Outstanding Qty aggregates (kg).
 */

import { shipmentListRowContractIdsSql } from './shipmentListQtySql';
import { sqlShipmentActiveStageRankExpr } from './shipmentActiveStageRank';
import { shipmentListQtyMoveCteFromPage } from './shipmentOutstandingQtySql';
import {
  sqlShipmentExecutionOsPerContractCtes,
  sqlShipmentSection1LightExecutionEnrichSelect,
} from './shipmentOutstandingQtySummarySql';

/**
 * Contract Qty of the status cards, counted ONCE PER CONTRACT.
 *
 * It used to be SUM(contract_qty) over the ROWS of each stage, and a CIF / CFR PO with several Type T STOs is several rows - each carrying
 * the whole PO's quantity - so the cards counted it once per STO. Measured on SIT 2026-10-13: 1,020,900 MT against 240,925 MT once per
 * contract (4.2x) for the CIF / CFR POs on two or more rows.
 *
 * One entry per contract, at the stage of its FURTHEST active sibling - the rule the OS cards already use (execution_os: DISTINCT ON contract,
 * stage_rank DESC), so a PO's Contract Qty and its OS sit on the same card. A contract with no active sibling is COMPLETED when any of its
 * rows is, otherwise CANCELLED (a cancelled leg does not undo a delivered one). The contracts of a row are the same set the row's own
 * Contract Qty summed (shipmentListRowContractIdsSql), so a row-grain figure and this one differ only by the repeats.
 *
 * Needs `<enriched>.sto_key`, `.contract_numbers`, `.effective_status` and `.is_unplanned_execution`.
 */
export function sqlShipmentContractQtyOncePerContractCtes(enrichedAlias = 'enriched'): string {
  return `
    contract_qty_rows AS (
      SELECT
        c.id AS contract_uuid,
        c.quantity_ordered::numeric AS qty,
        ${enrichedAlias}.effective_status,
        ${enrichedAlias}.is_unplanned_execution,
        ${sqlShipmentActiveStageRankExpr(`${enrichedAlias}.effective_status`)} AS stage_rank
      FROM ${enrichedAlias}
      JOIN contracts c
        ON c.contract_id IS NOT NULL
       AND TRIM(c.contract_id) <> ''
       AND c.id IN (${shipmentListRowContractIdsSql(enrichedAlias)}
       )
    ),
    contract_qty_once AS (
      SELECT DISTINCT ON (contract_uuid)
        contract_uuid,
        qty,
        effective_status,
        is_unplanned_execution
      FROM contract_qty_rows
      ORDER BY
        contract_uuid,
        stage_rank DESC,
        CASE WHEN effective_status = 'COMPLETED' THEN 1 ELSE 0 END DESC
    )`;
}

/** The four Contract Qty fields of the status cards, summed over contract_qty_once. */
export function sqlShipmentContractQtyOnceSelect(): string {
  const sum = (where: string) =>
    `COALESCE((SELECT SUM(COALESCE(qty, 0)) FROM contract_qty_once WHERE ${where}), 0)::numeric`;
  return `${sum('is_unplanned_execution')} AS unplanned_execution_contract_qty,
      ${sum("effective_status = 'PLANNED'")} AS planned_contract_qty,
      ${sum("effective_status = 'COMPLETED'")} AS completed_contract_qty,
      ${sum("effective_status = 'CANCELLED'")} AS cancelled_contract_qty`;
}

export interface ShipmentStatusContractQtyKg {
  unplanned: number;
  preplanned: number;
  planned: number;
  completed: number;
  cancelled: number;
}

export interface ShipmentStatusOutstandingQtyKg {
  unplanned: number;
  preplanned: number;
  planned: number;
  atLoadingPort: number;
  sailed: number;
  atDischargePort: number;
}

/** Execution-only OS parts before backlog merge (unplanned/preplanned backlog added separately). */
export interface ShipmentStatusOutstandingQtyExecutionParts {
  unplannedExecution: number;
  planned: number;
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

export function parseShipmentStatusOutstandingQtyFromExecutionRow(
  row: Record<string, unknown> | undefined | null,
): ShipmentStatusOutstandingQtyExecutionParts {
  const r = row ?? {};
  return {
    unplannedExecution: Number(r.unplanned_execution_outstanding_qty || 0) || 0,
    planned: Number(r.planned_outstanding_qty || 0) || 0,
    atLoadingPort: Number(r.at_loading_port_outstanding_qty || 0) || 0,
    sailed: Number(r.sailed_outstanding_qty || 0) || 0,
    atDischargePort: Number(r.at_discharge_port_outstanding_qty || 0) || 0,
  };
}

/** @deprecated Use parseShipmentStatusOutstandingQtyFromExecutionRow + merge for full card OS. */
export function parseShipmentStatusOutstandingQtyFromSqlRow(
  row: Record<string, unknown> | undefined | null,
): Pick<ShipmentStatusOutstandingQtyKg, 'atLoadingPort' | 'sailed' | 'atDischargePort'> {
  const parts = parseShipmentStatusOutstandingQtyFromExecutionRow(row);
  return {
    atLoadingPort: parts.atLoadingPort,
    sailed: parts.sailed,
    atDischargePort: parts.atDischargePort,
  };
}

export function mergeShipmentStatusCardQtyParts(input: {
  execution: ReturnType<typeof parseShipmentStatusContractQtyFromExecutionRow>;
  unplannedBacklogContractQtyKg: number;
  preplannedContractQtyKg: number;
  completedBacklogContractQtyKg?: number;
  cancelledBacklogContractQtyKg?: number;
  unplannedBacklogOutstandingQtyKg: number;
  preplannedOutstandingQtyKg: number;
  outstanding: ShipmentStatusOutstandingQtyExecutionParts;
}): ShipmentStatusCardQtyBundle {
  return {
    statusContractQty: {
      /** Unplanned card qty = PO backlog only (STO open qty is in Planned via effective status). */
      unplanned: Number(input.unplannedBacklogContractQtyKg) || 0,
      preplanned: Number(input.preplannedContractQtyKg) || 0,
      planned: input.execution.planned,
      completed:
        input.execution.completed + (Number(input.completedBacklogContractQtyKg) || 0),
      cancelled:
        input.execution.cancelled + (Number(input.cancelledBacklogContractQtyKg) || 0),
    },
    statusOutstandingQty: {
      unplanned: Number(input.unplannedBacklogOutstandingQtyKg) || 0,
      preplanned: Number(input.preplannedOutstandingQtyKg) || 0,
      planned: input.outstanding.planned,
      atLoadingPort: input.outstanding.atLoadingPort,
      sailed: input.outstanding.sailed,
      atDischargePort: input.outstanding.atDischargePort,
    },
  };
}

/** Sum of the 6 active-stage Outstanding Qty card values (kg). */
export function sumShipmentStatusOutstandingQtyKg(
  qty: Partial<ShipmentStatusOutstandingQtyKg> | null | undefined,
): number {
  if (!qty) return 0;
  return (
    (Number(qty.unplanned) || 0) +
    (Number(qty.preplanned) || 0) +
    (Number(qty.planned) || 0) +
    (Number(qty.atLoadingPort) || 0) +
    (Number(qty.sailed) || 0) +
    (Number(qty.atDischargePort) || 0)
  );
}

export interface ShipmentStatusCardCountSnapshot {
  unplanned: number;
  preplanned: number;
  planned: number;
  atLoadingPort: number;
  sailed: number;
  atDischargePort: number;
  completed: number;
  cancelled: number;
}

/**
 * When a stage count is 0, clear that stage's OS (and contract qty for completed/cancelled).
 * Prevents stale qty labels on empty cards (e.g. Sailed count=0 with residual OS).
 */
export function applyShipmentStatusCardZeroGuards(input: {
  counts: ShipmentStatusCardCountSnapshot;
  statusContractQty?: ShipmentStatusContractQtyKg | null;
  statusOutstandingQty?: ShipmentStatusOutstandingQtyKg | null;
}): {
  statusContractQty: ShipmentStatusContractQtyKg | null;
  statusOutstandingQty: ShipmentStatusOutstandingQtyKg | null;
} {
  const c = input.counts;
  let statusOutstandingQty = input.statusOutstandingQty
    ? { ...input.statusOutstandingQty }
    : null;
  let statusContractQty = input.statusContractQty ? { ...input.statusContractQty } : null;

  if (statusOutstandingQty) {
    if (c.unplanned <= 0) statusOutstandingQty.unplanned = 0;
    if (c.preplanned <= 0) statusOutstandingQty.preplanned = 0;
    if (c.planned <= 0) statusOutstandingQty.planned = 0;
    if (c.atLoadingPort <= 0) statusOutstandingQty.atLoadingPort = 0;
    if (c.sailed <= 0) statusOutstandingQty.sailed = 0;
    if (c.atDischargePort <= 0) statusOutstandingQty.atDischargePort = 0;
  }
  if (statusContractQty) {
    if (c.unplanned <= 0) statusContractQty.unplanned = 0;
    if (c.preplanned <= 0) statusContractQty.preplanned = 0;
    if (c.planned <= 0) statusContractQty.planned = 0;
    if (c.completed <= 0) statusContractQty.completed = 0;
    if (c.cancelled <= 0) statusContractQty.cancelled = 0;
  }

  return { statusContractQty, statusOutstandingQty };
}

/** Clear vessel-name arrays when the matching stage count is 0. */
export function applyShipmentStatusVesselZeroGuards(
  counts: ShipmentStatusCardCountSnapshot,
  vessels: {
    unplanned: string[];
    preplanned: string[];
    planned: string[];
    atLoadingPort: string[];
    sailed: string[];
    atDischargePort: string[];
    completed: string[];
    cancelled: string[];
  },
): typeof vessels {
  return {
    unplanned: counts.unplanned > 0 ? vessels.unplanned : [],
    preplanned: counts.preplanned > 0 ? vessels.preplanned : [],
    planned: counts.planned > 0 ? vessels.planned : [],
    atLoadingPort: counts.atLoadingPort > 0 ? vessels.atLoadingPort : [],
    sailed: counts.sailed > 0 ? vessels.sailed : [],
    atDischargePort: counts.atDischargePort > 0 ? vessels.atDischargePort : [],
    completed: counts.completed > 0 ? vessels.completed : [],
    cancelled: counts.cancelled > 0 ? vessels.cancelled : [],
  };
}

/** Toolbar-scoped execution rows — contract qty from linked POs, OS from qty_move. */
export async function buildShipmentStatusCardQtyExecutionAggregateQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
  contractScopeSql?: string,
): Promise<string> {
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
    ${await shipmentListQtyMoveCteFromPage()},
    enriched AS (
      SELECT
        ${sqlShipmentSection1LightExecutionEnrichSelect('sp')},
        sp.sto_key
      FROM shipment_page sp
    ),
    ${sqlShipmentContractQtyOncePerContractCtes('enriched')},
    ${sqlShipmentExecutionOsPerContractCtes('enriched', { requireResolvedRegionSite: true, contractScopeSql })}
    SELECT
      ${sqlShipmentContractQtyOnceSelect()},
      0::numeric AS unplanned_execution_outstanding_qty,
      COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE effective_status = 'PLANNED') FROM execution_os), 0)::numeric AS planned_outstanding_qty,
      COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${LOADING_STATUS_GROUP}) FROM execution_os), 0)::numeric AS at_loading_port_outstanding_qty,
      COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE effective_status = 'SAILED') FROM execution_os), 0)::numeric AS sailed_outstanding_qty,
      COALESCE((SELECT SUM(COALESCE(outstanding_quantity, 0)) FILTER (WHERE ${DISCHARGE_STATUS_GROUP}) FROM execution_os), 0)::numeric AS at_discharge_port_outstanding_qty
    FROM enriched e`;
}
