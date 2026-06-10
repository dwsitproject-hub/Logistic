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

/** AND-prefixed WHERE fragment for trucking list/calendar queries. */
export const truckingPageSapStoTypeTWhereSql = `AND ${buildTruckingSapStoTypeTExistsSql()}`;

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
