export type PerformanceMonthKey =
  | 'MONTH_01'
  | 'MONTH_02'
  | 'MONTH_03'
  | 'MONTH_04'
  | 'MONTH_05'
  | 'MONTH_06'
  | 'MONTH_07'
  | 'MONTH_08'
  | 'MONTH_09'
  | 'MONTH_10'
  | 'MONTH_11'
  | 'MONTH_12'

export type PerformancePeriodKey = 'YTD' | 'MTD' | PerformanceMonthKey

export type PerformancePeriodOption = {
  value: PerformancePeriodKey
  label: string
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function performanceMonthKey(month1Based: number): PerformanceMonthKey {
  return `MONTH_${pad2(month1Based)}` as PerformanceMonthKey
}

export function parsePerformanceMonthKey(period: PerformancePeriodKey): number | null {
  if (!period.startsWith('MONTH_')) return null
  const month = Number.parseInt(period.slice(6), 10)
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return month
}

/** Normalize legacy keys (e.g. CURRENT_MONTH) to YTD. */
export function normalizePerformancePeriodKey(value: string): PerformancePeriodKey {
  if (value === 'YTD' || value === 'MTD') return value
  const month = parsePerformanceMonthKey(value as PerformancePeriodKey)
  if (month != null) return performanceMonthKey(month)
  return 'YTD'
}

/**
 * YTD + MTD + completed calendar months before the current month (descending).
 * Current month is covered by MTD — not listed separately.
 */
export function buildPerformancePeriodOptions(
  referenceDate = new Date(),
): PerformancePeriodOption[] {
  const options: PerformancePeriodOption[] = [
    { value: 'YTD', label: 'YTD' },
    { value: 'MTD', label: 'MTD' },
  ]

  const currentMonth1Based = referenceDate.getMonth() + 1
  for (let month = currentMonth1Based - 1; month >= 1; month -= 1) {
    options.push({
      value: performanceMonthKey(month),
      label: MONTH_LABELS[month - 1],
    })
  }

  return options
}

export function resolvePerformancePeriodDateRange(
  period: PerformancePeriodKey,
  referenceDate = new Date(),
): { dateFrom: string; dateTo: string; label: string } {
  const normalized = normalizePerformancePeriodKey(period)
  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  const day = referenceDate.getDate()
  const today = `${year}-${pad2(month + 1)}-${pad2(day)}`

  if (normalized === 'MTD') {
    return {
      dateFrom: `${year}-${pad2(month + 1)}-01`,
      dateTo: today,
      label: 'MTD',
    }
  }

  const month1Based = parsePerformanceMonthKey(normalized)
  if (month1Based != null) {
    const lastDay = new Date(year, month1Based, 0).getDate()
    return {
      dateFrom: `${year}-${pad2(month1Based)}-01`,
      dateTo: `${year}-${pad2(month1Based)}-${pad2(lastDay)}`,
      label: MONTH_LABELS[month1Based - 1],
    }
  }

  return {
    dateFrom: `${year}-01-01`,
    dateTo: today,
    label: 'YTD',
  }
}

/** Row date must fall within [dateFrom, dateTo] inclusive (ISO YYYY-MM-DD). */
export function rowMatchesPerformancePeriod(
  rowDate: string | null | undefined,
  dateFrom: string,
  dateTo: string,
): boolean {
  const iso = String(rowDate ?? '').trim().slice(0, 10)
  if (!iso) return false
  if (dateFrom && iso < dateFrom) return false
  if (dateTo && iso > dateTo) return false
  return true
}

/** Parse comma-separated contract dates into sorted distinct ISO YYYY-MM-DD values. */
export function parsePerformanceContractDateList(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  const values = new Set<string>()
  for (const part of raw.split(',')) {
    const iso = part.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) values.add(iso)
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

/**
 * STO / multi-contract rows: match if any contract date falls within [dateFrom, dateTo].
 * Single-date strings keep previous behavior.
 */
export function rowMatchesPerformancePeriodAnyDate(
  rowDates: string | null | undefined,
  dateFrom: string,
  dateTo: string,
): boolean {
  const dates = parsePerformanceContractDateList(rowDates)
  if (dates.length === 0) return false
  return dates.some((iso) => rowMatchesPerformancePeriod(iso, dateFrom, dateTo))
}
