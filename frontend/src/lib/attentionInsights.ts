/** Shared Attention Needed + Aging Overdue types (Trucking + Shipments). */

export interface AttentionInsightsTopSupplier {
  supplier: string
  osKg: number
}

export interface AttentionInsightsTopVessel {
  vessel: string
  osKg: number
}

export interface AttentionInsightsCarryOver {
  labelMonth: string
  totalKg: number
  unplannedLateKg: number
}

export interface AttentionInsightsPaidUndelivered {
  totalOsKg: number
  contractCount: number
}

export interface AttentionInsightsIncomingAnomaly {
  supplierCount: number
  topSuppliers: string[]
}

export interface AttentionInsightsLossRow {
  supplier: string
  gainLossPct: number
}

/** Base shape shared by both modules. */
export interface AttentionInsightsData {
  /** Trucking: open contract count */
  contractCount: number
  /** Shipments: overdue shipment count (STO / operation / sto_key) */
  vesselCount?: number
  totalOsKg: number
  bucket1To7Kg: number
  bucket8To30Kg: number
  bucketGt30Kg: number
  osGt30Kg: number
  pctOfTotalOs: number | null
  topSuppliers: AttentionInsightsTopSupplier[]
  topVessels?: AttentionInsightsTopVessel[]
  carryOver: AttentionInsightsCarryOver | null
  paidUndelivered?: AttentionInsightsPaidUndelivered | null
  incomingAnomaly?: AttentionInsightsIncomingAnomaly | null
  lossAboveThreshold: AttentionInsightsLossRow[]
  /** Trucking: 3rd Party / In-house split */
  thirdPartyOsKg?: number
  intercoOsKg?: number
  /** Shipments: FOB / CIF split */
  fobOsKg?: number
  cifOsKg?: number
}

function mapTopSuppliers(raw: unknown): AttentionInsightsTopSupplier[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const s = item as Record<string, unknown>
      return {
        supplier: String(s.supplier ?? '').trim(),
        osKg: Number(s.osKg ?? 0) || 0,
      }
    })
    .filter((s) => s.supplier)
}

function mapTopVessels(raw: unknown): AttentionInsightsTopVessel[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const v = item as Record<string, unknown>
      return {
        vessel: String(v.vessel ?? '').trim(),
        osKg: Number(v.osKg ?? 0) || 0,
      }
    })
    .filter((v) => v.vessel)
}

function mapLossRows(raw: unknown): AttentionInsightsLossRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const s = item as Record<string, unknown>
    return {
      supplier: String(s.supplier ?? 'Unknown').trim() || 'Unknown',
      gainLossPct: Number(s.gainLossPct ?? 0) || 0,
    }
  })
}

function mapCarryOver(raw: unknown): AttentionInsightsCarryOver | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const totalKg = Number(c.totalKg ?? 0) || 0
  if (totalKg <= 0) return null
  return {
    labelMonth: String(c.labelMonth ?? 'Prior month'),
    totalKg,
    unplannedLateKg: Number(c.unplannedLateKg ?? 0) || 0,
  }
}

function mapPaidUndelivered(raw: unknown): AttentionInsightsPaidUndelivered | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const totalOsKg = Number(row.totalOsKg ?? 0) || 0
  if (totalOsKg <= 0) return null
  return {
    totalOsKg,
    contractCount: Number(row.contractCount ?? 0) || 0,
  }
}

function mapIncomingAnomaly(raw: unknown): AttentionInsightsIncomingAnomaly | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const supplierCount = Number(row.supplierCount ?? 0) || 0
  if (supplierCount <= 0) return null
  const topSuppliers = Array.isArray(row.topSuppliers)
    ? row.topSuppliers.map((s) => String(s ?? '').trim()).filter(Boolean)
    : []
  return { supplierCount, topSuppliers }
}

/** Map API camelCase payload from summary.attentionInsights. */
export function mapAttentionInsights(raw: unknown): AttentionInsightsData | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  return {
    contractCount: Number(row.contractCount ?? row.vesselCount ?? 0) || 0,
    vesselCount: row.vesselCount != null ? Number(row.vesselCount) || 0 : undefined,
    totalOsKg: Number(row.totalOsKg ?? 0) || 0,
    thirdPartyOsKg: row.thirdPartyOsKg != null ? Number(row.thirdPartyOsKg) || 0 : undefined,
    intercoOsKg: row.intercoOsKg != null ? Number(row.intercoOsKg) || 0 : undefined,
    fobOsKg: row.fobOsKg != null ? Number(row.fobOsKg) || 0 : undefined,
    cifOsKg: row.cifOsKg != null ? Number(row.cifOsKg) || 0 : undefined,
    bucket1To7Kg: Number(row.bucket1To7Kg ?? 0) || 0,
    bucket8To30Kg: Number(row.bucket8To30Kg ?? 0) || 0,
    bucketGt30Kg: Number(row.bucketGt30Kg ?? 0) || 0,
    osGt30Kg: Number(row.osGt30Kg ?? 0) || 0,
    pctOfTotalOs: row.pctOfTotalOs == null ? null : Number(row.pctOfTotalOs),
    topSuppliers: mapTopSuppliers(row.topSuppliers),
    topVessels: mapTopVessels(row.topVessels),
    carryOver: mapCarryOver(row.carryOver),
    paidUndelivered: mapPaidUndelivered(row.paidUndelivered),
    incomingAnomaly: mapIncomingAnomaly(row.incomingAnomaly),
    lossAboveThreshold: mapLossRows(row.lossAboveThreshold),
  }
}
