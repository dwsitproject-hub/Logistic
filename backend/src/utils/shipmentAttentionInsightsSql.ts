/**
 * Shipments page — Attention Needed + Aging Overdue insights (toolbar-scoped).
 * Row grain: COALESCE(sto_number, operation_id, sto_key) for execution;
 * contract backlog uses sto_key = contract:{uuid}.
 */

import { sqlIsContractSapClosedExpr, sqlIsContractSapClosedForStoExpr } from './contractDeliveryStatus';
import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';
import {
  sqlShipmentIncotermIsCif,
  sqlShipmentIncotermIsFob,
  sqlShipmentSourceIsInterco,
  sqlShipmentSourceIsThirdParty,
} from './shipmentOutstandingQtySummarySql';
import {
  buildUnplannedContractBacklogLatestSpdCte,
  unplannedContractBacklogBaseWhereSql,
  unplannedShipmentExecutionOuterSql,
} from './shipmentUnplannedHybridSql';

export function sqlShipmentHybridRowKey(
  stoNumberExpr: string,
  operationIdExpr: string,
  stoKeyExpr: string,
): string {
  return `COALESCE(NULLIF(TRIM(${stoNumberExpr}), ''), NULLIF(TRIM(${operationIdExpr}), ''), ${stoKeyExpr})`;
}

function sqlOutstandingKg(contractAlias = 'c'): string {
  return sqlContractGlobalOutstandingExpr({
    contractQtyExpr: `${contractAlias}.quantity_ordered`,
    incotermExpr: `${contractAlias}.incoterm`,
    contractNumberExpr: `${contractAlias}.contract_id`,
  });
}

function sqlDaysOverdue(deliveryEndExpr: string): string {
  return `(CURRENT_DATE - ${deliveryEndExpr}::date)`;
}

function sqlAgingBucketCase(daysOverdueExpr: string, osExpr: string): string {
  return `
    COALESCE(SUM(CASE WHEN ${daysOverdueExpr} BETWEEN 1 AND 7 THEN ${osExpr} ELSE 0 END), 0) AS bucket_1_7_kg,
    COALESCE(SUM(CASE WHEN ${daysOverdueExpr} BETWEEN 8 AND 30 THEN ${osExpr} ELSE 0 END), 0) AS bucket_8_30_kg,
    COALESCE(SUM(CASE WHEN ${daysOverdueExpr} > 30 THEN ${osExpr} ELSE 0 END), 0) AS bucket_gt_30_kg`;
}

/** Aggregate overdue rows already grouped to shipment grain (STO / operation / sto_key). */
function sqlShipmentGroupedOverdueAggregateSelect(): string {
  return `
    COUNT(*)::bigint AS row_count,
    COALESCE(SUM(outstanding_kg), 0)::numeric AS total_os_kg,
    COALESCE(SUM(fob_os_kg), 0)::numeric AS fob_os_kg,
    COALESCE(SUM(cif_os_kg), 0)::numeric AS cif_os_kg,
    COALESCE(SUM(third_party_os_kg), 0)::numeric AS third_party_os_kg,
    COALESCE(SUM(interco_os_kg), 0)::numeric AS interco_os_kg,
    ${sqlAgingBucketCase('days_overdue', 'outstanding_kg')},
    COALESCE(SUM(CASE WHEN days_overdue > 30 THEN outstanding_kg ELSE 0 END), 0)::numeric AS os_gt_30_kg`;
}

