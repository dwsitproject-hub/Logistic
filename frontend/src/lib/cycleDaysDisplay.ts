/** Shared Late (red) / On Time (green) styling for cycle-day metrics. */

export const CYCLE_DAYS_LATE_CLASS = 'text-red-600'
export const CYCLE_DAYS_ON_TIME_CLASS = 'text-green-600'
export const CYCLE_DAYS_NEUTRAL_CLASS = 'text-gray-500'

/** Aligns with the "Unusual" flag threshold on contracts. */
export const LOG_CYCLE_LATE_THRESHOLD_DAYS = 35

export function contextPerformanceClass(isLateContext: boolean): string {
  return isLateContext ? CYCLE_DAYS_LATE_CLASS : CYCLE_DAYS_ON_TIME_CLASS
}

/** Trade / cash cycle: > 0 = late, ≤ 0 = on time (same day = on time). */
export function signedCycleDaysClass(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return CYCLE_DAYS_NEUTRAL_CLASS
  return days > 0 ? CYCLE_DAYS_LATE_CLASS : CYCLE_DAYS_ON_TIME_CLASS
}

/** Log cycle duration: prefer trade-cycle sign; fallback to duration threshold. */
export function logCycleDaysClass(
  logDays: number | null | undefined,
  tradeCycleDays?: number | null | undefined,
): string {
  if (typeof tradeCycleDays === 'number' && Number.isFinite(tradeCycleDays)) {
    if (tradeCycleDays === 0) return CYCLE_DAYS_ON_TIME_CLASS
    return tradeCycleDays > 0 ? CYCLE_DAYS_LATE_CLASS : CYCLE_DAYS_ON_TIME_CLASS
  }
  if (logDays == null || !Number.isFinite(logDays)) return CYCLE_DAYS_NEUTRAL_CLASS
  return logDays >= LOG_CYCLE_LATE_THRESHOLD_DAYS ? CYCLE_DAYS_LATE_CLASS : CYCLE_DAYS_ON_TIME_CLASS
}

/** Unsigned duration metrics (e.g. weighted avg log cycle on dashboard). */
export function durationCycleDaysClass(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return CYCLE_DAYS_NEUTRAL_CLASS
  return days >= LOG_CYCLE_LATE_THRESHOLD_DAYS ? CYCLE_DAYS_LATE_CLASS : CYCLE_DAYS_ON_TIME_CLASS
}

/** Magnitude for display — late/ahead is shown via color, not a "-" prefix. */
function daysMagnitude(days: number): number {
  return Math.abs(days)
}

export function formatSignedCycleDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '-'
  if (days === 0) return '0 days'
  const abs = daysMagnitude(days)
  const unit = abs === 1 ? 'day' : 'days'
  return days > 0 ? `${abs} ${unit} late` : `${abs} ${unit} ahead`
}

/** Contract Performance Section 3 — magnitude only; late/ahead shown via text color. */
export function formatSignedCycleDaysCompact(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '-'
  if (days === 0) return '0 days'
  const abs = daysMagnitude(days)
  const unit = abs === 1 ? 'day' : 'days'
  return `${abs} ${unit}`
}

export function formatContractAgingDays(days: number): string {
  if (days === 0) return 'Due today'
  const abs = daysMagnitude(days)
  const unit = abs === 1 ? 'day' : 'days'
  return days > 0 ? `${abs} ${unit} late` : `${abs} ${unit} ahead`
}

export function formatLogCycleDays(
  days: number | null | undefined,
  tradeCycleDays?: number | null | undefined,
): string {
  if (days == null || !Number.isFinite(days)) return '-'
  const count = daysMagnitude(days)
  const unit = count === 1 ? 'day' : 'days'
  const late =
    typeof tradeCycleDays === 'number' && Number.isFinite(tradeCycleDays)
      ? tradeCycleDays > 0
      : count >= LOG_CYCLE_LATE_THRESHOLD_DAYS
  return late ? `${count} ${unit} late` : `${count} ${unit} ahead`
}

/** Contract Performance Section 3 — magnitude only; late/ahead shown via text color. */
export function formatLogCycleDaysCompact(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '-'
  const count = daysMagnitude(days)
  const unit = count === 1 ? 'day' : 'days'
  return `${count} ${unit}`
}

/** Raw signed delta (e.g. shipping performance columns) — magnitude only, color shows late/ahead. */
export function formatSignedDeltaDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '-'
  if (days === 0) return '0'
  return String(daysMagnitude(days))
}

export function formatAvgDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '- days'
  const rounded = daysMagnitude(Math.round(days))
  const unit = rounded === 1 ? 'day' : 'days'
  return `${rounded} ${unit}`
}

/** Section 1 status cards: nullable cycle averages; trade avg when no contracts in scope. */
export function statusCardAvgDaysClass(
  days: number | null | undefined,
  isLateContext: boolean,
): string {
  if (days == null || !Number.isFinite(days)) return CYCLE_DAYS_NEUTRAL_CLASS
  return contextPerformanceClass(isLateContext)
}

export function avgDaysMetricLabel(isLateContext: boolean): string {
  return isLateContext ? 'Avg Late' : 'Avg Ahead'
}

/** Display label for backend late_indicator values. */
export function formatLateIndicatorLabel(value: string | null | undefined): string {
  if (!value) return '-'
  if (value === 'On Time') return 'Ahead'
  return value
}
