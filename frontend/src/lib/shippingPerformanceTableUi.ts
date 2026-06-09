/**
 * Shipping Performance Section 3 — compact table UI aligned with Contract Performance.
 */

import { COMPACT_TABLE_HEADER_ROW_CLASS, resolveCompactColumnWidthPx } from '@/lib/compactTableUi'
import {
  getOperationalColumnLayout,
  type OperationalColumnLayout,
} from '@/lib/operationalTableLayout'

/** Intrinsic nowrap columns — full text visible, horizontal scroll when needed. */
const SHIPPING_PERF_INTRINSIC_TOKEN_COLUMN_LAYOUT: Partial<
  Record<string, OperationalColumnLayout>
> = {
  vessel_name: 'token',
}

export function getShippingPerfTableColumnLayout(
  colId: string,
  _tableViewMode: 'all' | 'by_vessel',
): OperationalColumnLayout {
  const override = SHIPPING_PERF_INTRINSIC_TOKEN_COLUMN_LAYOUT[colId]
  if (override) return override
  return getOperationalColumnLayout('shipping_performance', colId)
}

export const SHIPPING_PERF_TABLE_CELL_PAD = 'px-2 py-1.5'
export const SHIPPING_PERF_TABLE_ROW_MIN_H = 'min-h-[32px]'
export const SHIPPING_PERF_TABLE_HEADER_ROW_CLASS = COMPACT_TABLE_HEADER_ROW_CLASS
export const SHIPPING_PERF_TABLE_BODY_CLASS = 'divide-y divide-gray-200'

/** Fixed px widths for table-fixed layout (compact, matches CP Section 3 pattern). */
export const SHIPPING_PERF_TABLE_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  vessel_name: 128,
  contract_ext_no: 120,
  loading_port: 108,
  discharge_port: 108,
  incoterm: 72,
  product: 112,
  supplier: 140,
  contract_qty: 100,
  group_name: 100,
  shipment_count: 72,
  status: 96,
  po_number: 100,
  contract_number: 108,
  sto_number: 100,
  sto_qty: 96,
  received_qty: 96,
  outstanding_qty: 108,
  loading_delta_eta_etr_days: 88,
  loading_delta_eta_etb_days: 88,
  loading_delta_etb_etc_days: 88,
  discharge_delta_eta_etb_days: 96,
  discharge_delta_etb_etc_days: 96,
  total_delta_days: 72,
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
])

export type ShippingPerfCellTooltipSource = {
  vessel_name?: string | null
  contract_ext_no?: string | null
  contract_number?: string | null
  po_number?: string | null
  product?: string | null
  supplier?: string | null
  incoterm?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  group_name?: string | null
}

export function shippingPerfCellTooltipText(
  colKey: string,
  row: ShippingPerfCellTooltipSource,
): string | null {
  switch (colKey) {
    case 'vessel_name':
      return String(row.vessel_name ?? '').trim() || null
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
    case 'loading_port': {
      const v = String(row.loading_port ?? '').trim()
      return v && v !== 'Blank' ? v : null
    }
    case 'discharge_port': {
      const v = String(row.discharge_port ?? '').trim()
      return v && v !== 'Blank' ? v : null
    }
    case 'group_name':
      return String(row.group_name ?? '').trim() || null
    default:
      return null
  }
}
