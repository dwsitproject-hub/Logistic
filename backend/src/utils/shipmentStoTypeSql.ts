/**
 * SAP STO Type / STO number helpers — shared JSON field expressions.
 *
 * Shipments page: contract transport mode SEA/MIX, excluding STO Type T (trucking leg on sea/mix STO).
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
 * Operational STO key for shipments list grouping and STO Type resolution.
 * When SAP assigns the same contracts.sto_number to multiple STO rows (PO anomaly),
 * prefer each row's shipment_id when it is a distinct numeric SAP STO.
 */
export function shipmentListStoKeyExpr(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  return `COALESCE(
    CASE
      WHEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') ~ '^[0-9]+$'
        AND (
          NULLIF(TRIM(${contractAlias}.sto_number::text), '') IS NULL
          OR NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '')
             <> NULLIF(TRIM(${contractAlias}.sto_number::text), '')
        )
      THEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '')
      ELSE NULL
    END,
    NULLIF(TRIM(${contractAlias}.sto_number::text), ''),
    NULLIF(TRIM(${spdAlias}.effective_sto), ''),
    NULLIF(TRIM(${shipmentAlias}.operation_id::text), ''),
    NULLIF(TRIM(${shipmentAlias}.shipment_id::text), ''),
    ${shipmentAlias}.id::text
  )`;
}

/** @deprecated Use shipmentListStoKeyExpr for list grouping; kept for legacy references. */
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

/** Shipments page transport scope: contract Sea/Land = SEA or MIX. */
export function buildShipmentSeaMixTransportSql(contractAlias = 'c'): string {
  return `UPPER(COALESCE(NULLIF(TRIM(${contractAlias}.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')`;
}

/** Resolved STO Type for a shipment row (contract_stos, then SAP JSON). Requires `l` = latest_spd_contract. */
export function shipmentResolvedStoTypeExpr(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  const stoKey = shipmentListStoKeyExpr(contractAlias, spdAlias, shipmentAlias);
  return `UPPER(TRIM(COALESCE(
    (
      SELECT cs.sto_type
      FROM contract_stos cs
      WHERE cs.contract_id = ${contractAlias}.id
        AND NULLIF(TRIM(cs.sto_number::text), '') IS NOT NULL
        AND TRIM(cs.sto_number::text) = TRIM((${stoKey})::text)
      ORDER BY cs.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT ${sapStoTypeNormalizedExpr('spd_sto_type')}
      FROM sap_processed_data spd_sto_type
      WHERE NULLIF(TRIM((${stoKey})::text), '') IS NOT NULL
        AND TRIM(${sapStoNumberKeyExpr('spd_sto_type')}) = TRIM((${stoKey})::text)
        AND (
          NULLIF(TRIM(spd_sto_type.contract_number), '') IS NULL
          OR TRIM(spd_sto_type.contract_number) = TRIM(${contractAlias}.contract_id::text)
        )
      ORDER BY spd_sto_type.created_at DESC NULLS LAST
      LIMIT 1
    ),
    ''
  )))`;
}

/**
 * Exclude trucking-type STO rows from the shipments list (SEA/MIX + STO Type T).
 * Apply where `latest_spd_contract l` is joined on the contract.
 */
export function buildShipmentExcludeStoTypeTSql(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  return `NOT (${shipmentResolvedStoTypeExpr(contractAlias, spdAlias, shipmentAlias)} = 'T')`;
}
