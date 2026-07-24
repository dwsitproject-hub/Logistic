/**
 * Shipments page Section 1 — virtual 7-stage pipeline (UI-only aggregation).
 * Does NOT write to shipments.status; separate from Shipping Performance status logic.
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { shipmentEffectiveStatusExpr, shipmentHasAnyEtaExpr, shipmentHasDeliveryQtyExpr } from './shipmentListFilters';
import {
  SHIPMENT_AT_DISCHARGE_PORT_STATUSES,
  SHIPMENT_AT_LOADING_PORT_STATUSES,
  SHIPMENT_SAILED_STATUSES,
} from './shipmentStatus';
import { buildShipmentPageSeaIncotermColumnSql, buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';

/** Pipeline stage keys used by GET /shipments?status=… (Shipments page only). */
export const SHIPMENT_PAGE_PIPELINE_STAGES = [
  'UNPLANNED',
  'PLANNED',
  'AT_LOADING_PORT',
  'SAILED',
  'AT_DISCHARGE_PORT',
  'COMPLETED',
  'CANCELLED',
] as const;

export type ShipmentPagePipelineStage = (typeof SHIPMENT_PAGE_PIPELINE_STAGES)[number];

const PIPELINE_STAGE_SET = new Set<string>(SHIPMENT_PAGE_PIPELINE_STAGES);

/** Legacy Section 1 keys → pipeline stage (backward-compatible list filters). */
const LEGACY_STATUS_TO_PIPELINE: Record<string, ShipmentPagePipelineStage> = {
  IN_PROGRESS: 'AT_LOADING_PORT',
  ARRIVED_LP: 'AT_LOADING_PORT',
  BERTHED_LP: 'AT_LOADING_PORT',
  LOADING: 'AT_LOADING_PORT',
  COMPLETED_LOADING: 'AT_LOADING_PORT',
  IN_TRANSIT: 'SAILED',
  SAILED: 'SAILED',
  ARRIVED: 'AT_DISCHARGE_PORT',
  ARRIVED_DP: 'AT_DISCHARGE_PORT',
  BERTHED_DP: 'AT_DISCHARGE_PORT',
  UNLOADING: 'AT_DISCHARGE_PORT',
};

export function normalizeShipmentPagePipelineStageParam(
  raw: string | undefined,
): ShipmentPagePipelineStage | null {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!normalized || normalized === 'ALL') return null;
  if (PIPELINE_STAGE_SET.has(normalized)) {
    return normalized as ShipmentPagePipelineStage;
  }
  return LEGACY_STATUS_TO_PIPELINE[normalized] ?? null;
}

/** Summary-only pipeline cards → view-table detail statuses (last ATA / effective status). */
export const PIPELINE_STAGE_DETAIL_STATUS_GROUPS: Readonly<
  Record<'AT_LOADING_PORT' | 'SAILED' | 'AT_DISCHARGE_PORT', readonly string[]>
> = {
  AT_LOADING_PORT: SHIPMENT_AT_LOADING_PORT_STATUSES,
  SAILED: SHIPMENT_SAILED_STATUSES,
  AT_DISCHARGE_PORT: SHIPMENT_AT_DISCHARGE_PORT_STATUSES,
};

const PIPELINE_STAGE_DIRECT_EFFECTIVE: Partial<Record<ShipmentPagePipelineStage, string>> = {
  PLANNED: 'PLANNED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export function shipmentEffectiveStatusInListSql(
  alias: string,
  statuses: readonly string[],
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  const eff = shipmentEffectiveStatusExpr(alias);
  if (statuses.length === 0) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  if (statuses.length === 1) {
    return {
      sql: ` AND ${eff} = $${startIndex}`,
      params: [statuses[0]!],
      nextIndex: startIndex + 1,
    };
  }
  const placeholders = statuses.map((_, i) => `$${startIndex + i}`).join(', ');
  return {
    sql: ` AND ${eff} IN (${placeholders})`,
    params: [...statuses],
    nextIndex: startIndex + statuses.length,
  };
}

export function shipmentHasAnyLoadingPortAtaExpr(alias: string): string {
  const f = alias;
  return `(
    ${f}.ata_vessel_arrival_at_loading_port IS NOT NULL
    OR ${f}.ata_vessel_berthed_at_loading_port IS NOT NULL
    OR ${f}.ata_vessel_start_loading IS NOT NULL
    OR ${f}.ata_vessel_completed_loading IS NOT NULL
  )`;
}

export function shipmentHasAnyDischargePortAtaExpr(alias: string): string {
  const f = alias;
  return `(
    ${f}.ata_vessel_arrive_at_discharge_port IS NOT NULL
    OR ${f}.ata_vessel_berthed_at_discharge_port IS NOT NULL
    OR ${f}.ata_vessel_start_discharging IS NOT NULL
  )`;
}

/**
 * Legacy virtual pipeline stage expression (summary reference/tests only).
 * View-table status and card filters use shipmentEffectiveStatusExpr + detail status groups.
 */
