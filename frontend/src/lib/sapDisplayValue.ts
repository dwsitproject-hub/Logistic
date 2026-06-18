/**
 * Normalize missing SAP / DB placeholders for UI display.
 * Null, empty, "Unknown", "Blank", etc. render as "-" in tables and modals.
 */

const SAP_EMPTY_DISPLAY_VALUES = new Set([
  'unknown',
  'blank',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  '-',
  '—',
])

export function isEmptySapDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const trimmed = String(value).trim()
  if (!trimmed) return true
  return SAP_EMPTY_DISPLAY_VALUES.has(trimmed.toLowerCase())
}

export function formatSapDisplayValue(value: unknown, fallback = '-'): string {
  if (isEmptySapDisplayValue(value)) return fallback
  return String(value).trim()
}

/** Chart / drilldown row labels (maps internal "Blank" keys to "-"). */
export function formatSapGroupDisplayLabel(key: string, fallback = '-'): string {
  return formatSapDisplayValue(key, fallback)
}
