import { formatDateDMY } from '@/lib/dateFormat'

export type KlipSapCompareFormat = 'date' | 'number'

function normalizeDate(value: unknown): string {
  if (value == null || value === '') return ''
  return String(value).trim().slice(0, 10)
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatKlipSapDisplayValue(
  value: unknown,
  format: KlipSapCompareFormat,
): string {
  if (format === 'date') {
    const normalized = normalizeDate(value)
    return normalized ? formatDateDMY(normalized) : '—'
  }
  const num = parseNumber(value)
  if (num == null) return '—'
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function klipSapValuesEqual(
  klipValue: unknown,
  sapValue: unknown,
  format: KlipSapCompareFormat,
): boolean {
  if (format === 'date') {
    const k = normalizeDate(klipValue)
    const s = normalizeDate(sapValue)
    if (!k && !s) return true
    return k === s
  }
  const k = parseNumber(klipValue)
  const s = parseNumber(sapValue)
  if (k == null && s == null) return true
  if (k == null || s == null) return false
  return Math.abs(k - s) < 1e-9
}

export function formatDateDelta(klipValue: unknown, sapValue: unknown): string | null {
  const k = normalizeDate(klipValue)
  const s = normalizeDate(sapValue)
  if (!k || !s || k === s) return null
  const kMs = Date.parse(k)
  const sMs = Date.parse(s)
  if (Number.isNaN(kMs) || Number.isNaN(sMs)) return null
  const days = Math.round((kMs - sMs) / (1000 * 60 * 60 * 24))
  if (days === 0) return null
  return days > 0 ? `+${days}d` : `${days}d`
}

export function formatNumberDelta(klipValue: unknown, sapValue: unknown): string | null {
  const k = parseNumber(klipValue)
  const s = parseNumber(sapValue)
  if (k == null || s == null) return null
  const delta = k - s
  if (Math.abs(delta) < 1e-9) return null
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

export function formatKlipSapDelta(
  klipValue: unknown,
  sapValue: unknown,
  format: KlipSapCompareFormat,
): string | null {
  return format === 'date'
    ? formatDateDelta(klipValue, sapValue)
    : formatNumberDelta(klipValue, sapValue)
}

export function hasKlipSapMismatch(
  klipValue: unknown,
  sapValue: unknown,
  format: KlipSapCompareFormat,
): boolean {
  const sapEmpty =
    format === 'date'
      ? !normalizeDate(sapValue)
      : parseNumber(sapValue) == null
  if (sapEmpty) return false
  return !klipSapValuesEqual(klipValue, sapValue, format)
}
