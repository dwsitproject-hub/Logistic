/**
 * Contract Performance product tab filter — substring match (aligned with GET /contracts).
 * Example: tab "POME" matches product "POME", "CRUDE POME", "POME OIL".
 */
export function appendContractPerfProductSubstringSql(
  productFilter: string | undefined,
  productColumnSql: string,
  paramIndex: number,
): { clause: string; param: string; nextParamIndex: number } | null {
  const trimmed = productFilter?.trim()
  if (!trimmed || trimmed.toUpperCase() === 'ALL') return null
  return {
    clause: ` AND COALESCE(${productColumnSql}, '') ILIKE $${paramIndex}`,
    param: `%${trimmed}%`,
    nextParamIndex: paramIndex + 1,
  }
}
