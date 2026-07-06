/**
 * Shipping Performance Section 3 — compact table UI aligned with Contract Performance.
 */

import {
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_COL_WIDTH_PX,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  COMPACT_TABLE_HEADER_ROW_PERF_CLASS,
  resolveCompactColumnWidthPx,
} from '@/lib/compactTableUi'
import {
  getOperationalColumnLayout,
  type OperationalColumnLayout,
} from '@/lib/operationalTableLayout'
import {
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
  type ShippingPerformancePortSource,
} from '@/lib/shippingPerformancePorts'
import { formatVesselTableDisplay } from '@/lib/sapDisplayValue'
import { formatOutstandingQtyMtFromKg } from '@/lib/utils'

/** All Shipments view — default column order (On Going ETA / Close ATA share keys; headers follow label mode). */
export const ALL_SHIPMENTS_PRESET_COLUMN_ORDER = [
  'vessel_name',
  'sto_number',
  'loading_port',
  'discharge_port',
  'supplier',
  'incoterm',
  'product',
  'status',
  'contract_qty',
  'outstanding_qty_actual',
  'loading_delta_eta_etr_days',
  'loading_delta_eta_etb_days',
  'loading_delta_etb_etc_days',
  'discharge_delta_eta_etb_days',
  'discharge_delta_etb_etc_days',
  'total_delta_days',
] as const

export type AllShipmentsPresetColumnKey = (typeof ALL_SHIPMENTS_PRESET_COLUMN_ORDER)[number]

const ALL_SHIPMENTS_PRESET_VISIBLE_SET = new Set<string>(ALL_SHIPMENTS_PRESET_COLUMN_ORDER)

/** Default visible flags for All Shipments — preset columns only; others available via column manager. */
export function buildAllShipmentsPresetVisibleColumns(
  allColumnKeys: readonly string[],
): Record<string, boolean> {
  const visible: Record<string, boolean> = {}
  for (const key of allColumnKeys) {
    visible[key] = ALL_SHIPMENTS_PRESET_VISIBLE_SET.has(key)
  }
  return visible
}

/** Preset column order first, then remaining columns in definition order. */
export function ensureAllShipmentsPresetColumnOrder(
  order: readonly string[],
  allColumnKeys: readonly string[],
): string[] {
  const known = new Set(allColumnKeys)
  const preset = ALL_SHIPMENTS_PRESET_COLUMN_ORDER.filter((key) => known.has(key))
  const presetSet = new Set<string>(preset)
  const trailingFromOrder = order.filter((key) => known.has(key) && !presetSet.has(key))
  const trailingMissing = allColumnKeys.filter((key) => !presetSet.has(key) && !trailingFromOrder.includes(key))
  return [...preset, ...trailingFromOrder, ...trailingMissing]
}

export function isAllShipmentsPresetVisibleColumn(key: string): boolean {
  return ALL_SHIPMENTS_PRESET_VISIBLE_SET.has(key)
}

/** Section 3 — narrower truncate layout overrides (Shipping Performance only). */
const SHIPPING_PERF_TABLE_COLUMN_LAYOUT_OVERRIDES: Partial<
  Record<string, OperationalColumnLayout>
> = {
  vessel_name: 'truncate',
  loading_port: 'truncate',
  discharge_port: 'truncate',
  product: 'truncate',
  supplier: 'truncate',
  group_name: 'truncate',
  contract_ext_no: 'truncate',
  contract_number: 'truncate',
  sto_number: 'truncate',
  po_number: 'truncate',
}

export function getShippingPerfTableColumnLayout(
  colId: string,
  _tableViewMode: 'all' | 'by_vessel',
): OperationalColumnLayout {
  const override = SHIPPING_PERF_TABLE_COLUMN_LAYOUT_OVERRIDES[colId]
  if (override) return override
  return getOperationalColumnLayout('shipping_performance', colId)
}

export const SHIPPING_PERF_TABLE_CELL_PAD = 'px-2 py-1.5'
export const SHIPPING_PERF_TABLE_ROW_MIN_H = 'min-h-[32px]'
export const SHIPPING_PERF_TABLE_HEADER_ROW_CLASS = COMPACT_TABLE_HEADER_ROW_PERF_CLASS
export {
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_COL_WIDTH_PX,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
}
export const SHIPPING_PERF_TABLE_BODY_CLASS = 'divide-y divide-gray-200'

/** Fixed px widths for table-fixed layout (compact, matches CP Section 3 pattern). */
export const SHIPPING_PERF_TABLE_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  vessel_name: 96,
  by_vessel_qty_contract: 96,
  by_vessel_qty_delivery: 96,
  by_vessel_qty_receive: 96,
  contract_ext_no: 96,
  loading_port: 88,
  discharge_port: 88,
  incoterm: 64,
  product: 96,
  supplier: 112,
  contract_qty: 88,
  delivered_qty: 88,
  group_name: 88,
  shipment_count: 64,
  status: 80,
  po_number: 80,
  contract_number: 88,
  sto_number: 80,
  sto_qty: 80,
  received_qty: 80,
  planning_qty: 80,
  outstanding_qty_actual: 104,
  outstanding_qty_planning: 112,
  outstanding_qty: 96,
  loading_delta_eta_etr_days: 72,
  loading_delta_eta_etb_days: 72,
  loading_delta_etb_etc_days: 72,
  discharge_delta_eta_etb_days: 80,
  discharge_delta_etb_etc_days: 80,
  total_delta_days: 56,
}

