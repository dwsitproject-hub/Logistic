/**
 * SAP STO Type / STO number helpers — shared JSON field expressions.
 *
 * Shipments page list scope: CIF/FOB/CFR incoterm only — see shipmentIncotermScope.ts.
 * Trucking page: FRC/LCO — see truckingIncotermScope.ts.
 * Oil Loss vessel segment: MIX + STO Type 'V' — see oilLossEligibility.ts.
 */

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

/** Resolved STO Type for a specific STO number on a contract (contract_stos, then SAP JSON). */
export function shipmentResolvedStoTypeForNumberExpr(
  contractAlias = 'c',
  stoNumberParamSql: string,
): string {
  return `UPPER(TRIM(COALESCE(
    (
      SELECT cs.sto_type
      FROM contract_stos cs
      WHERE cs.contract_id = ${contractAlias}.id
        AND NULLIF(TRIM(cs.sto_number::text), '') IS NOT NULL
        AND TRIM(cs.sto_number::text) = TRIM(${stoNumberParamSql})
      ORDER BY cs.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT ${sapStoTypeNormalizedExpr('spd_sto_num')}
      FROM sap_processed_data spd_sto_num
      WHERE NULLIF(TRIM(${stoNumberParamSql}), '') IS NOT NULL
        AND TRIM(${sapStoNumberKeyExpr('spd_sto_num')}) = TRIM(${stoNumberParamSql})
        AND TRIM(spd_sto_num.contract_number) = TRIM(${contractAlias}.contract_id::text)
      ORDER BY spd_sto_num.created_at DESC NULLS LAST
      LIMIT 1
    ),
    ''
  )))`;
}

/** Resolved STO Type for a shipment row (contract_stos, then SAP JSON). Requires `l` = latest_spd_contract. */
export function shipmentResolvedStoTypeExpr(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  const stoKey = shipmentListStoKeyExpr(contractAlias, spdAlias, shipmentAlias);
  return shipmentResolvedStoTypeForNumberExpr(contractAlias, `(${stoKey})::text`);
}

/** Pick the Type V (vessel) STO number on a contract when present. */
export function contractSeaVesselStoNumberPickExpr(contractAlias = 'c'): string {
  return `(
    SELECT TRIM(cs.sto_number::text)
    FROM contract_stos cs
    WHERE cs.contract_id = ${contractAlias}.id
      AND NULLIF(TRIM(cs.sto_number::text), '') IS NOT NULL
      AND (
        UPPER(TRIM(COALESCE(cs.sto_type, ''))) = 'V'
        OR EXISTS (
          SELECT 1
          FROM sap_processed_data spd_cs
          WHERE TRIM(spd_cs.contract_number) = TRIM(${contractAlias}.contract_id::text)
            AND TRIM(${sapStoNumberKeyExpr('spd_cs')}) = TRIM(cs.sto_number::text)
            AND ${sapStoTypeNormalizedExpr('spd_cs')} = 'V'
        )
      )
    ORDER BY cs.updated_at DESC NULLS LAST
    LIMIT 1
  )`;
}

/** True when contract has at least one Type V (vessel) STO line. */
export function contractHasSeaVesselStoOnContractSql(contractAlias = 'c'): string {
  const pick = contractSeaVesselStoNumberPickExpr(contractAlias);
  return `(${pick}) IS NOT NULL`;
}

/**
 * List grouping key — for FOB mixed V+T POs with vessel execution, prefer Type V STO.
 * CIF/CFR and non-vessel rows fall back to shipmentListStoKeyExpr.
 */
export function shipmentListSeaStoKeyExpr(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  const inc = contractEffectiveIncotermExpr(contractAlias);
  const baseKey = shipmentListStoKeyExpr(contractAlias, spdAlias, shipmentAlias);
  const seaStoPick = contractSeaVesselStoNumberPickExpr(contractAlias);
  return `COALESCE(
    CASE
      WHEN (${inc}) = 'FOB'
        AND NULLIF(TRIM(${shipmentAlias}.vessel_name), '') IS NOT NULL
        AND (${seaStoPick}) IS NOT NULL
      THEN (${seaStoPick})
      ELSE NULL
    END,
    ${baseKey}
  )`;
}