function buildShipmentOverdueExecutionGroupedRowsCte(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
): string {
  const outerSql = unplannedShipmentExecutionOuterSql(toolbarOuterSql);
  const outstandingExpr = sqlOutstandingKg('c');
  const daysOverdue = sqlDaysOverdue('c.delivery_end_date');
  const rowKey = sqlShipmentHybridRowKey('sp.sto_number', 'sp.operation_id', 'sp.sto_key');

  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT DISTINCT TRIM(cn) AS contract_number
      FROM filtered_shipments sp
      CROSS JOIN LATERAL unnest(regexp_split_to_array(sp.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      WHERE sp.contract_numbers IS NOT NULL
        AND TRIM(sp.contract_numbers) <> ''
        AND TRIM(cn) <> ''`,
  });

  return `
    ${shipmentBaseCteSql}
    , filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${outerSql}
    ),
    ${qtyMoveCte},
    overdue_contract_parts AS (
      SELECT
        ${rowKey} AS row_key,
        NULLIF(TRIM(COALESCE(c.supplier, sp.suppliers, '')), '') AS supplier,
        c.source_type,
        c.incoterm,
        NULLIF(TRIM(COALESCE(sp.vessel_name, '')), '') AS vessel_name,
        ${outstandingExpr} AS contract_outstanding_kg,
        ${daysOverdue} AS days_overdue
      FROM filtered_shipments sp
      CROSS JOIN LATERAL unnest(regexp_split_to_array(sp.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      INNER JOIN contracts c ON TRIM(c.contract_id) = TRIM(cn)
      WHERE sp.contract_numbers IS NOT NULL
        AND TRIM(sp.contract_numbers) <> ''
        AND TRIM(cn) <> ''
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF')
        AND NOT (${sqlIsContractSapClosedForStoExpr('c', 'sp.sto_key')})
    ),
    overdue_rows AS (
      SELECT
        row_key,
        MAX(supplier) AS supplier,
        MAX(vessel_name) AS vessel_name,
        SUM(contract_outstanding_kg)::numeric AS outstanding_kg,
        MAX(days_overdue)::int AS days_overdue,
        COALESCE(SUM(CASE WHEN ${sqlShipmentIncotermIsFob('incoterm')} THEN contract_outstanding_kg ELSE 0 END), 0)::numeric AS fob_os_kg,
        COALESCE(SUM(CASE WHEN ${sqlShipmentIncotermIsCif('incoterm')} THEN contract_outstanding_kg ELSE 0 END), 0)::numeric AS cif_os_kg,
        COALESCE(SUM(CASE WHEN ${sqlShipmentSourceIsThirdParty('source_type')} THEN contract_outstanding_kg ELSE 0 END), 0)::numeric AS third_party_os_kg,
        COALESCE(SUM(CASE WHEN ${sqlShipmentSourceIsInterco('source_type')} THEN contract_outstanding_kg ELSE 0 END), 0)::numeric AS interco_os_kg
      FROM overdue_contract_parts
      GROUP BY row_key
    )`;
}

function sqlOverdueAggregateSelect(
  daysOverdueExpr: string,
  osExpr: string,
  rowKeyExpr: string,
): string {
  return `
    COUNT(DISTINCT ${rowKeyExpr})::bigint AS row_count,
    COALESCE(SUM(${osExpr}), 0)::numeric AS total_os_kg,
    COALESCE(SUM(CASE WHEN ${sqlShipmentIncotermIsFob('incoterm')} THEN ${osExpr} ELSE 0 END), 0)::numeric AS fob_os_kg,
    COALESCE(SUM(CASE WHEN ${sqlShipmentIncotermIsCif('incoterm')} THEN ${osExpr} ELSE 0 END), 0)::numeric AS cif_os_kg,
    COALESCE(SUM(CASE WHEN ${sqlShipmentSourceIsThirdParty('source_type')} THEN ${osExpr} ELSE 0 END), 0)::numeric AS third_party_os_kg,
    COALESCE(SUM(CASE WHEN ${sqlShipmentSourceIsInterco('source_type')} THEN ${osExpr} ELSE 0 END), 0)::numeric AS interco_os_kg,
    ${sqlAgingBucketCase(daysOverdueExpr, osExpr)},
    COALESCE(SUM(CASE WHEN ${daysOverdueExpr} > 30 THEN ${osExpr} ELSE 0 END), 0)::numeric AS os_gt_30_kg`;
}

/** Contract backlog overdue rows (hybrid sto_key = contract:{uuid}, one table row per entry). */
export function buildShipmentOverdueBacklogAggregateQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlOutstandingKg('c');
  const daysOverdue = sqlDaysOverdue('c.delivery_end_date');
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE`,
  });

  return `
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    ${qtyMoveCte},
    overdue_rows AS (
      SELECT
        ('contract:' || c.id::text) AS row_key,
        NULLIF(TRIM(COALESCE(c.supplier, '')), '') AS supplier,
        c.source_type,
        c.incoterm,
        NULL::text AS vessel_name,
        ${outstandingExpr} AS outstanding_kg,
        ${daysOverdue} AS days_overdue
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF')
    )
    SELECT
      ${sqlOverdueAggregateSelect('days_overdue', 'outstanding_kg', 'row_key')}
    FROM overdue_rows`;
}

/** Unplanned execution overdue rows grouped to STO / operation / sto_key grain. */
export function buildShipmentOverdueExecutionAggregateQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
): string {
  return `
    ${buildShipmentOverdueExecutionGroupedRowsCte(shipmentBaseCteSql, toolbarOuterSql)}
    SELECT
      ${sqlShipmentGroupedOverdueAggregateSelect()}
    FROM overdue_rows`;
}

