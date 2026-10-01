/**
 * Group Plant = where the contract is delivered, from the SAP Discharge Destination.
 *
 * It used to be `master_plants.group_plant`. A reload of Master Plant (migrations 195 and 208)
 * emptied that column, every contract resolved to 'Blank', and Pre-Planned - which excludes
 * 'Blank' - lost its whole pool. The destination is the same value the Region/Site filters use
 * (utils/regionSiteSql.ts: B2B child overlay, then the latest SAP row, then the alias map), so
 * Group Plant and Region/Site are now one dimension instead of two that look alike.
 *
 * One value still comes from the plant: 'Trading'. Pre-Planned leaves it out of auto-grouping, and
 * a trading plant's contracts go to 40+ different destinations, so the destination cannot say it.
 * SAP sends the Plant Code only, so a plant is trading when it is on `trading_plant_codes`
 * (migration 212, kept outside master_plants so a reload cannot lose it) or its Master Plant
 * `plant_type` starts with HO TRADING. A destination of TRADING TRANSIT HO is Trading too.
 *
 * Result: the destination in upper case (BONTANG, TANJUNG PURA ...), 'Trading', or 'Blank' when
 * SAP carries no destination at all.
 */

import { sqlRegionSiteRawForContract } from './regionSiteSql';

/** The contract columns the destination is looked up by. */
export interface GroupPlantContractRefs {
  contractNumber: string;
  originPo: string;
}

/** `FROM contracts c` - what nearly every caller has. */
export const GROUP_PLANT_CONTRACT_C: GroupPlantContractRefs = {
  contractNumber: 'c.contract_id',
  originPo: 'c.po_number',
};

/** A destination SAP uses for head-office trading stock. It is Trading, not a place. */
const TRADING_TRANSIT_DESTINATION = 'TRADING TRANSIT HO';

/** `plantRef` must already be UPPER(TRIM(...)). */
export function sqlIsTradingPlantExpr(plantRef: string): string {
  return `(
    EXISTS (SELECT 1 FROM trading_plant_codes tp WHERE tp.plant_code = ${plantRef})
    OR EXISTS (
      SELECT 1 FROM master_plants mp
      WHERE UPPER(TRIM(mp.plant_code)) = ${plantRef}
        AND UPPER(COALESCE(mp.plant_type, '')) LIKE 'HO TRADING%'
    )
  )`;
}

/**
 * Group Plant for one contract row. A scalar subquery, so the destination and the plant code are
 * each evaluated once per row however many times the caller repeats this expression.
 */
export function groupPlantExpr(plantCodeRef: string, contract: GroupPlantContractRefs): string {
  const destination = sqlRegionSiteRawForContract(contract.contractNumber, contract.originPo);
  return `(SELECT CASE
      WHEN ${sqlIsTradingPlantExpr('x.plant')} THEN 'Trading'
      WHEN x.dest IS NULL THEN 'Blank'
      WHEN x.dest = '${TRADING_TRANSIT_DESTINATION}' THEN 'Trading'
      ELSE x.dest
    END
    FROM (
      SELECT UPPER(TRIM(COALESCE(${plantCodeRef}, ''))) AS plant,
             NULLIF(UPPER(TRIM(${destination})), '') AS dest
    ) x)`;
}

export type GroupPlantFilterResult = {
  sql: string;
  params: string[];
  nextIndex: number;
};

/** Append Group Plant filter (supports "Blank" sentinel). */
export function appendGroupPlantFilter(
  plants: string[],
  paramIndex: number,
  groupPlantExprSql: string,
  blankPlantCodeRef?: string,
): GroupPlantFilterResult {
  if (plants.length === 0) {
    return { sql: '', params: [], nextIndex: paramIndex };
  }
  const blankIncluded = plants.some((p) => p === 'Blank');
  const nonBlank = plants.filter((p) => p !== 'Blank');
  const parts: string[] = [];
  let idx = paramIndex;
  const params: string[] = [];

  if (blankIncluded && blankPlantCodeRef) {
    parts.push(`(${blankPlantCodeRef} IS NULL OR TRIM(${blankPlantCodeRef}) = '')`);
  } else if (blankIncluded) {
    parts.push(`(${groupPlantExprSql} = 'Blank')`);
  }

  if (nonBlank.length > 0) {
    const ph = nonBlank.map(() => `$${idx++}`).join(', ');
    parts.push(`${groupPlantExprSql} IN (${ph})`);
    params.push(...nonBlank);
  }

  return {
    sql: parts.length > 0 ? ` AND (${parts.join(' OR ')})` : '',
    params,
    nextIndex: idx,
  };
}
