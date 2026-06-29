/**
 * SAP raw field expressions for Oil Loss — Quantity Delivery/Receive from sap_processed_data,
 * with KLIP manual override from shipments when edited qty differs from SAP.
 * SFAL/SFBD primary from SAP raw; shipment.sfal_qty / sfbd_qty used as fallback in the controller.
 */

const sapRaw = (field: string) => `spd.data->'raw'->>'${field}'`;

/** Quantity Delivery — SAP Data only (never shipments). */
export const SAP_OIL_LOSS_QTY_DELIVERY_RAW = `COALESCE(
  NULLIF(TRIM(${sapRaw('Quantity Delivered')}), ''),
  NULLIF(TRIM(${sapRaw('Quantity Delivery')}), ''),
  NULLIF(TRIM(${sapRaw('Qty Deliver')}), ''),
  '0'
)`;

/** Quantity Receive — SAP Data only (never shipments). */
export const SAP_OIL_LOSS_QTY_RECEIVE_RAW = `COALESCE(
  NULLIF(TRIM(${sapRaw('Quantity Receive')}), ''),
  NULLIF(TRIM(${sapRaw('Qty Receive')}), ''),
  '0'
)`;

export const SAP_OIL_LOSS_QTY_DELIVERY_NUMERIC = `REPLACE(REPLACE(
  ${SAP_OIL_LOSS_QTY_DELIVERY_RAW}, ',', ''), ' ', '')::numeric`;

export const SAP_OIL_LOSS_QTY_RECEIVE_NUMERIC = `REPLACE(REPLACE(
  ${SAP_OIL_LOSS_QTY_RECEIVE_RAW}, ',', ''), ' ', '')::numeric`;

/** Row must have parseable SAP delivery & receive quantities. */
export const SAP_OIL_LOSS_QTY_WHERE_CLAUSE = `
  NULLIF(TRIM(COALESCE(
    ${sapRaw('Quantity Delivered')},
    ${sapRaw('Quantity Delivery')},
    ${sapRaw('Qty Deliver')}
  )), '') IS NOT NULL
  AND NULLIF(TRIM(COALESCE(
    ${sapRaw('Quantity Receive')},
    ${sapRaw('Qty Receive')}
  )), '') IS NOT NULL
  AND REPLACE(REPLACE(${SAP_OIL_LOSS_QTY_RECEIVE_RAW}, ',', ''), ' ', '') ~ '^[0-9.]+$'
  AND REPLACE(REPLACE(${SAP_OIL_LOSS_QTY_DELIVERY_RAW}, ',', ''), ' ', '') ~ '^[0-9.]+$'
`;

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

export const SAP_SFAL_NUMERIC_EXPR = `CASE
  WHEN ${SAP_SFAL_RAW_EXPR} ~ '^[0-9.]+$'
  THEN ${SAP_SFAL_RAW_EXPR}::numeric
  ELSE NULL
END`;

export const SAP_SFBD_NUMERIC_EXPR = `CASE
  WHEN ${SAP_SFBD_RAW_EXPR} ~ '^[0-9.]+$'
  THEN ${SAP_SFBD_RAW_EXPR}::numeric
  ELSE NULL
END`;

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
