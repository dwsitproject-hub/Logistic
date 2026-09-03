/**
 * Operational Region/Site = SAP Discharge Destination (not master_plants.group_plant).
 *
 * Display coalesces empty dest to 'Blank' for tables/drilldown. Filter dropdowns omit Blank.
 * Matching is trim + case-insensitive so Bontang / BONTANG collapse.
 */

import { sapDischargeDestinationFromJson } from './sapTruckingLoadingLocationSql';
import { B2B_ENDING_CHILD_SNAPSHOT_TABLE } from './b2bOriginEndingSql';

export type RegionSiteFilterResult = {
  sql: string;
  params: string[];
  nextIndex: number;
};

export function sapDischargeDestinationFromAlias(alias = 'spd'): string {
  return sapDischargeDestinationFromJson(`${alias}.data`);
}

/** Raw dest (NULL when missing/blank). Overlay B2B child dest when origin is empty. */
export function sqlRegionSiteRawFromJsonAndB2b(dataExpr: string, b2bAlias = 'b2b_end'): string {
  return `COALESCE(
    NULLIF(TRIM(${b2bAlias}.discharge_destination), ''),
    ${sapDischargeDestinationFromJson(dataExpr)}
  )`;
}

export function regionSiteDisplayExpr(destExpr: string): string {
  return `COALESCE(NULLIF(TRIM(${destExpr}), ''), 'Blank')`;
}

export function sqlRegionSiteDisplayFromJsonAndB2b(dataExpr: string, b2bAlias = 'b2b_end'): string {
  return regionSiteDisplayExpr(sqlRegionSiteRawFromJsonAndB2b(dataExpr, b2bAlias));
}

/** Dest without requiring b2b_end / latest_spd already joined (list WHERE clauses). */
export function sqlRegionSiteRawForContract(contractNumberExpr: string, originPoExpr: string): string {
  return `COALESCE(
    (
      SELECT NULLIF(TRIM(m.discharge_destination), '')
      FROM ${B2B_ENDING_CHILD_SNAPSHOT_TABLE} m
      WHERE m.origin_po = NULLIF(TRIM(${originPoExpr}), '')
    ),
    (
      SELECT ${sapDischargeDestinationFromJson('spd.data')}
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    )
  )`;
}

export function sqlRegionSiteDisplayForContract(contractNumberExpr: string, originPoExpr: string): string {
  return regionSiteDisplayExpr(sqlRegionSiteRawForContract(contractNumberExpr, originPoExpr));
}
export function sqlRegionSiteRawFromLatestSpdSubquery(
  contractNumberExpr: string,
  b2bAlias = 'b2b_end',
): string {
  return `COALESCE(
    NULLIF(TRIM(${b2bAlias}.discharge_destination), ''),
    (
      SELECT ${sapDischargeDestinationFromJson('spd.data')}
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    )
  )`;
}

export function sqlRegionSiteDisplayFromLatestSpdSubquery(
  contractNumberExpr: string,
  b2bAlias = 'b2b_end',
): string {
  return regionSiteDisplayExpr(sqlRegionSiteRawFromLatestSpdSubquery(contractNumberExpr, b2bAlias));
}

/**
 * DISTINCT Discharge Destination values for filter dropdowns.
 * Empty / whitespace / Blank are excluded; mixed case collapses via GROUP BY UPPER.
 */
export const REGION_SITE_FILTER_OPTIONS_SQL = `
      SELECT MIN(dest) AS group_plant
      FROM (
        SELECT ${sapDischargeDestinationFromAlias('spd')} AS dest
        FROM sap_processed_data spd
      ) d
      WHERE dest IS NOT NULL
      GROUP BY UPPER(dest)
      ORDER BY MIN(dest)
`;

export function filterRegionSiteOptionValues(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'blank') continue;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Region/Site filter (query param `plant=`). No Blank sentinel — empty dest rows
 * only appear when this filter is unset.
 */
export function appendRegionSiteFilter(
  plants: string[],
  paramIndex: number,
  regionSiteExprSql: string,
): RegionSiteFilterResult {
  const selected = filterRegionSiteOptionValues(plants);
  if (selected.length === 0) {
    return { sql: '', params: [], nextIndex: paramIndex };
  }
  const placeholders = selected.map((_, i) => `UPPER($${paramIndex + i})`).join(', ');
  return {
    sql: ` AND UPPER(NULLIF(TRIM(${regionSiteExprSql}), 'Blank')) IN (${placeholders})`,
    params: selected,
    nextIndex: paramIndex + selected.length,
  };
}
