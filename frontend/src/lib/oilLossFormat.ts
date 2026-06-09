/** Oil Loss display — always 2 decimal places for MT and %. */

export function formatOilLossMtFromKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(Number(kg))) return '—'
  const mt = Number(kg) / 1000
  return mt.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
}

export function formatOilLossPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })}%`
}

/** YTD summary cards — avg oil loss in MT (already in MT, not Kg). */
export function formatOilLossAvgMt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
}

/** YTD summary cards — avg oil loss %. */
export function formatOilLossAvgPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })}%`
}
