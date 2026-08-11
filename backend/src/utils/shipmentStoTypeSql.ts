/**
 * SAP STO Type / STO number helpers — shared JSON field expressions.
 *
 * Shipments page list scope: CIF/FOB/CFR incoterm only — see shipmentIncotermScope.ts.
 * Trucking page: FRC/LCO — see truckingIncotermScope.ts.
 * Oil Loss vessel segment: MIX + STO Type 'V' — see oilLossEligibility.ts.
 */

import { sqlSapVesselNameFromSpdJsonb } from './sapVesselFields';
import { buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

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

/**
 * Display-only STO number for list/detail UI — contract SAP STO or numeric shipment_id only.
 * Never operation_id or synthetic OP-* keys (those belong in operation_id column).
 */
export function shipmentListDisplayStoNumberExpr(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  return `NULLIF(TRIM(COALESCE(
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
    CASE
      WHEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') ~ '^[0-9]+$'
      THEN NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '')
      ELSE NULL
    END
  )), '')`;
}

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
 * @deprecated Shipments list no longer filters STO Type T — scope is CIF/FOB/CFR incoterm only.
 * Kept for Oil Loss / ad-hoc scripts that still need Type T predicates.
 */
export function buildShipmentExcludeStoTypeTSql(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  return `NOT (${shipmentResolvedStoTypeExpr(contractAlias, spdAlias, shipmentAlias)} = 'T')`;
}

/**
 * Shipments / Shipping Performance row scope: CIF/FOB/CFR incoterm.
 * FOB Type T (truck leg) is excluded; CIF/CFR remain incoterm-only.
 */
export function buildShipmentPageSeaRowScopeSql(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  const incScope = buildShipmentPageSeaIncotermScopeSql(contractAlias);
  const inc = contractEffectiveIncotermExpr(contractAlias);
  const fobTruckLeg = `(
    (${inc}) = 'FOB'
    AND ${shipmentResolvedStoTypeExpr(contractAlias, spdAlias, shipmentAlias)} = 'T'
  )`;
  return `(${incScope}) AND NOT (${fobTruckLeg})`;
}

/** SQL: SAP row is FOB sea leg (Type V, or non-T with vessel name). */
export function sqlIsSapSeaStoRowExpr(spdAlias = 'spd'): string {
  const stoType = sapStoTypeNormalizedExpr(spdAlias);
  const vessel = sqlSapVesselNameFromSpdJsonb(`${spdAlias}.data`);
  return `(
    ${stoType} = 'V'
    OR (
      ${stoType} IS DISTINCT FROM 'T'
      AND ${stoType} <> 'V'
      AND ${vessel} IS NOT NULL
    )
  )`;
}

/** CIF/CFR pass by incoterm; FOB requires sea-leg STO row. */
export function sqlIsSapSeaStoRowForIncotermExpr(
  spdAlias = 'spd',
  contractAlias = 'c',
): string {
  const inc = contractEffectiveIncotermExpr(contractAlias);
  return `(
    (${inc}) IN ('CIF', 'CFR')
    OR ((${inc}) = 'FOB' AND ${sqlIsSapSeaStoRowExpr(spdAlias)})
  )`;
}

/** True when contract has at least one FOB Type V (or vessel) SAP STO row. */
export function contractHasFobSeaEligibleStoExistsSql(contractAlias = 'c'): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd_fob
    WHERE TRIM(spd_fob.contract_number) = TRIM(${contractAlias}.contract_id::text)
      AND TRIM(COALESCE(spd_fob.po_number, '')) = TRIM(COALESCE(${contractAlias}.po_number, ''))
      AND ${sapStoNumberKeyExpr('spd_fob')} IS NOT NULL
      AND UPPER(TRIM(COALESCE(${contractAlias}.incoterm, ''))) = 'FOB'
      AND ${sqlIsSapSeaStoRowExpr('spd_fob')}
  )`;
}
