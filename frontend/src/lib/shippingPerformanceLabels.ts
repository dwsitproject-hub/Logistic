/**
 * Shipping Performance — display labels only (no data / calculation changes).
 */

export type ShippingPerfLabelMode = 'estimated' | 'actual'

export type PerfDashMode = 'eta' | 'ata'
/** Section 1 cards: On Going (all pre-COMPLETED) + Close. */
export type ShippingPerfCardFilter = 'all' | 'ongoing' | 'close'
export type TableStatusFilter = 'All' | 'Open' | 'Closed'

export function perfDataModeFromCard(card: ShippingPerfCardFilter): PerfDashMode {
  if (card === 'close') return 'ata'
  return 'eta'
}

export const SHIPPING_PERF_CARD_TITLES: Record<ShippingPerfCardFilter, string> = {
  all: 'All',
  ongoing: 'On Going',
  close: 'Completed',
}

/** Section 1 summary cards — title lines. */
export function shippingPerfCardTitleLines(
  card: ShippingPerfCardFilter,
): { main: string; sub?: string } {
  switch (card) {
    case 'ongoing':
      return { main: 'On Going' }
    case 'close':
      return { main: 'Completed' }
    case 'all':
      return { main: 'All' }
  }
}

/** Section 3 follows global status filter; when All, follows Section 1 card. */
export function resolveShippingPerfLabelMode(
  perfCardFilter: ShippingPerfCardFilter,
  statusFilter: TableStatusFilter,
): ShippingPerfLabelMode {
  if (statusFilter === 'Closed') return 'actual'
  if (statusFilter === 'Open') return 'estimated'
  if (perfCardFilter === 'close') return 'actual'
  if (perfCardFilter === 'all') return 'estimated'
  return 'estimated'
}

/** Close: ETA→ATA and ETR/ETB/ETC→ATR/ATB/ATC. Open/All (estimated): unchanged. */
export function formatShippingPerfDisplayLabel(
  text: string,
  labelMode: ShippingPerfLabelMode,
): string {
  if (labelMode === 'estimated') return text
  return text
    .replace(/\bETA\b/g, 'ATA')
    .replace(/\bETR\b/g, 'ATR')
    .replace(/\bETB\b/g, 'ATB')
    .replace(/\bETC\b/g, 'ATC')
}

/** Section 1 summary cards — grid cell labels (Avg prefix; Close uses ATA via formatShippingPerfDisplayLabel). */
export const SHIPPING_SUMMARY_METRIC_LABELS = {
  loadingEtr: 'Avg Load (ETA-ETR)',
  loadingEtb: 'Avg Load (ETA-ETB)',
  loadingEtc: 'Avg Load (ETB-ETC)',
  dischargeEtb: 'Avg Discharge (ETA-ETB)',
  dischargeEtc: 'Avg Discharge (ETB-ETC)',
  total: 'Avg Total',
} as const

/** Full labels for tooltips. */
export const SHIPPING_SUMMARY_METRIC_FULL_LABELS = {
  loadingEtr: 'Avg Load (ETA - ETR)',
  loadingEtb: 'Avg Load (ETA - ETB)',
  loadingEtc: 'Avg Load (ETB - ETC)',
  dischargeEtb: 'Avg Discharge (ETA - ETB)',
  dischargeEtc: 'Avg Discharge (ETB - ETC)',
  total: 'Avg Total',
} as const

export type ShippingSummaryMetricKey = keyof typeof SHIPPING_SUMMARY_METRIC_LABELS

export function getShippingSummaryMetricLabel(
  key: ShippingSummaryMetricKey,
  labelMode: ShippingPerfLabelMode,
  variant: 'short' | 'full' = 'short',
): string {
  const base =
    variant === 'short' ? SHIPPING_SUMMARY_METRIC_LABELS[key] : SHIPPING_SUMMARY_METRIC_FULL_LABELS[key]
  return formatShippingPerfDisplayLabel(base, labelMode)
}
