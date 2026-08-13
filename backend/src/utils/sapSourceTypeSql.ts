/**
 * SAP JSON paths for Source / Source_Type (Excel raw + normalized contract).
 * Used by sap_latest (execution) and latest_spd_contract (Unplanned/Preplanned backlog).
 */

/** Source from a sap_processed_data.data JSONB expression. */
export function sqlSapSourceTypeFromJsonb(dataExpr: string): string {
  return `COALESCE(
    NULLIF(TRIM(${dataExpr}->'contract'->>'source_type'), ''),
    NULLIF(TRIM(${dataExpr}->>'Source'), ''),
    NULLIF(TRIM(${dataExpr}->'raw'->>'Source'), ''),
    NULLIF(TRIM(${dataExpr}->>'Source_Type'), ''),
    NULLIF(TRIM(${dataExpr}->'raw'->>'Source_Type'), '')
  )`;
}

/** Incoterm from a sap_processed_data.data JSONB expression (contract + raw Excel). */
export function sqlSapIncotermFromJsonb(dataExpr: string): string {
  return `COALESCE(
    NULLIF(TRIM(${dataExpr}->'contract'->>'incoterm'), ''),
    NULLIF(TRIM(${dataExpr}->'raw'->>'Incoterm'), ''),
    NULLIF(TRIM(${dataExpr}->>'Incoterm'), '')
  )`;
}

/** Prefer contract.source_type, then SAP Source / Source_Type. */
export function sqlCoalesceSourceType(...exprs: string[]): string {
  const parts = exprs.map((expr) => `NULLIF(TRIM(${expr}::text), '')`);
  return `COALESCE(${parts.join(', ')}, '')`;
}
