/**
 * SQL helpers for resolving human-readable port names (skip numeric SAP port codes).
 */

/** PostgreSQL expression: true when the value looks like a numeric SAP port id (e.g. 22.03). */
export function isNumericPortCodeSql(valueExpr: string): string {
  return `TRIM(COALESCE(${valueExpr}, '')) ~ '^\\d+(\\.\\d+)?$'`;
}

const INVALID_PORT_LITERALS = `'', '0', '0.00'`;

/** SAP JSON paths for loading port text on an spd row alias (Shipping Performance sap_agg, etc.). */
export function sapSpdLoadingPortTextExpr(spdAlias = 'spd'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdAlias}.data->'raw'->>'Vessel Loading Port',
    ${spdAlias}.data->'raw'->>'Vessel Loading Port ',
    ${spdAlias}.data->'shipment'->>'vessel_loading_port',
    ${spdAlias}.data->'raw'->>'Vessel Loading Port 1',
    ${spdAlias}.data->'raw'->>'Vessel Loading Port 1 ',
    ${spdAlias}.data->'shipment'->>'vessel_loading_port_1'
  )), '')`;
}

/** SAP JSON paths for discharge port text on an spd row alias. */
export function sapSpdDischargePortTextExpr(spdAlias = 'spd'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdAlias}.data->'raw'->>'Vessel Discharge Port',
    ${spdAlias}.data->'raw'->>'Vessel Discharge Port ',
    ${spdAlias}.data->'shipment'->>'vessel_discharge_port',
    ${spdAlias}.data->'raw'->>'Port of Discharge',
    ${spdAlias}.data->'shipment'->>'port_of_discharge'
  )), '')`;
}

/** Latest SAP loading-port text for a contract business id (may still be numeric). */
export function sapLoadingPortTextSubquery(contractIdRef: string): string {
  return `(
    SELECT ${sapSpdLoadingPortTextExpr('spd')}
    FROM sap_processed_data spd
    WHERE spd.contract_number = ${contractIdRef}
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  )`;
}

/** Latest SAP discharge-port text for a contract business id (may still be numeric). */
export function sapDischargePortTextSubquery(contractIdRef: string): string {
  return `(
    SELECT ${sapSpdDischargePortTextExpr('spd')}
    FROM sap_processed_data spd
    WHERE spd.contract_number = ${contractIdRef}
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  )`;
}

function resolvedPortNameCase(sapTextSubquery: string): string {
  return `CASE
    WHEN ${sapTextSubquery} IS NULL THEN NULL
    WHEN TRIM(${sapTextSubquery}) IN (${INVALID_PORT_LITERALS}) THEN NULL
    WHEN ${isNumericPortCodeSql(sapTextSubquery)} THEN NULL
    ELSE TRIM(${sapTextSubquery})
  END`;
}

export function resolvedLoadingPortNameSql(contractIdRef: string): string {
  return resolvedPortNameCase(sapLoadingPortTextSubquery(contractIdRef));
}

export function resolvedDischargePortNameSql(contractIdRef: string): string {
  return resolvedPortNameCase(sapDischargePortTextSubquery(contractIdRef));
}

/** Filter clause for port name columns in UNION sources (exclude numeric SAP codes). */
export const NON_NUMERIC_PORT_NAME_FILTER = (columnRef: string): string =>
  `TRIM(COALESCE(${columnRef}, '')) NOT IN (${INVALID_PORT_LITERALS})
   AND NOT (${isNumericPortCodeSql(columnRef)})`;

/** Latest SAP Contract Ext No for a contract (+ optional PO line). */
export function contractExtNoSubquery(contractIdRef: string, poNumberRef?: string): string {
  const poMatch = poNumberRef
    ? `AND (
         NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') IS NULL
         OR NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') = NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '')
       )`
    : '';
  return `(
    SELECT NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Contract Ext No',
      spd.data->>'Contract Ext No'
    )), '')
    FROM sap_processed_data spd
    WHERE spd.contract_number = ${contractIdRef}
    ${poMatch}
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  )`;
}

/** Latest SAP plant code for a contract (+ optional PO line). */
export function sapPlantCodeSubquery(contractIdRef: string, poNumberRef?: string): string {
  const poMatch = poNumberRef
    ? `AND (
         NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') IS NULL
         OR NULLIF(TRIM(COALESCE(spd.po_number::text, '')), '') = NULLIF(TRIM(COALESCE(${poNumberRef}::text, '')), '')
       )`
    : '';
  return `(
    SELECT NULLIF(TRIM(COALESCE(
      spd.data->'contract'->>'plant_code',
      spd.data->'raw'->>'Plant Code',
      spd.data->'raw'->>'plant code'
    )), '')
    FROM sap_processed_data spd
    WHERE spd.contract_number = ${contractIdRef}
    ${poMatch}
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  )`;
}

/**
 * Resolve plant code: PO-scoped SAP row first, then contract-level SAP, then contracts column.
 */
export function resolvedPlantCodeSql(
  contractIdRef: string,
  poNumberRef: string,
  plantCodeColumnRef: string,
): string {
  return `COALESCE(
    ${sapPlantCodeSubquery(contractIdRef, poNumberRef)},
    ${sapPlantCodeSubquery(contractIdRef)},
    NULLIF(TRIM(${plantCodeColumnRef}), '')
  )`;
}
