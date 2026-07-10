/**
 * Shared SQL helpers for Group Plant resolution and filtering via master_plants.
 */

/** Lateral join aliases — use when pnc/pna are joined on plant_code + company_name. */
export const GROUP_PLANT_FROM_LATERAL_SQL = `COALESCE(
  NULLIF(TRIM(pnc.group_plant), ''),
  NULLIF(TRIM(pna.group_plant), ''),
  'Blank'
)`;

/** Resolve group plant from plant_code (+ optional company_name) using scalar subqueries. */
export function groupPlantExpr(plantCodeRef: string, companyNameRef?: string): string {
  const codeMatch = `TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(${plantCodeRef}, '')))`;
  const companyMatch = companyNameRef
    ? `AND NULLIF(TRIM(${companyNameRef}), '') IS NOT NULL
          AND TRIM(UPPER(COALESCE(mp.company_name, ''))) = TRIM(UPPER(COALESCE(${companyNameRef}, '')))`
    : '';
  const pncSub = `(SELECT mp.group_plant
    FROM master_plants mp
    WHERE ${codeMatch}
      AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
      ${companyMatch}
    ORDER BY mp.updated_at DESC NULLS LAST
    LIMIT 1)`;
  const pnaSub = `(SELECT mp.group_plant
    FROM master_plants mp
    WHERE ${codeMatch}
      AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
    ORDER BY mp.updated_at DESC NULLS LAST
    LIMIT 1)`;
  return `COALESCE(NULLIF(TRIM(${pncSub}), ''), NULLIF(TRIM(${pnaSub}), ''), 'Blank')`;
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
