import { shipmentManualQtyResolveSql } from './shipmentManualQtyResolveSql';

/**
 * STO-level outstanding quantity (kg) using the same incoterm rules as the Contracts list:
 * CIF/CFR/FRC → Quantity Receive; FOB/LCO → Quantity Delivery; others → receive or delivery.
 */

export function shipmentOutstandingQtyExpr(opts: {
  stoQtyExpr: string;
  receiveExpr: string;
  deliveryExpr: string;
  incotermExpr: string;
}): string {
  const { stoQtyExpr, receiveExpr, deliveryExpr, incotermExpr } = opts;
  const inc = `UPPER(TRIM(COALESCE(${incotermExpr}, '')))`;
  return `GREATEST(
    COALESCE(${stoQtyExpr}, 0)::numeric
    - COALESCE(
      CASE
        WHEN ${inc} IN ('FRC', 'CIF', 'CFR') THEN ${receiveExpr}
        WHEN ${inc} IN ('LCO', 'FOB') THEN ${deliveryExpr}
        ELSE COALESCE(NULLIF(${receiveExpr}, 0), ${deliveryExpr})
      END,
      0
    ),
    0
  )`;
}

/** Outstanding qty for grouped shipments list (`shipment_page` + SAP agg). */
export function shipmentListOutstandingQtySql(
  spAlias = 'sp',
  saAlias = 'sa',
  slAlias = 'sl',
): string {
  return shipmentOutstandingQtyExpr({
    stoQtyExpr: `NULLIF(${saAlias}.sto_quantity, 0)`,
    receiveExpr: shipmentManualQtyResolveSql(
      `${spAlias}.actual_vessel_qty_receive`,
      `${saAlias}.quantity_receive`,
    ),
    deliveryExpr: shipmentManualQtyResolveSql(
      `${spAlias}.quantity_delivered`,
      `${saAlias}.quantity_delivered_sap`,
    ),
    incotermExpr: `COALESCE(${slAlias}.incoterm, ${spAlias}.incoterm)`,
  });
}
