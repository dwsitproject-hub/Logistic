/**
 * SAP quantity UOM helpers.
 * KLIP stores quantities in kg; UI typically displays MT (÷1000).
 * When SAP exports MT already, multiply once to kg — never apply the legacy scale heuristic.
 */

const MT_UOMS = new Set(['MT', 'TO', 'TON', 'TONS', 'T']);

export function normalizeSapUom(uom: unknown): string | null {
  if (uom == null) return null;
  const s = String(uom).trim().toUpperCase();
  return s === '' ? null : s;
}

/** Metric-ton family UOMs that mean the numeric value is already in MT. */
export function isMetricTonUom(uom: unknown): boolean {
  const n = normalizeSapUom(uom);
  return n != null && MT_UOMS.has(n);
}

/**
 * Convert a SAP quantity to kg for storage.
 * - MT / TO / TON → qty × 1000
 * - KG / blank / unknown → qty as-is (assumed kg)
 */
export function normalizeSapQtyToKg(qty: number | null, uom?: unknown): number | null {
  if (qty == null || !Number.isFinite(qty)) return null;
  if (isMetricTonUom(uom)) return qty * 1000;
  return qty;
}

/**
 * SQL CASE: when UOM expr is MT-family, multiply qty; when UOM present as KG/other, keep qty;
 * when UOM blank/null, fall back to legacy scale heuristic vs contract qty.
 */
export function sqlNormalizeSapQtyToKgWithUom(
  sapNumericExpr: string,
  uomExpr: string,
  contractQtyKgExpr = 'COALESCE(c.quantity_ordered, 0)',
): string {
  const uomUpper = `UPPER(TRIM(COALESCE(${uomExpr}, '')))`;
  return `CASE
    WHEN (${sapNumericExpr}) IS NULL THEN NULL
    WHEN ${uomUpper} IN ('MT', 'TO', 'TON', 'TONS', 'T') THEN (${sapNumericExpr}) * 1000
    WHEN ${uomUpper} <> '' THEN (${sapNumericExpr})
    WHEN (${sapNumericExpr}) < (${contractQtyKgExpr}) / 10.0
         AND (${sapNumericExpr}) * 1000 <= (${contractQtyKgExpr}) * 1.05
      THEN (${sapNumericExpr}) * 1000
    ELSE (${sapNumericExpr})
  END`;
}
