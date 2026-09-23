/**
 * Oil Loss page — eligible Incoterm segment rules (mirrors backend).
 * Used as a defensive filter after API fetch on the Oil Loss page only.
 *
 * Vessel: CIF, FOB, CFR (same as the Shipments page)
 * Truck:  FRC, LCO (same as the Trucking page)
 * SAP SEA / LAND is not a gate.
 */

export const OIL_LOSS_VESSEL_INCOTERMS = ['CIF', 'FOB', 'CFR'] as const
export const OIL_LOSS_TRUCK_INCOTERMS = ['FRC', 'LCO'] as const

export type OilLossTransportSegmentRow = {
  incoterm?: string | null
  transport_mode?: string | null
  sto_type?: string | null
}

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function isOilLossVesselIncoterm(value: string | null | undefined): boolean {
  return (OIL_LOSS_VESSEL_INCOTERMS as readonly string[]).includes(normalizeOilLossIncoterm(value))
}

export function isOilLossTruckIncoterm(value: string | null | undefined): boolean {
  return (OIL_LOSS_TRUCK_INCOTERMS as readonly string[]).includes(normalizeOilLossIncoterm(value))
}

/** Normalize SAP SEA / LAND / MIX (case-insensitive; MIXED → MIX). Kept for unused mode hooks. */
export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'LAND'
  const upper = raw.toUpperCase()
  if (upper === 'MIXED' || upper === 'MIX') return 'MIX'
  if (upper === 'SEA') return 'SEA'
  if (upper === 'LAND') return 'LAND'
  return upper
}

export function matchesOilLossVesselSegment(row: OilLossTransportSegmentRow): boolean {
  return isOilLossVesselIncoterm(row.incoterm)
}

export function matchesOilLossTruckSegment(row: OilLossTransportSegmentRow): boolean {
  return isOilLossTruckIncoterm(row.incoterm)
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  _mode?: string | null | undefined,
  _stoType?: string | null | undefined,
): boolean {
  return isOilLossVesselIncoterm(incoterm) || isOilLossTruckIncoterm(incoterm)
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
