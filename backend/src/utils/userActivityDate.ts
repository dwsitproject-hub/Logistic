/** Normalize Postgres DATE / timestamptz values to `YYYY-MM-DD` (UTC calendar date). */
export function toActivityDateOnly(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }

  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return '';
}
