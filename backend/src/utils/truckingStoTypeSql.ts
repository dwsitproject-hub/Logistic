/**
 * Trucking page — include only SAP rows with STO Type = 'T' (trucking/land).
 * Scope: Trucking page only (Shipments/Shipping Performance use STO Type 'V').
 */

import { sapStoNumberKeyExpr, sapStoTypeNormalizedExpr } from './shipmentStoTypeSql';

export const TRUCKING_PAGE_SAP_STO_TYPE_T = 'T';

/**
 * EXISTS: trucking row linked to SAP with STO Type 'T'.
 * Aliases `t`, `c`, and `s` (shipments LEFT JOIN) must be in scope.
 */
export function buildTruckingSapStoTypeTExistsSql(): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd
    WHERE ${sapStoTypeNormalizedExpr('spd')} = '${TRUCKING_PAGE_SAP_STO_TYPE_T}'
      AND (
        (
          NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
          AND ${sapStoNumberKeyExpr('spd')} = TRIM(c.sto_number::text)
          AND (
            NULLIF(TRIM(spd.contract_number), '') IS NULL
            OR TRIM(spd.contract_number) = TRIM(c.contract_id)
          )
        )
        OR (
          NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
          AND ${sapStoNumberKeyExpr('spd')} = TRIM(s.shipment_id::text)
          AND (
            NULLIF(TRIM(spd.contract_number), '') IS NULL
            OR TRIM(spd.contract_number) = TRIM(c.contract_id)
          )
        )
        OR (
          NULLIF(TRIM(c.sto_number::text), '') IS NULL
          AND (t.shipment_id IS NULL OR NULLIF(TRIM(s.shipment_id::text), '') IS NULL)
          AND TRIM(spd.contract_number) = TRIM(c.contract_id)
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