export function shipmentPagePipelineStageExpr(alias: string): string {
  const f = alias;
  return `(
    CASE
      WHEN UPPER(TRIM(COALESCE(${f}.status, ''))) = 'CANCELLED' THEN 'CANCELLED'
      WHEN COALESCE(${f}.is_contract_sap_closed, FALSE) IS TRUE THEN 'COMPLETED'
      WHEN ${f}.ata_vessel_complete_discharge IS NOT NULL THEN 'COMPLETED'
      WHEN ${shipmentHasAnyDischargePortAtaExpr(f)} THEN 'AT_DISCHARGE_PORT'
      WHEN ${f}.ata_vessel_sailed_from_loading_port IS NOT NULL THEN 'SAILED'
      WHEN ${shipmentHasAnyLoadingPortAtaExpr(f)} THEN 'AT_LOADING_PORT'
      WHEN ${shipmentHasAnyEtaExpr(f)} THEN 'PLANNED'
      WHEN ${shipmentHasDeliveryQtyExpr(f)} THEN 'PLANNED'
      ELSE NULL
    END
  )`;
}

/** Table filter for Unplanned card — open STO row without ETA/ATA and without Delivery Qty. */
export function shipmentPagePipelineUnplannedRowPredicate(alias: string): string {
  const f = alias;
  return `(
    NOT COALESCE(${f}.is_contract_sap_closed, FALSE)
    AND NOT ${shipmentHasAnyEtaExpr(f)}
    AND NOT ${shipmentHasDeliveryQtyExpr(f)}
    AND NOT ${shipmentHasAnyLoadingPortAtaExpr(f)}
    AND NOT ${shipmentHasAnyDischargePortAtaExpr(f)}
    AND ${f}.ata_vessel_sailed_from_loading_port IS NULL
    AND ${f}.ata_vessel_complete_discharge IS NULL
    AND UPPER(TRIM(COALESCE(${f}.status, ''))) <> 'CANCELLED'
  )`;
}

/** True when contract has no shipment-level or port-level ETA registered. */
export function sqlContractHasNoRegisteredEtaExpr(contractAlias = 'c'): string {
  return `NOT EXISTS (
    SELECT 1
    FROM shipments s_eta
    LEFT JOIN vessel_loading_ports vlp_eta ON vlp_eta.shipment_id = s_eta.id
    WHERE s_eta.contract_id = ${contractAlias}.id
      AND (
        s_eta.eta_arrival IS NOT NULL
        OR s_eta.eta_berthed IS NOT NULL
        OR s_eta.eta_loading_start IS NOT NULL
        OR s_eta.eta_loading_complete IS NOT NULL
        OR s_eta.eta_sailed IS NOT NULL
        OR s_eta.eta_discharge_arrival IS NOT NULL
        OR s_eta.eta_discharge_berthed IS NOT NULL
        OR s_eta.eta_discharge_start IS NOT NULL
        OR s_eta.eta_discharge_complete IS NOT NULL
        OR vlp_eta.eta_vessel_arrival IS NOT NULL
        OR vlp_eta.eta_vessel_berthed IS NOT NULL
        OR vlp_eta.eta_loading_start IS NOT NULL
        OR vlp_eta.eta_loading_completed IS NOT NULL
        OR vlp_eta.eta_vessel_sailed IS NOT NULL
        OR vlp_eta.eta_vessel_complete_discharge IS NOT NULL
      )
  )`;
}

/** B2B child exclusion (matches shipment list baseline). */
export function shipmentPageExcludeB2bChildCond(lAlias = 'l'): string {
  return `NOT (
    ${lAlias}.contract_number IS NOT NULL
    AND UPPER(NULLIF(TRIM(COALESCE(${lAlias}.b2b_flag_raw, '')), '')) = 'B2B'
    AND NULLIF(TRIM(COALESCE(${lAlias}.contract_reference_po_raw, '')), '') IS NOT NULL
  )`;
}

/**
 * CTE: count distinct open CIF/FOB/CFR contracts with no registered ETA (Unplanned card).
 * Contract-level scope (incoterm only) — STO Type T exclusion applies to execution rows
 * via shipmentPipelineDailySummarySql / buildShipmentPageSeaRowScopeSql.
 * `contractScopeSql` — additional AND clauses on `c` (date/plant/contract toolbar scope).
 */
export function buildShipmentPageUnplannedOpenContractsCte(contractScopeSql = ''): string {
  return `
      unplanned_open_contracts AS (
        SELECT COUNT(DISTINCT c.contract_id)::bigint AS unplanned_contract_count
        FROM contracts c
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE ${buildShipmentPageSeaIncotermScopeSql('c')}
          AND NOT (${sqlIsContractSapClosedExpr('c')})
          AND ${shipmentPageExcludeB2bChildCond('l')}
          AND ${sqlContractHasNoRegisteredEtaExpr('c')}
          ${contractScopeSql}
      )`;
}

