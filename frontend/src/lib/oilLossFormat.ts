/** Oil Loss display — MT qty as whole numbers; % keeps 2 decimals. */

export function formatOilLossMtFromKg(kg: number | null | undefined): string {
  const n = Number(kg)
  const mt = Number.isFinite(n) ? n / 1000 : 0
  return mt.toLocaleString('en-US', {
    maximumFractionDigits: 0,
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
  if (value == null || !Number.isFinite(value)) return '0'
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 0,
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

/** YTD summary cards — total oil loss in MT (already in MT, not Kg). */
export function formatOilLossTotalMt(value: number | null | undefined): string {
  return formatOilLossAvgMt(value)
}

/** YTD summary cards — aggregate total oil loss % (weighted by base qty). */
export function formatOilLossTotalPct(value: number | null | undefined): string {
  return formatOilLossAvgPct(value)
}
