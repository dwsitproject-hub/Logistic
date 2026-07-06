/** Segment delta keys that roll up into total_delta_days (ETA mode). */
export const SHIPPING_PERF_DELTA_SEGMENT_KEYS = [
  'loading_delta_eta_etr_days',
  'loading_delta_eta_etb_days',
  'loading_delta_etb_etc_days',
  'discharge_delta_eta_etb_days',
  'discharge_delta_etb_etc_days',
] as const

const SHIPPING_PERF_DELTA_SEGMENT_ATA_KEYS: Record<
  (typeof SHIPPING_PERF_DELTA_SEGMENT_KEYS)[number],
  string
> = {
  loading_delta_eta_etr_days: 'ata_loading_delta_eta_etr_days',
  loading_delta_eta_etb_days: 'ata_loading_delta_eta_etb_days',
  loading_delta_etb_etc_days: 'ata_loading_delta_etb_etc_days',
  discharge_delta_eta_etb_days: 'ata_discharge_delta_eta_etb_days',
  discharge_delta_etb_etc_days: 'ata_discharge_delta_etb_etc_days',
}

export type ShippingPerfTotalDeltaMode = 'eta' | 'ata'

export function areAllShippingPerfDeltaSegmentsNull(
  row: Record<string, unknown>,
  mode: ShippingPerfTotalDeltaMode,
): boolean {
  for (const logicalKey of SHIPPING_PERF_DELTA_SEGMENT_KEYS) {
    const dataKey = mode === 'ata' ? SHIPPING_PERF_DELTA_SEGMENT_ATA_KEYS[logicalKey] : logicalKey
    const value = row[dataKey]
    if (typeof value === 'number' && Number.isFinite(value)) return false
  }
  return true
}

/** Table display — null total when every segment is missing (not 0). */
export function resolveShippingPerfTotalDeltaDisplay(
  row: Record<string, unknown>,
  mode: ShippingPerfTotalDeltaMode,
): number | null {
  if (areAllShippingPerfDeltaSegmentsNull(row, mode)) return null
  const totalKey = mode === 'ata' ? 'ata_total_delta_days' : 'total_delta_days'
  const total = row[totalKey]
  if (typeof total !== 'number' || !Number.isFinite(total)) return null
  return total
}