/** Summary SELECT — pipeline cards + tooltip tiers from granular effective_status. */
export function shipmentPagePipelineSummarySelectSql(): string {
  const eff = 'effective_status';
  const loadingGroup = `${eff} IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING')`;
  const dischargeGroup = `${eff} IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING')`;
  return `
        COUNT(*) FILTER (WHERE ${eff} = 'PLANNED')::bigint AS planned_count,
        COUNT(*) FILTER (WHERE ${loadingGroup})::bigint AS at_loading_port_count,
        COUNT(*) FILTER (WHERE ${eff} = 'SAILED')::bigint AS sailed_count,
        COUNT(*) FILTER (WHERE ${dischargeGroup})::bigint AS at_discharge_port_count,
        COUNT(*) FILTER (WHERE ${eff} = 'COMPLETED')::bigint AS completed_count,
        COUNT(*) FILTER (WHERE ${eff} = 'CANCELLED')::bigint AS cancelled_count,
        COUNT(*) FILTER (WHERE ${eff} = 'ARRIVED_LP')::bigint AS loading_port_arrived_count,
        COUNT(*) FILTER (WHERE ${eff} = 'BERTHED_LP')::bigint AS loading_port_berthed_count,
        COUNT(*) FILTER (WHERE ${eff} = 'LOADING')::bigint AS loading_port_loading_count,
        COUNT(*) FILTER (WHERE ${eff} = 'COMPLETED_LOADING')::bigint AS loading_port_completed_loading_count,
        COUNT(*) FILTER (WHERE ${eff} = 'ARRIVED_DP')::bigint AS discharge_port_arrived_count,
        COUNT(*) FILTER (WHERE ${eff} = 'BERTHED_DP')::bigint AS discharge_port_berthed_count,
        COUNT(*) FILTER (WHERE ${eff} = 'UNLOADING')::bigint AS discharge_port_unloading_count`;
}

/** Normalized non-blank vessel identity used for distinct-vessel counts. */
export function shipmentPipelineVesselKeyExpr(vesselNameExpr = 'vessel_name'): string {
  return `NULLIF(UPPER(TRIM(COALESCE(${vesselNameExpr}, ''))), '')`;
}

/**
 * Summary SELECT — sorted distinct vessel names per pipeline card (blank names excluded).
 * Unplanned is added separately by callers because its predicate needs a row alias.
 */
export function shipmentPagePipelineVesselNamesSelectSql(): string {
  const eff = 'effective_status';
  const vessel = shipmentPipelineVesselKeyExpr();
  const loadingGroup = `${eff} IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING')`;
  const dischargeGroup = `${eff} IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING')`;
  return `
        ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${eff} = 'PLANNED' AND ${vessel} IS NOT NULL) AS planned_vessel_names,
        ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${loadingGroup} AND ${vessel} IS NOT NULL) AS at_loading_port_vessel_names,
        ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${eff} = 'SAILED' AND ${vessel} IS NOT NULL) AS sailed_vessel_names,
        ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${dischargeGroup} AND ${vessel} IS NOT NULL) AS at_discharge_port_vessel_names,
        ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${eff} = 'COMPLETED' AND ${vessel} IS NOT NULL) AS completed_vessel_names,
        ARRAY_AGG(DISTINCT ${vessel}) FILTER (WHERE ${eff} = 'CANCELLED' AND ${vessel} IS NOT NULL) AS cancelled_vessel_names`;
}

/** Filter list rows by pipeline card — maps grouped cards to detail effective statuses. */
export function appendShipmentPipelineStageFilter(
  statusParam: string | undefined,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  const stage = normalizeShipmentPagePipelineStageParam(statusParam);
  if (!stage) {
    return { sql: '', params: [], nextIndex: startIndex };
  }

  if (stage === 'UNPLANNED') {
    return {
      sql: ` AND ${shipmentPagePipelineUnplannedRowPredicate('sb')} AND ${buildShipmentPageSeaIncotermColumnSql('sb.incoterm')}`,
      params: [],
      nextIndex: startIndex,
    };
  }

  const grouped =
    PIPELINE_STAGE_DETAIL_STATUS_GROUPS[stage as keyof typeof PIPELINE_STAGE_DETAIL_STATUS_GROUPS];
  if (grouped) {
    const mapped = shipmentEffectiveStatusInListSql('sb', grouped, startIndex);
    return { sql: mapped.sql, params: mapped.params, nextIndex: mapped.nextIndex };
  }

  const direct = PIPELINE_STAGE_DIRECT_EFFECTIVE[stage] ?? stage;
  return {
    sql: ` AND ${shipmentEffectiveStatusExpr('sb')} = $${startIndex}`,
    params: [direct],
    nextIndex: startIndex + 1,
  };
}

/** Scoped ETA summary when a pipeline status card is active (Shipments page Section 2). */
export function appendShipmentPipelineScopeStageFilter(
  scopeStatusParam: string | undefined,
  startIndex: number,
): { sql: string; params: unknown[]; nextIndex: number } {
  return appendShipmentPipelineStageFilter(scopeStatusParam, startIndex);
}
