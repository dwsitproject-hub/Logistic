/**
 * Pre-aggregated (compute-once) versions of the Trucking SAP delivery/receive
 * dedup, GR-closed check, and WB-actuals lookup normally embedded as a
 * correlated subquery per output row in `truckingListStoExpandSql.ts`.
 *
 * Each piece here is a mechanical translation of the existing per-row logic
 * (`sqlTruckingPoLevelSapQtyWithDedup` in `truckingQuantitySql.ts`,
 * `sqlIsContractSapClosedExpr` in `contractDeliveryStatus.ts`, and the WB sums
 * in `truckingWbActualSumSql.ts`) from "one contract per invocation" to a
 * `GROUP BY`/`DISTINCT ON` pass over the distinct contract / operation keys
 * already present in an expanded row-set (e.g. `expanded` in
 * `truckingListStoExpandSql.ts`). Semantics (matching rules, 1.2x/0.95x dedup
 * thresholds, MT-scale normalization) are preserved exactly — only *where*
 * the computation happens changes: once per distinct key via a JOIN, instead
 * of once per output row via a re-executed, text-duplicated subquery.
 */

import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import {
  SAP_DELIVERY_RAW_COALESCE,
  SAP_RECEIVE_RAW_COALESCE,
  sqlNormalizeSapTruckingQtyToKg,
  sqlTruckingHasDailyActualsExpr,
  sqlTruckingPoLevelSapRowMatch,
} from './truckingQuantitySql';
import { sqlWbActualDeliverySumKg, sqlWbActualReceiveSumKg } from './truckingWbActualSumSql';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

/**
 * Grouped translation of `sqlTruckingPoLevelSapQtyWithDedup`:
 * `latest_per_sto` -> `normalized` -> `metrics` -> `adj` -> final CASE,
 * computed once per distinct `(contract_id, po_number)` key
 * found in `expandedRelation`, instead of once per output row.
 *
 * Match SAP rows by the row's own contract number (`contracts.contract_id`),
 * not the list display `e.contract_number`. That display is STRING_AGG'd when
 * two LAND POs share an operation_id, so equality with sap_processed_data
 * never hits and GR Close Delivery/Receive collapse to 0.
 */
function buildSapPoDedupCte(opts: {
  cteName: string;
  rawCoalesceExpr: string;
  expandedRelation: string;
}): string {
  const { cteName, rawCoalesceExpr, expandedRelation } = opts;
  const match = sqlTruckingPoLevelSapRowMatch('k.contract_uuid', 'k.po_number', 'spd');
  const stoKey = `TRIM(COALESCE(${SPD_EFFECTIVE_STO}, spd.sto_number::text, ''))`;
  const rawQty = `NULLIF(regexp_replace(${rawCoalesceExpr}, '[^0-9\\.-]', '', 'g'), '')::numeric`;
  const rawPresent = `NULLIF(TRIM(${rawCoalesceExpr}), '') IS NOT NULL`;
  const qtyKg = sqlNormalizeSapTruckingQtyToKg('x.qty', 'x.contract_qty_kg');
  // Every step is forced MATERIALIZED: this batch only pays off if Postgres computes
  // each stage exactly once and joins the (small) result, rather than inlining the
  // CTE chain back into the outer query and re-planning it as a per-row correlated
  // subquery (which Postgres 12+ can do by default for singly-referenced CTEs and is
  // exactly the N-per-row cost this rewrite exists to eliminate).
  return `
    ${cteName}_keys AS MATERIALIZED (
      SELECT DISTINCT
        e.contract_id AS contract_uuid,
        e.po_number
      FROM ${expandedRelation} e
      WHERE e.contract_id IS NOT NULL
    ),
    ${cteName}_latest AS MATERIALIZED (
      SELECT DISTINCT ON (k.contract_uuid, ${stoKey})
        k.contract_uuid,
        COALESCE(c.quantity_ordered, 0)::numeric AS contract_qty_kg,
        ${rawQty} AS qty
      FROM ${cteName}_keys k
      INNER JOIN contracts c ON c.id = k.contract_uuid
      INNER JOIN sap_processed_data spd
        ON spd.contract_number = c.contract_id
       AND ${match}
      WHERE ${rawPresent}
      ORDER BY k.contract_uuid, ${stoKey}, spd.created_at DESC NULLS LAST
    ),
    ${cteName}_normalized AS MATERIALIZED (
      SELECT x.contract_uuid, x.contract_qty_kg, ${qtyKg} AS qty_kg
      FROM ${cteName}_latest x
      WHERE x.qty IS NOT NULL
    ),
    ${cteName}_metrics AS MATERIALIZED (
      SELECT
        contract_uuid,
        contract_qty_kg,
        COUNT(*)::int AS sto_count,
        COALESCE(SUM(qty_kg), 0)::numeric AS sum_raw,
        COALESCE(MAX(qty_kg), 0)::numeric AS max_qty
      FROM ${cteName}_normalized
      GROUP BY contract_uuid, contract_qty_kg
    ),
    ${cteName}_adj AS MATERIALIZED (
      SELECT
        m.contract_uuid,
        m.contract_qty_kg,
        m.sto_count,
        m.max_qty,
        COALESCE(SUM(n.qty_kg) FILTER (
          WHERE NOT (
            m.sto_count > 1
            AND m.sum_raw > m.contract_qty_kg * 1.2
            AND n.qty_kg >= m.contract_qty_kg * 0.95
          )
        ), 0)::numeric AS sum_adj
      FROM ${cteName}_metrics m
      INNER JOIN ${cteName}_normalized n ON n.contract_uuid = m.contract_uuid
      GROUP BY m.contract_uuid, m.contract_qty_kg, m.sto_count, m.max_qty
    ),
    ${cteName} AS MATERIALIZED (
      SELECT
        a.contract_uuid,
        CASE
          WHEN a.sto_count > 1 AND a.sum_adj > a.contract_qty_kg * 1.2 THEN a.max_qty
          ELSE a.sum_adj
        END AS qty_kg
      FROM ${cteName}_adj a
    )`;
}

