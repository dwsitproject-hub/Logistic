/**
 * Shipments page — Outstanding Qty KPI strip (FOB/CIF × Interco / 3rd Party).
 * OS uses the same contract-global outstanding rules as list / unplanned backlog rows.
 */

import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { shipmentEffectiveStatusExpr } from './shipmentListFilters';
import {
  appendShipmentPipelineStageFilter,
  normalizeShipmentPagePipelineStageParam,
  shipmentPagePipelineUnplannedRowPredicate,
} from './shipmentPagePipelineSql';
import {
  buildUnplannedContractBacklogLatestSpdCte,
  unplannedContractBacklogBaseWhereSql,
} from './shipmentUnplannedHybridSql';

export interface ShipmentOutstandingQtyBucketKg {
  fobKg: number;
  cifKg: number;
}

export interface ShipmentOutstandingQtySummary {
  totalKg: number;
  thirdParty: ShipmentOutstandingQtyBucketKg;
  interco: ShipmentOutstandingQtyBucketKg;
}

export const EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY: ShipmentOutstandingQtySummary = {
  totalKg: 0,
  thirdParty: { fobKg: 0, cifKg: 0 },
  interco: { fobKg: 0, cifKg: 0 },
};

const ACTIVE_OS_STATUSES = new Set([
  'UNPLANNED',
  'PLANNED',
  'AT_LOADING_PORT',
  'SAILED',
  'AT_DISCHARGE_PORT',
]);

/** SQL: contracts.source_type maps to UI "3rd Party". */
export function sqlShipmentSourceIsThirdParty(expr: string): string {
  return `(
    POSITION('3RD' IN UPPER(TRIM(COALESCE(${expr}, '')))) > 0
    AND POSITION('PARTY' IN UPPER(TRIM(COALESCE(${expr}, '')))) > 0
  )`;
}

/** SQL: contracts.source_type maps to UI "Interco" (Inhouse / Interco). */
export function sqlShipmentSourceIsInterco(expr: string): string {
  const u = `UPPER(TRIM(COALESCE(${expr}, '')))`;
  return `(
    POSITION('INTERCO' IN ${u}) > 0
    OR POSITION('INHOUSE' IN ${u}) > 0
    OR POSITION('IN-HOUSE' IN ${u}) > 0
  )`;
}

export function sqlShipmentIncotermIsFob(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'FOB'`;
}

export function sqlShipmentIncotermIsCif(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'CIF'`;
}

function sqlSumOutstandingBucket(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
  sourceKind: 'third_party' | 'interco',
  incotermKind: 'fob' | 'cif',
): string {
  const sourcePred =
    sourceKind === 'third_party'
      ? sqlShipmentSourceIsThirdParty(sourceExpr)
      : sqlShipmentSourceIsInterco(sourceExpr);
  const incotermPred =
    incotermKind === 'fob'
      ? sqlShipmentIncotermIsFob(incotermExpr)
      : sqlShipmentIncotermIsCif(incotermExpr);
  return `COALESCE(SUM(CASE
    WHEN ${sourcePred} AND ${incotermPred} THEN COALESCE((${outstandingExpr})::numeric, 0)
    ELSE 0
  END), 0)`;
}

export function sqlShipmentOutstandingQtyAggregateSelect(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
): string {
  return `
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'third_party', 'fob')} AS third_party_fob_kg,
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'third_party', 'cif')} AS third_party_cif_kg,
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'interco', 'fob')} AS interco_fob_kg,
    ${sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, 'interco', 'cif')} AS interco_cif_kg
  `;
}

/** Normalize osStatus query; null means ALL (no extra stage filter). */
export function normalizeShipmentOsStatusParam(raw: unknown): string | null {
  return normalizeShipmentPagePipelineStageParam(
    typeof raw === 'string' ? raw : undefined,
  );
}

/** Completed / Cancelled cards → empty OS (no overlap with active-only scope). */
export function isShipmentOsStatusOutsideActiveScope(osStatus: string | null): boolean {
  if (!osStatus) return false;
  return !ACTIVE_OS_STATUSES.has(osStatus);
}

export function shouldIncludeShipmentUnplannedBacklogForOs(osStatus: string | null): boolean {
  return !osStatus || osStatus === 'UNPLANNED';
}

/** Active pipeline stages for OS strip (excludes COMPLETED / CANCELLED). */
export function sqlShipmentOutstandingActiveStagePredicate(alias: string): string {
  const eff = shipmentEffectiveStatusExpr(alias);
  return `(
    ${shipmentPagePipelineUnplannedRowPredicate(alias)}
    OR ${eff} IN (
      'PLANNED',
      'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING',
      'SAILED',
      'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING'
    )
  )`;
}

