/**
 * VesselHistoryModal only — partition shipments by status string (case-insensitive).
 */

/** Planned through Unloading (matches Shipping Performance OPEN_TABLE_STATUSES). */
export const VESSEL_HISTORY_ON_GOING_STATUSES = new Set([
  'PLANNED',
  'IN_PROGRESS',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED',
  'UNLOADING',
])

/** History table — Completed or Cancelled only. */
export const VESSEL_HISTORY_CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'CANCELED'])

export function normalizeVesselHistoryStatus(status: string | null | undefined): string {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
}

export function isVesselHistoryOnGoingStatus(status: string | null | undefined): boolean {
  return VESSEL_HISTORY_ON_GOING_STATUSES.has(normalizeVesselHistoryStatus(status))
}

export function isVesselHistoryClosedStatus(status: string | null | undefined): boolean {
  return VESSEL_HISTORY_CLOSED_STATUSES.has(normalizeVesselHistoryStatus(status))
}

export function partitionVesselHistoryByStatus<T extends { status?: string | null }>(
  rows: readonly T[],
): { onGoingShipments: T[]; historyShipments: T[] } {
  const onGoingShipments: T[] = []
  const historyShipments: T[] = []
  for (const row of rows) {
    if (isVesselHistoryClosedStatus(row.status)) {
      historyShipments.push(row)
    } else if (isVesselHistoryOnGoingStatus(row.status)) {
      onGoingShipments.push(row)
    }
  }
  return { onGoingShipments, historyShipments }
}
