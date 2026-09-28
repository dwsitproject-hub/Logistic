import { formatDateDMY } from '@/lib/dateFormat'

export type KlipSapCompareFormat = 'date' | 'number' | 'text'

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

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\r/g, '').trim()
}

export function formatKlipSapDisplayValue(
  value: unknown,
  format: KlipSapCompareFormat,
): string {
  if (format === 'text') {
    const text = normalizeText(value)
    return text || '—'
  }
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
  if (format === 'text') {
    const k = normalizeText(klipValue).toUpperCase()
    const s = normalizeText(sapValue).toUpperCase()
    if (!k && !s) return true
    return k === s
  }
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
  if (format === 'text') return null
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
    format === 'text'
      ? !normalizeText(sapValue)
      : format === 'date'
        ? !normalizeDate(sapValue)
        : parseNumber(sapValue) == null
  if (sapEmpty) return false
  return !klipSapValuesEqual(klipValue, sapValue, format)
}

/**
 * Does this field hold anything at all, in the format's own terms?
 *
 * Needed to tell "no value" apart from "a value that happens to match SAP" - the badge means
 * different things in those two cases, and treating them alike is how a blank field ended up
 * claiming to be KLIP input.
 */
export function hasKlipSapValue(value: unknown, format: KlipSapCompareFormat): boolean {
  return formatKlipSapDisplayValue(value, format) !== '—'
}

export type KlipSapProvenance = 'none' | 'sap' | 'klip' | 'jps'

/** The sources a displayed value can have come from, as the data records them. */
export type KlipSapRecordedSource = 'sap' | 'klip' | 'jps'

/**
 * Where did the value on screen come from?
 *
 * Three doors can write an ATA-ATC date: the SAP import, a KLIP user, and now the Jetty Planning
 * System. Decided in this order, strongest evidence first:
 *
 *   none    the field is empty.
 *   source  the data RECORDS who wrote it. A recorded fact beats any inference below, so when the
 *           backend can say, it is trusted as-is.
 *   klip    a KLIP user is recorded as having edited it.
 *   jps     it equals what JPS reported and NOT what SAP reported - or SAP reported nothing. When
 *           JPS and SAP agree the badge says SAP: SAP is the system of record, and a second system
 *           agreeing with it is not a different origin.
 *   klip    it differs from SAP, and JPS did not supply it either, so KLIP is the only door left.
 *   sap     it matches SAP.
 *   klip    a filled value with no SAP or JPS counterpart at all.
 *
 * `jpsValue` and `source` are optional, so every caller written before JPS existed gets exactly the
 * answer it got before.
 */
export function resolveKlipSapProvenance({
  klipValue,
  sapValue,
  format,
  klipEdited = false,
  jpsValue,
  source,
}: {
  klipValue: unknown
  sapValue: unknown
  format: KlipSapCompareFormat
  klipEdited?: boolean
  jpsValue?: unknown
  source?: KlipSapRecordedSource | null
}): KlipSapProvenance {
  if (!hasKlipSapValue(klipValue, format)) return 'none'
  if (source === 'sap' || source === 'klip' || source === 'jps') return source
  if (klipEdited) return 'klip'
  const sapHas = hasKlipSapValue(sapValue, format)
  const matchesSap = sapHas && klipSapValuesEqual(klipValue, sapValue, format)
  if (
    !matchesSap &&
    hasKlipSapValue(jpsValue, format) &&
    klipSapValuesEqual(klipValue, jpsValue, format)
  ) {
    return 'jps'
  }
  if (hasKlipSapMismatch(klipValue, sapValue, format)) return 'klip'
  if (sapHas) return 'sap'
  return 'klip'
}

/**
 * Show SAP's own value underneath when the one on screen came from somewhere else.
 *
 * Covers JPS as well as KLIP: a JPS date that disagrees with SAP is exactly the case a reviewer
 * needs both numbers for.
 */
export function shouldShowKlipSapFooter(
  provenance: KlipSapProvenance,
  sapValue: unknown,
  format: KlipSapCompareFormat,
): boolean {
  return (provenance === 'klip' || provenance === 'jps') && hasKlipSapValue(sapValue, format)
}

/**
 * Show what JPS reported when it differs from the value on screen.
 *
 * The reverse of the SAP footer: the jetty has its own actuals, and when a KLIP user or SAP says
 * something else, that disagreement is worth seeing rather than silently resolved by precedence.
 *
 * An EMPTY field is included on purpose. The jetty logs arrival and berthing as they happen, days
 * before SAP reports them, so "the field is blank but JPS already knows" is the most common case
 * this footer exists for, not an edge of it.
 */
export function shouldShowJpsReferenceFooter(
  provenance: KlipSapProvenance,
  displayedValue: unknown,
  jpsValue: unknown,
  format: KlipSapCompareFormat,
): boolean {
  if (provenance === 'jps') return false
  if (!hasKlipSapValue(jpsValue, format)) return false
  return !klipSapValuesEqual(displayedValue, jpsValue, format)
}
