/**
 * Preserve null for SAP-sourced API display fields.
 * Do not coerce missing SAP values to 0 in JSON responses (calculations may still use COALESCE in SQL).
 */
export function toSapDisplayNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
