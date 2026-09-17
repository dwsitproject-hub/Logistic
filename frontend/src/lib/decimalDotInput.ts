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
