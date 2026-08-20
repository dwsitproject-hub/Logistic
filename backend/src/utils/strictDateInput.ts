/**
 * Strict date / timestamp parsing for query & body inputs (VA SQLi hardening).
 * Values are still bound as parameterized `$N` — this rejects malformed casts that
 * scanners exploit as boolean side-channels (e.g. `2026-08-06%`).
 */

export class InvalidDateInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateInputError';
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO-8601 date or date-time (optional fractional seconds + Z/offset). Rejects `%` and junk. */
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function firstQueryValue(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function isValidCalendarDateOnly(yyyyMmDd: string): boolean {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/**
 * Optional `YYYY-MM-DD`. Empty/missing → undefined.
 * Invalid format or calendar → throws InvalidDateInputError.
 */
export function parseOptionalStrictDateOnly(
  raw: unknown,
  fieldName: string,
): string | undefined {
  const s = firstQueryValue(raw);
  if (s === undefined) return undefined;
  if (!DATE_ONLY_RE.test(s) || !isValidCalendarDateOnly(s)) {
    throw new InvalidDateInputError(`${fieldName} must be a valid YYYY-MM-DD date`);
  }
  return s;
}

/**
 * Parse optional dateFrom/dateTo from Express query (or plain object).
 * Throws InvalidDateInputError if either is present but invalid.
 */
export function parseOptionalStrictDateRange(
  source: { dateFrom?: unknown; dateTo?: unknown },
): { dateFrom?: string; dateTo?: string } {
  return {
    dateFrom: parseOptionalStrictDateOnly(source.dateFrom, 'dateFrom'),
    dateTo: parseOptionalStrictDateOnly(source.dateTo, 'dateTo'),
  };
}

export type EventAtParseResult =
  | { kind: 'omit' }
  | { kind: 'ok'; value: string }
  | { kind: 'invalid' };

/**
 * Validate optional activity `eventAt`. Invalid values are not bound to SQL.
 */
export function parseEventAtInput(raw: unknown): EventAtParseResult {
  if (raw == null) return { kind: 'omit' };
  const s = String(raw).trim();
  if (!s) return { kind: 'omit' };
  if (!ISO_TIMESTAMP_RE.test(s)) return { kind: 'invalid' };
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return { kind: 'invalid' };
  return { kind: 'ok', value: new Date(ms).toISOString() };
}

/** Escape `\`, `%`, `_` for PostgreSQL `ILIKE … ESCAPE E'\\'` patterns. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Wrap an ILIKE contains pattern with wildcards after escaping metacharacters. */
export function likeContainsPattern(value: string): string {
  return `%${escapeIlikePattern(value)}%`;
}

/** SQL fragment: `ILIKE $N ESCAPE E'\\'` (escape character is backslash). */
export function sqlIlikeParam(paramIndex: number): string {
  return `ILIKE $${paramIndex} ESCAPE E'\\\\'`;
}
