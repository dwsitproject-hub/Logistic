/**
 * Trucking compact table — default column order, visibility, and compact widths.
 * Matches Contract Performance compact header sizing behavior.
 */

import {
  buildCompactTableColumnWidthTracks,
  resolveCompactColumnWidthPx,
  type CompactTableColumnWidthInput,
} from '@/lib/compactTableUi'

/** Default visible columns in left-to-right table order. */
export const TRUCKING_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'late_indicator',
  'contract_date',
  'contract_ext_no',
  'po_number',
  'supplier',
  'status',
  'sto_number',
  'product',
  'incoterm',
  'contract_qty',
  'sto_quantity',
  'quantity_delivered',
  'quantity_receive',
  'trucking_start_date',
  'trucking_completion_date',
] as const

/** Bump when default column order/visibility changes — resets users without matching saved layout. */
export const TRUCKING_COLUMN_LAYOUT_VERSION = 'trucking-columns-v1'

export const TRUCKING_COLUMN_LAYOUT_VERSION_KEY = 'trucking.compact.columnLayoutVersion'

/** Compact fixed px widths — header longest-word logic may expand via resolveCompactColumnWidthPx. */
export const TRUCKING_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  late_indicator: 100,
  contract_date: 100,
  contract_ext_no: 120,
  po_number: 72,
  supplier: 88,
  status: 80,
  sto_number: 72,
  product: 88,
  incoterm: 72,
  contract_qty: 96,
  sto_quantity: 96,
  quantity_delivered: 96,
  quantity_receive: 96,
  trucking_start_date: 88,
  trucking_completion_date: 88,
  operation_id: 120,
  location: 88,
  loading_location: 100,
  unloading_location: 100,
  trucking_owner: 88,
  quantity_sent: 96,
  gain_loss_percentage: 88,
  gain_loss_amount: 96,
  oa_budget: 88,
  oa_actual: 88,
  estimated_km: 88,
  cargo_readiness_date: 96,
  delivery_start_date: 108,
  delivery_end_date: 108,
  buyer: 72,
  group_name: 72,
}

export function truckingDefaultVisibleColumnIds(allIds: string[]): string[] {
  return TRUCKING_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

/** Primary columns first (default visible order), then remaining definition order. */
export function truckingCompactColumnFallbackOrder(allIds: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of TRUCKING_DEFAULT_VISIBLE_COLUMN_IDS) {
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

export function mergeTruckingColumnOrder(saved: string[], allIds: string[]): string[] {
  const canonical = truckingCompactColumnFallbackOrder(allIds)
  if (saved.length === 0) return canonical

  const primary = TRUCKING_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
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

export function buildTruckingVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  columnOrderIds: string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const allIds = columns.map((c) => c.id)
  const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : truckingCompactColumnFallbackOrder(allIds)).filter(
    (id) => byId.has(id),
  )
  return orderedIds.map((id) => byId.get(id)!).filter((c) => visibleIds.has(c.id))
}

export function buildTruckingColumnWidthTracks(
  visibleColumns: ReadonlyArray<string | CompactTableColumnWidthInput>,
  labelById?: ReadonlyMap<string, string>,
): Record<string, string> {
  return buildCompactTableColumnWidthTracks(visibleColumns, (id, label, formulaHelp) =>
    resolveCompactColumnWidthPx(TRUCKING_COLUMN_WIDTH_PX[id] ?? 96, label ?? labelById?.get(id), {
      hasFormulaHelp: Boolean(formulaHelp),
      hasSort: true,
    }),
  )
}
