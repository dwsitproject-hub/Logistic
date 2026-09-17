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
 * - Any STO registered on contract_stos for the contract
 * - Full SAP mode: additionally, any STO with SAP trucking movement
 *
 * Registered lines must be eligible in BOTH variants: the Summary Trucking Status
 * circles aggregate the full expansion, so the previous shell-only restriction
 * ("primary or sole STO") made multi-STO contracts show fewer table rows than the
 * circles counted (e.g. contract 1004030828: circles 2 Unplanned, table 1 row).
 */
export function sqlTruckingEligibleStoLineWhere(
  contractAlias = 'c',
  stoLineExpr: string,
  skipSapJoin: boolean,
): string {
  const primaryMatch = `TRIM(${stoLineExpr}) = NULLIF(TRIM(${contractAlias}.sto_number::text), '')`;
  const registeredSto = `EXISTS (
    SELECT 1
    FROM contract_stos cs_reg
    WHERE cs_reg.contract_id = ${contractAlias}.id
      AND NULLIF(TRIM(cs_reg.sto_number::text), '') IS NOT NULL
      AND TRIM(cs_reg.sto_number::text) = TRIM(${stoLineExpr})
  )`;

  if (skipSapJoin) {
    return `(${primaryMatch} OR ${registeredSto})`;
  }

  return `(${primaryMatch} OR ${registeredSto} OR ${sqlTruckingStoHasSapMovement(contractAlias, stoLineExpr)})`;
}
