/**
 * Shipments list — quantity SQL helpers.
 * Missing SAP / contract qty stays NULL (UI shows "-"), not coerced to 0.
 */

import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';
import { sqlSapQtyDeliveredAnyFromSpd } from './contractLogisticsStoDetailSql';
import { sqlCoalesceSapRawQtyFields } from './sapQtyPlaceholderSql';
import { sapStoNumberKeyExpr } from './shipmentStoTypeSql';
import { sqlSapIncotermFromJsonb } from './sapSourceTypeSql';
import { shipmentListRowGlobalOutstandingSql } from './shipmentOutstandingQtySql';

/**
 * Sum contract qty (kg) for contracts linked on a grouped shipment row.
 *
 * Candidates are gathered *from* each source by index and then summed, rather than scanning
 * `contracts` and testing an OR per row. The old shape could not use any index for that OR, and
 * EXPLAIN (ANALYZE, BUFFERS) on the Shipments summary query showed it as the single remaining
 * full scan: `Seq Scan on contracts c_2 ... Rows Removed by Filter: 18749, loops=463,
 * Buffers: shared hit=628667` - 37% of that query's 1,719,396 buffers.
 *
 * Set-equivalent by construction: `A OR B` over `contracts` sums exactly the contracts whose id
 * lies in (ids satisfying A) union (ids satisfying B). Each branch extracts the ids the matching
 * EXISTS tested for, and a NULL `contract_id` on either side drops the row in both shapes.
 *
 * The one rewritten predicate: `TRIM(COALESCE(c.sto_number::text, '')) = <sto>` becomes
 * `NULLIF(TRIM(cb.sto_number::text), '') = <sto>` so `idx_contracts_sto_number_trim` can serve
 * it. They agree for every value this receives: `<sto>` is `NULLIF(TRIM(...), '')`, so it is NULL
 * or non-empty, and the branch is guarded on it being non-NULL.
 *
 * Indexes each branch relies on: idx_contracts_contract_id_trim,
 * idx_contract_stos_sto_number_trim (migration 160), idx_contracts_sto_number_trim,
 * idx_shipments_trim_operation_id and idx_shipments_trim_shipment_id (migration 155). The
 * operation_id / shipment_id OR is split into two UNION branches so each uses its own index.
 */
export function shipmentListRowContractQtySql(spAlias = 'sp'): string {
  const groupedSto = `NULLIF(TRIM(${spAlias}.sto_key::text), '')`;
  return `(
    SELECT SUM(c.quantity_ordered::numeric)
    FROM contracts c
    WHERE c.contract_id IS NOT NULL
      AND TRIM(c.contract_id) <> ''
      AND c.id IN (
          SELECT ca.id
          FROM contracts ca
          WHERE ${spAlias}.contract_numbers IS NOT NULL
            AND TRIM(${spAlias}.contract_numbers) <> ''
            AND TRIM(ca.contract_id) IN (
              SELECT TRIM(cn)
              FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\s*,\s*')) AS cn
            )
        UNION
          SELECT cs.contract_id
          FROM contract_stos cs
          WHERE ${groupedSto} IS NOT NULL
            AND TRIM(cs.sto_number::text) = ${groupedSto}
        UNION
          SELECT cb.id
          FROM contracts cb
          WHERE ${groupedSto} IS NOT NULL
            AND NULLIF(TRIM(cb.sto_number::text), '') = ${groupedSto}
        UNION
          SELECT sh_op.contract_id
          FROM shipments sh_op
          WHERE ${groupedSto} IS NOT NULL
            AND COALESCE(sh_op.status, '') <> 'CANCELLED'
            AND NULLIF(TRIM(sh_op.operation_id::text), '') = ${groupedSto}
        UNION
          SELECT sh_id.contract_id
          FROM shipments sh_id
          WHERE ${groupedSto} IS NOT NULL
            AND COALESCE(sh_id.status, '') <> 'CANCELLED'
            AND NULLIF(TRIM(sh_id.shipment_id::text), '') = ${groupedSto}
      )
  )`;
}

/** Incoterm fulfilled kg for list metrics — NULL when the chosen SAP field is NULL. */
export function sqlShipmentListFulfilledKgCase(
  incotermExpr: string,
  receiveExpr: string,
  deliveryExpr: string,
): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `CASE
    WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN ${receiveExpr}
    WHEN ${inc} IN ('LCO', 'FOB') THEN ${deliveryExpr}
    ELSE COALESCE(${receiveExpr}, ${deliveryExpr})
  END`;
}

