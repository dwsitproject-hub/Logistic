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
