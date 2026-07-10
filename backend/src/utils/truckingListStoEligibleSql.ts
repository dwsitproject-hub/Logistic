/**
 * Which contract_stos lines qualify for trucking list STO expansion.
 * Avoids cartesian explosion when SAP assigns many STOs but only a subset is active.
 */

import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

/** SAP row has trucking execution signals for a contract + STO line. */
export function sqlTruckingStoHasSapMovement(contractAlias = 'c', stoLineExpr: string): string {
  return `EXISTS (
    SELECT 1
    FROM sap_processed_data spd
    WHERE TRIM(spd.contract_number) = TRIM(${contractAlias}.contract_id::text)
      AND TRIM(${SPD_EFFECTIVE_STO}) = TRIM(${stoLineExpr})
      AND (
        NULLIF(TRIM(COALESCE(
          spd.data->'raw'->>'Quantity Delivered',
          spd.data->'raw'->>'Quantity Delivery',
          ''
        )), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(
          spd.data->'raw'->>'Quantity Receive',
          spd.data->'raw'->>'Qty Receive',
          ''
        )), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(
          spd.data->'raw'->>'Trucking Last Receive Date',
          spd.data->>'Trucking Last Receive Date',
          spd.data->'trucking'->0->'data'->>'trucking_last_receive_date',
          ''
        )), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(
          spd.data->'raw'->>'Trucking Start Receive Date',
          spd.data->>'Trucking Start Receive Date',
          spd.data->'trucking'->0->'data'->>'trucking_start_receive_date',
          ''
        )), '') IS NOT NULL
      )
  )`;
}

/**
 * Eligible STO lines for list expansion (shell = no SAP subqueries).
 * - Primary STO on contracts.sto_number
 * - Sole STO on contract_stos
 * - Full SAP mode: any STO with SAP trucking movement
 */
export function sqlTruckingEligibleStoLineWhere(
  contractAlias = 'c',
  stoLineExpr: string,
  skipSapJoin: boolean,
): string {
  const primaryMatch = `TRIM(${stoLineExpr}) = NULLIF(TRIM(${contractAlias}.sto_number::text), '')`;
  const soleSto = `(
    SELECT COUNT(*)::int
    FROM contract_stos cs_n
    WHERE cs_n.contract_id = ${contractAlias}.id
      AND NULLIF(TRIM(cs_n.sto_number::text), '') IS NOT NULL
  ) = 1 AND TRIM(${stoLineExpr}) = (
    SELECT TRIM(cs_one.sto_number::text)
    FROM contract_stos cs_one
    WHERE cs_one.contract_id = ${contractAlias}.id
      AND NULLIF(TRIM(cs_one.sto_number::text), '') IS NOT NULL
    LIMIT 1
  )`;

  if (skipSapJoin) {
    return `(${primaryMatch} OR ${soleSto})`;
  }

  return `(${primaryMatch} OR ${soleSto} OR ${sqlTruckingStoHasSapMovement(contractAlias, stoLineExpr)})`;
}
