/**
 * Trucking compact table — default column order, visibility, and compact widths.
 * Matches Contract Performance compact header sizing behavior.
 */

import { migrateSavedColumnLayout, mergePreservedColumnOrder } from '@/lib/columnLayoutMigration'
import {
  buildCompactTableColumnWidthTracks,
  resolveCompactColumnWidthPx,
  type CompactTableColumnWidthInput,
} from '@/lib/compactTableUi'

/** Default visible columns in left-to-right table order (STO-first after late indicator). */
export const TRUCKING_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'late_indicator',
  'sto_number',
  'contract_date',
  'contract_ext_no',
  'po_number',
  'supplier',
  'status',
  'product',
  'incoterm',
  'contract_qty',
  // sto_quantity kept in column picker only — list uses Contract Qty + Delivery/Receive.
  'quantity_delivered',
  'quantity_receive',
  'outstanding_qty_mt',
  'trucking_start_date',
  'trucking_completion_date',
] as const

/** Soft-hide on layout version bump (still available via Columns menu). */
export const TRUCKING_SOFT_HIDE_COLUMN_IDS: readonly string[] = ['sto_quantity']

/** Removed from the table and Columns menu while retaining the source field elsewhere. */
export const TRUCKING_REMOVED_COLUMN_IDS: readonly string[] = ['quantity_sent']

/** Bump when default column order/visibility changes — soft-migrates saved layouts. */
export const TRUCKING_COLUMN_LAYOUT_VERSION = 'trucking-columns-v6'

export const TRUCKING_COLUMN_LAYOUT_VERSION_KEY = 'trucking.compact.columnLayoutVersion'

/** Compact fixed px widths — header longest-word logic may expand via resolveCompactColumnWidthPx. */
export const TRUCKING_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  late_indicator: 100,
  contract_date: 100,
  contract_ext_no: 120,
  po_number: 72,
  supplier: 152,
  status: 80,
  sto_number: 72,
  product: 88,
  incoterm: 72,
  contract_qty: 96,
  sto_quantity: 96,
  quantity_delivered: 96,
  quantity_receive: 96,
  outstanding_qty_mt: 108,
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
  return mergePreservedColumnOrder(saved, allIds, truckingCompactColumnFallbackOrder(allIds))
}

export function migrateTruckingColumnLayout(
  visibleColumnIds: readonly string[],
  columnOrderIds: readonly string[],
  allColumnIds: readonly string[],
): { visibleColumnIds: string[]; columnOrderIds: string[] } {
  const softHide = new Set(TRUCKING_SOFT_HIDE_COLUMN_IDS)
  const migrated = migrateSavedColumnLayout({
    visibleColumnIds,
    columnOrderIds,
    obsoleteColumnIds: TRUCKING_REMOVED_COLUMN_IDS,
  })
  const visibleRaw =
    migrated.visibleColumnIds.length > 0
      ? migrated.visibleColumnIds
      : truckingDefaultVisibleColumnIds([...allColumnIds])
  const visible = visibleRaw.filter((id) => !softHide.has(id))
  // Keep soft-hidden ids in order so Columns menu still lists them after the primary set.
  const orderBase = mergeTruckingColumnOrder(migrated.columnOrderIds, [...allColumnIds])
  const orderWithSoftHidden = mergeTruckingColumnOrder(
    [...orderBase, ...TRUCKING_SOFT_HIDE_COLUMN_IDS],
    [...allColumnIds],
  )
  return {
    visibleColumnIds: visible,
    columnOrderIds: orderWithSoftHidden,
  }
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

const TRUCKING_DEFAULT_COLUMN_WIDTH_PX = 96

/** Match Contract/Shipping Performance: base map + header longest-word floor. */
export function truckingTableColumnWidthPx(
  colId: string,
  headerLabel?: string,
  options?: { hasFormulaHelp?: boolean },
): number {
  const base = TRUCKING_COLUMN_WIDTH_PX[colId] ?? TRUCKING_DEFAULT_COLUMN_WIDTH_PX
  return resolveCompactColumnWidthPx(base, headerLabel, {
    hasFormulaHelp: options?.hasFormulaHelp,
    hasSort: true,
  })
}

export function buildTruckingColumnWidthTracks(
  visibleColumns: ReadonlyArray<string | CompactTableColumnWidthInput>,
  labelById?: ReadonlyMap<string, string>,
): Record<string, string> {
  return buildCompactTableColumnWidthTracks(visibleColumns, (id, label, formulaHelp) =>
    truckingTableColumnWidthPx(id, label ?? labelById?.get(id), {
      hasFormulaHelp: Boolean(formulaHelp),
    }),
  )
}
