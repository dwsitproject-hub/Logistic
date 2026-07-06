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

/** Tailwind badge classes aligned with Shipments list status chips. */
export function shipmentStatusBadgeClass(status: string | null | undefined): string {
  switch (normalizeShipmentStatusKey(status)) {
    case 'UNPLANNED':
      return 'bg-slate-100 text-slate-800'
    case 'PLANNED':
      return 'bg-blue-100 text-blue-800'
    case 'ARRIVED_LP':
      return 'bg-yellow-100 text-yellow-800'
    case 'BERTHED_LP':
      return 'bg-amber-100 text-amber-800'
    case 'LOADING':
      return 'bg-orange-100 text-orange-800'
    case 'COMPLETED_LOADING':
      return 'bg-orange-200 text-orange-900'
    case 'SAILED':
      return 'bg-purple-100 text-purple-800'
    case 'ARRIVED_DP':
      return 'bg-indigo-100 text-indigo-800'
    case 'BERTHED_DP':
      return 'bg-cyan-100 text-cyan-800'
    case 'UNLOADING':
      return 'bg-teal-100 text-teal-800'
    case 'COMPLETED':
      return 'bg-green-100 text-green-800'
    case 'CANCELLED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}
