/**
 * SQL qty resolution aligned with frontend
 * resolveShipmentListDeliveredKg / resolveShipmentListReceiveKg.
 *
 * Close → SAP; if SAP is missing/stub 0 → legacy header then KLIP (so OS matches View Table).
 * Open + meaningful KLIP → KLIP; else SAP (legacy last resort for delivery).
 */

/** Meaningful KLIP/manual qty: non-null and > 0. */
function sqlMeaningfulQtyKg(expr: string): string {
  return `(NULLIF(${expr}::numeric, 0) IS NOT NULL AND (${expr})::numeric > 0)`;
}

/**
 * Shipments Delivery Qty (kg): Close→SAP; Open→KLIP then SAP then optional legacy.
 */
export function sqlShipmentResolvedDeliveryKg(
  closedExpr: string,
  klipExpr: string,
  sapExpr: string,
  legacyExpr?: string,
): string {
  const sap = `NULLIF(${sapExpr}::numeric, 0)`;
  const klip = `NULLIF(${klipExpr}::numeric, 0)`;
  const legacy = legacyExpr
    ? `NULLIF(${legacyExpr}::numeric, 0)`
    : 'NULL::numeric';
  return `CASE
    WHEN COALESCE((${closedExpr}), FALSE) IS TRUE THEN
      CASE
        WHEN ${sap} IS NOT NULL THEN ${sap}
        WHEN ${legacy} IS NOT NULL THEN ${legacy}
        ELSE ${klip}
      END
    WHEN ${sqlMeaningfulQtyKg(klipExpr)} THEN ${klip}
    WHEN ${sap} IS NOT NULL THEN ${sap}
    ELSE ${legacy}
  END`;
}

/**
 * Shipments Receive Qty (kg): Close→SAP; Open→KLIP vessel receive then SAP.
 */
export function sqlShipmentResolvedReceiveKg(
  closedExpr: string,
  klipReceiveExpr: string,
  sapExpr: string,
): string {
  const sap = `NULLIF(${sapExpr}::numeric, 0)`;
  const klip = `NULLIF(${klipReceiveExpr}::numeric, 0)`;
  return `CASE
    WHEN COALESCE((${closedExpr}), FALSE) IS TRUE THEN
      CASE
        WHEN ${sap} IS NOT NULL THEN ${sap}
        ELSE ${klip}
      END
    WHEN ${sqlMeaningfulQtyKg(klipReceiveExpr)} THEN ${klip}
    WHEN ${sap} IS NOT NULL THEN ${sap}
    ELSE ${klip}
  END`;
}

/**
 * @deprecated Prefer sqlShipmentResolvedDeliveryKg / sqlShipmentResolvedReceiveKg (Open/Close).
 * Legacy: prefer manual when it differs from SAP by > 0.5 kg (Oil Loss / older OS paths).
 */
export function shipmentManualQtyResolveSql(manualExpr: string, sapExpr: string): string {
  const manual = `NULLIF(${manualExpr}::numeric, 0)`;
  const sap = `NULLIF(${sapExpr}::numeric, 0)`;
  return `CASE
    WHEN ${manual} IS NOT NULL AND ${sap} IS NOT NULL AND ABS(${manual} - ${sap}) > 0.5
      THEN ${manual}
    WHEN ${sap} IS NOT NULL
      THEN ${sap}
    ELSE COALESCE(${manual}, ${sap})
  END`;
}

/** Incoterm-based SAP fulfilled qty (Shipping Performance / outstanding). */
export function shippingPerfSapFulfilledQtySql(
  incotermExpr: string,
  quantityReceiveExpr: string,
  quantityDeliveredSapExpr: string,
): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `CASE
    WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN ${quantityReceiveExpr}
    WHEN ${inc} IN ('LCO', 'FOB') THEN ${quantityDeliveredSapExpr}
    ELSE COALESCE(NULLIF(${quantityReceiveExpr}::numeric, 0), ${quantityDeliveredSapExpr})
  END`;
}

/** Manual/KLIP fulfilled qty for shipping performance (receive kg vs delivery kg by incoterm). */
export function shippingPerfManualFulfilledQtySql(incotermExpr: string): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `CASE
    WHEN ${inc} IN ('LCO', 'FOB') THEN COALESCE(NULLIF(s.quantity_delivered_klip::numeric, 0), s.quantity_delivered)
    ELSE s.actual_vessel_qty_receive
  END`;
}

export function shippingPerfResolvedFulfilledQtySql(
  incotermExpr: string,
  quantityReceiveExpr: string,
  quantityDeliveredSapExpr: string,
  closedExpr = 'FALSE',
): string {
  const resolvedReceive = sqlShipmentResolvedReceiveKg(
    closedExpr,
    's.actual_vessel_qty_receive',
    quantityReceiveExpr,
  );
  const resolvedDelivery = sqlShipmentResolvedDeliveryKg(
    closedExpr,
    'COALESCE(NULLIF(s.quantity_delivered_klip::numeric, 0), s.quantity_delivered)',
    quantityDeliveredSapExpr,
    's.quantity_delivered',
  );
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `COALESCE(
    NULLIF(
      CASE
        WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN (${resolvedReceive})
        WHEN ${inc} IN ('LCO', 'FOB') THEN (${resolvedDelivery})
        ELSE COALESCE(NULLIF((${resolvedReceive})::numeric, 0), (${resolvedDelivery}))
      END,
      0
    ),
    NULLIF(s.actual_vessel_qty_receive::numeric, 0),
    NULLIF(s.bl_quantity::numeric, 0),
    0::numeric
  )`;
}

export function shippingPerfResolvedDeliveredQtySql(
  quantityDeliveredExpr: string,
  quantityDeliveredSapExpr: string,
  closedExpr = 'FALSE',
  klipExpr = 's.quantity_delivered_klip',
): string {
  return `(${sqlShipmentResolvedDeliveryKg(
    closedExpr,
    klipExpr,
    quantityDeliveredSapExpr,
    quantityDeliveredExpr,
  )})::numeric`;
}
