/**
 * Trucking page — include only SAP rows with STO Type = 'T' (trucking/land).
 * Scope: Trucking page only (Shipments/Shipping Performance use STO Type 'V').
 */

import { sapStoNumberKeyExpr, sapStoTypeNormalizedExpr } from './shipmentStoTypeSql';

export const TRUCKING_PAGE_SAP_STO_TYPE_T = 'T';

/** Pre-filter SAP rows to STO Type T once per query (avoids repeated JSON scans). */
export function buildTruckingSapStoTypeTSapCteBodySql(): string {
  return `
    SELECT DISTINCT
      NULLIF(TRIM(spd.contract_number), '') AS contract_number,
      ${sapStoNumberKeyExpr('spd')} AS sto_key
    FROM sap_processed_data spd
    WHERE ${sapStoTypeNormalizedExpr('spd')} = '${TRUCKING_PAGE_SAP_STO_TYPE_T}'
  `;
}

/** CTE clause — prepend as first WITH entry (or sole WITH) on trucking list/calendar queries. */
export const truckingSapStoTypeTSapCteClause = `sap_sto_type_t AS MATERIALIZED (${buildTruckingSapStoTypeTSapCteBodySql()})`;

/**
 * EXISTS: trucking row linked to pre-filtered SAP STO Type 'T' rows.
 * Requires `sap_sto_type_t` CTE in the same query.
 * Aliases `t`, `c`, and `s` (shipments LEFT JOIN) must be in scope.
 */
export function buildTruckingSapStoTypeTExistsSql(): string {
  return `EXISTS (
    SELECT 1
    FROM sap_sto_type_t st
    WHERE (
      (
        NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
        AND st.sto_key = TRIM(c.sto_number::text)
        AND (
          st.contract_number IS NULL
          OR st.contract_number = TRIM(c.contract_id)
        )
      )
      OR (
        NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
        AND st.sto_key = TRIM(s.shipment_id::text)
        AND (
          st.contract_number IS NULL
          OR st.contract_number = TRIM(c.contract_id)
        )
      )
      OR (
        NULLIF(TRIM(c.sto_number::text), '') IS NULL
        AND (t.shipment_id IS NULL OR NULLIF(TRIM(s.shipment_id::text), '') IS NULL)
        AND st.contract_number = TRIM(c.contract_id)
      )
    )
  )`;
}

/** AND-prefixed WHERE fragment for trucking list/calendar queries (STO Type T only). */
export const truckingPageSapStoTypeTWhereSql = `AND ${buildTruckingSapStoTypeTExistsSql()}`;

/** Effective Sea/Land from contract row with SAP fallback (matches Contracts page). */
export function contractEffectiveSeaLandExpr(contractAlias = 'c'): string {
  return `UPPER(TRIM(COALESCE(
    NULLIF(TRIM(${contractAlias}.transport_mode), ''),
    (
      SELECT COALESCE(
        spd.data->'contract'->>'transport_mode',
        spd.data->'contract'->>'sea_land',
        spd.data->'raw'->>'Sea / Land',
        spd.data->'raw'->>'Sea_Land'
      )
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM((${contractAlias}).contract_id::text)
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ),
    ''
  )))`;
}

/** Latest SAP STO Type is null/empty for the contract. */
export function buildLatestSapStoTypeNullForContractSql(contractAlias = 'c'): string {
  return `(
    SELECT NULLIF(TRIM(${sapStoTypeNormalizedExpr('spd')}), '')
    FROM sap_processed_data spd
    WHERE TRIM(spd.contract_number) = TRIM((${contractAlias}).contract_id::text)
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
  ) IS NULL`;
}

/**
 * Fallback when SAP STO Type is null: include when Sea/Land is LAND or MIX.
 * Covers manually created trucking on LAND contracts without SAP STO Type T.
 */
export function buildTruckingLandMixStoTypeNullFallbackSql(contractAlias = 'c'): string {
  const seaLand = contractEffectiveSeaLandExpr(contractAlias);
  return `(
    ${buildLatestSapStoTypeNullForContractSql(contractAlias)}
    AND (${seaLand} LIKE 'LAND%' OR ${seaLand} LIKE 'MIX%')
  )`;
}

/**
 * Trucking page scope (Section 1 KPIs through table/calendar):
 * SAP STO Type T OR (STO Type null + Sea/Land LAND/MIX).
 */
export function buildTruckingPageListScopeSql(): string {
  return `(
    ${buildTruckingSapStoTypeTExistsSql()}
    OR ${buildTruckingLandMixStoTypeNullFallbackSql('c')}
  )`;
}

/** AND-prefixed WHERE fragment for trucking list, calendar, and get-by-id. */
export const truckingPageListScopeWhereSql = `AND ${buildTruckingPageListScopeSql()}`;

/** Contract has at least one SAP row with STO Type 'T' (create modal / suggestions). */
export function buildSapStoTypeTExistsForContractSql(contractIdSql = 'c.contract_id'): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd
    WHERE TRIM(spd.contract_number) = TRIM((${contractIdSql})::text)
      AND ${sapStoTypeNormalizedExpr('spd')} = '${TRUCKING_PAGE_SAP_STO_TYPE_T}'
  )`;
}

export const truckingPageSapStoTypeTForContractWhereSql = `AND ${buildSapStoTypeTExistsForContractSql()}`;
