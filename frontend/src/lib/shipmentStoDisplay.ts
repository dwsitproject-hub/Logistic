/** Display rules for Shipments list + Edit Shipment modal (mirrors contractLogisticsStoDisplay). */

function trimOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text || text === '-') return null
  return text
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
