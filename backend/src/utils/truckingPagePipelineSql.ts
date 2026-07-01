/**
 * Trucking page Section 2 — Summary Trucking Status pipeline (page-only).
 * Does not replace contractLogisticsStoDisplay / other modules.
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { sqlHasTruckingKlipPlanning } from './truckingEffectiveStatus';
import { sqlRealizationEndDate, sqlRealizationStartDate } from './truckingRealizationSql';

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
 * Open SAP contract/PO with no KLIP planning/ETA yet — trucking Unplanned backlog.
 * STO is not required. Closed SAP status is never Unplanned.
 */
export function sqlTruckingPageUnplannedPredicate(
  contractAlias = 'c',
  _stoExpr?: string,
  truckingAlias = 't',
): string {
  const contractOpen = `NOT (${sqlIsContractSapClosedExpr(contractAlias)})`;
  const realizationEnd = sqlRealizationEndDate(contractAlias);
  const notCompleted = `(
    ${realizationEnd} IS NULL
    AND NOT (${sqlIsContractSapClosedExpr(contractAlias)})
    AND UPPER(COALESCE(${truckingAlias}.status, '')) NOT IN ('COMPLETED', 'CLOSE', 'CLOSED')
  )`;
  return `(
    ${contractOpen}
    AND NOT (${sqlTruckingPageHasEtaOrPlanning(truckingAlias)})
    AND ${notCompleted}
  )`;
}

/**
 * Mutually exclusive pipeline stage per trucking operation row (Section 2 + Section 3 filter).
 */
export function sqlTruckingPagePipelineStageExpr(
  contractAlias = 'c',
  stoExpr?: string,
): string {
  const stoCheck = stoExpr ?? `NULLIF(TRIM(${contractAlias}.sto_number::text), '')`;
  const realizationStart = sqlRealizationStartDate(contractAlias);
  const realizationEnd = sqlRealizationEndDate(contractAlias);
  const notCompleted = `(
    ${realizationEnd} IS NULL
    AND NOT (${sqlIsContractSapClosedExpr(contractAlias)})
    AND UPPER(COALESCE(t.status, '')) NOT IN ('COMPLETED', 'CLOSE', 'CLOSED')
  )`;
  const contractOpen = `NOT (${sqlIsContractSapClosedExpr(contractAlias)})`;
  return `CASE
    WHEN COALESCE(t.status, '') = 'CANCELLED' THEN 'CANCELLED'
    WHEN ${realizationEnd} IS NOT NULL THEN 'COMPLETED'
    WHEN ${sqlIsContractSapClosedExpr(contractAlias)} THEN 'COMPLETED'
    WHEN UPPER(COALESCE(t.status, '')) IN ('COMPLETED', 'CLOSE', 'CLOSED') THEN 'COMPLETED'
    WHEN ${sqlHasTruckingKlipPlanning('t')}
      AND ${realizationStart} IS NOT NULL
      AND ${realizationEnd} IS NULL
      THEN 'IN_PROGRESS'
    WHEN ${contractOpen}
      AND ${sqlTruckingPageHasEtaOrPlanning('t')}
      AND ${notCompleted}
      THEN 'PLANNED'
    WHEN ${sqlTruckingPageUnplannedPredicate(contractAlias, stoCheck)} THEN 'UNPLANNED'
    ELSE 'COMPLETED'
  END`;
}

/** Filter list rows by pipeline card (same expression as summary). */
export function appendTruckingPipelineStageFilter(
  stage: string | undefined,
  stoExpr: string,
  startIndex: number,
): { sql: string; params: string[]; nextIndex: number } {
  const normalized = normalizeTruckingPagePipelineStageParam(stage);
  if (!normalized) {
    return { sql: '', params: [], nextIndex: startIndex };
  }
  return {
    sql: ` AND ${sqlTruckingPagePipelineStageExpr('c', stoExpr)} = $${startIndex}`,
    params: [normalized],
    nextIndex: startIndex + 1,
  };
}
