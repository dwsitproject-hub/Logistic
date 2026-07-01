/**
 * Shipments compact table — default column order, visibility, and compact widths.
 * Matches Contract Performance compact header sizing behavior.
 */

import {
  buildCompactTableColumnWidthTracks,
  resolveCompactColumnWidthPx,
  type CompactTableColumnWidthInput,
} from '@/lib/compactTableUi'

/** Default visible columns in left-to-right table order. */
export const SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'late_indicator',
  'shipment_id',
  'contract_date',
  'contract_ext_no',
  'po_numbers',
  'supplier',
  'vessel_name',
  'status',
  'product',
  'incoterm',
  'sto_quantity',
  'quantity_delivered',
  'quantity_receive',
  'outstanding_quantity',
  'sfal_qty',
  'sfbd_qty',
  'ata_vessel_completed_loading',
  'ata_vessel_complete_discharge',
] as const

/** Bump when default column order/visibility changes — resets users without matching saved layout. */
export const SHIPMENT_COLUMN_LAYOUT_VERSION = 'shipments-columns-v5'

export const SHIPMENT_COLUMN_LAYOUT_VERSION_KEY = 'shipments.compact.columnLayoutVersion'

/** Compact fixed px widths — header longest-word logic may expand via resolveCompactColumnWidthPx. */
export const SHIPMENT_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  late_indicator: 100,
  contract_date: 100,
  contract_ext_no: 120,
  po_numbers: 72,
  supplier: 96,
  vessel_name: 88,
  status: 80,
  shipment_id: 72,
  product: 88,
  incoterm: 72,
  sto_quantity: 96,
  quantity_delivered: 96,
  quantity_receive: 96,
  outstanding_quantity: 104,
  sfal_qty: 96,
  sfbd_qty: 96,
  ata_vessel_completed_loading: 88,
  ata_vessel_complete_discharge: 88,
  operation_id: 120,
  contract_numbers: 120,
  contract_reference_po: 120,
  delivery_start: 108,
  delivery_end: 108,
  b2b_flag: 80,
  port_of_loading: 100,
  port_of_discharge: 100,
  vessel_code: 88,
  estimated_nautical_miles: 96,
  vessel_draft: 88,
  vessel_loa: 72,
  vessel_capacity: 96,
  vessel_hull_type: 96,
  vessel_registration_year: 96,
  average_vessel_speed: 96,
}

export function shipmentDefaultVisibleColumnIds(allIds: string[]): string[] {
  return SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

/** Primary columns first (default visible order), then remaining definition order. */
export function shipmentCompactColumnFallbackOrder(allIds: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS) {
    if (allIds.includes(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of allIds) {
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

export function mergeShipmentColumnOrder(saved: string[], allIds: string[]): string[] {
  const canonical = shipmentCompactColumnFallbackOrder(allIds)
  if (saved.length === 0) return canonical

  const primary = SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
  const primarySet = new Set(primary)
  const extras: string[] = []
  const seen = new Set<string>()

  for (const id of saved) {
    if (allIds.includes(id) && !primarySet.has(id) && !seen.has(id)) {
      extras.push(id)
      seen.add(id)
    }
  }
  for (const id of canonical) {
    if (!primarySet.has(id) && !seen.has(id)) {
      extras.push(id)
      seen.add(id)
    }
  }
  return [...primary, ...extras]
}

export function buildShipmentVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  columnOrderIds: string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const allIds = columns.map((c) => c.id)
  const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : shipmentCompactColumnFallbackOrder(allIds)).filter(
    (id) => byId.has(id),
  )
  return orderedIds.map((id) => byId.get(id)!).filter((c) => visibleIds.has(c.id))
}

export function buildShipmentColumnWidthTracks(
  visibleColumns: ReadonlyArray<string | CompactTableColumnWidthInput>,
  labelById?: ReadonlyMap<string, string>,
): Record<string, string> {
  return buildCompactTableColumnWidthTracks(visibleColumns, (id, label, formulaHelp) =>
    resolveCompactColumnWidthPx(SHIPMENT_COLUMN_WIDTH_PX[id] ?? 96, label ?? labelById?.get(id), {
      hasFormulaHelp: Boolean(formulaHelp),
      hasSort: true,
    }),
  )
}
