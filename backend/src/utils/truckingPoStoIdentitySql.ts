/**
 * PO-level STO identity helpers for trucking validate / get-by-id / WB resolve.
 * Aligns with list expansion eligibility (contract_stos ∪ SAP effective STO).
 */

import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import { sqlTruckingEligibleStoLineWhere } from './truckingListStoEligibleSql';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

/**
 * Scalar subquery: comma-separated eligible STO numbers for one contracts row alias.
 * Uses contract_stos ∪ SAP effective STO with list eligibility (full SAP mode).
 */
export function sqlTruckingPoAggregatedStoNumbersExpr(contractAlias = 'c'): string {
  const eligibleCs = sqlTruckingEligibleStoLineWhere(
    contractAlias,
    'TRIM(cs.sto_number::text)',
    true,
  );
  const eligibleSap = sqlTruckingEligibleStoLineWhere(
    contractAlias,
    `TRIM(${SPD_EFFECTIVE_STO})`,
    false,
  );
  return `COALESCE(
    (
      SELECT STRING_AGG(DISTINCT TRIM(x.sto_line), ', ' ORDER BY TRIM(x.sto_line))
      FROM (
        SELECT TRIM(cs.sto_number::text) AS sto_line
        FROM contract_stos cs
        WHERE cs.contract_id = ${contractAlias}.id
          AND cs.sto_number IS NOT NULL AND TRIM(cs.sto_number::text) != ''
          AND ${eligibleCs}
        UNION
        SELECT TRIM(${SPD_EFFECTIVE_STO}) AS sto_line
        FROM sap_processed_data spd
        WHERE TRIM(spd.contract_number) = TRIM(${contractAlias}.contract_id::text)
          AND ${SPD_EFFECTIVE_STO} IS NOT NULL
          AND ${eligibleSap}
      ) x
      WHERE NULLIF(TRIM(x.sto_line), '') IS NOT NULL
    ),
    NULLIF(TRIM(${contractAlias}.sto_number::text), '')
  )`;
}

/**
 * SQL fragment: match contracts where an STO key equals $paramIdx
 * (contract_stos, contracts.sto_number, or SAP effective STO).
 */
export function sqlContractMatchesStoParam(contractAlias: string, paramIdx: number): string {
  return `(
    EXISTS (
      SELECT 1 FROM contract_stos cs
      WHERE cs.contract_id = ${contractAlias}.id
        AND TRIM(cs.sto_number::text) = TRIM($${paramIdx}::text)
    )
    OR TRIM(COALESCE(${contractAlias}.sto_number::text, '')) = TRIM($${paramIdx}::text)
    OR EXISTS (
      SELECT 1 FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM(${contractAlias}.contract_id::text)
        AND TRIM(${SPD_EFFECTIVE_STO}) = TRIM($${paramIdx}::text)
    )
  )`;
}

/**
 * Resolve a PO number for an STO key (trim). Returns null when not found / ambiguous.
 * Prefer contracts.po_number from contract_stos, then primary contracts.sto_number, then SAP.
 */
export const SQL_RESOLVE_PO_FROM_STO = `
  SELECT NULLIF(TRIM(c.po_number::text), '') AS po_number
  FROM contracts c
  WHERE COALESCE(c.po_number, '') != ''
    AND (
      EXISTS (
        SELECT 1 FROM contract_stos cs
        WHERE cs.contract_id = c.id
          AND TRIM(cs.sto_number::text) = TRIM($1::text)
      )
      OR TRIM(COALESCE(c.sto_number::text, '')) = TRIM($1::text)
      OR EXISTS (
        SELECT 1 FROM sap_processed_data spd
        WHERE TRIM(spd.contract_number) = TRIM(c.contract_id::text)
          AND TRIM(${SPD_EFFECTIVE_STO}) = TRIM($1::text)
      )
    )
  ORDER BY c.contract_date DESC NULLS LAST, c.updated_at DESC NULLS LAST
  LIMIT 1
`;

/**
 * Batch version of SQL_RESOLVE_PO_FROM_STO — resolve PO numbers for a whole array of STO
 * keys ($1::text[]) in a single round trip. Returns one row per distinct input key
 * (po_number is NULL when not found). Feeds a `Map<stoKey, poNumber | null>`.
 */
export const SQL_RESOLVE_PO_FROM_STO_BATCH = `
  SELECT
    x.sto_key,
    (
      SELECT NULLIF(TRIM(c.po_number::text), '')
      FROM contracts c
      WHERE COALESCE(c.po_number, '') != ''
        AND (
          EXISTS (
            SELECT 1 FROM contract_stos cs
            WHERE cs.contract_id = c.id
              AND TRIM(cs.sto_number::text) = x.sto_key
          )
          OR TRIM(COALESCE(c.sto_number::text, '')) = x.sto_key
          OR EXISTS (
            SELECT 1 FROM sap_processed_data spd
            WHERE TRIM(spd.contract_number) = TRIM(c.contract_id::text)
              AND TRIM(${SPD_EFFECTIVE_STO}) = x.sto_key
          )
        )
      ORDER BY c.contract_date DESC NULLS LAST, c.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS po_number
  FROM UNNEST($1::text[]) AS x(sto_key)
`;
