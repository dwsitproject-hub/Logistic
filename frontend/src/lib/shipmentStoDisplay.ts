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
 * The table column wins, so the modal matches the row the user opened. Without a column, an
 * OP- voyage keeps the contract STO only when its shipment_id is that STO (the SAP shell).
 * Any other shipment_id — including another numeric SAP document — is a later voyage and
 * must not copy the contract STO. A numeric id alone is not the shell.
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
  const contractSto = String(args.contractStoNumber ?? '').trim()
  const klipAddedVoyage = operationId.startsWith('OP-') && shipmentId !== contractSto
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