/**
 * OS base qty (kg) for Shipping Perf STO metrics / Edit Shipment STO-scoped OS.
 * Default: Contract Qty (1 STO × N POs).
 * When one PO has several parallel SAP STOs, use STO Qty so the PO commitment
 * is not copied onto every line (PO 1581000931 / STOs 4927–4929).
 * Shipments View Table OS does not use this — parallel STOs show PO-level OS instead.
 */
export function sqlShipmentListOsBaseQtyExpr(opts: {
  poStoCountExpr: string;
  stoQtyExpr: string;
  contractQtyExpr: string;
}): string {
  return `CASE
    WHEN COALESCE((${opts.poStoCountExpr})::int, 1) > 1
      THEN COALESCE(NULLIF((${opts.stoQtyExpr})::numeric, 0), (${opts.contractQtyExpr})::numeric)
    ELSE (${opts.contractQtyExpr})::numeric
  END`;
}

/**
 * Outstanding (kg) = Contract Qty − fulfilled (Open→KLIP / Close→SAP).
 * Missing Delivery/Receive (null) counts as 0 so View Table OS is numeric, not "-".
 * Callers that need PO-level OS on parallel STO rows should wrap this with
 * sqlShipmentListViewTableOutstandingKgExpr instead of changing the base qty.
 */
export function sqlShipmentListOutstandingKgExpr(opts: {
  contractQtyExpr: string;
  incotermExpr: string;
  receiveExpr: string;
  deliveryExpr: string;
  clampAtZero?: boolean;
}): string {
  const fulfilled = sqlShipmentListFulfilledKgCase(
    opts.incotermExpr,
    opts.receiveExpr,
    opts.deliveryExpr,
  );
  const diff = `(${opts.contractQtyExpr}::numeric - COALESCE((${fulfilled})::numeric, 0))`;
  const body = opts.clampAtZero ? `GREATEST(0, ${diff})` : diff;
  return `CASE
    WHEN ${opts.contractQtyExpr} IS NULL THEN NULL
    ELSE ${body}
  END`;
}

/**
 * Grouped View Table: if every PO copied the same vessel qty, keep MAX;
 * if POs have different qtys, SUM.
 */
export function sqlGroupedMaybeCopiedQty(expr: string): string {
  return `CASE
    WHEN COUNT(*) FILTER (WHERE NULLIF((${expr})::numeric, 0) IS NOT NULL) <= 1
      THEN MAX(${expr})
    WHEN MIN(NULLIF((${expr})::numeric, 0)) IS NOT DISTINCT FROM MAX(NULLIF((${expr})::numeric, 0))
      THEN MAX(${expr})
    ELSE SUM(${expr})
  END`;
}

/** Prefer a positive qty; 0/NULL falls through so a 0 stub cannot hide SAP. */
export function sqlCoalesceNonZeroQty(preferredExpr: string, fallbackExpr: string): string {
  return `COALESCE(NULLIF((${preferredExpr})::numeric, 0), ${fallbackExpr})`;
}

/** First non-zero wins (sto_metrics before grouped header SUM / qty_move). */
export function sqlCoalesceNonZeroChain(exprs: string[]): string {
  if (exprs.length === 0) {
    return 'NULL::numeric';
  }
  let acc = exprs[exprs.length - 1];
  for (let i = exprs.length - 2; i >= 0; i -= 1) {
    acc = sqlCoalesceNonZeroQty(exprs[i], acc);
  }
  return acc;
}

function shipmentListRowQtyMoveScalarSql(spAlias: string, columnSql: string): string {
  return `(
    SELECT SUM(${columnSql})
    FROM contracts c
    INNER JOIN qty_move qm ON qm.contract_number = c.contract_id
    WHERE c.contract_id IS NOT NULL
      AND TRIM(c.contract_id) <> ''
      AND ${spAlias}.contract_numbers IS NOT NULL
      AND TRIM(${spAlias}.contract_numbers) <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
        WHERE TRIM(cn) = TRIM(c.contract_id)
      )
  )`;
}

