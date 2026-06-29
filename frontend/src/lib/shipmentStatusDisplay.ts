/**
 * Display-only labels for shipment effective status.
 * Used on Shipments and Shipping Performance pages only — no logic / filter / API changes.
 */
export const SHIPMENT_STATUS_DISPLAY_LABELS: Record<string, string> = {
  UNPLANNED: 'Unplanned',
  PLANNED: 'Planned',
  IN_PROGRESS: 'Sailing to LP',
  LOADING: 'Loading at DP',
  IN_TRANSIT: 'Sailing to DP',
  ARRIVED: 'Arrived at DP',
  UNLOADING: 'Unloading',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
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
