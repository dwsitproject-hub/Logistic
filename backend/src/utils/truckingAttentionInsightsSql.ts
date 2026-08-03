/**
 * Trucking page — Attention Needed + Aging Overdue insights (toolbar-scoped).
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { buildTruckingPageIncotermScopeSql } from './truckingIncotermScope';
import {
  buildTruckingUnplannedBacklogLatestSpdCte,
  truckingUnplannedContractBacklogBaseWhereSql,
} from './truckingUnplannedHybridSql';
import {
  sqlTruckingSourceIsInterco,
  sqlTruckingSourceIsThirdParty,
} from './truckingOutstandingQtySummarySql';

/** Negative gain/loss % at or below this value is flagged (Land). */
export const TRUCKING_LOSS_ABOVE_THRESHOLD_PCT = -0.5;

/** Open LAND/MIX FRC/LCO contracts (not SAP-closed), including those with trucking ops. */
export function truckingOpenLandContractBaseWhereSql(
  contractAlias = 'c',
  spdAlias = 'l',
): string {
  return `
    ${buildTruckingPageIncotermScopeSql(contractAlias)}
    AND UPPER(COALESCE(NULLIF(TRIM(${contractAlias}.transport_mode::text), ''), 'LAND')) IN ('LAND', 'MIX')
    AND NOT (${sqlIsContractSapClosedExpr(contractAlias)})
    AND NOT (
      ${contractAlias}.contract_id IS NOT NULL
      AND UPPER(NULLIF(TRIM(COALESCE(${spdAlias}.b2b_flag_raw, ${contractAlias}.contract_type::text, '')), '')) = 'B2B'
      AND NULLIF(TRIM(COALESCE(${spdAlias}.contract_reference_po_raw, '')), '') IS NOT NULL
    )`;
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

/** Main overdue + aging aggregate (contract grain, Due Date < today & OS > 0). */
export function buildTruckingOverdueInsightsAggregateQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const openWhere = `${truckingOpenLandContractBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlOutstandingKg('c');
  const daysOverdue = sqlDaysOverdue('c.delivery_end_date');
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE`,
  });

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    overdue_contracts AS (
      SELECT
        c.id,
        c.supplier,
        c.source_type,
        ${outstandingExpr} AS outstanding_kg,
        ${daysOverdue} AS days_overdue
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
    )
    SELECT
      COUNT(*)::bigint AS contract_count,
      COALESCE(SUM(outstanding_kg), 0)::numeric AS total_os_kg,
      COALESCE(SUM(CASE WHEN ${sqlTruckingSourceIsThirdParty('source_type')} THEN outstanding_kg ELSE 0 END), 0)::numeric AS third_party_os_kg,
      COALESCE(SUM(CASE WHEN ${sqlTruckingSourceIsInterco('source_type')} THEN outstanding_kg ELSE 0 END), 0)::numeric AS interco_os_kg,
      ${sqlAgingBucketCase('days_overdue', 'outstanding_kg')},
      COALESCE(SUM(CASE WHEN days_overdue > 30 THEN outstanding_kg ELSE 0 END), 0)::numeric AS os_gt_30_kg
    FROM overdue_contracts`;
}

/** Top suppliers by overdue OS (kg). */
export function buildTruckingOverdueTopSuppliersQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit = 3,
): string {
  const openWhere = `${truckingOpenLandContractBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlOutstandingKg('c');
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE`,
  });

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    overdue_contracts AS (
      SELECT
        NULLIF(TRIM(COALESCE(c.supplier, '')), '') AS supplier,
        ${outstandingExpr} AS outstanding_kg
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < CURRENT_DATE
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
    )
    SELECT supplier, COALESCE(SUM(outstanding_kg), 0)::numeric AS os_kg
    FROM overdue_contracts
    WHERE supplier IS NOT NULL
    GROUP BY supplier
    ORDER BY os_kg DESC
    LIMIT ${Math.max(1, Math.min(limit, 10))}`;
}

/**
 * Carry-over: delivery ended before the current month, OS > 0, 3rd Party.
 * Urgent subset: unplanned backlog (no trucking op) still overdue.
 */