/** Contract-grain qty_move delivery (vessel then trucking) for list-row SAP fallback. */
export function shipmentListRowQtyMoveDeliverySql(spAlias = 'sp'): string {
  return shipmentListRowQtyMoveScalarSql(
    spAlias,
    'COALESCE(qm.quantity_delivery_vessel, qm.quantity_delivery_trucking)',
  );
}

/** Contract-grain qty_move receive for list-row SAP fallback. */
export function shipmentListRowQtyMoveReceiveSql(spAlias = 'sp'): string {
  return shipmentListRowQtyMoveScalarSql(spAlias, 'qm.quantity_receive');
}

/** True when list row sto_key is a real SAP STO (not KLIP OP-/MNL-/MSEA-). */
export function shipmentListHasRealSapStoKeySql(spAlias = 'sp'): string {
  return `(
    NULLIF(TRIM(COALESCE(${spAlias}.sto_key::text, '')), '') IS NOT NULL
    AND TRIM(${spAlias}.sto_key::text) !~ '^(OP-|MNL-|MSEA-)'
  )`;
}

/**
 * Per-STO SAP Quantity Receive (kg) — same grain as Edit Shipment modal / sap_agg primary match.
 * Used when sto_metrics / sap_agg joins miss (shell hydrate) so KLIP 0 cannot blank the SAP column.
 */
export function shipmentListStoScopedSapReceiveSql(spAlias = 'sp'): string {
  return `(
    SELECT SUM(
      NULLIF(regexp_replace(COALESCE(
        ${sqlCoalesceSapRawQtyFields([
          `spd.data->'raw'->>'Quantity Receive'`,
          `spd.data->'raw'->>'Qty Receive'`,
          `spd.data->'shipment'->>'quantity_receive'`,
          `spd.data->'contract'->>'quantity_receive'`,
        ])},
        ''
      ), '[^0-9\\.-]', '', 'g'), '')::numeric
    )
    FROM sap_processed_data spd
    WHERE ${sapStoNumberKeyExpr('spd')} = TRIM(${spAlias}.sto_key::text)
  )`;
}

/** Per-STO SAP delivery (kg) via incoterm matrix — vessel for CIF/FOB, not dirty trucking. */
export function shipmentListStoScopedSapDeliverySql(spAlias = 'sp'): string {
  return `(
    SELECT SUM(${sqlSapQtyDeliveredAnyFromSpd('spd', sqlSapIncotermFromJsonb('spd.data'))})
    FROM sap_processed_data spd
    WHERE ${sapStoNumberKeyExpr('spd')} = TRIM(${spAlias}.sto_key::text)
  )`;
}

/**
 * KLIP receive for a View Table STO row: one qty per PO/contract (sto_shipment_klip)
 * then SUM — same grain as Edit Shipment Grand Total.
 * Falls back to grouped header actual_vessel_qty_receive (maybeCopied MAX) before hydrate.
 */
export function shipmentListKlipReceiveKgExpr(spAlias = 'sp'): string {
  return sqlCoalesceNonZeroQty('sm.klip_receive_kg', `${spAlias}.actual_vessel_qty_receive`);
}

/** KLIP delivery — same per-PO-then-SUM grain as receive. */
export function shipmentListKlipDeliveryKgExpr(spAlias = 'sp'): string {
  return sqlCoalesceNonZeroQty('sm.klip_delivery_kg', `${spAlias}.quantity_delivered_klip`);
}

/**
 * SAP receive for list `quantity_receive` column (KLIP vessel receive is NOT mixed in —
 * Open/Close resolve uses actual_vessel_qty_receive separately).
 * Real SAP STO: sto_metrics → sap_agg → sto-scoped SAP subquery (never PO-wide qty_move).
 * 1 PO × several STOs: skip the unscoped SPD SUM (history / PO-level copies).
 * Synthetic OP-/MNL keys: allow qty_move contract fallback.
 */
export function shipmentListSapDeliveryQtySql(spAlias = 'sp'): string {
  const stoScoped = shipmentListStoScopedSapDeliverySql(spAlias);
  const siblingSto = sqlCoalesceNonZeroChain([
    'sm.delivered_qty',
    'sa.quantity_delivered_sap',
  ]);
  const perSto = sqlCoalesceNonZeroChain([
    'sm.delivered_qty',
    'sa.quantity_delivered_sap',
    stoScoped,
  ]);
  const withQtyMove = sqlCoalesceNonZeroChain([
    'sm.delivered_qty',
    'sa.quantity_delivered_sap',
    stoScoped,
    shipmentListRowQtyMoveDeliverySql(spAlias),
  ]);
  return `CASE
    WHEN ${shipmentListHasRealSapStoKeySql(spAlias)}
      AND COALESCE((sm.po_sto_count)::int, 1) > 1 THEN (${siblingSto})
    WHEN ${shipmentListHasRealSapStoKeySql(spAlias)} THEN (${perSto})
    ELSE (${withQtyMove})
  END`;
}

