/** Shipment granular status keys (Shipments module — mirrors backend shipmentStatus.ts). */

export type ShipmentDetailStatus =
  | 'UNPLANNED'
  | 'PLANNED'
  | 'ARRIVED_LP'
  | 'BERTHED_LP'
  | 'LOADING'
  | 'COMPLETED_LOADING'
  | 'SAILED'
  | 'ARRIVED_DP'
  | 'BERTHED_DP'
  | 'UNLOADING'
  | 'COMPLETED'
  | 'CANCELLED'

export const SHIPMENT_DETAIL_STATUSES: readonly ShipmentDetailStatus[] = [
  'UNPLANNED',
  'PLANNED',
  'ARRIVED_LP',
  'BERTHED_LP',
  'LOADING',
  'COMPLETED_LOADING',
  'SAILED',
  'ARRIVED_DP',
  'BERTHED_DP',
  'UNLOADING',
  'COMPLETED',
  'CANCELLED',
]

export const LEGACY_SHIPMENT_STATUS_ALIASES: Readonly<Record<string, ShipmentDetailStatus>> = {
  IN_PROGRESS: 'ARRIVED_LP',
  IN_TRANSIT: 'SAILED',
  ARRIVED: 'ARRIVED_DP',
}

export const SHIPMENT_AT_LOADING_PORT_STATUSES: readonly ShipmentDetailStatus[] = [
  'ARRIVED_LP',
  'BERTHED_LP',
  'LOADING',
  'COMPLETED_LOADING',
]

export const SHIPMENT_AT_DISCHARGE_PORT_STATUSES: readonly ShipmentDetailStatus[] = [
  'ARRIVED_DP',
  'BERTHED_DP',
  'UNLOADING',
]

export const SHIPMENT_LOADING_ETA_PHASE_STATUSES: readonly ShipmentDetailStatus[] = [
  'UNPLANNED',
  'PLANNED',
  ...SHIPMENT_AT_LOADING_PORT_STATUSES,
]

export const SHIPMENT_DISCHARGE_ETA_PHASE_STATUSES: readonly ShipmentDetailStatus[] = [
  'SAILED',
  ...SHIPMENT_AT_DISCHARGE_PORT_STATUSES,
]

export function normalizeShipmentDetailStatus(raw: string | null | undefined): ShipmentDetailStatus {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!normalized) return 'UNPLANNED'
  const legacy = LEGACY_SHIPMENT_STATUS_ALIASES[normalized]
  if (legacy) return legacy
  if ((SHIPMENT_DETAIL_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as ShipmentDetailStatus
  }
  return 'UNPLANNED'
}

export function isAtLoadingPortStatus(status: ShipmentDetailStatus): boolean {
  return (SHIPMENT_AT_LOADING_PORT_STATUSES as readonly string[]).includes(status)
}

export function isAtDischargePortStatus(status: ShipmentDetailStatus): boolean {
  return (SHIPMENT_AT_DISCHARGE_PORT_STATUSES as readonly string[]).includes(status)
}
