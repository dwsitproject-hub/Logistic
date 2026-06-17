/**
 * SAP STO Type helpers — shared JSON field expressions.
 * Shipments page: STO Type 'V' (vessel).
 * Shipping Performance: transport mode SEA/MIX only (no STO Type filter).
 * Trucking page: STO Type 'T' — see truckingStoTypeSql.ts.
 */

export const SHIPMENTS_PAGE_SAP_STO_TYPE_V = 'V';

/** Normalized STO Type from sap_processed_data JSON. */
export const sapStoTypeNormalizedExpr = (spdAlias = 'spd'): string => `
  UPPER(TRIM(COALESCE(
    ${spdAlias}.data->'raw'->>'STO Type',
    ${spdAlias}.data->'raw'->>'STO Type ',
    ${spdAlias}.data->'contract'->>'sto_type',
    ${spdAlias}.data->'shipment'->>'sto_type',
    ''
  )))
`;

/** STO number key extracted from a sap_processed_data row. */
export const sapStoNumberKeyExpr = (spdAlias = 'spd'): string => `
  NULLIF(TRIM(COALESCE(
    ${spdAlias}.sto_number::text,
    ${spdAlias}.data->'raw'->>'STO No.',
    ${spdAlias}.data->'raw'->>'STO Number',
    ${spdAlias}.data->'raw'->>'STO No',
    ${spdAlias}.data->'shipment'->>'sto_no',
    ${spdAlias}.data->'contract'->>'sto_no'
  )), '')
`;

/**
 * Operational STO key for a shipment row (aliases `s`, `c` must be in scope).
 * Matches Shipping Performance SAP join priority.
 */
export const shipmentSapStoKeyExpr = `
  COALESCE(
    NULLIF(TRIM(s.shipment_id), ''),
    NULLIF(TRIM(s.operation_id), ''),
    NULLIF(TRIM(c.sto_number::text), ''),
    s.id::text
  )
`;

/**
 * EXISTS subquery: shipment/STO is linked to SAP data with STO Type 'V'.
 */
export function buildSapStoTypeVExistsSql(
  stoKeySql: string = shipmentSapStoKeyExpr,
  contractIdSql = 'c.contract_id',
): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd
    WHERE ${sapStoNumberKeyExpr('spd')} = TRIM((${stoKeySql})::text)
      AND (
        NULLIF(TRIM(spd.contract_number), '') IS NULL
        OR TRIM(spd.contract_number) = TRIM((${contractIdSql})::text)
      )
      AND ${sapStoTypeNormalizedExpr('spd')} = '${SHIPMENTS_PAGE_SAP_STO_TYPE_V}'
  )`;
}

/** AND-prefixed WHERE fragment for shipment list queries (aliases s, c). */
export const shipmentsPageSapStoTypeVWhereSql = `AND ${buildSapStoTypeVExistsSql()}`;

/** Parameterized EXISTS for a single STO literal (e.g. contract-details modal). */
export function buildSapStoTypeVExistsForStoParamSql(paramRef: string): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd
    WHERE ${sapStoNumberKeyExpr('spd')} = TRIM(${paramRef}::text)
      AND ${sapStoTypeNormalizedExpr('spd')} = '${SHIPMENTS_PAGE_SAP_STO_TYPE_V}'
  )`;
}
