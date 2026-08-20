/**
 * Contract Performance (Section 3) — default column order and visibility.
 * Isolated from `/contracts` and other pages; do not import from shared table configs elsewhere.
 */

import { migrateSavedColumnLayout, mergePreservedColumnOrder } from '@/lib/columnLayoutMigration'
import {
  buildCompactTableColumnWidthTracks,
  resolveCompactColumnWidthPx,
  type CompactTableColumnWidthInput,
} from '@/lib/compactTableUi'
import {
  getOperationalColumnLayout,
  type OperationalColumnLayout,
} from '@/lib/operationalTableLayout'
import { formatContractViewTableReceiveQtyMt } from '@/lib/contractPerformanceExport'
import {
  formatSapOutstandingQtyMtDisplay,
  formatSapQtyMtDisplay,
} from '@/lib/sapDisplayValue'

export {
  COMPACT_TABLE_HEADER_ROW_CLASS as CONTRACT_PERF_TABLE_HEADER_ROW_CLASS,
  COMPACT_TABLE_HEADER_ROW_PERF_CLASS as CONTRACT_PERF_TABLE_HEADER_ROW_PERF_CLASS,
  COMPACT_TABLE_HEADER_ROW_OPERATIONAL_CLASS as CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_STICKY_CLASS,
  COMPACT_TABLE_ACTIONS_COL_WIDTH_PX,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
} from '@/lib/compactTableUi'

/** Left-to-right table order and Visible Column modal sequence (primary columns first). */
export const CONTRACT_PERF_COLUMN_ORDER: readonly string[] = [
  'month_delivery_end',
  'contract_date',
  'contract_ext_no',
  'po_number',
  'supplier',
  'incoterm',
  'product',
  'status_overall',
  'contract_qty',
  'delivery_qty',
  'outstanding_qty_mt',
  'trade_cycle_days',
  'dp_cycle_days',
  'cash_cycle_days',
  'log_cycle_days',
] as const

/** Default visible set matches {@link CONTRACT_PERF_COLUMN_ORDER}. */
export const CONTRACT_PERF_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = CONTRACT_PERF_COLUMN_ORDER

/** Bump when default column order/visibility changes — triggers one-time local reset on the CP page. */
export const CONTRACT_PERF_COLUMN_LAYOUT_VERSION = 'cp-columns-v6'

/** Contracts list (/contracts) — separate from Contract Performance layout version. */
export const CONTRACTS_COLUMN_LAYOUT_VERSION = 'contracts-columns-v3'

export const CONTRACTS_COLUMN_LAYOUT_VERSION_KEY = 'contracts.compact.columnLayoutVersion'

/** Duplicate of contract_qty — removed from column picker. */
export const CONTRACT_OBSOLETE_COLUMN_IDS = ['qty_delivery'] as const

export const CONTRACT_PERF_COLUMN_LAYOUT_VERSION_KEY =
  'contract-performance.compact.columnLayoutVersion'

/** Legacy localStorage keys (pre-v2 layout) — cleared on migration. */
export const CONTRACT_PERF_LEGACY_STORAGE_KEYS = [
  'contract-performance.compact.visibleColumns.v14',
  'contract-performance.compact.visibleColumns.v15',
  'contract-performance.compact.columnOrder.v10',
  'contract-performance.compact.columnOrder.v11',
] as const

export function isContractPerformancePathname(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === '/contract-performance'
}

/** Section 3 table + visible rows in Columns menu — respects saved {@link columnOrderIds} when provided. */
export function buildContractPerfVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  columnOrderIds?: readonly string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const allIds = columns.map((c) => c.id)
  const fallback = contractPerfCompactColumnFallbackOrder(allIds)
  const baseOrder =
    columnOrderIds && columnOrderIds.length > 0
      ? mergeContractPerfColumnOrder([...columnOrderIds], allIds)
      : fallback

  const out: T[] = []
  for (const id of baseOrder) {
    if (!visibleIds.has(id)) continue
    const col = byId.get(id)
    if (col) out.push(col)
  }
  return out
}

export function contractPerfDefaultVisibleColumnIds(allIds: string[]): string[] {
  return CONTRACT_PERF_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

export function contractPerfCompactColumnFallbackOrder(allIds: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of CONTRACT_PERF_COLUMN_ORDER) {
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

/** Preserve saved user order; append any new columns from canonical fallback. */
export function mergeContractPerfColumnOrder(saved: string[], allIds: string[]): string[] {
  return mergePreservedColumnOrder(saved, allIds, contractPerfCompactColumnFallbackOrder(allIds))
}

/** Section 3 compact table — shared by Contract Performance and Contracts pages. */
export const CONTRACT_PERF_TABLE_CELL_PAD = 'px-2 py-1.5'
export const CONTRACT_PERF_TABLE_ROW_MIN_H = 'min-h-[32px]'

/** Section 3 — narrower truncate layout overrides (Contract Performance only). */
const CONTRACT_PERF_TABLE_COLUMN_LAYOUT_OVERRIDES: Partial<
  Record<string, OperationalColumnLayout>
> = {
  supplier: 'truncate',
  product: 'truncate',
  source_type: 'truncate',
  group_name: 'truncate',
  company_name: 'truncate',
  vessel_name: 'truncate',
  contract_ext_no: 'truncate',
  po_number: 'truncate',
}

export function getContractPerfTableColumnLayout(colId: string): OperationalColumnLayout {
  const override = CONTRACT_PERF_TABLE_COLUMN_LAYOUT_OVERRIDES[colId]
  if (override) return override
  return getOperationalColumnLayout('contracts', colId)
}

/** Section 3 compact table — fixed px widths (Contract Performance only). */
export const CONTRACT_PERF_TABLE_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  contract_date: 88,
  supplier: 152,
  contract_ext_no: 96,
  po_number: 80,
  source_type: 72,
  product: 96,
  incoterm: 64,
  contract_qty: 88,
  delivery_qty: 96,
  outstanding_qty_mt: 96,
  trade_cycle_days: 80,
  dp_cycle_days: 72,
  cash_cycle_days: 80,
  log_cycle_days: 72,
  month_delivery_end: 96,
  contract_id: 120,
  group_name: 120,
  contract_aging: 100,
  delivery_status: 100,
  status_overall: 88,
  unusual_status: 88,
  received_qty: 120,
  outstanding_qty: 120,
  over_under_delivery_status: 140,
  company_name: 150,
  lt_spot: 72,
  sto_number: 110,
  delivery_start: 108,
  delivery_end: 108,
  cargo_readiness_date: 120,
  last_planning_delivery_date: 140,
  vessel_name: 120,
  eta_vessel_completed_loading: 108,
  eta_vessel_complete_discharge: 108,
  created_at: 100,
}

/** Multi-word / long text columns — ID columns use operational nowrap/stack layout instead. */
export const CONTRACT_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'supplier',
  'product',
  'source_type',
  'group_name',
  'company_name',
  'vessel_name',
  'contract_ext_no',
  'po_number',
  'contract_qty',
  'delivery_qty',
  'outstanding_qty_mt',
  'received_qty',
])

