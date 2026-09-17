/**
 * SAP Excel often fills a preferred qty column with "0" / "0.00" while a later
 * column (e.g. Quantity Delivery) holds the real kg. COALESCE must skip those
 * placeholders or View Table Delivery/Receive show 0 MT.
 */
export function sqlNullIfSapQtyPlaceholder(expr: string): string {
  const trimmed = `TRIM(COALESCE(${expr}, ''))`;
  const compact = `REPLACE(REPLACE(${trimmed}, ',', ''), ' ', '')`;
  return `CASE
    WHEN ${trimmed} = '' THEN NULL
    WHEN ${compact} ~ '^-?0+(\\.0*)?$' THEN NULL
    ELSE ${trimmed}
  END`;
}

export function sqlCoalesceSapRawQtyFields(fields: readonly string[]): string {
  return `COALESCE(${fields.map(sqlNullIfSapQtyPlaceholder).join(', ')})`;
}