export function parseShipmentOutstandingQtySummaryRow(
  row: Record<string, unknown> | undefined | null,
): ShipmentOutstandingQtySummary {
  if (!row) {
    return {
      totalKg: 0,
      thirdParty: { fobKg: 0, cifKg: 0 },
      interco: { fobKg: 0, cifKg: 0 },
    };
  }
  const thirdParty = {
    fobKg: Number(row.third_party_fob_kg ?? 0) || 0,
    cifKg: Number(row.third_party_cif_kg ?? 0) || 0,
  };
  const interco = {
    fobKg: Number(row.interco_fob_kg ?? 0) || 0,
    cifKg: Number(row.interco_cif_kg ?? 0) || 0,
  };
  return {
    thirdParty,
    interco,
    totalKg: thirdParty.fobKg + thirdParty.cifKg + interco.fobKg + interco.cifKg,
  };
}

export function mergeShipmentOutstandingQtySummaries(
  ...parts: ShipmentOutstandingQtySummary[]
): ShipmentOutstandingQtySummary {
  const thirdParty = { fobKg: 0, cifKg: 0 };
  const interco = { fobKg: 0, cifKg: 0 };
  for (const part of parts) {
    thirdParty.fobKg += part.thirdParty.fobKg;
    thirdParty.cifKg += part.thirdParty.cifKg;
    interco.fobKg += part.interco.fobKg;
    interco.cifKg += part.interco.cifKg;
  }
  return {
    thirdParty,
    interco,
    totalKg: thirdParty.fobKg + thirdParty.cifKg + interco.fobKg + interco.cifKg,
  };
}

/**
 * Aggregate OS from active shipment execution rows (toolbar-scoped), expanded to contracts.
 */
export function buildShipmentOutstandingQtyExecutionAggregateQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
  baseParams: unknown[],
  osStatus: string | null,
): { text: string; params: unknown[] } {
  const stageFilter = appendShipmentPipelineStageFilter(
    osStatus ?? undefined,
    baseParams.length + 1,
  );
  // appendShipmentPipelineStageFilter hardcodes alias `sb`; active rows use `f`.
  const stageSql = stageFilter.sql.replace(/\bsb\./g, 'f.');
  const params = [...baseParams, ...stageFilter.params];

  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });

  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT DISTINCT TRIM(cn) AS contract_number
      FROM active_shipments sp
      CROSS JOIN LATERAL unnest(regexp_split_to_array(sp.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      WHERE sp.contract_numbers IS NOT NULL
        AND TRIM(sp.contract_numbers) <> ''
        AND TRIM(cn) <> ''`,
  });

  const text = `
    ${shipmentBaseCteSql}
    , filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${toolbarOuterSql}
    ),
    active_shipments AS (
      SELECT f.*
      FROM filtered_shipments f
      WHERE ${sqlShipmentOutstandingActiveStagePredicate('f')}
        ${stageSql}
    ),
    ${qtyMoveCte},
    os_rows AS (
      SELECT
        c.source_type,
        c.incoterm,
        ${outstandingExpr} AS outstanding_quantity
      FROM active_shipments sp
      CROSS JOIN LATERAL unnest(regexp_split_to_array(sp.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      INNER JOIN contracts c ON TRIM(c.contract_id) = TRIM(cn)
      WHERE sp.contract_numbers IS NOT NULL
        AND TRIM(sp.contract_numbers) <> ''
        AND TRIM(cn) <> ''
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF')
    )
    SELECT
      ${sqlShipmentOutstandingQtyAggregateSelect(
        'os_rows.outstanding_quantity',
        'os_rows.source_type',
        'os_rows.incoterm',
      )}
    FROM os_rows`;

  return { text, params };
}

/**
 * Aggregate OS from open-contract unplanned backlog (no shipment yet).
 */
export function buildShipmentOutstandingQtyBacklogAggregateQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
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
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    ${qtyMoveCte},
    backlog_rows AS (
      SELECT
        c.source_type,
        c.incoterm,
        ${outstandingExpr} AS outstanding_quantity
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF')
    )
    SELECT
      ${sqlShipmentOutstandingQtyAggregateSelect(
        'br.outstanding_quantity',
        'br.source_type',
        'br.incoterm',
      )}
    FROM backlog_rows br`;
}
