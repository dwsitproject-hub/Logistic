/**
 * Oil Loss page — eligible Incoterm × transport segment rules (mirrors backend).
 * Used as a defensive filter after API fetch on the Oil Loss page only.
 *
 * Vessel: (FOB|CIF) + (SEA or (MIX + STO Type V))
 * Truck:  (FRC|LCO) + LAND
 * All other incoterm × transport combinations are excluded.
 */

export const OIL_LOSS_VESSEL_INCOTERMS = ['CIF', 'FOB'] as const
export const OIL_LOSS_TRUCK_INCOTERMS = ['FRC', 'LCO'] as const

export type OilLossTransportSegmentRow = {
  incoterm?: string | null
  transport_mode?: string | null
  sto_type?: string | null
}

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

/** Normalize SAP SEA / LAND / MIX (case-insensitive; MIXED → MIX). */
export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'LAND'
  const upper = raw.toUpperCase()
  if (upper === 'MIXED' || upper === 'MIX') return 'MIX'
  if (upper === 'SEA') return 'SEA'
  if (upper === 'LAND') return 'LAND'
  return upper
}

export function normalizeOilLossStoType(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function isOilLossVesselTransportMode(
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const m = normalizeOilLossMode(mode)
  const sto = normalizeOilLossStoType(stoType)
  return m === 'SEA' || (m === 'MIX' && sto === 'V')
}

export function isOilLossTruckTransportMode(mode: string | null | undefined): boolean {
  return normalizeOilLossMode(mode) === 'LAND'
}

export function matchesOilLossVesselSegment(row: OilLossTransportSegmentRow): boolean {
  const inc = normalizeOilLossIncoterm(row.incoterm)
  if (!(OIL_LOSS_VESSEL_INCOTERMS as readonly string[]).includes(inc)) return false
  return isOilLossVesselTransportMode(row.transport_mode, row.sto_type)
}

export function matchesOilLossTruckSegment(row: OilLossTransportSegmentRow): boolean {
  const inc = normalizeOilLossIncoterm(row.incoterm)
  if (!(OIL_LOSS_TRUCK_INCOTERMS as readonly string[]).includes(inc)) return false
  return isOilLossTruckTransportMode(row.transport_mode)
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const row: OilLossTransportSegmentRow = {
    incoterm,
    transport_mode: mode,
    sto_type: stoType,
  }
  return matchesOilLossVesselSegment(row) || matchesOilLossTruckSegment(row)
}

export function filterOilLossEligibleRows<T extends OilLossTransportSegmentRow>(rows: readonly T[]): T[] {
  return rows.filter((row) => isOilLossEligibleIncotermMode(row.incoterm, row.transport_mode, row.sto_type)) as T[]
}

/** Mode filter options for Oil Loss toolbar (SEA / LAND / MIX from SAP). */
export const OIL_LOSS_MODE_FILTER_OPTIONS = ['SEA', 'LAND', 'MIX'] as const

export function matchesOilLossModeFilter(
  rowMode: string | null | undefined,
  selectedModes: readonly string[],
): boolean {
  if (selectedModes.length === 0) return true
  const normalized = normalizeOilLossMode(rowMode)
  return selectedModes.some((m) => normalizeOilLossMode(m) === normalized)
}
