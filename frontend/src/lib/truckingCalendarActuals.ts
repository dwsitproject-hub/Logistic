export type TruckingCalendarQtyRow = {
  id: string
  daily_deliverables?: Array<{ date?: string; quantity_delivered?: number }>
  daily_actuals?: Array<{ date?: string; quantity_delivered?: number }>
  delivery_start_date?: string
  delivery_end_date?: string
}

export function toLocalIsoDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** H+1 = calendar tomorrow (local date). */
export function getHPlusOneIsoDate(ref = new Date()): string {
  const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  base.setDate(base.getDate() + 1)
  return toLocalIsoDate(base)
}

export function getRowDueDateBounds(row: TruckingCalendarQtyRow): { start: string; end: string } | null {
  const start = (row.delivery_start_date || '').slice(0, 10)
  const end = (row.delivery_end_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  return { start, end }
}

export function isDateInDueWindow(row: TruckingCalendarQtyRow, dateIso: string): boolean {
  const bounds = getRowDueDateBounds(row)
  if (!bounds) return true
  const date = dateIso.slice(0, 10)
  return date >= bounds.start && date <= bounds.end
}

export function getPlanningQtyKgForDate(row: TruckingCalendarQtyRow, dateIso: string): number {
  const date = dateIso.slice(0, 10)
  const entry = (row.daily_deliverables || []).find((x) => (x?.date || '').slice(0, 10) === date)
  return Number(entry?.quantity_delivered || 0)
}

export function hasActualRecordForDate(row: TruckingCalendarQtyRow, dateIso: string): boolean {
  const date = dateIso.slice(0, 10)
  return (row.daily_actuals || []).some((x) => (x?.date || '').slice(0, 10) === date)
}

export function shouldAutoPromoteHPlusOnePlanning(
  row: TruckingCalendarQtyRow,
  tomorrowIso: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tomorrowIso)) return false
  if (!isDateInDueWindow(row, tomorrowIso)) return false
  if (hasActualRecordForDate(row, tomorrowIso)) return false
  return getPlanningQtyKgForDate(row, tomorrowIso) > 0
}

/** Display qty: actual record, else planning (incl. H+1 before background persist). */
export function resolveCalendarCellQtyKg(
  row: TruckingCalendarQtyRow,
  dateIso: string,
  tomorrowIso = getHPlusOneIsoDate(),
): number {
  const date = dateIso.slice(0, 10)
  if (hasActualRecordForDate(row, date)) {
    const entry = (row.daily_actuals || []).find((x) => (x?.date || '').slice(0, 10) === date)
    return Number(entry?.quantity_delivered || 0)
  }
  return getPlanningQtyKgForDate(row, date)
}

/** First/last ISO dates with resolved qty > 0 (planning or actual). */
export function getRowFilledQtyDateBounds(
  row: TruckingCalendarQtyRow,
  tomorrowIso = getHPlusOneIsoDate(),
): { start: string; end: string } | null {
  const candidates = new Set<string>()
  for (const x of row.daily_deliverables || []) {
    const d = (x?.date || '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) candidates.add(d)
  }
  for (const x of row.daily_actuals || []) {
    const d = (x?.date || '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) candidates.add(d)
  }
  const filled: string[] = []
  for (const d of candidates) {
    if (resolveCalendarCellQtyKg(row, d, tomorrowIso) > 0) filled.push(d)
  }
  if (filled.length === 0) return null
  filled.sort()
  return { start: filled[0]!, end: filled[filled.length - 1]! }
}

/** Min start / max end of filled qty dates across rows (e.g. calendar day-column span). */
export function getCalendarFilledQtyDateBounds(
  rows: TruckingCalendarQtyRow[],
  tomorrowIso = getHPlusOneIsoDate(),
): { start: string; end: string } | null {
  let min: string | null = null
  let max: string | null = null
  for (const row of rows) {
    const bounds = getRowFilledQtyDateBounds(row, tomorrowIso)
    if (!bounds) continue
    if (!min || bounds.start < min) min = bounds.start
    if (!max || bounds.end > max) max = bounds.end
  }
  return min && max ? { start: min, end: max } : null
}

/**
 * Day-of-month numbers to show in the calendar grid for `month`,
 * clipped to the filled-qty span across rows (inclusive).
 */
export function getCalendarFilledQtyDaysInMonth(
  rows: TruckingCalendarQtyRow[],
  month: Date,
  tomorrowIso = getHPlusOneIsoDate(),
): number[] {
  const bounds = getCalendarFilledQtyDateBounds(rows, tomorrowIso)
  if (!bounds) return []
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const prefix = `${yyyy}-${String(mm + 1).padStart(2, '0')}-`
  const monthStart = `${prefix}01`
  const monthEnd = `${prefix}${String(daysInMonth).padStart(2, '0')}`
  if (bounds.end < monthStart || bounds.start > monthEnd) return []
  const startIso = bounds.start > monthStart ? bounds.start : monthStart
  const endIso = bounds.end < monthEnd ? bounds.end : monthEnd
  const startDay = Number(startIso.slice(8, 10))
  const endDay = Number(endIso.slice(8, 10))
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || startDay > endDay) return []
  return Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i)
}

export async function applyHPlusOnePlanningPromotions<T extends TruckingCalendarQtyRow & { id: string }>(
  rows: T[],
  upsertActual: (
    rowId: string,
    progressDate: string,
    quantityKg: number,
  ) => Promise<Array<{ date: string; quantity_delivered: number }> | undefined>,
  tomorrowIso = getHPlusOneIsoDate(),
): Promise<T[]> {
  let updated = rows
  for (const row of rows) {
    if (!shouldAutoPromoteHPlusOnePlanning(row, tomorrowIso)) continue
    const qtyKg = getPlanningQtyKgForDate(row, tomorrowIso)
    const dailyActuals = await upsertActual(row.id, tomorrowIso, qtyKg)
    if (dailyActuals) {
      updated = updated.map((r) => (r.id === row.id ? { ...r, daily_actuals: dailyActuals } : r))
    }
  }
  return updated
}
