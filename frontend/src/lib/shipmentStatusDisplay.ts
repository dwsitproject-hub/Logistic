/**
 * Display-only labels for shipment effective status (Shipments page primary).
 * Legacy keys kept for backward-compatible API rows and other modules.
 */
export const SHIPMENT_STATUS_DISPLAY_LABELS: Record<string, string> = {
  UNPLANNED: 'Unplanned',
  PLANNED: 'Planned',
  ARRIVED_LP: 'Arrived LP',
  BERTHED_LP: 'Berthed LP',
  LOADING: 'Loading',
  COMPLETED_LOADING: 'Completed Loading',
  SAILED: 'Sailed',
  ARRIVED_DP: 'Arrived DP',
  BERTHED_DP: 'Berthed DP',
  UNLOADING: 'Unloading',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  /** @deprecated legacy keys */
  IN_PROGRESS: 'Arrived LP',
  IN_TRANSIT: 'Sailed',
  ARRIVED: 'Arrived DP',
}

/** Map UI-facing status text back to enum key when needed for display lookup. */
const LEGACY_STATUS_LABEL_TO_KEY: Record<string, string> = {
  'IN PROGRESS': 'IN_PROGRESS',
  'IN TRANSIT': 'IN_TRANSIT',
}

export function normalizeShipmentStatusKey(status: string | null | undefined): string {
  const raw = String(status ?? '').trim()
  if (!raw) return ''
  const upper = raw.toUpperCase()
  if (SHIPMENT_STATUS_DISPLAY_LABELS[upper]) return upper
  return LEGACY_STATUS_LABEL_TO_KEY[upper] ?? upper
}

export function formatShipmentStatusLabel(status: string | null | undefined): string {
  const raw = String(status ?? '').trim()
  if (!raw) return '-'
  const key = normalizeShipmentStatusKey(raw)
  return SHIPMENT_STATUS_DISPLAY_LABELS[key] ?? raw
}