const CONTRACT_PERF_DEFAULT_COLUMN_WIDTH_PX = 96

export function contractPerfTableColumnWidthPx(
  colId: string,
  headerLabel?: string,
  options?: { hasFormulaHelp?: boolean },
): number {
  const base = CONTRACT_PERF_TABLE_COLUMN_WIDTH_PX[colId] ?? CONTRACT_PERF_DEFAULT_COLUMN_WIDTH_PX
  return resolveCompactColumnWidthPx(base, headerLabel, {
    hasFormulaHelp: options?.hasFormulaHelp,
    hasSort: true,
  })
}

export function contractPerfTableColumnTrack(colId: string): string {
  const px = contractPerfTableColumnWidthPx(colId)
  return `minmax(${px}px, ${px}px)`
}

export function buildContractPerfColumnWidthTracks(
  visibleColumns: ReadonlyArray<string | CompactTableColumnWidthInput>,
): Record<string, string> {
  return buildCompactTableColumnWidthTracks(visibleColumns, (id, label, formulaHelp) =>
    contractPerfTableColumnWidthPx(id, label, { hasFormulaHelp: Boolean(formulaHelp) }),
  )
}

export type ContractPerfCellTooltipSource = {
  contract_id?: string | null
  supplier?: string | null
  contract_ext_no?: string | null
  po_number?: string | null
  po_numbers?: string | null
  product?: string | null
  source_type?: string | null
  group_name?: string | null
  company_name?: string | null
  vessel_name?: string | null
  sto_number?: string | null
  sto_numbers?: string | null
  quantity_ordered?: number | null
  quantity_delivery?: number | null
  quantity_receive?: number | null
  outstanding_quantity?: number | null
}

export function contractPerfCellTooltipText(
  colId: string,
  row: ContractPerfCellTooltipSource,
): string | null {
  switch (colId) {
    case 'supplier':
      return row.supplier?.trim() || null
    case 'contract_ext_no':
      return row.contract_ext_no?.trim() || null
    case 'po_number':
      return (row.po_numbers || row.po_number || '').trim() || null
    case 'product':
      return row.product?.trim() || null
    case 'source_type':
      return row.source_type?.trim() || null
    case 'group_name':
      return row.group_name?.trim() || null
    case 'company_name':
      return row.company_name?.trim() || null
    case 'contract_id':
      return row.contract_id?.trim() || null
    case 'vessel_name':
      return row.vessel_name?.trim() || null
    case 'sto_number':
      return (row.sto_numbers || row.sto_number || '').trim() || null
    case 'contract_qty':
      return formatSapQtyMtDisplay(row.quantity_ordered)
    case 'delivery_qty':
      return formatSapQtyMtDisplay(row.quantity_delivery)
    case 'received_qty':
      return formatContractViewTableReceiveQtyMt(row.quantity_receive)
    case 'outstanding_qty_mt':
      return formatSapOutstandingQtyMtDisplay(row.outstanding_quantity)
    default:
      return null
  }
}

/** Migrate saved contract column prefs: drop qty_delivery duplicate, keep contract_qty. */
export function migrateContractColumnLayout(
  visibleColumnIds: readonly string[],
  columnOrderIds: readonly string[],
  ensureVisibleIds: readonly string[],
): { visibleColumnIds: string[]; columnOrderIds: string[] } {
  return migrateSavedColumnLayout({
    visibleColumnIds,
    columnOrderIds,
    obsoleteColumnIds: CONTRACT_OBSOLETE_COLUMN_IDS,
    idRemap: { qty_delivery: 'contract_qty' },
    ensureVisibleIds,
  })
}

export function orderContractPerformanceColumns<T extends { id: string }>(columns: T[]): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: T[] = []
  for (const id of CONTRACT_PERF_COLUMN_ORDER) {
    const col = byId.get(id)
    if (col && !seen.has(id)) {
      out.push(col)
      seen.add(id)
    }
  }
  for (const col of columns) {
    if (!seen.has(col.id)) {
      out.push(col)
      seen.add(col.id)
    }
  }
  return out
}
