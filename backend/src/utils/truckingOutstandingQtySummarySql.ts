/**
 * Trucking page — Outstanding Qty KPI strip (FRC/LCO × Interco / 3rd Party).
 * OS uses the same expanded-row outstanding_quantity as the view table (after WB).
 */

import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { normalizeTruckingPagePipelineStageParam } from './truckingPagePipelineSql';
import {
  buildTruckingUnplannedBacklogLatestSpdCte,
  truckingUnplannedContractBacklogBaseWhereSql,
} from './truckingUnplannedHybridSql';
import { wrapTruckingListQueryWithStoExpansion } from './truckingListStoExpandSql';

export interface TruckingOutstandingQtyBuiltQuery {
  preOuterQuery: string;
  outerSql: string;
  innerParams: unknown[];
  outerParams: unknown[];
}

export interface TruckingOutstandingQtyBucketKg {
  frcKg: number;
  lcoKg: number;
}

export interface TruckingOutstandingQtySummary {
  totalKg: number;
  thirdParty: TruckingOutstandingQtyBucketKg;
  interco: TruckingOutstandingQtyBucketKg;
}

export const EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY: TruckingOutstandingQtySummary = {
  totalKg: 0,
  thirdParty: { frcKg: 0, lcoKg: 0 },
  interco: { frcKg: 0, lcoKg: 0 },
};

const ACTIVE_OS_STATUSES = new Set(['UNPLANNED', 'PLANNED', 'IN_PROGRESS']);

/** SQL: contracts.source_type maps to UI "3rd Party". */
export function sqlTruckingSourceIsThirdParty(expr: string): string {
  return `(
    POSITION('3RD' IN UPPER(TRIM(COALESCE(${expr}, '')))) > 0
    AND POSITION('PARTY' IN UPPER(TRIM(COALESCE(${expr}, '')))) > 0
  )`;
}

/** SQL: contracts.source_type maps to UI "Interco" (Inhouse / Interco). */
export function sqlTruckingSourceIsInterco(expr: string): string {
  const u = `UPPER(TRIM(COALESCE(${expr}, '')))`;
  return `(
    POSITION('INTERCO' IN ${u}) > 0
    OR POSITION('INHOUSE' IN ${u}) > 0
    OR POSITION('IN-HOUSE' IN ${u}) > 0
  )`;
}

export function sqlTruckingIncotermIsFrc(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'FRC'`;
}

export function sqlTruckingIncotermIsLco(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'LCO'`;
}

function sqlSumOutstandingBucket(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
  sourceKind: 'third_party' | 'interco',
  incotermKind: 'frc' | 'lco',
): string {
  const sourcePred =
    sourceKind === 'third_party'
      ? sqlTruckingSourceIsThirdParty(sourceExpr)
      : sqlTruckingSourceIsInterco(sourceExpr);
  const incotermPred =
    incotermKind === 'frc'
      ? sqlTruckingIncotermIsFrc(incotermExpr)
      : sqlTruckingIncotermIsLco(incotermExpr);
  return `COALESCE(SUM(CASE
    WHEN ${sourcePred} AND ${incotermPred} THEN COALESCE((${outstandingExpr})::numeric, 0)
    ELSE 0
  END), 0)`;
}

export function sqlTruckingOutstandingQtyAggregateSelect(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
): string {
  return `
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'third_party', 'frc')} AS third_party_frc_kg,
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'third_party', 'lco')} AS third_party_lco_kg,
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'interco', 'frc')} AS interco_frc_kg,
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'interco', 'lco')} AS interco_lco_kg
  `;
}

/** Normalize osStatus query; null means ALL (no extra stage filter). */
export function normalizeTruckingOsStatusParam(raw: unknown): string | null {
  const normalized = normalizeTruckingPagePipelineStageParam(
    typeof raw === 'string' ? raw : undefined,
  );
  return normalized;
}

/** Completed / Cancelled cards → empty OS (no overlap with active-only scope). */
export function isTruckingOsStatusOutsideActiveScope(osStatus: string | null): boolean {
  if (!osStatus) return false;
  return !ACTIVE_OS_STATUSES.has(osStatus);
}

