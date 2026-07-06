/**
 * SQL qty resolution aligned with frontend resolveShipmentListDeliveredKg / resolveShipmentListReceiveKg.
 * Values are kg. Prefer KLIP manual shipment row when it differs from SAP (> 0.5 kg).
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

/** Manual fulfilled qty for shipping performance (receive kg vs delivery kg by incoterm). */
export function shippingPerfManualFulfilledQtySql(incotermExpr: string): string {
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `CASE
    WHEN ${inc} IN ('LCO', 'FOB') THEN s.quantity_delivered
    ELSE s.actual_vessel_qty_receive
  END`;
}

export function shippingPerfResolvedFulfilledQtySql(
  incotermExpr: string,
  quantityReceiveExpr: string,
  quantityDeliveredSapExpr: string,
): string {
  const sap = shippingPerfSapFulfilledQtySql(
    incotermExpr,
    quantityReceiveExpr,
    quantityDeliveredSapExpr,
  );
  const manual = shippingPerfManualFulfilledQtySql(incotermExpr);
  return `COALESCE(
    NULLIF(${shipmentManualQtyResolveSql(manual, sap)}, 0),
    NULLIF(s.actual_vessel_qty_receive::numeric, 0),
    NULLIF(s.bl_quantity::numeric, 0),
    0::numeric
  )`;
}

export function shippingPerfResolvedDeliveredQtySql(
  quantityDeliveredExpr: string,
  quantityDeliveredSapExpr: string,
): string {
  return `${shipmentManualQtyResolveSql(quantityDeliveredExpr, quantityDeliveredSapExpr)}::numeric`;
}
