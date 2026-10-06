/**
 * Decimal qty inputs: only `.` is allowed as decimal separator.
 * Comma (locale decimal) is rejected so values like "1000,38" are not mis-parsed.
 */

export const DECIMAL_DOT_HINT =
  'Use a dot (.) for decimals. Comma (,) is not allowed.'

/** True for keys that must never enter decimal qty fields (comma / locale separators). */
export function isBlockedDecimalSeparatorKey(key: string): boolean {
  return key === ',' || key === 'Decimal' || key === 'Separator'
}

/**
 * Strip/reject commas and keep a single `.` decimal.
 * Returns null if the raw string is not a valid partial/complete number.
 */
export function sanitizeDecimalDotInput(raw: string): string | null {
  if (raw === '') return ''
  // Reject comma immediately — do not treat as thousand or decimal separator.
  if (raw.includes(',')) return null
  if (!/^\d*\.?\d*$/.test(raw)) return null
  // Disallow more than one dot (regex already does) and lone incomplete forms are OK while typing.
  return raw
}

/** Parse a sanitized decimal-dot string to number; empty → null; invalid → null. */
export function parseDecimalDotInput(raw: string): number | null {
  const sanitized = sanitizeDecimalDotInput(raw.trim())
  if (sanitized === null) return null
  if (sanitized === '' || sanitized === '.') return null
  const n = Number(sanitized)
  return Number.isFinite(n) ? n : null
}

/** onKeyDown helper: prevent comma / Decimal key from being typed. */
export function blockCommaDecimalKeyDown(
  e: { key: string; preventDefault: () => void },
): void {
  if (isBlockedDecimalSeparatorKey(e.key)) {
    e.preventDefault()
  }
}

/**
 * A qty input that shows String(number) loses what the user is in the middle of typing: "12." parses to 12 and the dot
 * disappears, "1.0" parses to 1 so "1.05" can never be typed. The input therefore keeps the text being typed (the draft)
 * and shows it for as long as it still means the number the form holds.
 */

/** What a draft means as a number; an empty or lone "." means `emptyAs`. */
export function decimalDraftToValue(draft: string, emptyAs: number | null = null): number | null {
  return parseDecimalDotInput(draft) ?? emptyAs
}

/** Same number, allowing for the rounding of a kg <-> MT round trip (1.005 * 1000 / 1000 is not 1.005). */
export function decimalValuesMatch(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

/** The text to show: the draft while it still equals `value`, else `value` itself (a reset, a reload, a pick elsewhere). */
export function resolveDecimalDraftDisplay(
  draft: string | null,
  value: number | null,
  emptyAs: number | null = null,
): string {
  if (draft !== null && decimalValuesMatch(decimalDraftToValue(draft, emptyAs), value)) return draft
  return value === null ? '' : String(value)
}
