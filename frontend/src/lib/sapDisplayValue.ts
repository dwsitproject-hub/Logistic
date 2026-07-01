/**
 * Normalize missing SAP / DB placeholders for UI display.
 * Null, empty, "Unknown", "Blank", etc. render as "-" in tables and modals.
 */

import { formatOutstandingQtyMtFromKg, formatQtyMtFromKg } from '@/lib/utils'

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

/** True when a numeric SAP field is missing (null/undefined/empty/non-finite). Real zero is not empty. */
export function isEmptySapNumericValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  const raw =
    typeof value === 'string' ? value.replace(/,/g, '').replace(/\s+/g, '').trim() : value
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  return !Number.isFinite(n)
}

/** Format SAP numeric fields for display — null/missing → "-", real zero stays zero. */
export function formatSapDisplayNumber(
  value: number | string | null | undefined,
  opts?: { maxFractionDigits?: number; suffix?: string },
): string {
  if (isEmptySapNumericValue(value)) return '-'
  const raw =
    typeof value === 'string' ? value.replace(/,/g, '').replace(/\s+/g, '').trim() : value
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  const maxFractionDigits = opts?.maxFractionDigits ?? 2
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
    useGrouping: true,
  })
  return opts?.suffix ? `${formatted}${opts.suffix}` : formatted
}

/** SAP quantity stored in kg — display as MT; null SAP → "-". */
export function formatSapQtyMtDisplay(
  kg: number | string | null | undefined,
  opts?: { maxFractionDigits?: number },
): string {
  return formatQtyMtFromKg(kg, opts)
}

/** SAP outstanding quantity in kg — display as MT with over-delivery styling context; null → "-". */
export function formatSapOutstandingQtyMtDisplay(kg: number | string | null | undefined): string {
  return formatOutstandingQtyMtFromKg(kg)
}
