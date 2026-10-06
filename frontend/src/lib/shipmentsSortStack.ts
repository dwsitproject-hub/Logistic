/**
 * Shipments View Table: sort by click history on GET /shipments.
 *
 * The columns a stack may hold are the ones the server can ORDER BY (a mirror of `isShipmentListSortKey` in the backend's
 * shipmentListSortSql.ts - the server drops any key it does not know from a stack, which would silently change which
 * column is primary, so the client only ever stacks keys on this list). A column outside it, such as Jetty Status, stays
 * a single sort: clicking it replaces the stack, and clicking an ordinary column afterwards starts a new stack.
 */
import {
  clickSortStack,
  DEFAULT_SORT_STACK_DEPTH,
  serializeSortStack,
  type SortEntry,
} from '@/lib/sortStack'

export const SHIPMENTS_SERVER_SORT_KEYS: ReadonlySet<string> = new Set([
  'created_at', 'vessel_name', 'sto_number', 'shipment_id', 'contract_numbers', 'contract_number', 'po_numbers',
  'status', 'plant_site', 'supplier', 'suppliers', 'product', 'products', 'incoterm', 'contract_date', 'charter_type',
  'operation_id', 'delivery_start_date', 'delivery_end_date', 'delivery_start', 'delivery_end', 'quantity_shipped',
  'quantity_delivered', 'quantity_receive', 'sfal_qty', 'sfbd_qty', 'vessel_code', 'estimated_nautical_miles',
  'vessel_draft', 'vessel_loa', 'vessel_capacity', 'vessel_hull_type', 'vessel_registration_year',
  'average_vessel_speed', 'fuel_consumption', 'freight', 'freight_budget', 'pump_rate', 'sailing_speed', 'shortage',
  'contract_reference_po', 'eta_arrival', 'eta_berthed', 'eta_loading_start', 'eta_loading_complete', 'eta_sailed',
  'eta_discharge_arrival', 'eta_discharge_berthed', 'eta_discharge_start', 'eta_discharge_complete',
  'ata_vessel_completed_loading', 'ata_vessel_complete_discharge', 'ata_vessel_arrival_at_loading_port',
  'ata_vessel_berthed_at_loading_port', 'ata_vessel_start_loading', 'ata_vessel_sailed_from_loading_port',
  'ata_vessel_arrive_at_discharge_port', 'ata_vessel_berthed_at_discharge_port', 'ata_vessel_start_discharging',
  'late_indicator', 'contract_qty', 'loading_port', 'discharge_port', 'contract_ext_no',
  // enriched (SAP / qty) columns
  'outstanding_quantity', 'outstanding_qty_planning', 'sto_quantity', 'b2b_flag', 'quantity_shipment_plan',
  // contract-backlog-only columns
  'pre_planned_group', 'trade_cycle_days',
])

export function isStackableShipmentsSort(columnId: string): boolean {
  return SHIPMENTS_SERVER_SORT_KEYS.has(columnId)
}

/** What a header click does on the Shipments page. */
export function nextShipmentsSortStack(
  stack: ReadonlyArray<SortEntry>,
  columnId: string,
  maxDepth: number = DEFAULT_SORT_STACK_DEPTH,
): SortEntry[] {
  if (!isStackableShipmentsSort(columnId)) {
    // A single sort: flip it if it is already the only/primary one, else start it ascending.
    const top = stack[0]
    const dir: 'asc' | 'desc' = top && top.key === columnId && top.dir === 'asc' ? 'desc' : 'asc'
    return [{ key: columnId, dir }]
  }
  // Never carry a single (non-stackable) sort into a stack: the new column starts it.
  const base = stack.every((entry) => isStackableShipmentsSort(entry.key)) ? stack : []
  return clickSortStack(base, columnId, maxDepth)
}

/** The `sort` query parameter, or '' when sortKey + sortDir already say it (one key, or a key the server cannot stack). */
export function shipmentsSortStackParam(stack: ReadonlyArray<SortEntry>): string {
  if (stack.length < 2) return ''
  if (!stack.every((entry) => isStackableShipmentsSort(entry.key))) return ''
  return serializeSortStack(stack)
}
