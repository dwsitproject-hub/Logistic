/**
 * Sum KLIP planning qty (kg) from daily_deliverables JSONB arrays.
 */

/** Total planned kg from a daily_deliverables JSONB column expression. */
export function sqlSumDailyDeliverablesKg(jsonExpr: string): string {
  return `COALESCE((
    SELECT SUM(COALESCE(NULLIF(TRIM(elem->>'quantity_delivered'), '')::numeric, 0))
    FROM jsonb_array_elements(COALESCE(${jsonExpr}, '[]'::jsonb)) AS elem
    WHERE NULLIF(TRIM(elem->>'date'), '') IS NOT NULL
      AND COALESCE(NULLIF(TRIM(elem->>'quantity_delivered'), '')::numeric, 0) > 0
  ), 0)`;
}