/** Grouped translation of `sqlIsContractSapClosedExpr`, once per distinct contract. */
function buildGrClosedCte(expandedRelation: string): string {
  const closedExpr = sqlIsContractSapClosedExpr('c');
  return `
    gr_closed_keys AS MATERIALIZED (
      SELECT DISTINCT e.contract_id AS contract_uuid
      FROM ${expandedRelation} e
      WHERE e.contract_id IS NOT NULL
    ),
    gr_closed AS MATERIALIZED (
      SELECT
        k.contract_uuid,
        (${closedExpr}) AS is_closed
      FROM gr_closed_keys k
      INNER JOIN contracts c ON c.id = k.contract_uuid
    )`;
}

/** Grouped translation of the WB (`trucking_daily_actuals`) sums, once per distinct operation. */
function buildWbActualsCte(expandedRelation: string): string {
  const hasActuals = sqlTruckingHasDailyActualsExpr('k.operation_id');
  const wbDelivery = sqlWbActualDeliverySumKg('k.operation_id');
  const wbReceive = sqlWbActualReceiveSumKg('k.operation_id');
  return `
    wb_actuals_keys AS MATERIALIZED (
      SELECT DISTINCT e.id AS operation_id
      FROM ${expandedRelation} e
    ),
    wb_actuals AS MATERIALIZED (
      SELECT
        k.operation_id,
        ${hasActuals} AS has_actuals,
        ${wbDelivery} AS delivery_kg,
        ${wbReceive} AS receive_kg
      FROM wb_actuals_keys k
    )`;
}

/**
 * All 4 pre-aggregation CTEs (`sap_delivery_dedup`, `sap_receive_dedup`,
 * `gr_closed`, `wb_actuals`), comma-joined so callers can splice this
 * directly into an existing `WITH` chain right after `expandedRelation` is
 * defined. Must be referenced via `TRUCKING_QTY_RESOLUTION_JOIN` afterwards.
 */
export function buildTruckingQtyResolutionCtes(expandedRelation = 'expanded'): string {
  const deliveryCte = buildSapPoDedupCte({
    cteName: 'sap_delivery_dedup',
    rawCoalesceExpr: SAP_DELIVERY_RAW_COALESCE,
    expandedRelation,
  });
  const receiveCte = buildSapPoDedupCte({
    cteName: 'sap_receive_dedup',
    rawCoalesceExpr: SAP_RECEIVE_RAW_COALESCE,
    expandedRelation,
  });
  const grClosedCte = buildGrClosedCte(expandedRelation);
  const wbCte = buildWbActualsCte(expandedRelation);
  return `${deliveryCte},${receiveCte},${grClosedCte},${wbCte}`;
}

/**
 * Joins the 4 CTEs above onto the row-set aliased `e` (matches `expanded e`
 * in `truckingListStoExpandSql.ts`). Must appear after `buildTruckingQtyResolutionCtes`
 * has been spliced into the same `WITH` chain.
 */
export const TRUCKING_QTY_RESOLUTION_JOIN = `
      LEFT JOIN sap_delivery_dedup spq_d ON spq_d.contract_uuid = e.contract_id
      LEFT JOIN sap_receive_dedup spq_r ON spq_r.contract_uuid = e.contract_id
      LEFT JOIN gr_closed grc ON grc.contract_uuid = e.contract_id
      LEFT JOIN wb_actuals wb ON wb.operation_id = e.id`;

/** Column refs to feed into `sqlTruckingResolvedDeliveryQty`/`ReceiveQty` as overrides. */
export const TRUCKING_QTY_RESOLUTION_OVERRIDES = {
  grClosedExpr: 'COALESCE(grc.is_closed, false)',
  hasWbExpr: 'COALESCE(wb.has_actuals, false)',
  wbDeliveryExpr: 'COALESCE(wb.delivery_kg, 0)',
  wbReceiveExpr: 'COALESCE(wb.receive_kg, 0)',
  sapDeliveryExpr: 'spq_d.qty_kg',
  sapReceiveExpr: 'spq_r.qty_kg',
};
