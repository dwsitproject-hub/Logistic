/**
 * SAP raw field expressions for Oil Loss — Quantity Delivery/Receive from sap_processed_data,
 * aligned with SAP UAT incoterm matrix (Quantity Delivery Trucking / Vessel).
 * SFAL/SFBD primary from SAP raw; shipment.sfal_qty / sfbd_qty used as fallback in the controller.
 */

import {
  sqlIncotermImportStatusFromJson,
  sqlUatQuantityDeliveryCase,
} from './sapIncotermMetrics';
import { sqlCoalesceSapRawQtyFields } from './sapQtyPlaceholderSql';

const sapRaw = (field: string) => `spd.data->'raw'->>'${field}'`;

/**
 * Strip thousands separators then CAST only when the remainder is a single number.
 * Unguarded `::numeric` on SAP text (N/A, 1.2.3, "123 MT") raises 22P02 and 500s the page.
 */
export function sqlSafeSapNumericCast(valueExpr: string): string {
  const cleaned = `REPLACE(REPLACE(TRIM(COALESCE((${valueExpr}), '')), ',', ''), ' ', '')`;
  return `(CASE
    WHEN ${cleaned} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${cleaned})::numeric
    ELSE NULL
  END)`;
}

/** SAP incoterm on row (before contracts join). */
export const SAP_OIL_LOSS_INCOTERM_RAW_EXPR = `COALESCE(
  NULLIF(TRIM(${sapRaw('Incoterm')}), ''),
  NULLIF(TRIM(spd.data->'contract'->>'incoterm'), ''),
  ''
)`;

/** UAT import status (GR PO vs GR STO) from SAP JSON + raw incoterm. */
export const SAP_OIL_LOSS_IMPORT_STATUS_EXPR = sqlIncotermImportStatusFromJson(
  'spd.data',
  SAP_OIL_LOSS_INCOTERM_RAW_EXPR,
);

/** Quantity Delivery Trucking — SAP UAT field. Skip "0" placeholders so Quantity Delivery can win. */
export const SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC = sqlSafeSapNumericCast(
  sqlCoalesceSapRawQtyFields([
    `spd.data->'raw'->>'Quantity Delivery Trucking'`,
    `spd.data->'raw'->>'Quantity Delivered Trucking'`,
    `spd.data->'raw'->>'Quantity Delivered via Trucking'`,
    `spd.data->>'quantity_delivered_via_trucking'`,
    `spd.data->'shipment'->>'quantity_delivery_trucking'`,
    `spd.data->'contract'->>'quantity_delivery_trucking'`,
    `spd.data->'raw'->>'Quantity Delivery'`,
  ]),
);

/** Quantity Delivery Vessel — SAP UAT field. */
export const SAP_OIL_LOSS_QTY_VESSEL_NUMERIC = sqlSafeSapNumericCast(
  sqlCoalesceSapRawQtyFields([
    `spd.data->'raw'->>'Quantity Delivery Vessel'`,
    `spd.data->'raw'->>'Quantity Delivered'`,
    `spd.data->'raw'->>'Quantity Delivery'`,
    `spd.data->'shipment'->>'quantity_delivery'`,
    `spd.data->'contract'->>'quantity_delivery'`,
  ]),
);

/** Legacy generic delivery (pre-UAT SAP templates). */
export const SAP_OIL_LOSS_QTY_DELIVERY_RAW = `COALESCE(
  ${sqlCoalesceSapRawQtyFields([
    sapRaw('Quantity Delivered'),
    sapRaw('Quantity Delivery'),
    sapRaw('Qty Deliver'),
  ])},
  '0'
)`;

export const SAP_OIL_LOSS_QTY_DELIVERY_LEGACY_NUMERIC = sqlSafeSapNumericCast(
  SAP_OIL_LOSS_QTY_DELIVERY_RAW,
);

/** Quantity Receive — SAP Data only (never shipments). */
export const SAP_OIL_LOSS_QTY_RECEIVE_RAW = `COALESCE(
  ${sqlCoalesceSapRawQtyFields([
    sapRaw('Quantity Receive'),
    sapRaw('Qty Receive'),
  ])},
  '0'
)`;

export const SAP_OIL_LOSS_QTY_RECEIVE_NUMERIC = sqlSafeSapNumericCast(SAP_OIL_LOSS_QTY_RECEIVE_RAW);

/** Contract / PO qty from SAP raw — display fallback when contracts.quantity_ordered is missing. */
export const SAP_OIL_LOSS_QTY_CONTRACT_NUMERIC = sqlSafeSapNumericCast(`COALESCE(
  spd.data->'raw'->>'Contract Quantity\r\n(or PO Qty)',
  spd.data->'raw'->>'Contract Quantity',
  ''
)`);