export function buildTruckingCarryOverInsightsQuery(
  contractScopeSql: string,
  toolbarSql: string,
): string {
  const openWhere = `${truckingOpenLandContractBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const backlogWhere = `${truckingUnplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlOutstandingKg('c');
  const qtyMoveCte = buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT c.contract_id
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}`,
  });

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()},
    ${qtyMoveCte},
    carry_contracts AS (
      SELECT ${outstandingExpr} AS outstanding_kg
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${openWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < date_trunc('month', CURRENT_DATE)::date
        AND ${sqlTruckingSourceIsThirdParty('c.source_type')}
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
    ),
    carry_backlog AS (
      SELECT ${outstandingExpr} AS outstanding_kg
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${backlogWhere}
        AND c.delivery_end_date IS NOT NULL
        AND c.delivery_end_date::date < date_trunc('month', CURRENT_DATE)::date
        AND ${sqlTruckingSourceIsThirdParty('c.source_type')}
        AND COALESCE((${outstandingExpr})::numeric, 0) > 0
    )
    SELECT
      (SELECT COALESCE(SUM(outstanding_kg), 0) FROM carry_contracts)::numeric AS carry_total_kg,
      (SELECT COALESCE(SUM(outstanding_kg), 0) FROM carry_backlog)::numeric AS carry_unplanned_late_kg,
      to_char(date_trunc('month', CURRENT_DATE)::date - interval '1 month', 'Mon YYYY') AS carry_label_month`;
}

/** Land trucking ops with gain/loss at or below threshold. */
export function buildTruckingLossAboveThresholdQuery(
  contractScopeSql: string,
  toolbarSql: string,
  limit = 5,
): string {
  const threshold = TRUCKING_LOSS_ABOVE_THRESHOLD_PCT;
  const openWhere = `${truckingOpenLandContractBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;

  return `
    WITH ${buildTruckingUnplannedBacklogLatestSpdCte()}
    SELECT
      NULLIF(TRIM(COALESCE(c.supplier, t.trucking_owner, '')), '') AS supplier,
      t.gain_loss_percentage::numeric AS gain_loss_pct
    FROM trucking_operations t
    INNER JOIN contracts c ON c.id = t.contract_id
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    WHERE ${openWhere}
      AND COALESCE(t.status, '') <> 'CANCELLED'
      AND t.gain_loss_percentage IS NOT NULL
      AND t.gain_loss_percentage::numeric <= ${threshold}
    ORDER BY t.gain_loss_percentage ASC
    LIMIT ${Math.max(1, Math.min(limit, 10))}`;
}

export interface TruckingAttentionInsightsRow {
  contractCount: number;
  totalOsKg: number;
  thirdPartyOsKg: number;
  intercoOsKg: number;
  bucket1To7Kg: number;
  bucket8To30Kg: number;
  bucketGt30Kg: number;
  osGt30Kg: number;
  pctOfTotalOs: number | null;
  topSuppliers: Array<{ supplier: string; osKg: number }>;
  carryOver: {
    labelMonth: string;
    totalKg: number;
    unplannedLateKg: number;
  } | null;
  lossAboveThreshold: Array<{ supplier: string; gainLossPct: number }>;
}

export function parseTruckingAttentionInsights(params: {
  aggregateRow: Record<string, unknown> | null | undefined;
  topSupplierRows: Record<string, unknown>[];
  carryRow: Record<string, unknown> | null | undefined;
  lossRows: Record<string, unknown>[];
  totalOutstandingKg: number | null | undefined;
}): TruckingAttentionInsightsRow {
  const row = params.aggregateRow ?? {};
  const totalOsKg = Number(row.total_os_kg ?? 0) || 0;
  const totalOutstandingKg = Number(params.totalOutstandingKg ?? 0) || 0;
  const pctOfTotalOs =
    totalOutstandingKg > 0 ? Math.round((totalOsKg / totalOutstandingKg) * 1000) / 10 : null;

  const carryTotal = Number(params.carryRow?.carry_total_kg ?? 0) || 0;
  const carryUnplanned = Number(params.carryRow?.carry_unplanned_late_kg ?? 0) || 0;
  const carryLabel = String(params.carryRow?.carry_label_month ?? '').trim();

  return {
    contractCount: parseInt(String(row.contract_count ?? '0'), 10) || 0,
    totalOsKg,
    thirdPartyOsKg: Number(row.third_party_os_kg ?? 0) || 0,
    intercoOsKg: Number(row.interco_os_kg ?? 0) || 0,
    bucket1To7Kg: Number(row.bucket_1_7_kg ?? 0) || 0,
    bucket8To30Kg: Number(row.bucket_8_30_kg ?? 0) || 0,
    bucketGt30Kg: Number(row.bucket_gt_30_kg ?? 0) || 0,
    osGt30Kg: Number(row.os_gt_30_kg ?? 0) || 0,
    pctOfTotalOs,
    topSuppliers: params.topSupplierRows
      .map((r) => ({
        supplier: String(r.supplier ?? '').trim(),
        osKg: Number(r.os_kg ?? 0) || 0,
      }))
      .filter((r) => r.supplier),
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
      .filter((r) => r.gainLossPct <= TRUCKING_LOSS_ABOVE_THRESHOLD_PCT),
  };
}
