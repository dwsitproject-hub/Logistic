import { isEmptySapDisplayValue } from '@/lib/sapDisplayValue'

/** Display rules for Shipments list + Edit Shipment modal (mirrors contractLogisticsStoDisplay). */

function trimOrNull(value: unknown): string | null {
  if (isEmptySapDisplayValue(value)) return null
  return String(value).trim()
}

function isKlipSyntheticLogisticsKey(value: string): boolean {
  return value.startsWith('OP-') || value.startsWith('MNL-') || value.startsWith('MSEA-')
}

/** STO column / field: real SAP STO only — never Operation ID or synthetic keys. */
export function resolveShipmentDisplayStoNumber(stoNumber: unknown): string {
  const sto = trimOrNull(stoNumber)
  if (!sto) return '-'
  if (isKlipSyntheticLogisticsKey(sto)) return '-'
  return sto
}

/**
 * STO field in Edit Shipment.
 *
 * The list lookup key of an OP- voyage is the operation id, which is not an STO. The SAP shell
 * of that voyage still has a numeric shipment_id and keeps the contract STO. A later Add New
 * row (MNL- or `{sto}-{contract}`) does not. When the table already computed the column, that
 * value wins so the modal matches the row the user opened.
 */
export function resolveEditShipmentStoNumber(args: {
  listStoNumber?: string | null
  listStoProvided?: boolean
  lookupKey?: string | null
  shipmentId?: string | null
  operationId?: string | null
  contractStoNumber?: string | null
}): string {
  if (args.listStoProvided) {
    return resolveShipmentDisplayStoNumber(args.listStoNumber)
  }
  const operationId = String(args.operationId ?? '').trim()
  const shipmentId = String(args.shipmentId ?? '').trim()
  const klipAddedVoyage =
    operationId.startsWith('OP-') && shipmentId.length > 0 && !/^\d+$/.test(shipmentId)
  if (klipAddedVoyage) return '-'
  const fromLookup = resolveShipmentDisplayStoNumber(args.lookupKey)
  if (fromLookup !== '-') return fromLookup
  return resolveShipmentDisplayStoNumber(args.contractStoNumber)
}

/** Grouping / API lookup key (details, loading ports) — may be sto_key or operation_id. */
export function resolveShipmentApiLookupKey(row: {
  sto_key?: string | null
  sto_number?: string | null
  operation_id?: string | null
  shipment_id?: string | null
  id?: string
} | null | undefined): string {
  if (!row) return ''
  return (
    String(row.sto_key ?? '').trim() ||
    String(row.sto_number ?? '').trim() ||
    String(row.operation_id ?? '').trim() ||
    String(row.shipment_id ?? '').trim() ||
    String(row.id ?? '').trim()
  )
}
