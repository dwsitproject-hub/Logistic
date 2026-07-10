/** Inclusive calendar dates between start and end (YYYY-MM-DD). */
export function enumerateInclusivePlanningDates(startIso: string, endIso: string): string[] {
  const startParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso)
  const endParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endIso)
  if (!startParts || !endParts) return []
  const start = new Date(Number(startParts[1]), Number(startParts[2]) - 1, Number(startParts[3]))
  const end = new Date(Number(endParts[1]), Number(endParts[2]) - 1, Number(endParts[3]))
  if (start.getTime() > end.getTime()) return []
  const dates: string[] = []
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    dates.push(`${yyyy}-${mm}-${dd}`)
  }
  return dates
}

/**
 * Builds daily_deliverables (kg) from per-day MT planning.
 * When per-day × days exceeds outstanding (kg), earlier days keep the per-day amount
 * and the last day receives the remaining outstanding quantity.
 */
export function buildDailyDeliverablesFromPerDayPlanning(
  startIso: string,
  endIso: string,
  perDayMt: number,
  outstandingKg?: number | null,
): Array<{ date: string; quantity_delivered: number }> {
  const dates = enumerateInclusivePlanningDates(startIso, endIso)
  if (dates.length === 0 || !Number.isFinite(perDayMt) || perDayMt <= 0) return []

  const perDayKg = Math.round(perDayMt * 1000 * 100) / 100
  const numDays = dates.length
  const uncappedTotalKg = perDayKg * numDays

  const outstandingFinite =
    outstandingKg != null && Number.isFinite(outstandingKg) && outstandingKg > 0
      ? outstandingKg
      : null

  const needsCap = outstandingFinite != null && uncappedTotalKg > outstandingFinite

  if (needsCap) {
    let remainingKg = outstandingFinite!
    return dates.map((date, idx) => {
      const isLast = idx === numDays - 1
      const dayKg = isLast
        ? Math.round(remainingKg * 100) / 100
        : Math.round(Math.min(perDayKg, remainingKg) * 100) / 100
      remainingKg = Math.round((remainingKg - dayKg) * 100) / 100
      return { date, quantity_delivered: Math.max(0, dayKg) }
    })
  }

  let allocated = 0
  return dates.map((date, idx) => {
    if (idx === numDays - 1) {
      const last = Math.round((uncappedTotalKg - allocated) * 100) / 100
      return { date, quantity_delivered: last }
    }
    allocated += perDayKg
    return { date, quantity_delivered: perDayKg }
  })
}

export function sumDailyDeliverablesKg(
  rows: Array<{ quantity_delivered: number }>,
): number {
  return rows.reduce((sum, row) => sum + (Number(row.quantity_delivered) || 0), 0)
}

export function derivePerDayMtFromDailyDeliverables(
  dailyRows: Array<{ date?: string; quantity_delivered?: number }>,
  startIso: string,
  endIso: string,
): number | null {
  const dates = enumerateInclusivePlanningDates(startIso, endIso)
  if (dates.length === 0) return null

  const byDate = new Map(
    dailyRows.map((row) => [
      String(row.date ?? '').slice(0, 10),
      Number(row.quantity_delivered) || 0,
    ]),
  )

  const firstDayKg = byDate.get(dates[0]) ?? 0
  if (firstDayKg > 0) return firstDayKg / 1000

  const totalKg = dailyRows.reduce((sum, row) => sum + (Number(row.quantity_delivered) || 0), 0)
  if (totalKg <= 0) return null
  return totalKg / 1000 / dates.length
}

/** Returns validation message when per-day × days exceeds outstanding (kg), else null. */
export function getPlanningExceedsOutstandingError(args: {
  perDayMt: number
  startIso: string
  endIso: string
  outstandingKg?: number | null
  formatMt?: (value: number) => string
}): string | null {
  const dates = enumerateInclusivePlanningDates(args.startIso, args.endIso)
  if (dates.length === 0 || !Number.isFinite(args.perDayMt) || args.perDayMt <= 0) return null
  const outstandingKg = args.outstandingKg
  if (outstandingKg == null || !Number.isFinite(outstandingKg) || outstandingKg <= 0) return null

  const totalMt = args.perDayMt * dates.length
  const outstandingMt = outstandingKg / 1000
  if (totalMt <= outstandingMt + 1e-9) return null

  const fmt = args.formatMt ?? ((n: number) => String(Math.round(n * 100) / 100))
  const days = dates.length
  const dayLabel = days === 1 ? 'day' : 'days'
  return `Total planned delivery (${fmt(totalMt)} MT over ${days} ${dayLabel}) exceeds Outstanding Qty (${fmt(outstandingMt)} MT). Reduce qty per day or shorten the planning period.`
}
