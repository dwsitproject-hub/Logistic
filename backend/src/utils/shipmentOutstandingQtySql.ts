import {
  sqlShipmentResolvedDeliveryKg,
  sqlShipmentResolvedReceiveKg,
} from './shipmentManualQtyResolveSql';
import {
  buildQtyMoveCte,
  sqlContractGlobalOutstandingExpr,
} from './contractGlobalOutstandingSql';

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
  const closed = `COALESCE(${spAlias}.is_contract_sap_closed, FALSE)`;
  return shipmentOutstandingQtyExpr({
    stoQtyExpr: `NULLIF(${saAlias}.sto_quantity, 0)`,
    receiveExpr: sqlShipmentResolvedReceiveKg(
      closed,
      `${spAlias}.actual_vessel_qty_receive`,
      `${saAlias}.quantity_receive`,
    ),
    deliveryExpr: sqlShipmentResolvedDeliveryKg(
      closed,
      `${spAlias}.quantity_delivered_klip`,
      `${saAlias}.quantity_delivered_sap`,
      `${spAlias}.quantity_delivered`,
    ),
    incotermExpr: `COALESCE(${slAlias}.incoterm, ${spAlias}.incoterm)`,
  });
}

/** Page-scoped qty_move for shipments list (contracts on current page only). */
export function shipmentListQtyMoveCteFromPage(pageCte = 'shipment_page'): string {
  return buildQtyMoveCte({
    kind: 'in_subquery',
    subquery: `SELECT DISTINCT TRIM(cn) AS contract_number
      FROM ${pageCte} sp
      CROSS JOIN LATERAL unnest(regexp_split_to_array(sp.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
      WHERE sp.contract_numbers IS NOT NULL
        AND TRIM(sp.contract_numbers) <> ''
        AND TRIM(cn) <> ''`,
  });
}

/**
 * Sum contract-global outstanding (kg) for all contracts on a grouped list row —
 * same rules as Edit Shipment modal / GET /shipments/contracts/details.
 */
export function shipmentListRowGlobalOutstandingSql(spAlias = 'sp'): string {
  const perContract = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    contractNumberExpr: 'c.contract_id',
  });
  return `COALESCE((
    SELECT SUM(${perContract})
    FROM contracts c
    WHERE c.contract_id IS NOT NULL
      AND ${spAlias}.contract_numbers IS NOT NULL
      AND TRIM(${spAlias}.contract_numbers) <> ''
      AND EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(${spAlias}.contract_numbers, E'\\\\s*,\\\\s*')) AS cn
        WHERE TRIM(cn) = TRIM(c.contract_id)
      )
  ), 0)`;
}
