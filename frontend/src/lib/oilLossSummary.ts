import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

export type ROilLossKey = 'r1' | 'r2' | 'r3' | 'r4'

export type ROilLossSummary = {
  avgMt: number | null
  avgPct: number | null
  totalMt: number | null
  totalPct: number | null
  sampleCount?: number
}

export type YtdOilLossSummary = {
  year: number
  dateFrom: string
  dateTo: string
  r1: ROilLossSummary
  r2: ROilLossSummary
  r3: ROilLossSummary
  r4: ROilLossSummary
}

function parseQty(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function resolveContractDate(row: OilLossSourceRow): string {
  return String(row.contract_date ?? row.operation_date ?? '').slice(0, 10)
}

export function getYtdDateRange(referenceDate = new Date()): { year: number; dateFrom: string; dateTo: string } {
  const year = referenceDate.getFullYear()
  const dateFrom = `${year}-01-01`
  const dateTo = referenceDate.toISOString().slice(0, 10)
  return { year, dateFrom, dateTo }
}

export function filterYtdOilLossRows(
  rows: OilLossSourceRow[],
  referenceDate = new Date(),
): OilLossSourceRow[] {
  const { dateFrom, dateTo } = getYtdDateRange(referenceDate)
  return filterOilLossRowsByDateRange(rows, dateFrom, dateTo)
}

export function filterOilLossRowsByDateRange(
  rows: OilLossSourceRow[],
  dateFrom: string,
  dateTo: string,
): OilLossSourceRow[] {
  return rows.filter((row) => {
    const d = resolveContractDate(row)
    if (!d) return false
    if (dateFrom && d < dateFrom) return false
    if (dateTo && d > dateTo) return false
    return true
  })
}

export function buildOilLossSummaryForDateRange(
  rows: OilLossSourceRow[],
  dateFrom: string,
  dateTo: string,
): YtdOilLossSummary {
  const year = Number(dateFrom.slice(0, 4)) || new Date().getFullYear()
  const periodRows = filterOilLossRowsByDateRange(rows, dateFrom, dateTo)
  return {
    year,
    dateFrom,
    dateTo,
    r1: computeROilLossSummary(periodRows, 'r1'),
    r2: computeROilLossSummary(periodRows, 'r2'),
    r3: computeROilLossSummary(periodRows, 'r3'),
    r4: computeROilLossSummary(periodRows, 'r4'),
  }
}

function contractGroupKey(row: OilLossSourceRow): string {
  const cn = String(row.contract_number ?? '').trim()
  if (cn) return `cn:${cn}`
  const ext = String(row.contract_ext_no ?? '').trim()
  if (ext) return `ext:${ext}`
  return `row:${row.id}`
}

type ContractQuantityAgg = {
  quantity_sent: number
  quantity_received: number
  quantity_sfal: number
  quantity_sfbd: number
  has_sent: boolean
  has_received: boolean
  has_sfal: boolean
  has_sfbd: boolean
}

function aggregateOilLossQuantitiesByContract(rows: OilLossSourceRow[]): Map<string, ContractQuantityAgg> {
  const map = new Map<string, ContractQuantityAgg>()

  for (const row of rows) {
    const key = contractGroupKey(row)
    let agg = map.get(key)
    if (!agg) {
      agg = {
        quantity_sent: 0,
        quantity_received: 0,
        quantity_sfal: 0,
        quantity_sfbd: 0,
        has_sent: false,
        has_received: false,
        has_sfal: false,
        has_sfbd: false,
      }
      map.set(key, agg)
    }
    const delivery = parseQty(row.quantity_sent)
    const receive = parseQty(row.quantity_received)
    const sfal = parseQty(row.quantity_sfal)
    const sfbd = parseQty(row.quantity_sfbd)
    if (delivery != null) {
      agg.quantity_sent += delivery
      agg.has_sent = true
    }
    if (receive != null) {
      agg.quantity_received += receive
      agg.has_received = true
    }
    if (sfal != null) {
      agg.quantity_sfal += sfal
      agg.has_sfal = true
    }
    if (sfbd != null) {
      agg.quantity_sfbd += sfbd
      agg.has_sfbd = true
    }
  }

  return map
}

function sampleFromContractAgg(
  agg: ContractQuantityAgg,
  kind: ROilLossKey,
): { lossKg: number; baseKg: number; pct: number; deliveryKg: number } | null {
  const delivery = agg.quantity_sent
  const receive = agg.quantity_received
  const sfal = agg.quantity_sfal
  const sfbd = agg.quantity_sfbd

  let lossKg: number | null = null
  let baseKg: number | null = null

  if (kind === 'r1' && agg.has_sfal && agg.has_sent && delivery > 0) {
    lossKg = sfal - delivery
    baseKg = delivery
  } else if (kind === 'r2' && agg.has_sfbd && agg.has_sfal && sfal > 0) {
    lossKg = sfbd - sfal
    baseKg = sfal
  } else if (kind === 'r3' && agg.has_received && agg.has_sfbd && sfbd > 0) {
    lossKg = receive - sfbd
    baseKg = sfbd
  } else if (kind === 'r4' && agg.has_received && agg.has_sent && delivery > 0) {
    lossKg = receive - delivery
    baseKg = delivery
  }

  if (lossKg == null || baseKg == null || baseKg <= 0) return null
  return {
    lossKg,
    baseKg,
    pct: (lossKg / baseKg) * 100,
    deliveryKg: agg.has_sent ? delivery : 0,
  }
}

export function computeROilLossSummary(rows: OilLossSourceRow[], kind: ROilLossKey): ROilLossSummary {
  const byContract = aggregateOilLossQuantitiesByContract(rows)
  const samples: { lossKg: number; baseKg: number; pct: number; deliveryKg: number }[] = []

  for (const agg of byContract.values()) {
    const sample = sampleFromContractAgg(agg, kind)
    if (sample) samples.push(sample)
  }

  if (samples.length === 0) {
    return { avgMt: null, avgPct: null, totalMt: null, totalPct: null, sampleCount: 0 }
  }

  const count = samples.length
  const totalLossKg = samples.reduce((sum, s) => sum + s.lossKg, 0)

  let weightedPctNumerator = 0
  let deliveryWeightSum = 0
  for (const s of samples) {
    if (s.deliveryKg <= 0) continue
    weightedPctNumerator += s.deliveryKg * s.pct
    deliveryWeightSum += s.deliveryKg
  }

  return {
    avgMt: totalLossKg / count / 1000,
    avgPct: samples.reduce((sum, s) => sum + s.pct, 0) / count,
    totalMt: totalLossKg / 1000,
    /** Weighted avg % by Qty Delivery across active contracts. */
    totalPct: deliveryWeightSum > 0 ? weightedPctNumerator / deliveryWeightSum : null,
    sampleCount: count,
  }
}

/** Sum of R4 oil loss % per contract — additive total (matches Section 1 totalPct). */
export function sumR4OilLossPctByContract(rows: OilLossSourceRow[]): number {
  const byContract = aggregateOilLossQuantitiesByContract(rows)
  let sum = 0
  for (const agg of byContract.values()) {
    const sample = sampleFromContractAgg(agg, 'r4')
    if (sample) sum += sample.pct
  }
  return sum
}

export function buildYtdOilLossSummary(
  rows: OilLossSourceRow[],
  referenceDate = new Date(),
): YtdOilLossSummary {
  const { year, dateFrom, dateTo } = getYtdDateRange(referenceDate)
  const ytdRows = filterYtdOilLossRows(rows, referenceDate)

  return {
    year,
    dateFrom,
    dateTo,
    r1: computeROilLossSummary(ytdRows, 'r1'),
    r2: computeROilLossSummary(ytdRows, 'r2'),
    r3: computeROilLossSummary(ytdRows, 'r3'),
    r4: computeROilLossSummary(ytdRows, 'r4'),
  }
}
