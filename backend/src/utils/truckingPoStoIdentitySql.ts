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
/**
 * STO number -> PO number, for a whole batch of STO keys.
 *
 * Three indexed joins unioned together, rather than one correlated subquery per key. The previous
 * shape asked, for every key, "scan contracts and keep the first that matches any of three ORed
 * conditions" - and because those conditions span different tables, no index could serve them.
 * Production measured it at 46,117ms inside a 48s WB upload; the same comparison on the dev copy
 * ran 186,864ms against 4,460ms for 60 keys.
 *
 * Every key still comes back, matched or not: the closing LEFT JOIN keeps the row set identical to
 * the old scalar-subquery form, which returned NULL rather than dropping the key.
 */
export const SQL_RESOLVE_PO_FROM_STO_BATCH = `
  WITH keys AS (
    SELECT DISTINCT TRIM(k) AS sto_key
    FROM UNNEST($1::text[]) AS k
    WHERE NULLIF(TRIM(k), '') IS NOT NULL
  ),
  candidates AS (
    SELECT k.sto_key, c.po_number, c.contract_date, c.updated_at, c.quantity_ordered, c.contract_id
    FROM keys k
    INNER JOIN contract_stos cs ON TRIM(cs.sto_number::text) = k.sto_key
    INNER JOIN contracts c ON c.id = cs.contract_id
    WHERE COALESCE(c.po_number, '') != ''

    UNION ALL

    SELECT k.sto_key, c.po_number, c.contract_date, c.updated_at, c.quantity_ordered, c.contract_id
    FROM keys k
    INNER JOIN contracts c ON TRIM(COALESCE(c.sto_number::text, '')) = k.sto_key
    WHERE COALESCE(c.po_number, '') != ''

    UNION ALL

    SELECT k.sto_key, c.po_number, c.contract_date, c.updated_at, c.quantity_ordered, c.contract_id
    FROM keys k
    INNER JOIN sap_processed_data spd ON TRIM(${SPD_EFFECTIVE_STO}) = k.sto_key
    INNER JOIN contracts c ON TRIM(c.contract_id::text) = TRIM(spd.contract_number)
    WHERE COALESCE(c.po_number, '') != ''
  ),
  best AS (
    /*
     * Ties are common and the old ordering could not break them: measured on the dev copy, the
     * contracts sharing STO 1006015816 agree on both contract_date and updated_at, so whichever
     * the planner reached first won - a different PO on different runs.
     *
     * Largest contract quantity decides, which is a rule that can be explained to a user rather
     * than an accident of the plan. contract_id closes it so the answer is reproducible even when
     * the quantities match too.
     */
    SELECT DISTINCT ON (sto_key)
      sto_key,
      NULLIF(TRIM(po_number::text), '') AS po_number
    FROM candidates
    ORDER BY
      sto_key,
      contract_date DESC NULLS LAST,
      updated_at DESC NULLS LAST,
      quantity_ordered DESC NULLS LAST,
      contract_id
  )
  SELECT k.sto_key, b.po_number
  FROM keys k
  LEFT JOIN best b ON b.sto_key = k.sto_key
`;
