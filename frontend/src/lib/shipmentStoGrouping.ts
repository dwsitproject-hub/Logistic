/**
 * Section 3 Shipments table — group rows by STO for collapsible group headers.
 */

export function resolveShipmentStoKey(row: {
  id: string
  sto_number?: string | null
  shipment_id?: string | null
}): string {
  const sto = String(row.sto_number || row.shipment_id || '').trim()
  return sto || `__no_sto__${row.id}`
}

export function resolveShipmentStoDisplay(stoKey: string): string {
  return stoKey.startsWith('__no_sto__') ? '—' : stoKey
}

export type ShipmentStoGroup<T> = {
  stoKey: string
  stoDisplay: string
  rows: T[]
}

/** Preserve first-seen order from the sorted list. */
export function groupShipmentsBySto<
  T extends { id: string; sto_number?: string | null; shipment_id?: string | null },
>(rows: readonly T[]): ShipmentStoGroup<T>[] {
  const groups: ShipmentStoGroup<T>[] = []
  const indexByKey = new Map<string, number>()

  for (const row of rows) {
    const stoKey = resolveShipmentStoKey(row)
    const existing = indexByKey.get(stoKey)
    if (existing !== undefined) {
      groups[existing].rows.push(row)
      continue
    }
    indexByKey.set(stoKey, groups.length)
    groups.push({
      stoKey,
      stoDisplay: resolveShipmentStoDisplay(stoKey),
      rows: [row],
    })
  }

  return groups
}
