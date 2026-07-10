/** Rows with SAP STO numbers sort before rows without STO (Unplanned / Planned tables). */

export function shouldPrioritizeSapStoRows(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return normalized === 'UNPLANNED' || normalized === 'PLANNED';
}

export function sqlSapStoPresentSortKey(stoNumberExpr: string): string {
  return `CASE
    WHEN NULLIF(TRIM(COALESCE(${stoNumberExpr}::text, '')), '') IS NOT NULL
      AND TRIM(COALESCE(${stoNumberExpr}::text, '')) <> '-'
    THEN 0
    ELSE 1
  END`;
}

export function buildListOrderByWithSapStoPriority(
  stoNumberExpr: string,
  primaryOrderSql: string,
  status?: unknown,
): string {
  if (!shouldPrioritizeSapStoRows(status)) {
    return primaryOrderSql;
  }
  return `${sqlSapStoPresentSortKey(stoNumberExpr)} ASC, ${primaryOrderSql}`;
}