const DEFAULT_COLUMN_WIDTH_PX = 88

export function shippingPerfTableColumnWidthPx(colKey: string, headerLabel?: string): number {
  const base = SHIPPING_PERF_TABLE_COLUMN_WIDTH_PX[colKey] ?? DEFAULT_COLUMN_WIDTH_PX
  return resolveCompactColumnWidthPx(base, headerLabel, { hasSort: true })
}

export function shippingPerfTableMinWidthPx(
  visibleColumns: ReadonlyArray<{ key: string; label?: string } | string>,
): number {
  return visibleColumns.reduce((sum, item) => {
    if (typeof item === 'string') {
      return sum + shippingPerfTableColumnWidthPx(item)
    }
    return sum + shippingPerfTableColumnWidthPx(item.key, item.label)
  }, 0)
}

/** Multi-word / long text columns — ID and status columns use operational nowrap/stack layout. */
export const SHIPPING_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'vessel_name',
  'product',
  'supplier',
  'loading_port',
  'discharge_port',
  'group_name',
  'contract_ext_no',
  'contract_number',
  'po_number',
  'sto_number',
  'contract_qty',
  'delivered_qty',
  'sto_qty',
  'received_qty',
  'planning_qty',
  'outstanding_qty_actual',
  'outstanding_qty_planning',
  'outstanding_qty',
  'by_vessel_qty_contract',
  'by_vessel_qty_receive',
  'by_vessel_qty_delivery',
])

export type ShippingPerfCellTooltipSource = ShippingPerformancePortSource & {
  vessel_name?: string | null
  contract_ext_no?: string | null
  contract_number?: string | null
  po_number?: string | null
  product?: string | null
  supplier?: string | null
  incoterm?: string | null
  group_name?: string | null
  contract_qty?: number | null
  delivered_qty?: number | null
  sto_qty?: number | null
  received_qty?: number | null
  planning_qty?: number | null
  outstanding_qty_actual?: number | null
  outstanding_qty_planning?: number | null
  outstanding_qty?: number | null
}

export function shippingPerfCellTooltipText(
  colKey: string,
  row: ShippingPerfCellTooltipSource,
): string | null {
  switch (colKey) {
    case 'vessel_name':
      return formatVesselTableDisplay(row.vessel_name, '') || null
    case 'contract_ext_no':
      return String(row.contract_ext_no ?? '').trim() || null
    case 'contract_number':
      return String(row.contract_number ?? '').trim() || null
    case 'po_number':
      return String(row.po_number ?? '').trim() || null
    case 'product':
      return String(row.product ?? '').trim() || null
    case 'supplier':
      return String(row.supplier ?? '').trim() || null
    case 'incoterm':
      return String(row.incoterm ?? '').trim() || null
    case 'loading_port':
      return resolveShippingPerfLoadingPort(row)
    case 'discharge_port':
      return resolveShippingPerfDischargePort(row)
    case 'group_name':
      return String(row.group_name ?? '').trim() || null
    case 'contract_qty':
    case 'delivered_qty':
    case 'by_vessel_qty_contract':
    case 'by_vessel_qty_delivery':
    case 'by_vessel_qty_receive':
    case 'sto_qty':
    case 'received_qty':
    case 'planning_qty': {
      let raw: number | null | undefined
      if (colKey === 'contract_qty' || colKey === 'by_vessel_qty_contract') {
        raw = row.contract_qty
      } else if (colKey === 'delivered_qty' || colKey === 'by_vessel_qty_delivery') {
        raw = row.delivered_qty
      } else if (colKey === 'received_qty' || colKey === 'by_vessel_qty_receive') {
        raw = row.received_qty
      } else if (colKey === 'sto_qty') {
        raw = row.sto_qty
      } else if (colKey === 'planning_qty') {
        raw = row.planning_qty
      } else {
        raw = null
      }
      if (raw === null || raw === undefined) return null
      const mt = Number(raw) / 1000
      return `${mt.toLocaleString('en-US', { maximumFractionDigits: 2 })} MT`
    }
    case 'outstanding_qty_actual':
    case 'outstanding_qty_planning':
    case 'outstanding_qty': {
      let raw: number | null | undefined
      if (colKey === 'outstanding_qty_planning') {
        raw = row.outstanding_qty_planning
      } else {
        raw = row.outstanding_qty_actual ?? row.outstanding_qty
      }
      if (raw === null || raw === undefined) return null
      return formatOutstandingQtyMtFromKg(raw)
    }
    default:
      return null
  }
}
