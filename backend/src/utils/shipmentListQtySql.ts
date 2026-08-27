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

/** Sum contract qty (kg) for contracts linked on a grouped shipment row. */
export function shipmentListRowContractQtySql(spAlias = 'sp'): string {
  const groupedSto = `NULLIF(TRIM(${spAlias}.sto_key::text), '')`;
  return `(
    SELECT SUM(c.quantity_ordered::numeric)
    FROM contracts c
    WHERE c.contract_id IS NOT NULL
      AND TRIM(c.contract_id) <> ''
      AND (
        (
          ${spAlias}.contract_numbers IS NOT NULL
          AND TRIM(${spAlias}.contract_numbers) <> ''
          AND EXISTS (
            SELECT 1
            FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
            WHERE TRIM(cn) = TRIM(c.contract_id)
          )
        )
        OR (
          ${groupedSto} IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM contract_stos cs
              WHERE cs.contract_id = c.id
                AND TRIM(cs.sto_number::text) = ${groupedSto}
            )
            OR TRIM(COALESCE(c.sto_number::text, '')) = ${groupedSto}
            OR EXISTS (
              SELECT 1 FROM shipments sh
              WHERE sh.contract_id = c.id
                AND COALESCE(sh.status, '') <> 'CANCELLED'
                AND (
                  NULLIF(TRIM(sh.operation_id::text), '') = ${groupedSto}
                  OR NULLIF(TRIM(sh.shipment_id::text), '') = ${groupedSto}
                )
            )
          )
        )
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