const SAP_NUMERIC_TOKEN = `'^-?[0-9]+(\\.[0-9]+)?$'`;

const legacyDeliveryValid = `
  NULLIF(TRIM(COALESCE(
    ${sapRaw('Quantity Delivered')},
    ${sapRaw('Quantity Delivery')},
    ${sapRaw('Qty Deliver')}
  )), '') IS NOT NULL
  AND REPLACE(REPLACE(${SAP_OIL_LOSS_QTY_DELIVERY_RAW}, ',', ''), ' ', '') ~ ${SAP_NUMERIC_TOKEN}`;

/** Row must have parseable SAP receive + at least one delivery source (UAT or legacy). */
export const SAP_OIL_LOSS_QTY_WHERE_CLAUSE = `
  NULLIF(TRIM(COALESCE(
    ${sapRaw('Quantity Receive')},
    ${sapRaw('Qty Receive')}
  )), '') IS NOT NULL
  AND REPLACE(REPLACE(${SAP_OIL_LOSS_QTY_RECEIVE_RAW}, ',', ''), ' ', '') ~ ${SAP_NUMERIC_TOKEN}
  AND (
    COALESCE(${SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC}, 0) > 0
    OR COALESCE(${SAP_OIL_LOSS_QTY_VESSEL_NUMERIC}, 0) > 0
    OR (${legacyDeliveryValid})
  )`;

/** Incoterm-aware quantity delivery on enriched row columns (Kg). */
export function sqlOilLossUatQtyDeliveryExpr(opts: {
  incotermExpr: string;
  transportExpr: string;
  truckingCol: string;
  vesselCol: string;
  legacyCol: string;
}): string {
  const uat = sqlUatQuantityDeliveryCase({
    incotermExpr: opts.incotermExpr,
    transportExpr: opts.transportExpr,
    truckingQtyExpr: opts.truckingCol,
    vesselQtyExpr: opts.vesselCol,
  });
  return `CASE
    WHEN COALESCE((${uat}), 0) > 0 THEN COALESCE((${uat}), 0)
    ELSE COALESCE(${opts.legacyCol}, 0)
  END`;
}

export const SAP_SFAL_RAW_EXPR = `REPLACE(REPLACE(COALESCE(
  ${sapRaw(' Ship Figure After Loading (SFAL) ')},
  ${sapRaw('Ship Figure After Loading (SFAL)')},
  ''
), ',', ''), ' ', '')`;

export const SAP_SFBD_RAW_EXPR = `REPLACE(REPLACE(COALESCE(
  ${sapRaw(' Ship Figure Before Discharge (SFBD) ')},
  ${sapRaw('Ship Figure Before Discharge (SFBD)')},
  ''
), ',', ''), ' ', '')`;

export const SAP_SFAL_NUMERIC_EXPR = sqlSafeSapNumericCast(`COALESCE(
  ${sapRaw(' Ship Figure After Loading (SFAL) ')},
  ${sapRaw('Ship Figure After Loading (SFAL)')},
  ''
)`);

export const SAP_SFBD_NUMERIC_EXPR = sqlSafeSapNumericCast(`COALESCE(
  ${sapRaw(' Ship Figure Before Discharge (SFBD) ')},
  ${sapRaw('Ship Figure Before Discharge (SFBD)')},
  ''
)`);

/** Truck transporter — primary SAP field: Truck Transporter. */
export const SAP_OIL_LOSS_TRUCK_TRANSPORTER_RAW = `COALESCE(
  NULLIF(TRIM(${sapRaw('Truck Transporter')}), ''),
  NULLIF(TRIM(${sapRaw('Trucking Owner at Starting Location')}), ''),
  ''
)`;

/** Vessel transporter label — primary SAP field: Vessel Name. */
export const SAP_OIL_LOSS_VESSEL_NAME_RAW = `COALESCE(
  NULLIF(TRIM(${sapRaw('Vessel Name')}), ''),
  NULLIF(TRIM(${sapRaw('vessel name')}), ''),
  ''
)`;

/** SFAL/SFBD: SAP raw first, then shipments.sfal_qty / sfbd_qty (Kg). */
export const OIL_LOSS_SFAL_QTY_EXPR = `COALESCE(qty_sfal_raw, shipment_sfal_kg)`;
export const OIL_LOSS_SFBD_QTY_EXPR = `COALESCE(qty_sfbd_raw, shipment_sfbd_kg)`;
