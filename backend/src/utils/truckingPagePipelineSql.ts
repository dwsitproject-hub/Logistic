/**
 * Trucking page Section 2 — Summary Trucking Status pipeline (page-only).
 * Does not replace contractLogisticsStoDisplay / other modules.
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { sqlHasTruckingKlipPlanning } from './truckingEffectiveStatus';
import { sqlRealizationStartDate } from './truckingRealizationSql';
import {
  sqlTruckingPipelineIsCompletedExpr,
} from './truckingQuantitySql';

export const TRUCKING_PAGE_PIPELINE_STAGES = [
  'UNPLANNED',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TruckingPagePipelineStage = (typeof TRUCKING_PAGE_PIPELINE_STAGES)[number];

const PIPELINE_SET = new Set<string>(TRUCKING_PAGE_PIPELINE_STAGES);

export function normalizeTruckingPagePipelineStageParam(
  raw: string | undefined,
): TruckingPagePipelineStage | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!s || s === 'ALL') return null;
  return PIPELINE_SET.has(s) ? (s as TruckingPagePipelineStage) : null;
}

/** KLIP ETA columns or Daily Planning (Add New Trucking) — not SAP receive / completion dates. */
export function sqlTruckingPageHasEtaOrPlanning(truckingAlias = 't'): string {
  return `(
    ${sqlHasTruckingKlipPlanning(truckingAlias)}
    OR ${truckingAlias}.eta_trucking_start_date IS NOT NULL
    OR ${truckingAlias}.eta_trucking_completion_date IS NOT NULL
    OR ${truckingAlias}.eta_delivery_start_date IS NOT NULL
    OR ${truckingAlias}.eta_delivery_end_date IS NOT NULL
  )`;
}

/** Contract has STO identifier (DB or SAP agg on list join). */
export function sqlTruckingPageHasSto(stoExpr: string): string {
  return `${stoExpr} IS NOT NULL`;
}

/**
 * Open SAP contract/PO with no KLIP planning/ETA and no Start Receive yet — Unplanned backlog.
 * STO is not required. Closed SAP status is never Unplanned.
 * Requires trucking_realizations join alias `tr` (same as list/pipeline queries).
 */
export function sqlTruckingPageUnplannedPredicate(
  contractAlias = 'c',
  _stoExpr?: string,
  truckingAlias = 't',
  outstandingQtyExpr?: string,
): string {
  const contractOpen = `NOT (${sqlIsContractSapClosedExpr(contractAlias)})`;
  const notCompleted = `NOT (${sqlTruckingPageIsCompletedExpr(contractAlias, outstandingQtyExpr)})`;
  const noStartReceive = `${sqlRealizationStartDate(contractAlias)} IS NULL`;
  return `(
    ${contractOpen}
    AND NOT (${sqlTruckingPageHasEtaOrPlanning(truckingAlias)})
    AND ${noStartReceive}
    AND ${notCompleted}
  )`;
}

/** COMPLETED = GR PO/STO Close (incoterm) OR |OS Qty| within 0 MT display band (≤499 kg). */
export function sqlTruckingPageIsCompletedExpr(
  contractAlias = 'c',
  outstandingQtyExpr?: string,
): string {
  return sqlTruckingPipelineIsCompletedExpr(contractAlias, outstandingQtyExpr);
}

/**
 * Mutually exclusive pipeline stage per trucking operation row (Section 2 + Section 3 filter).
 * Start Receive (SAP AV or trucking_realizations / WB) → IN_PROGRESS without requiring daily planning.
 */
export function sqlTruckingPagePipelineStageExpr(
  contractAlias = 'c',
  stoExpr?: string,
  outstandingQtyExpr?: string,
): string {
  const stoCheck = stoExpr ?? `NULLIF(TRIM(${contractAlias}.sto_number::text), '')`;
  const realizationStart = sqlRealizationStartDate(contractAlias);
  const isCompleted = sqlTruckingPageIsCompletedExpr(contractAlias, outstandingQtyExpr);
  const notCompleted = `NOT (${isCompleted})`;
  const contractOpen = `NOT (${sqlIsContractSapClosedExpr(contractAlias)})`;
  return `CASE
    WHEN COALESCE(t.status, '') = 'CANCELLED' THEN 'CANCELLED'
    WHEN ${isCompleted} THEN 'COMPLETED'
    WHEN ${realizationStart} IS NOT NULL
      AND ${notCompleted}
      THEN 'IN_PROGRESS'
    WHEN ${contractOpen}
      AND ${sqlTruckingPageHasEtaOrPlanning('t')}
      AND ${notCompleted}
      THEN 'PLANNED'
    WHEN ${sqlTruckingPageUnplannedPredicate(contractAlias, stoCheck, 't', outstandingQtyExpr)} THEN 'UNPLANNED'
    ELSE CASE
      WHEN ${sqlTruckingPageHasEtaOrPlanning('t')} THEN 'PLANNED'
      ELSE 'UNPLANNED'
    END
  END`;
}

/** Filter list rows by pipeline card (same expression as summary).
 * Planned card is special: includes PLANNED + IN_PROGRESS (In Progress card stays exact).
 */
export function appendTruckingPipelineStageFilter(
  stage: string | undefined,
  stoExpr: string,
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  const normalized = normalizeTruckingPagePipelineStageParam(stage);
  if (!normalized) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  const stageExpr = sqlTruckingPagePipelineStageExpr('c', stoExpr, undefined);
  if (normalized === 'PLANNED') {
    return {
      sql: ` AND ${stageExpr} IN ('PLANNED', 'IN_PROGRESS')`,
      params: [],
      nextIndex: startIndex,
    };
  }
  return {
    sql: ` AND ${stageExpr} = $${startIndex}`,
    params: [normalized],
    nextIndex: startIndex + 1,
  };
}

/**
 * Status-scoped WHERE for expanded list rows (`tf.status`).
 * Planned card → PLANNED + IN_PROGRESS; other cards exact match.
 */
export function buildTruckingExpandedStatusFilterWhere(
  statusColumnExpr: string,
  stageFilter: string | null | undefined,
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  const normalized = normalizeTruckingPagePipelineStageParam(stageFilter ?? undefined);
  if (!normalized) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  if (normalized === 'PLANNED') {
    return {
      sql: ` WHERE ${statusColumnExpr} IN ('PLANNED', 'IN_PROGRESS')`,
      params: [],
      nextIndex: startIndex,
    };
  }
  return {
    sql: ` WHERE ${statusColumnExpr} = $${startIndex}`,
    params: [normalized],
    nextIndex: startIndex + 1,
  };
}

/** True when UI Planned card should show Planned + In Progress rows. */
export function isTruckingPlannedCardStatusFilter(stage: string | null | undefined): boolean {
  return normalizeTruckingPagePipelineStageParam(stage ?? undefined) === 'PLANNED';
}
