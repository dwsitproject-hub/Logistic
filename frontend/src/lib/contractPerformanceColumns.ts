/**
 * Contract Performance (Section 3) — default column order and visibility.
 * Isolated from `/contracts` and other pages; do not import from shared table configs elsewhere.
 */

/** Left-to-right table order and Visible Column modal sequence (primary columns first). */
export const CONTRACT_PERF_COLUMN_ORDER: readonly string[] = [
  'contract_date',
  'supplier',
  'contract_ext_no',
  'po_number',
  'source_type',
  'product',
  'incoterm',
  'contract_qty',
  'outstanding_qty_mt',
  'trade_cycle_days',
  'dp_cycle_days',
  'cash_cycle_days',
  'log_cycle_days',
  'month_delivery_end',
] as const

/** Default visible set matches {@link CONTRACT_PERF_COLUMN_ORDER}. */
export const CONTRACT_PERF_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = CONTRACT_PERF_COLUMN_ORDER

/** Bump when default column order/visibility changes — triggers one-time local reset on the CP page. */
export const CONTRACT_PERF_COLUMN_LAYOUT_VERSION = 'cp-columns-v3'

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

/** Section 3 table + visible rows in Columns menu — strict {@link CONTRACT_PERF_COLUMN_ORDER}. */
export function buildContractPerfVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const out: T[] = []
  for (const id of CONTRACT_PERF_COLUMN_ORDER) {
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

/** Primary columns stay in {@link CONTRACT_PERF_COLUMN_ORDER}; extras keep saved order, then canonical. */
export function mergeContractPerfColumnOrder(saved: string[], allIds: string[]): string[] {
  const canonical = contractPerfCompactColumnFallbackOrder(allIds)
  if (saved.length === 0) return canonical

  const primary = CONTRACT_PERF_COLUMN_ORDER.filter((id) => allIds.includes(id))
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

/** Section 3 compact table — fixed px widths (Contract Performance only). */
export const CONTRACT_PERF_TABLE_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  contract_date: 100,
  supplier: 150,
  contract_ext_no: 120,
  po_number: 110,
  source_type: 88,
  product: 120,
  incoterm: 72,
  contract_qty: 120,
  outstanding_qty_mt: 130,
  trade_cycle_days: 96,
  dp_cycle_days: 88,
  cash_cycle_days: 96,
  log_cycle_days: 88,
  month_delivery_end: 108,
  contract_id: 120,
  group_name: 120,
  contract_aging: 100,
  delivery_status: 100,
  status_overall: 88,
  unusual_status: 88,
  received_qty: 120,
  qty_delivery: 120,
  outstanding_qty: 120,
  over_under_delivery_status: 140,
  company_name: 150,
  lt_spot: 72,
  sto_number: 110,
  delivery_start: 108,
  delivery_end: 108,
  cargo_readiness_date: 120,
  vessel_name: 120,
  eta_vessel_completed_loading: 108,
  eta_vessel_complete_discharge: 108,
  created_at: 100,
}

export const CONTRACT_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'supplier',
  'contract_ext_no',
  'po_number',
  'product',
  'source_type',
  'group_name',
  'company_name',
  'contract_id',
  'vessel_name',
  'sto_number',
])

const CONTRACT_PERF_DEFAULT_COLUMN_WIDTH_PX = 96

export function contractPerfTableColumnWidthPx(colId: string): number {
  return CONTRACT_PERF_TABLE_COLUMN_WIDTH_PX[colId] ?? CONTRACT_PERF_DEFAULT_COLUMN_WIDTH_PX
}

export function contractPerfTableColumnTrack(colId: string): string {
  const px = contractPerfTableColumnWidthPx(colId)
  return `minmax(${px}px, ${px}px)`
}

export function buildContractPerfColumnWidthTracks(
  visibleColumnIds: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of visibleColumnIds) {
    out[id] = contractPerfTableColumnTrack(id)
  }
  return out
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
    default:
      return null
  }
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