export function shipmentListSapReceiveQtySql(spAlias = 'sp'): string {
  const stoScoped = shipmentListStoScopedSapReceiveSql(spAlias);
  const siblingSto = sqlCoalesceNonZeroChain([
    'sm.received_qty',
    'sa.quantity_receive',
  ]);
  const perSto = sqlCoalesceNonZeroChain([
    'sm.received_qty',
    'sa.quantity_receive',
    stoScoped,
  ]);
  const withQtyMove = sqlCoalesceNonZeroChain([
    'sm.received_qty',
    'sa.quantity_receive',
    stoScoped,
    shipmentListRowQtyMoveReceiveSql(spAlias),
  ]);
  return `CASE
    WHEN ${shipmentListHasRealSapStoKeySql(spAlias)}
      AND COALESCE((sm.po_sto_count)::int, 1) > 1 THEN (${siblingSto})
    WHEN ${shipmentListHasRealSapStoKeySql(spAlias)} THEN (${perSto})
    ELSE (${withQtyMove})
  END`;
}

/** SELECT list fragment for shipments page qty columns (null-safe). */
export function shipmentListPageQtySelectSql(spAlias = 'sp'): string {
  const contractQtyFallback = shipmentListRowContractQtySql(spAlias);
  const contractQtyExpr = `COALESCE(sm.contract_qty, ${contractQtyFallback})`;
  const closedExpr = `COALESCE(${spAlias}.is_contract_sap_closed, FALSE)`;
  const incotermExpr = `COALESCE(NULLIF(TRIM(${spAlias}.incoterm::text), ''), NULLIF(TRIM(sl.incoterm::text), ''), '')`;
  const sapReceive = shipmentListSapReceiveQtySql(spAlias);
  const sapDelivery = shipmentListSapDeliveryQtySql(spAlias);
  const klipReceive = shipmentListKlipReceiveKgExpr(spAlias);
  const klipDelivery = shipmentListKlipDeliveryKgExpr(spAlias);
  const receiveResolved = sqlShipmentResolvedReceiveKg(
    closedExpr,
    klipReceive,
    sapReceive,
  );
  const deliveryResolved = sqlShipmentResolvedDeliveryKg(
    closedExpr,
    klipDelivery,
    sapDelivery,
    `${spAlias}.quantity_delivered`,
  );
  // Same fulfilled qty as Delivery/Receive columns; null fulfilled → 0 (OS = contract qty).
  const listOutstandingFallback = sqlShipmentListOutstandingKgExpr({
    contractQtyExpr,
    incotermExpr,
    receiveExpr: receiveResolved,
    deliveryExpr: deliveryResolved,
    clampAtZero: false,
  });
  // PO-grain OS (qty_move) — same as Contracts / status cards / Section OS Qty.
  // Repeated on every sibling STO row when po_sto_count > 1 (UI only; cards stay 1×).
  const poLevelOutstanding = shipmentListRowGlobalOutstandingSql(spAlias);

  return `
        COALESCE(sm.contract_qty, ${contractQtyFallback}) AS contract_qty,
        COALESCE(sm.sto_qty, sa.sto_quantity) AS sto_quantity,
        ${klipReceive} AS klip_receive_qty,
        ${klipDelivery} AS klip_delivery_qty,
        ${sapReceive} AS quantity_receive,
        ${sapDelivery} AS quantity_delivered_sap,
        sm.planning_qty AS planning_qty,
        sm.outstanding_qty_planning AS outstanding_qty_planning,
        CASE
          WHEN COALESCE((sm.po_sto_count)::int, 1) > 1
            THEN (${poLevelOutstanding})
          ELSE COALESCE((${listOutstandingFallback}), sm.outstanding_qty_actual, ${poLevelOutstanding})
        END AS outstanding_quantity`.trim();
}
