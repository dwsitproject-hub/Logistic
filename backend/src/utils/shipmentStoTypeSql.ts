/**
 * SAP STO Type / STO number helpers — shared JSON field expressions.
 *
 * Shipments & Shipping Performance: contract transport mode SEA/MIX only (no STO Type filter).
 * Trucking page: transport mode LAND only — see truckingStoTypeSql.ts.
 * Oil Loss vessel segment: MIX + STO Type 'V' — see oilLossEligibility.ts.
 */

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
 * Prefer contract/SAP STO before synthetic shipment_id / operation_id (matches list grouping).
 */
export const shipmentSapStoKeyExpr = `
  COALESCE(
    NULLIF(TRIM(c.sto_number::text), ''),
    NULLIF(TRIM(l.effective_sto), ''),
    NULLIF(TRIM(s.shipment_id), ''),
    NULLIF(TRIM(s.operation_id), ''),
    s.id::text
  )
`;

/** Manual / synthetic operation ids created from UI (OP-SEA-*, OP-{contract}-*). */
export const isSyntheticShipmentOperationKeySql = (stoKeySql: string): string =>
  `(TRIM((${stoKeySql})::text) ~ '^OP-')`;
