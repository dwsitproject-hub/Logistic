/**
 * Oil Loss page — eligible Incoterm × Mode combinations (mirrors backend).
 * Used as a defensive filter after API fetch on the Oil Loss page only.
 */

export const OIL_LOSS_ELIGIBLE_MODES = {
  CIF: ['LAND', 'MIX'] as const,
  FOB: ['SEA', 'LAND', 'MIX'] as const,
  LCO: ['SEA', 'LAND', 'MIX'] as const,
} as const;

export function normalizeOilLossIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function normalizeOilLossMode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  return (raw || 'LAND').toUpperCase()
}

export function isOilLossEligibleIncotermMode(
  incoterm: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  const inc = normalizeOilLossIncoterm(incoterm)
  const m = normalizeOilLossMode(mode)
  if (inc === 'CIF') return (OIL_LOSS_ELIGIBLE_MODES.CIF as readonly string[]).includes(m)
  if (inc === 'FOB') return (OIL_LOSS_ELIGIBLE_MODES.FOB as readonly string[]).includes(m)
  if (inc === 'LCO') return (OIL_LOSS_ELIGIBLE_MODES.LCO as readonly string[]).includes(m)
  return false
}

export function filterOilLossEligibleRows<
  T extends { incoterm?: string | null; transport_mode?: string | null },
>(rows: readonly T[]): T[] {
  return rows.filter((row) =>
    isOilLossEligibleIncotermMode(row.incoterm, row.transport_mode),
  ) as T[]
}

/** Mode filter options for Oil Loss toolbar (SEA / LAND / MIX from SAP). */
export const OIL_LOSS_MODE_FILTER_OPTIONS = ['SEA', 'LAND', 'MIX'] as const

export function normalizeOilLossStatusForFilter(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function matchesOilLossStatusFilter(
  rowStatus: string | null | undefined,
  selectedStatuses: readonly string[],
): boolean {
  if (selectedStatuses.length === 0) return true
  const normalized = normalizeOilLossStatusForFilter(rowStatus)
  if (!normalized) return false
  return selectedStatuses.some(
    (s) => normalizeOilLossStatusForFilter(s) === normalized,
  )
}

export function matchesOilLossModeFilter(
  rowMode: string | null | undefined,
  selectedModes: readonly string[],
): boolean {
  if (selectedModes.length === 0) return true
  const normalized = normalizeOilLossMode(rowMode)
  return selectedModes.some((m) => normalizeOilLossMode(m) === normalized)
}

export function deriveOilLossStatusFilterOptions(
  rows: readonly { status?: string | null }[],
): string[] {
  const displayByKey = new Map<string, string>()
  for (const row of rows) {
    const raw = String(row.status ?? '').trim()
    if (!raw) continue
    const key = normalizeOilLossStatusForFilter(raw)
    if (!displayByKey.has(key)) displayByKey.set(key, raw)
  }
  return [...displayByKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
}
