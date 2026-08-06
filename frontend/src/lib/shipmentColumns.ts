/**
 * Shipments compact table — default column order, visibility, and compact widths.
 * Matches Contract Performance compact header sizing behavior.
 */

import { migrateSavedColumnLayout, mergePreservedColumnOrder } from '@/lib/columnLayoutMigration'
import type { ShipmentsPipelineStageFilter } from '@/lib/shipmentsPageFilterState'
import {
  buildCompactTableColumnWidthTracks,
  resolveCompactColumnWidthPx,
  type CompactTableColumnWidthInput,
} from '@/lib/compactTableUi'

export const SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID = 'pre_planned_group' as const

/** Default visible columns in left-to-right table order. */
export const SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'status',
  'pre_planned_group',
  'late_indicator',
  'vessel_name',
  'shipment_id',
  'loading_port',
  'discharge_port',
  'supplier',
  'incoterm',
  'product',
  'contract_qty',
  'outstanding_quantity',
  'outstanding_qty_planning',
  'sfal_qty',
  'sfbd_qty',
  'ata_vessel_completed_loading',
  'ata_vessel_complete_discharge',
] as const

/** Removed from column picker — use loading_port / discharge_port (SAP-resolved). */
export const SHIPMENT_OBSOLETE_COLUMN_IDS = ['port_of_loading', 'port_of_discharge'] as const

/** Bump when default column order/visibility changes — triggers one-time layout migration. */
export const SHIPMENT_COLUMN_LAYOUT_VERSION = 'shipments-columns-v9'

export const SHIPMENT_COLUMN_LAYOUT_VERSION_KEY = 'shipments.compact.columnLayoutVersion'

/** Compact fixed px widths — header longest-word logic may expand via resolveCompactColumnWidthPx. */
export const SHIPMENT_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  late_indicator: 100,
  vessel_name: 88,
  shipment_id: 72,
  loading_port: 100,
  discharge_port: 100,
  supplier: 152,
  incoterm: 72,
  product: 88,
  status: 80,
  contract_qty: 96,
  outstanding_quantity: 104,
  outstanding_qty_planning: 112,
  sfal_qty: 88,
  sfbd_qty: 88,
  ata_vessel_completed_loading: 88,
  ata_vessel_complete_discharge: 88,
  contract_date: 100,
  contract_ext_no: 120,
  po_numbers: 72,
  pre_planned_group: 80,
  sto_quantity: 96,
  quantity_delivered: 96,
  quantity_receive: 96,
  operation_id: 120,
  contract_numbers: 120,
  contract_reference_po: 120,
  delivery_start: 108,
  delivery_end: 108,
  b2b_flag: 80,
  vessel_code: 88,
  estimated_nautical_miles: 96,
  vessel_draft: 88,
  vessel_loa: 72,
  vessel_capacity: 96,
  vessel_hull_type: 96,
  vessel_registration_year: 96,
  charter_type: 88,
  average_vessel_speed: 96,
  fuel_consumption: 128,
  freight: 120,
  freight_budget: 128,
  pump_rate: 104,
  sailing_speed: 96,
  shortage: 104,
  eta_arrival: 88,
  eta_berthed: 88,
  eta_loading_start: 88,
  eta_loading_complete: 88,
  eta_sailed: 88,
  eta_discharge_arrival: 88,
  eta_discharge_berthed: 88,
  eta_discharge_start: 88,
  eta_discharge_complete: 88,
  eta_vessel_complete_discharge: 88,
  ata_vessel_arrival_at_loading_port: 88,
  ata_vessel_berthed_at_loading_port: 88,
  ata_vessel_start_loading: 88,
  ata_vessel_sailed_from_loading_port: 88,
  ata_vessel_arrive_at_discharge_port: 88,
  ata_vessel_berthed_at_discharge_port: 88,
  ata_vessel_start_discharging: 88,
}

export function shipmentDefaultVisibleColumnIds(allIds: string[]): string[] {
  return SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

/** Grouping Suggestion is only eligible when the pipeline stage filter is Unplanned or Preplanned. */
export function isShipmentGroupingSuggestionColumnEligible(
  pipelineStage: ShipmentsPipelineStageFilter,
): boolean {
  return pipelineStage === 'UNPLANNED' || pipelineStage === 'PREPLANNED'
}

/** Default visible set — omits Grouping Suggestion unless Unplanned/Preplanned is active. */
export function shipmentDefaultVisibleColumnIdsForStage(
  allIds: string[],
  pipelineStage: ShipmentsPipelineStageFilter,
): string[] {
  const base = shipmentDefaultVisibleColumnIds(allIds)
  if (isShipmentGroupingSuggestionColumnEligible(pipelineStage)) {
    return base
  }
  return base.filter((id) => id !== SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID)
}

/** Hide Grouping Suggestion from the rendered table when the stage filter is not eligible. */
export function filterShipmentVisibleColumnIdsForStage(
  visibleIds: ReadonlySet<string>,
  pipelineStage: ShipmentsPipelineStageFilter,
): Set<string> {
  if (isShipmentGroupingSuggestionColumnEligible(pipelineStage)) {
    return new Set(visibleIds)
  }
  const next = new Set(visibleIds)
  next.delete(SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID)
  return next
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
  return mergePreservedColumnOrder(saved, allIds, shipmentCompactColumnFallbackOrder(allIds))
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

const SHIPMENT_DEFAULT_COLUMN_WIDTH_PX = 96

/** Match Contract/Shipping Performance: base map + header longest-word floor. */
export function shipmentTableColumnWidthPx(
  colId: string,
  headerLabel?: string,
  options?: { hasFormulaHelp?: boolean },
): number {
  const base = SHIPMENT_COLUMN_WIDTH_PX[colId] ?? SHIPMENT_DEFAULT_COLUMN_WIDTH_PX
  return resolveCompactColumnWidthPx(base, headerLabel, {
    hasFormulaHelp: options?.hasFormulaHelp,
    hasSort: true,
  })
}

export function buildShipmentColumnWidthTracks(
  visibleColumns: ReadonlyArray<string | CompactTableColumnWidthInput>,
  labelById?: ReadonlyMap<string, string>,
): Record<string, string> {
  return buildCompactTableColumnWidthTracks(visibleColumns, (id, label, formulaHelp) =>
    shipmentTableColumnWidthPx(id, label ?? labelById?.get(id), {
      hasFormulaHelp: Boolean(formulaHelp),
    }),
  )
}

/** Expand/collapse spacer before data columns (Tailwind w-10). */
export const SHIPMENT_EXPAND_COL_WIDTH_PX = 40

/** Migrate saved shipment column prefs: drop raw port columns, ensure SAP port columns visible. */
export function migrateShipmentColumnLayout(
  visibleColumnIds: readonly string[],
  columnOrderIds: readonly string[],
  allColumnIds?: readonly string[],
): { visibleColumnIds: string[]; columnOrderIds: string[] } {
  const migrated = migrateSavedColumnLayout({
    visibleColumnIds,
    columnOrderIds,
    obsoleteColumnIds: SHIPMENT_OBSOLETE_COLUMN_IDS,
    ensureVisibleIds: ['loading_port', 'discharge_port'],
  })
  const allIds =
    allColumnIds && allColumnIds.length > 0
      ? [...allColumnIds]
      : [...new Set([...migrated.visibleColumnIds, ...migrated.columnOrderIds])]
  return {
    visibleColumnIds: migrated.visibleColumnIds,
    columnOrderIds: mergeShipmentColumnOrder(migrated.columnOrderIds, allIds),
  }
}