export function buildShipmentOverdueBacklogTopSuppliersQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit = 3,
): string {
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlOutstandingKg('c');
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE`,
  });

  return `
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    ${qtyMoveCte},
    overdue_rows AS (
      SELECT
        NULLIF(TRIM(COALESCE(c.supplier, '')), '') AS supplier,
        ${outstandingExpr} AS outstanding_kg
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF')
    )
    SELECT supplier, COALESCE(SUM(outstanding_kg), 0)::numeric AS os_kg
    FROM overdue_rows
    WHERE supplier IS NOT NULL
    GROUP BY supplier
    ORDER BY os_kg DESC
    LIMIT ${Math.max(1, Math.min(limit, 10))}`;
}

export function buildShipmentOverdueExecutionTopSuppliersQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
  limit = 3,
): string {
  return `
    ${buildShipmentOverdueExecutionGroupedRowsCte(shipmentBaseCteSql, toolbarOuterSql)}
    SELECT supplier, COALESCE(SUM(outstanding_kg), 0)::numeric AS os_kg
    FROM overdue_rows
    WHERE supplier IS NOT NULL
    GROUP BY supplier
    ORDER BY os_kg DESC
    LIMIT ${Math.max(1, Math.min(limit, 10))}`;
}

/** Top vessels by overdue OS (execution rows grouped to shipment grain). */
export function buildShipmentOverdueTopVesselsQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
  limit = 3,
): string {
  return `
    ${buildShipmentOverdueExecutionGroupedRowsCte(shipmentBaseCteSql, toolbarOuterSql)}
    SELECT vessel_name AS vessel, COALESCE(SUM(outstanding_kg), 0)::numeric AS os_kg
    FROM overdue_rows
    WHERE vessel_name IS NOT NULL
    GROUP BY vessel_name
    ORDER BY os_kg DESC
    LIMIT ${Math.max(1, Math.min(limit, 10))}`;
}

/** Carry-over: delivery ended before current month, OS > 0, 3rd Party. */
export function buildShipmentCarryOverInsightsQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const openWhere = `${buildShipmentPageSeaIncotermScopeSql('c')}
    AND NOT (${sqlIsContractSapClosedExpr('c')})
    AND UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FOB', 'CIF')${contractScopeSql}${toolbarSql}`;
  const backlogWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlOutstandingKg('c');
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}`,
  });

  return `
    WITH ${buildUnplannedContractBacklogLatestSpdCte()},
    ${qtyMoveCte},
    carry_contracts AS (
      SELECT ${outstandingExpr} AS outstanding_kg
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < date_trunc('month', CURRENT_DATE)::date
        AND ${sqlShipmentSourceIsThirdParty('c.source_type')}
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
    ),
    carry_backlog AS (
      SELECT ${outstandingExpr} AS outstanding_kg
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < date_trunc('month', CURRENT_DATE)::date
        AND ${sqlShipmentSourceIsThirdParty('c.source_type')}
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
    )
    SELECT
      (SELECT COALESCE(SUM(outstanding_kg), 0) FROM carry_contracts)::numeric AS carry_total_kg,
      (SELECT COALESCE(SUM(outstanding_kg), 0) FROM carry_backlog)::numeric AS carry_unplanned_late_kg,
      to_char(date_trunc('month', CURRENT_DATE)::date - interval '1 month', 'Mon YYYY') AS carry_label_month`;
}

export interface ShipmentAttentionInsightsRow {
  vesselCount: number;
  totalOsKg: number;
  fobOsKg: number;
  cifOsKg: number;
  thirdPartyOsKg: number;
  intercoOsKg: number;
  bucket1To7Kg: number;
  bucket8To30Kg: number;
  bucketGt30Kg: number;
  osGt30Kg: number;
  pctOfTotalOs: number | null;
  topSuppliers: Array<{ supplier: string; osKg: number }>;
  topVessels: Array<{ vessel: string; osKg: number }>;
  carryOver: {
    labelMonth: string;
    totalKg: number;
    unplannedLateKg: number;
  } | null;
  lossAboveThreshold: Array<{ supplier: string; gainLossPct: number }>;
}

function mergeOverdueAggregateRows(
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  let rowCount = 0;
  let totalOsKg = 0;
  let fobOsKg = 0;
  let cifOsKg = 0;
  let thirdPartyOsKg = 0;
  let intercoOsKg = 0;
  let bucket1To7Kg = 0;
  let bucket8To30Kg = 0;
  let bucketGt30Kg = 0;
  let osGt30Kg = 0;
  for (const row of rows) {
    rowCount += parseInt(String(row.row_count ?? '0'), 10) || 0;
    totalOsKg += Number(row.total_os_kg ?? 0) || 0;
    fobOsKg += Number(row.fob_os_kg ?? 0) || 0;
    cifOsKg += Number(row.cif_os_kg ?? 0) || 0;
    thirdPartyOsKg += Number(row.third_party_os_kg ?? 0) || 0;
    intercoOsKg += Number(row.interco_os_kg ?? 0) || 0;
    bucket1To7Kg += Number(row.bucket_1_7_kg ?? 0) || 0;
    bucket8To30Kg += Number(row.bucket_8_30_kg ?? 0) || 0;
    bucketGt30Kg += Number(row.bucket_gt_30_kg ?? 0) || 0;
    osGt30Kg += Number(row.os_gt_30_kg ?? 0) || 0;
  }
  return {
    row_count: rowCount,
    total_os_kg: totalOsKg,
    fob_os_kg: fobOsKg,
    cif_os_kg: cifOsKg,
    third_party_os_kg: thirdPartyOsKg,
    interco_os_kg: intercoOsKg,
    bucket_1_7_kg: bucket1To7Kg,
    bucket_8_30_kg: bucket8To30Kg,
    bucket_gt_30_kg: bucketGt30Kg,
    os_gt_30_kg: osGt30Kg,
  };
}

function mergeTopSuppliers(
  rows: Record<string, unknown>[],
  limit = 3,
): Array<{ supplier: string; osKg: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const supplier = String(row.supplier ?? '').trim();
    if (!supplier) continue;
    map.set(supplier, (map.get(supplier) ?? 0) + (Number(row.os_kg ?? 0) || 0));
  }
  return [...map.entries()]
    .map(([supplier, osKg]) => ({ supplier, osKg }))
    .sort((a, b) => b.osKg - a.osKg)
    .slice(0, limit);
}

export function parseShipmentAttentionInsights(params: {
  backlogAggregateRow: Record<string, unknown> | null | undefined;
  executionAggregateRow: Record<string, unknown> | null | undefined;
  backlogTopSupplierRows: Record<string, unknown>[];
  executionTopSupplierRows: Record<string, unknown>[];
  topVesselRows: Record<string, unknown>[];
  carryRow: Record<string, unknown> | null | undefined;
  lossRows: Record<string, unknown>[];
  totalOutstandingKg: number | null | undefined;
}): ShipmentAttentionInsightsRow {
  const aggregateRow = mergeOverdueAggregateRows([
    params.backlogAggregateRow ?? {},
    params.executionAggregateRow ?? {},
  ]);
  const totalOsKg = Number(aggregateRow.total_os_kg ?? 0) || 0;
  const totalOutstandingKg = Number(params.totalOutstandingKg ?? 0) || 0;
  const pctOfTotalOs =
    totalOutstandingKg > 0 ? Math.round((totalOsKg / totalOutstandingKg) * 1000) / 10 : null;

  const carryTotal = Number(params.carryRow?.carry_total_kg ?? 0) || 0;
  const carryUnplanned = Number(params.carryRow?.carry_unplanned_late_kg ?? 0) || 0;
  const carryLabel = String(params.carryRow?.carry_label_month ?? '').trim();

  return {
    vesselCount: parseInt(String(aggregateRow.row_count ?? '0'), 10) || 0,
    totalOsKg,
    fobOsKg: Number(aggregateRow.fob_os_kg ?? 0) || 0,
    cifOsKg: Number(aggregateRow.cif_os_kg ?? 0) || 0,
    thirdPartyOsKg: Number(aggregateRow.third_party_os_kg ?? 0) || 0,
    intercoOsKg: Number(aggregateRow.interco_os_kg ?? 0) || 0,
    bucket1To7Kg: Number(aggregateRow.bucket_1_7_kg ?? 0) || 0,
    bucket8To30Kg: Number(aggregateRow.bucket_8_30_kg ?? 0) || 0,
    bucketGt30Kg: Number(aggregateRow.bucket_gt_30_kg ?? 0) || 0,
    osGt30Kg: Number(aggregateRow.os_gt_30_kg ?? 0) || 0,
    pctOfTotalOs,
    topSuppliers: mergeTopSuppliers([
      ...params.backlogTopSupplierRows,
      ...params.executionTopSupplierRows,
    ]),
    topVessels: params.topVesselRows
      .map((r) => ({
        vessel: String(r.vessel ?? '').trim(),
        osKg: Number(r.os_kg ?? 0) || 0,
      }))
      .filter((r) => r.vessel),
    carryOver:
      carryTotal > 0
        ? {
            labelMonth: carryLabel || 'Prior month',
            totalKg: carryTotal,
            unplannedLateKg: carryUnplanned,
          }
        : null,
    lossAboveThreshold: params.lossRows
      .map((r) => ({
        supplier: String(r.supplier ?? 'Unknown').trim() || 'Unknown',
        gainLossPct: Number(r.gain_loss_pct ?? 0) || 0,
      }))
      .filter((r) => r.gainLossPct < 0),
  };
}