/** Display STO for list UI — mirrors shipmentListSeaStoKeyExpr formatting. */
export function shipmentListSeaDisplayStoNumberExpr(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
): string {
  return `NULLIF(TRIM((${shipmentListSeaStoKeyExpr(contractAlias, spdAlias, shipmentAlias)})::text), '')`;
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
 * True when SAP names a vessel on this STO of this contract.
 *
 * A FOB STO of Type T is a trucking leg - EXCEPT when SAP writes a Vessel Name on it. Measured on the
 * 29 Sep 2026 export: of 772 FOB Type T rows, 767 carry no vessel and every one of them carries trucking
 * data (transporter / truck loading location / trucking qty); the other 5 name a vessel - all tug and
 * barge sets (TB. AS MARINA 9 / BG. AS MARINA 12 ...) - and none carries trucking data. Those 5 are sea
 * execution typed T in SAP, and without this exception they vanished from Shipments: STO 1006020352
 * (POs 1001031897 / 1001032649, AS MARINA 10, planned in KLIP) was unfindable by its STO.
 */
export function sqlSapStoHasVesselExpr(contractAlias: string, stoNumberSql: string): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd_tv
    WHERE TRIM(spd_tv.contract_number) = TRIM(${contractAlias}.contract_id::text)
      AND NULLIF(TRIM(${stoNumberSql}), '') IS NOT NULL
      AND TRIM(${sapStoNumberKeyExpr('spd_tv')}) = TRIM(${stoNumberSql})
      AND ${sapVesselNamePresentSql('spd_tv.data')}
  )`;
}

/**
 * True when ANY of the SAP vessel-name fields holds a name. Each field is tested on its own: the parser
 * can leave shipment.vessel_name = '' while raw."Vessel Name" holds the name, and a COALESCE over the
 * fields (sqlSapVesselNameFromSpdJsonb) stops at that empty string and reads "no vessel".
 */
export function sapVesselNamePresentSql(dataExpr: string): string {
  return `COALESCE(
    NULLIF(TRIM(${dataExpr}->'shipment'->>'vessel_name'), ''),
    NULLIF(TRIM(${dataExpr}->'vessel'->>'vessel_name'), ''),
    NULLIF(TRIM(${dataExpr}->'raw'->>'Vessel Name'), ''),
    NULLIF(TRIM(${dataExpr}->'raw'->>'Vessel'), ''),
    NULLIF(TRIM(${dataExpr}->'raw'->>'vessel name'), '')
  ) IS NOT NULL`;
}

/** True when this STO number is a FOB trucking (Type T) leg — not a Shipments search hit. */
export function sqlIsFobTypeTStoNumberExpr(
  contractAlias: string,
  stoNumberSql: string,
): string {
  const inc = contractEffectiveIncotermExpr(contractAlias);
  return `(
    (${inc}) = 'FOB'
    AND ${shipmentResolvedStoTypeForNumberExpr(contractAlias, stoNumberSql)} = 'T'
    AND NOT ${sqlSapStoHasVesselExpr(contractAlias, stoNumberSql)}
  )`;
}

export interface ShipmentPageSeaRowScopeOptions {
  /** When set, FOB Type T check resolves against this bound STO param (search / ?sto=). */
  selectedStoParamIndex?: number;
}

/**
 * Shipments / Shipping Performance row scope: CIF/FOB/CFR incoterm.
 * FOB Type T is a trucking leg — not a Shipments row (mixed V+T POs keep Type V only) - unless SAP
 * names a vessel on that STO (sqlSapStoHasVesselExpr): tug / barge sets typed T.
 * CIF/CFR remain incoterm-only (Type T allowed).
 */
export function buildShipmentPageSeaRowScopeSql(
  contractAlias = 'c',
  spdAlias = 'l',
  shipmentAlias = 's',
  options?: ShipmentPageSeaRowScopeOptions,
): string {
  const incScope = buildShipmentPageSeaIncotermScopeSql(contractAlias);
  const inc = contractEffectiveIncotermExpr(contractAlias);
  const stoNumberSql =
    options?.selectedStoParamIndex != null
      ? `$${options.selectedStoParamIndex}::text`
      : `(${shipmentListStoKeyExpr(contractAlias, spdAlias, shipmentAlias)})::text`;
  const resolvedTypeExpr = shipmentResolvedStoTypeForNumberExpr(contractAlias, stoNumberSql);
  // FOB Type T is a trucking leg unless SAP names a vessel on that STO (sqlSapStoHasVesselExpr).
  // The EXISTS is last so it only runs for FOB Type T rows.
  const fobTypeT = `(
    (${inc}) = 'FOB'
    AND ${resolvedTypeExpr} = 'T'
    AND NOT ${sqlSapStoHasVesselExpr(contractAlias, stoNumberSql)}
  )`;
  return `(${incScope}) AND NOT (${fobTypeT})`;
}

/**
 * SQL: SAP row is FOB sea leg - Type V, or any row naming a vessel. A Type T row with a vessel counts:
 * SAP types some tug / barge sets T (see sqlSapStoHasVesselExpr); a real trucking leg names no vessel.
 */
export function sqlIsSapSeaStoRowExpr(spdAlias = 'spd'): string {
  const stoType = sapStoTypeNormalizedExpr(spdAlias);
  return `(
    ${stoType} = 'V'
    OR ${sapVesselNamePresentSql(`${spdAlias}.data`)}
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
