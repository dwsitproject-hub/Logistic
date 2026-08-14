/**
 * Trucking page — Outstanding Qty KPI strip (FRC/LCO × Interco / 3rd Party).
 *
 * Strip total = Unplanned OS + Planned/In Progress OS (clamped at 0 per PO).
 * Same numbers as the status cards. 3rd Party / Interco slice that mix
 * by source × FRC/LCO; residual is otherKg.
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
  /** Residual so 3rd+Interco+Other = total (blank/other source or non-FRC/LCO). */
  otherKg?: number;
}

export const EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY: TruckingOutstandingQtySummary = {
  totalKg: 0,
  thirdParty: { frcKg: 0, lcoKg: 0 },
  interco: { frcKg: 0, lcoKg: 0 },
  otherKg: 0,
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

/**
 * Strip / card-total line qty: Unplanned + Planned + In Progress use
 * outstanding qty, floored at 0 so over-delivery does not shrink totals.
 */
export function sqlTruckingStripLineQtyExpr(
  statusExpr: string,
  _contractQtyExpr: string,
  outstandingExpr: string,
): string {
  return `CASE
    WHEN ${statusExpr} IN ('UNPLANNED', 'PLANNED', 'IN_PROGRESS')
      THEN GREATEST(0, COALESCE((${outstandingExpr})::numeric, 0))
    ELSE 0
  END`;
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

export function sumTruckingOutstandingQtyClassifiedBucketsKg(
  summary: Pick<TruckingOutstandingQtySummary, 'thirdParty' | 'interco'>,
): number {
  return (
    (Number(summary.thirdParty?.frcKg) || 0) +
    (Number(summary.thirdParty?.lcoKg) || 0) +
    (Number(summary.interco?.frcKg) || 0) +
    (Number(summary.interco?.lcoKg) || 0)
  );
}

export function reconcileTruckingOutstandingQtySummary(
  strip: TruckingOutstandingQtySummary,
  cardTotalKg?: number | null,
): TruckingOutstandingQtySummary {
  const classified = sumTruckingOutstandingQtyClassifiedBucketsKg(strip);
  const totalKg =
    cardTotalKg != null && Number.isFinite(Number(cardTotalKg))
      ? Number(cardTotalKg) || 0
      : Number(strip.totalKg) || 0;
  return {
    ...strip,
    totalKg,
    otherKg: Math.max(0, totalKg - classified),
  };
}

export function parseTruckingOutstandingQtySummaryRow(
  row: Record<string, unknown> | undefined | null,
): TruckingOutstandingQtySummary {
  if (!row) {
    return { ...EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY };
  }
  const thirdParty = {
    frcKg: Number(row.third_party_frc_kg ?? 0) || 0,
    lcoKg: Number(row.third_party_lco_kg ?? 0) || 0,
  };
  const interco = {
    frcKg: Number(row.interco_frc_kg ?? 0) || 0,
    lcoKg: Number(row.interco_lco_kg ?? 0) || 0,
  };
  const classified = thirdParty.frcKg + thirdParty.lcoKg + interco.frcKg + interco.lcoKg;
  const cardTotalKg =
    row.card_total_kg != null
      ? Number(row.card_total_kg) || 0
      : classified;
  return reconcileTruckingOutstandingQtySummary(
    { thirdParty, interco, totalKg: cardTotalKg },
    cardTotalKg,
  );
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
  const totalKg = parts.reduce((sum, part) => sum + (Number(part.totalKg) || 0), 0);
  return reconcileTruckingOutstandingQtySummary(
    { thirdParty, interco, totalKg },
    totalKg,
  );
}

/**
 * Aggregate strip qty from trucking execution rows at PO grain.
 * Unplanned / Planned / In Progress = outstanding qty (clamped at 0).
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
  /** Planned card matches list filter: Planned + In Progress. */
  const plannedCard = osStatus === 'PLANNED';
  const stageClause = !osStatus
    ? ''
    : plannedCard
      ? ` AND pc.status IN ('PLANNED', 'IN_PROGRESS')`
      : ` AND pc.status = $${baseParams.length + 1}`;
  const params = !osStatus || plannedCard ? baseParams : [...baseParams, osStatus];
  const lineQty = sqlTruckingStripLineQtyExpr(
    'pc.status',
    'pc.contract_qty',
    'pc.outstanding_quantity',
  );

  const text = `
    WITH trucking_filtered AS (
      SELECT * FROM (
        ${expanded}
      ) expanded_sub
    ),
    per_contract AS (
      SELECT
        tf.status,
        tf.contract_number,
        MAX(COALESCE(tf.contract_qty, 0))::numeric AS contract_qty,
        GREATEST(0, MAX(COALESCE(tf.outstanding_quantity, 0)))::numeric AS outstanding_quantity,
        MAX(NULLIF(TRIM(COALESCE(tf.source_type::text, '')), '')) AS source_type,
        MAX(NULLIF(TRIM(COALESCE(tf.incoterm::text, '')), '')) AS incoterm
      FROM trucking_filtered tf
      WHERE NULLIF(TRIM(COALESCE(tf.contract_number::text, '')), '') IS NOT NULL
        AND tf.status IN ('UNPLANNED', 'PLANNED', 'IN_PROGRESS')
      GROUP BY tf.status, tf.contract_number
    )
    SELECT
      ${sqlTruckingOutstandingQtyAggregateSelect(lineQty, 'pc.source_type', 'pc.incoterm')},
      COALESCE(SUM(${lineQty}), 0)::numeric AS card_total_kg
    FROM per_contract pc
    WHERE 1=1
      ${stageClause}`;

  return { text, params };
}

function buildTruckingUnplannedBacklogOsCtes(
  contractScopeSql: string,
  toolbarSql: string,
): { backlogWhere: string; outstandingExpr: string; qtyMoveCte: string } {
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
  return { backlogWhere, outstandingExpr, qtyMoveCte };
}

/**
 * Aggregate Unplanned backlog at outstanding qty (no trucking op yet).
 * @deprecated Use `buildTruckingUnplannedBacklogCombinedQuery`.
 */
export function buildTruckingOutstandingQtyBacklogAggregateQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const { backlogWhere, outstandingExpr, qtyMoveCte } = buildTruckingUnplannedBacklogOsCtes(
    contractScopeSql,
    toolbarSql,
  );

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    backlog_rows AS (
      SELECT
        c.source_type,
        c.incoterm,
        (${outstandingExpr})::numeric AS outstanding_quantity
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    )
    SELECT
      ${sqlTruckingOutstandingQtyAggregateSelect(
        'br.outstanding_quantity',
        'br.source_type',
        'br.incoterm',
      )},
      COALESCE(SUM(COALESCE(br.outstanding_quantity, 0)), 0)::numeric AS card_total_kg
    FROM backlog_rows br`;
}

/**
 * Section 1 Summary/OS backlog — single scan of the unplanned contract backlog for
 * COUNT + contract qty (kg) + strip buckets (Unplanned = outstanding qty, clamped at 0).
 */
export function buildTruckingUnplannedBacklogCombinedQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const { backlogWhere, outstandingExpr, qtyMoveCte } = buildTruckingUnplannedBacklogOsCtes(
    contractScopeSql,
    toolbarSql,
  );

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    backlog_rows AS (
      SELECT
        c.quantity_ordered,
        c.source_type,
        c.incoterm,
        (${outstandingExpr})::numeric AS outstanding_quantity
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
    )
    SELECT
      COUNT(*)::bigint AS c,
      COALESCE(SUM(COALESCE(br.quantity_ordered, 0)), 0)::numeric AS contract_qty_kg,
      COALESCE(SUM(COALESCE(br.outstanding_quantity, 0)), 0)::numeric AS card_total_kg,
      ${sqlTruckingOutstandingQtyAggregateSelect(
        'br.outstanding_quantity',
        'br.source_type',
        'br.incoterm',
      )}
    FROM backlog_rows br`;
}