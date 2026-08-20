/**
 * Shipments list — quantity SQL helpers.
 * Missing SAP / contract qty stays NULL (UI shows "-"), not coerced to 0.
 */

import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';

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
 * Outstanding (kg) = base qty − fulfilled.
 * Shipments / Shipping Perf OS uses Contract Qty as base (not STO Qty).
 * Fulfilled follows Open→KLIP / Close→SAP (same as Delivery/Receive columns).
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
  const diff = `(${opts.contractQtyExpr}::numeric - (${fulfilled})::numeric)`;
  const body = opts.clampAtZero ? `GREATEST(0, ${diff})` : diff;
  return `CASE
    WHEN ${opts.contractQtyExpr} IS NULL THEN NULL
    WHEN (${fulfilled}) IS NULL THEN NULL
    ELSE ${body}
  END`;
}

/** Prefer a positive qty; 0/NULL falls through so a 0 stub cannot hide SAP. */
export function sqlCoalesceNonZeroQty(preferredExpr: string, fallbackExpr: string): string {
  return `COALESCE(NULLIF((${preferredExpr})::numeric, 0), ${fallbackExpr})`;
}

/**
 * Multi-PO View Table: a partial sto_metrics/SAP value must not hide a larger
 * grouped shipment header SUM (or the reverse — take the best positive signal).
 */
export function sqlGreatestPositiveQty(exprs: string[]): string {
  const parts = exprs.map((e) => `COALESCE(NULLIF((${e})::numeric, 0), 0)`);
  return `NULLIF(GREATEST(${parts.join(', ')}), 0)`;
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

/** sto_metrics → sap_agg → shipment header → qty_move (skip 0 stubs; keep the largest positive). */
export function shipmentListSapDeliveryQtySql(spAlias = 'sp'): string {
  return sqlGreatestPositiveQty([
    'sm.delivered_qty',
    'sa.quantity_delivered_sap',
    `${spAlias}.quantity_delivered`,
    shipmentListRowQtyMoveDeliverySql(spAlias),
  ]);
}

export function shipmentListSapReceiveQtySql(spAlias = 'sp'): string {
  return sqlGreatestPositiveQty([
    'sm.received_qty',
    'sa.quantity_receive',
    `${spAlias}.actual_vessel_qty_receive`,
    shipmentListRowQtyMoveReceiveSql(spAlias),
  ]);
}

/** SELECT list fragment for shipments page qty columns (null-safe). */
export function shipmentListPageQtySelectSql(spAlias = 'sp'): string {
  const contractQtyFallback = shipmentListRowContractQtySql(spAlias);
  const contractQtyExpr = `COALESCE(sm.contract_qty, ${contractQtyFallback})`;
  const closedExpr = `COALESCE(${spAlias}.is_contract_sap_closed, FALSE)`;
  const incotermExpr = `COALESCE(NULLIF(TRIM(${spAlias}.incoterm::text), ''), NULLIF(TRIM(sl.incoterm::text), ''), '')`;
  const sapReceive = shipmentListSapReceiveQtySql(spAlias);
  const sapDelivery = shipmentListSapDeliveryQtySql(spAlias);
  const receiveResolved = sqlShipmentResolvedReceiveKg(
    closedExpr,
    `${spAlias}.actual_vessel_qty_receive`,
    sapReceive,
  );
  const deliveryResolved = sqlShipmentResolvedDeliveryKg(
    closedExpr,
    `${spAlias}.quantity_delivered_klip`,
    sapDelivery,
    `${spAlias}.quantity_delivered`,
  );
  // Same fulfilled qty as Delivery/Receive columns (do not COALESCE stub NULL to 0).
  const listOutstandingFallback = sqlShipmentListOutstandingKgExpr({
    contractQtyExpr,
    incotermExpr,
    receiveExpr: receiveResolved,
    deliveryExpr: deliveryResolved,
    clampAtZero: false,
  });
  const qtyMoveReceive = `NULLIF((SELECT qm.quantity_receive FROM qty_move qm WHERE qm.contract_number = c.contract_id)::numeric, 0)`;
  const qtyMoveDelivery = `NULLIF((SELECT COALESCE(qm.quantity_delivery_vessel, qm.quantity_delivery_trucking) FROM qty_move qm WHERE qm.contract_number = c.contract_id)::numeric, 0)`;
  const globalOutstanding = `(SELECT SUM(
    CASE
      WHEN c.quantity_ordered IS NULL THEN NULL
      ELSE (${sqlShipmentListOutstandingKgExpr({
        contractQtyExpr: 'c.quantity_ordered',
        incotermExpr: 'c.incoterm',
        receiveExpr: qtyMoveReceive,
        deliveryExpr: qtyMoveDelivery,
        clampAtZero: false,
      })})
    END
  )
  FROM contracts c
  WHERE c.contract_id IS NOT NULL
    AND ${spAlias}.contract_numbers IS NOT NULL
    AND TRIM(${spAlias}.contract_numbers) <> ''
    AND EXISTS (
      SELECT 1
      FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      WHERE TRIM(cn) = TRIM(c.contract_id)
    ))`;

  return `
        COALESCE(sm.contract_qty, ${contractQtyFallback}) AS contract_qty,
        COALESCE(sm.sto_qty, sa.sto_quantity) AS sto_quantity,
        ${sapReceive} AS quantity_receive,
        ${sapDelivery} AS quantity_delivered_sap,
        sm.planning_qty AS planning_qty,
        sm.outstanding_qty_planning AS outstanding_qty_planning,
        COALESCE((${listOutstandingFallback}), sm.outstanding_qty_actual, ${globalOutstanding}) AS outstanding_quantity`.trim();
}
