/**
 * Shipping Performance Section 1 — card membership (On Going / Close).
 * Close = shipment status COMPLETED.
 * On Going = planned through pre-completed (ETA presence is not split), plus the unplanned
 * backlog: a contract with outstanding and no shipment is open work, not finished work.
 */

import type { ShippingPerfCardFilter } from '@/lib/shippingPerformanceLabels'

export type ShippingPerfCardRow = {
  id?: string
  status?: string | null
  /**
   * The stage narrowed to the row's OWN STO. `status` is a MAX across the STO group, so one
   * finished voyage marks the whole group COMPLETED. Card membership reads this one: putting a
   * contract's outstanding on a row the Close card then swallows is how the first attempt at this
   * moved CPO/BONTANG DOWN, 103,545 -> 103,142 MT.
   */
  os_status?: string | null
  /** Backend flag: contract with outstanding and no shipment. See shippingPerfRowIsUnplannedBacklog. */
  is_unplanned_backlog?: boolean | null
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
 * The backlog arm: a contract with outstanding and NO shipment. The backend marks these; the flag
 * is its statement, and the row's `UNPLANNED` status is a coincidence of spelling shared with a
 * genuinely unplanned *shipment*, which this page still excludes. Never infer one from the other.
 */
export function shippingPerfRowIsUnplannedBacklog(row: ShippingPerfCardRow): boolean {
  return row.is_unplanned_backlog === true
}

/**
 * On Going — from PLANNED through statuses before COMPLETED.
 * Status only. A backlog row has status UNPLANNED and still belongs to On Going, which is why
 * membership is decided by shippingPerfRowMatchesCard from the row rather than here.
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
/**
 * The stage card membership is decided by: the row's OWN STO when the merge computed one, else
 * the row's status. The table keeps showing `status`, the group-wide value, as it always has -
 * the same split Shipments makes between its list and its OS path.
 */
export function shippingPerfCardStage(row: ShippingPerfCardRow): string | null | undefined {
  const own = String(row.os_status ?? '').trim()
  return own || row.status
}

export function shippingPerfRowMatchesCard(
  row: ShippingPerfCardRow,
  card: ShippingPerfCardFilter,
): boolean {
  if (card === 'all') return true
  const stage = shippingPerfCardStage(row)
  if (isCancelledShipmentStatus(stage)) return false

  if (card === 'close') {
    return shippingPerfRowIsCompletedStatus(stage)
  }

  if (card === 'ongoing') {
    // Outstanding with no shipment yet is open work. Decided per Ryan, 2026-09-18: backlog counts
    // as Open, on the cards and on the table's Open/Closed toggle together - splitting them would
    // let the table and the card above it disagree about the same rows.
    if (shippingPerfRowIsUnplannedBacklog(row)) return true
    return shippingPerfRowIsOngoingStatus(stage)
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
