/**
 * Shipping Performance Section 1 — card membership (On Going / Close).
 * Close = shipment status COMPLETED.
 * On Going = planned through pre-completed (ETA presence is not split).
 */

import type { ShippingPerfCardFilter } from '@/lib/shippingPerformanceLabels'

export type ShippingPerfCardRow = {
  id?: string
  status?: string | null
  import_status?: string | null
  sto_key?: string | null
  sto_number?: string | null
  operation_id?: string | null
  shipment_id?: string | null
  contract_number?: string | null
  loading_eta_arrival?: string | null
  loading_eta_berthed?: string | null
  loading_eta_completed?: string | null
  discharge_eta_arrival?: string | null
  discharge_eta_berthed?: string | null
  discharge_eta_completed?: string | null
  loading_ata_arrival?: string | null
  loading_ata_berthed?: string | null
  loading_ata_completed?: string | null
  discharge_ata_arrival?: string | null
  discharge_ata_berthed?: string | null
  discharge_ata_completed?: string | null
}

const ETA_DATE_FIELDS = [
  'loading_eta_arrival',
  'loading_eta_berthed',
  'loading_eta_completed',
  'discharge_eta_arrival',
  'discharge_eta_berthed',
  'discharge_eta_completed',
] as const

const ATA_DATE_FIELDS = [
  'loading_ata_arrival',
  'loading_ata_berthed',
  'loading_ata_completed',
  'discharge_ata_arrival',
  'discharge_ata_berthed',
  'discharge_ata_completed',
] as const

function hasPresentDate(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

export function shippingPerfRowHasEta(row: ShippingPerfCardRow): boolean {
  return ETA_DATE_FIELDS.some((key) => hasPresentDate(row[key]))
}

export function shippingPerfRowHasAta(row: ShippingPerfCardRow): boolean {
  return ATA_DATE_FIELDS.some((key) => hasPresentDate(row[key]))
}

function normalizeShipmentStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toUpperCase()
}

function isCancelledShipmentStatus(status: string | null | undefined): boolean {
  const u = normalizeShipmentStatus(status)
  return u === 'CANCELLED' || u === 'CANCELED'
}

/** Close card — shipment execution finished. */
export function shippingPerfRowIsCompletedStatus(status: string | null | undefined): boolean {
  return normalizeShipmentStatus(status) === 'COMPLETED'
}

/**
 * On Going — from PLANNED through statuses before COMPLETED.
 * UNPLANNED is excluded at page base filter; CANCELLED/COMPLETED excluded here.
 */
export function shippingPerfRowIsOngoingStatus(status: string | null | undefined): boolean {
  if (isCancelledShipmentStatus(status)) return false
  if (shippingPerfRowIsCompletedStatus(status)) return false
  const u = normalizeShipmentStatus(status)
  if (!u || u === 'UNPLANNED') return false
  return true
}

/**
 * Row-level card membership.
 * - Close: status === COMPLETED
 * - On Going: any ongoing status (with or without ETA)
 */
export function shippingPerfRowMatchesCard(
  row: ShippingPerfCardRow,
  card: ShippingPerfCardFilter,
): boolean {
  if (card === 'all') return true
  if (isCancelledShipmentStatus(row.status)) return false

  if (card === 'close') {
    return shippingPerfRowIsCompletedStatus(row.status)
  }

  if (card === 'ongoing') {
    return shippingPerfRowIsOngoingStatus(row.status)
  }

  return false
}

export function applyShippingPerfCardFilter<T extends ShippingPerfCardRow>(
  rows: T[],
  card: ShippingPerfCardFilter,
): T[] {
  if (card === 'all') return rows
  return rows.filter((row) => shippingPerfRowMatchesCard(row, card))
}

/**
 * Vessel card/drilldown identity: one “vessel” = one shipment (STO).
 * Prefer SQL sto_key / sto_number; if STO is missing use KLIP operation_id.
 */
export function shippingPerfRowStoKey(row: ShippingPerfCardRow): string {
  const sqlKey = String(row.sto_key || '').trim()
  if (sqlKey) return /^\d+$/.test(sqlKey) ? `sto:${sqlKey}` : `op:${sqlKey}`
  const sto = String(row.sto_number || '').trim()
  if (sto) return `sto:${sto}`
  const op = String(row.operation_id || '').trim()
  if (op) return `op:${op}`
  const shipmentId = String(row.shipment_id || '').trim()
  if (shipmentId) return `ship:${shipmentId}`
  const id = String(row.id || '').trim()
  return id ? `id:${id}` : ''
}

export function addDistinctShippingPerfStoKey(keys: Set<string>, row: ShippingPerfCardRow): void {
  const key = shippingPerfRowStoKey(row)
  if (key) keys.add(key)
}

export function countUniqueShippingPerfStoKeys(rows: ShippingPerfCardRow[]): number {
  const keys = new Set<string>()
  for (const row of rows) {
    addDistinctShippingPerfStoKey(keys, row)
  }
  return keys.size
}
