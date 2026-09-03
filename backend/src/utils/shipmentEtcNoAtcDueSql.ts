/**
 * Shipments page — Pending ATC (Overdue / Due ≤7d) KPI.
 * Count + OS Qty for execution rows with no ATC and due end on or before today+7
 * (all overdue + due within 7 days). Excludes Completed / Cancelled.
 */

import { shipmentListQtyMoveCteFromPage } from './shipmentOutstandingQtySql';
import {
  sqlShipmentExecutionOsPerContractCtes,
  sqlShipmentSection1LightExecutionEnrichSelect,
} from './shipmentOutstandingQtySummarySql';
import { shipmentEffectiveStatusExpr } from './shipmentListFilters';

/** Inclusive forward horizon on due date delivery end (excludes due > today+7). */
export const ETC_NO_ATC_DUE_HORIZON_DAYS = 7;

export interface ShipmentEtcNoAtcDueWithin7d {
  count: number;
  outstandingQtyKg: number;
}

export const EMPTY_SHIPMENT_ETC_NO_ATC_DUE_WITHIN_7D: ShipmentEtcNoAtcDueWithin7d = {
  count: 0,
  outstandingQtyKg: 0,
};

/** ATC = ATA Vessel Complete Discharge (effective: override + shipment + VLP). */
export function sqlShipmentListAtcDateExpr(alias = 'fs'): string {
  return `${alias}.ata_vessel_complete_discharge::date`;
}

/**
 * ATC null, due delivery end <= today+7 (overdue + due within 7d).
 * Excludes pipeline COMPLETED and CANCELLED (same effective status as Section 1 cards).
 * Uses shipment_base / filtered row columns (no latest_spd_data).
 */
export function sqlShipmentEtcNoAtcDueWithin7dPred(alias = 'fs'): string {
  const atc = sqlShipmentListAtcDateExpr(alias);
  return `(
    ${atc} IS NULL
    AND ${alias}.delivery_end_date IS NOT NULL
    AND ${alias}.delivery_end_date::date <= (CURRENT_DATE + ${ETC_NO_ATC_DUE_HORIZON_DAYS})
    AND ${shipmentEffectiveStatusExpr(alias)} NOT IN ('COMPLETED', 'CANCELLED')
  )`;
}

export function isShipmentEtcNoAtcDueWithin7dListFilter(
  enabled: boolean | string | undefined,
): boolean {
  return (
    enabled === true ||
    String(enabled ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

/** List-only outer filter (alias `sb` = shipment_base). */
export function appendShipmentEtcNoAtcDueWithin7dFilter(
  enabled: boolean | string | undefined,
): { sql: string } {
  if (!isShipmentEtcNoAtcDueWithin7dListFilter(enabled)) return { sql: '' };
  return { sql: ` AND ${sqlShipmentEtcNoAtcDueWithin7dPred('sb')}` };
}

export function parseShipmentEtcNoAtcDueWithin7dRow(
  row: Record<string, unknown> | undefined | null,
): ShipmentEtcNoAtcDueWithin7d {
  if (!row) return { ...EMPTY_SHIPMENT_ETC_NO_ATC_DUE_WITHIN_7D };
  return {
    count: Number(row.etc_no_atc_due_within_7d_count ?? 0) || 0,
    outstandingQtyKg: Number(row.etc_no_atc_due_within_7d_outstanding_qty ?? 0) || 0,
  };
}

/**
 * Toolbar-scoped aggregate: matching shipment group count + OS kg (qty_move / execution_os).
 */
export function buildShipmentEtcNoAtcDueWithin7dQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
): string {
  const pred = sqlShipmentEtcNoAtcDueWithin7dPred('fs');
  return `
    ${shipmentBaseCteSql},
    filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${toolbarOuterSql}
        AND COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'
    ),
    matching_page AS (
      SELECT fs.*
      FROM filtered_shipments fs
      WHERE ${pred}
    ),
    shipment_page AS (
      SELECT mp.*
      FROM matching_page mp
    ),
    ${shipmentListQtyMoveCteFromPage()},
    enriched AS (
      SELECT
        ${sqlShipmentSection1LightExecutionEnrichSelect('sp')}
      FROM shipment_page sp
    ),
    ${sqlShipmentExecutionOsPerContractCtes('enriched')}
    SELECT
      (SELECT COUNT(*)::bigint FROM matching_page) AS etc_no_atc_due_within_7d_count,
      COALESCE(
        (SELECT SUM(COALESCE(outstanding_quantity, 0)) FROM execution_os),
        0
      )::numeric AS etc_no_atc_due_within_7d_outstanding_qty`;
}