export function shouldIncludeTruckingUnplannedBacklogForOs(osStatus: string | null): boolean {
  return !osStatus || osStatus === 'UNPLANNED';
}

export function parseTruckingOutstandingQtySummaryRow(
  row: Record<string, unknown> | undefined | null,
): TruckingOutstandingQtySummary {
  if (!row) {
    return {
      totalKg: 0,
      thirdParty: { frcKg: 0, lcoKg: 0 },
      interco: { frcKg: 0, lcoKg: 0 },
    };
  }
  const thirdParty = {
    frcKg: Number(row.third_party_frc_kg ?? 0) || 0,
    lcoKg: Number(row.third_party_lco_kg ?? 0) || 0,
  };
  const interco = {
    frcKg: Number(row.interco_frc_kg ?? 0) || 0,
    lcoKg: Number(row.interco_lco_kg ?? 0) || 0,
  };
  return {
    thirdParty,
    interco,
    totalKg: thirdParty.frcKg + thirdParty.lcoKg + interco.frcKg + interco.lcoKg,
  };
}

export function mergeTruckingOutstandingQtySummaries(
  ...parts: TruckingOutstandingQtySummary[]
): TruckingOutstandingQtySummary {
  const thirdParty = { frcKg: 0, lcoKg: 0 };
  const interco = { frcKg: 0, lcoKg: 0 };
  for (const part of parts) {
    thirdParty.frcKg += part.thirdParty.frcKg;
    thirdParty.lcoKg += part.thirdParty.lcoKg;
    interco.frcKg += part.interco.frcKg;
    interco.lcoKg += part.interco.lcoKg;
  }
  return {
    thirdParty,
    interco,
    totalKg: thirdParty.frcKg + thirdParty.lcoKg + interco.frcKg + interco.lcoKg,
  };
}

/**
 * Aggregate OS from expanded trucking execution rows (same expansion as list/summary).
 */
export function buildTruckingOutstandingQtyExecutionAggregateQuery(
  built: TruckingOutstandingQtyBuiltQuery,
  osStatus: string | null,
): { text: string; params: unknown[] } {
  const innerSql = `${built.preOuterQuery}${built.outerSql}`;
  const expanded = wrapTruckingListQueryWithStoExpansion(innerSql, {
    selectOutstanding: true,
    skipSapJoin: false,
  });
  const baseParams = [...built.innerParams, ...built.outerParams];
  /** Planned card OS matches list filter: Planned + In Progress. */
  const plannedCard = osStatus === 'PLANNED';
  const stageClause = !osStatus
    ? ''
    : plannedCard
      ? ` AND tf.status IN ('PLANNED', 'IN_PROGRESS')`
      : ` AND tf.status = $${baseParams.length + 1}`;
  const params = !osStatus || plannedCard ? baseParams : [...baseParams, osStatus];

  const text = `
    WITH trucking_filtered AS (
      SELECT * FROM (
        ${expanded}
      ) expanded_sub
    )
    SELECT
      ${sqlTruckingOutstandingQtyAggregateSelect(
        'tf.outstanding_quantity',
        'tf.source_type',
        'tf.incoterm',
      )}
    FROM trucking_filtered tf
    WHERE tf.status IN ('UNPLANNED', 'PLANNED', 'IN_PROGRESS')
      AND UPPER(TRIM(COALESCE(tf.incoterm, ''))) IN ('FRC', 'LCO')
      ${stageClause}`;

  return { text, params };
}

/**
 * Aggregate OS from open-contract unplanned backlog (no trucking op yet).
 * Caller supplies contractScopeSql / toolbarSql params separately.
 */
export function buildTruckingOutstandingQtyBacklogAggregateQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const backlogWhere = `${truckingUnplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}`,
  });

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    backlog_rows AS (
      SELECT
        c.source_type,
        c.incoterm,
        ${outstandingExpr} AS outstanding_quantity
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'LCO')
    )
    SELECT
      ${sqlTruckingOutstandingQtyAggregateSelect(
        'br.outstanding_quantity',
        'br.source_type',
        'br.incoterm',
      )}
    FROM backlog_rows br`;
}
