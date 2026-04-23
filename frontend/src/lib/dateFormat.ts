import { format, isValid, parseISO } from 'date-fns'

/**
 * Parse common KLIP date inputs for display. Prefer calendar date for YYYY-MM-DD
 * to avoid UTC off-by-one when the string has no time component.
 */
function parseForDisplay(input: string): Date | null {
  const s = String(input).trim()
  if (!s) return null
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const isoTry = parseISO(s)
  if (isValid(isoTry)) return isoTry
  const fallback = new Date(s)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** Date only: DD/MM/YYYY */
export function formatDateDMY(input: string | Date | null | undefined): string {
  if (input === null || input === undefined || input === '') return '-'
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? '-' : format(input, 'dd/MM/yyyy')
  }
  const d = parseForDisplay(input)
  if (!d) return '-'
  return format(d, 'dd/MM/yyyy')
}

/** Date + time: DD/MM/YYYY HH:mm (24h) */
export function formatDateTimeDMY(input: string | Date | null | undefined): string {
  if (input === null || input === undefined || input === '') return '-'
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? '-' : format(input, 'dd/MM/yyyy HH:mm')
  }
  const d = parseForDisplay(input)
  if (!d) return '-'
  return format(d, 'dd/MM/yyyy HH:mm')
}

/** Time only HH:mm:ss (24h), for pairing with a separate date line */
export function formatTimeHMS(input: string | Date | null | undefined): string {
  if (input === null || input === undefined || input === '') return '-'
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? '-' : format(input, 'HH:mm:ss')
  }
  const d = parseForDisplay(input)
  if (!d) return '-'
  return format(d, 'HH:mm:ss')
}

/** For DD/MM/YYYY text inputs (empty string if no value) */
export function isoDateStringToDdMmYyyy(iso: string | null | undefined): string {
  if (iso == null || iso === '') return ''
  const d = parseForDisplay(String(iso))
  if (!d) return ''
  return format(d, 'dd/MM/yyyy')
}

/** Strict DD/MM/YYYY → YYYY-MM-DD for API / DB */
export function parseDdMmYyyyToIso(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  // Accept ISO date (or full ISO) pasted in.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (ymd) {
    const yyyy = Number(ymd[1])
    const mm = Number(ymd[2])
    const dd = Number(ymd[3])
    const d = new Date(yyyy, mm - 1, dd)
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }

  // Accept digits-only DDMMYYYY (common from spreadsheets when copied as text)
  const digitsOnly = t.replace(/[^\d]/g, '')
  if (digitsOnly.length === 8) {
    const dd = Number(digitsOnly.slice(0, 2))
    const mm = Number(digitsOnly.slice(2, 4))
    const yyyy = Number(digitsOnly.slice(4, 8))
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
    const d = new Date(yyyy, mm - 1, dd)
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }

  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (!dmy) return null
  const dd = Number(dmy[1])
  const mm = Number(dmy[2])
  const yyyy = Number(dmy[3])
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const d = new Date(yyyy, mm - 1, dd)
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}
