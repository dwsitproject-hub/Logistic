/**
 * Oil Loss page — eligible Incoterm × transport segment rules (mirrors backend).
 * Used as a defensive filter after API fetch on the Oil Loss page only.
 *
 * Vessel: Incoterm CIF or FOB + SEA/MIX (or STO Type V).
 * Truck:  Incoterm FRC or CIF + LAND/MIX (or STO Type T).
 * All other incoterm × transport combinations are excluded.
 */

export const OIL_LOSS_VESSEL_INCOTERMS = ['CIF', 'FOB'] as const
export const OIL_LOSS_TRUCK_INCOTERMS = ['FRC', 'CIF'] as const

export type OilLossTransportSegmentRow = {
  incoterm?: string | null
  transport_mode?: string | null
  sto_type?: string | null
}

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  return (raw || 'LAND').toUpperCase()
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
  return m === 'SEA' || m === 'MIX' || sto === 'V'
}

export function isOilLossTruckTransportMode(
  mode: string | null | undefined,
  stoType?: string | null | undefined,
): boolean {
  const m = normalizeOilLossMode(mode)
  const sto = normalizeOilLossStoType(stoType)
  return m === 'LAND' || m === 'MIX' || sto === 'T'
}

export function matchesOilLossVesselSegment(row: OilLossTransportSegmentRow): boolean {
  const inc = normalizeOilLossIncoterm(row.incoterm)
  if (!(OIL_LOSS_VESSEL_INCOTERMS as readonly string[]).includes(inc)) return false
  return isOilLossVesselTransportMode(row.transport_mode, row.sto_type)
}

export function matchesOilLossTruckSegment(row: OilLossTransportSegmentRow): boolean {
  const inc = normalizeOilLossIncoterm(row.incoterm)
  if (!(OIL_LOSS_TRUCK_INCOTERMS as readonly string[]).includes(inc)) return false
  return isOilLossTruckTransportMode(row.transport_mode, row.sto_type)
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
