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

/** OR-combine product substring filters (multi-select). */
export function appendContractPerfProductsMultiSql(
  products: string[] | undefined,
  productColumnSql: string,
  paramIndex: number,
): { clause: string; params: string[]; nextParamIndex: number } | null {
  const list = (products ?? []).map((p) => String(p).trim()).filter(Boolean)
  if (list.length === 0) return null
  const parts: string[] = []
  const params: string[] = []
  let idx = paramIndex
  for (const product of list) {
    parts.push(`COALESCE(${productColumnSql}, '') ILIKE $${idx}`)
    params.push(`%${product}%`)
    idx += 1
  }
  return {
    clause: ` AND (${parts.join(' OR ')})`,
    params,
    nextParamIndex: idx,
  }
}
