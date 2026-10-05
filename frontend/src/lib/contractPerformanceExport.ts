/**
 * Contract Performance "Download Table" — cell values must match the visible table,
 * and the sheet must include only columns the user set visible (same left-to-right order).
 *
 * Numbers are exported as numbers with the unit in the header ("Contract Qty (MT)"), so the file
 * can be summed and counted; see exportNumbers.ts.
 */

import { formatDateDMY } from '@/lib/dateFormat'
import { exportHeaderWithUnit, exportNumberCell, kgToMtNumber } from '@/lib/exportNumbers'
import { formatSapDisplayValue, formatSapQtyMtDisplay } from '@/lib/sapDisplayValue'

/**
 * Rows arrive here as whatever the page holds, so the entry points still take `object` - a typed
 * contract interface is assignable to that, and would not be assignable to a Record without an
 * index signature. The *callbacks* are the other direction: the caller writes them and this
 * module calls them, so declaring their parameter as `object` meant no caller could read a field
 * off the row without casting. They now receive the record this module already builds.
 */
export interface ContractPerfExportColumn {
  id: string
  label: string
  getSortValue?: (row: Record<string, unknown>) => string | number | null | undefined
}

export interface ContractPerfExportFormatters {
  formatStatusOverall: (row: Record<string, unknown>) => string
}

function asRecord(row: object): Record<string, unknown> {
  return row as Record<string, unknown>
}

/** Full calendar-date columns — export DD/MM/YYYY to match the table. */
export const CONTRACT_PERF_EXPORT_DATE_COLUMN_IDS = new Set([
  'contract_date',
  'eta_vessel_completed_loading',
  'eta_vessel_complete_discharge',
  'delivery_start',
  'delivery_end',
  'last_planning_delivery_date',
  'cargo_readiness_date',
])

export const CONTRACT_PERF_EXPORT_QTY_MT_COLUMN_IDS = new Set([
  'contract_qty',
  'delivery_qty',
  'received_qty',
])

export const CONTRACT_PERF_EXPORT_SIGNED_CYCLE_COLUMN_IDS = new Set([
  'trade_cycle_days',
  'cash_cycle_days',
  'dp_cycle_days',
])

/** Unit shown in the export header of a numeric column; the cell itself is a bare number. */
export const CONTRACT_PERF_EXPORT_UNIT_BY_COLUMN_ID: Record<string, string> = {
  contract_qty: 'MT',
  delivery_qty: 'MT',
  received_qty: 'MT',
  outstanding_qty_mt: 'MT',
  trade_cycle_days: 'days',
  cash_cycle_days: 'days',
  dp_cycle_days: 'days',
  log_cycle_days: 'days',
}

const QTY_ROW_FIELD_BY_COLUMN_ID: Record<string, string> = {
  contract_qty: 'quantity_ordered',
  delivery_qty: 'quantity_delivery',
  received_qty: 'quantity_receive',
  outstanding_qty_mt: 'outstanding_quantity',
}

/** pg numeric often arrives as a string — parse so sort/export do not collapse to 0. */
export function parseContractPerfKg(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const raw =
    typeof value === 'string' ? value.replace(/,/g, '').replace(/\s+/g, '').trim() : value
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  return Number.isFinite(n) ? n : null
}

export function contractPerfQtySortValue(value: unknown): number {
  return parseContractPerfKg(value) ?? 0
}

/**
 * Contracts / Contract Performance View Table.
 * Null qty displays as 0 MT (same as Shipments / Trucking tables).
 */
export function formatContractViewTableReceiveQtyMt(value: unknown): string {
  return formatSapQtyMtDisplay(parseContractPerfKg(value) ?? 0)
}

/** The table shows the magnitude only (late/ahead is colour), so the export does the same. */
function cycleDaysMagnitudeCell(value: unknown): number | '' {
  const n = exportNumberCell(value)
  return n === '' ? '' : Math.abs(n)
}

function dashIfEmpty(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined || value === '') return '-'
  return value
}

export function resolveContractPerfExportCell(
  column: ContractPerfExportColumn,
  row: object,
  formatters: ContractPerfExportFormatters,
): string | number {
  const id = column.id
  const rec = asRecord(row)

  if (id === 'status_overall') {
    return formatters.formatStatusOverall(rec) || '-'
  }
  if (id === 'over_under_delivery_status') {
    return formatSapDisplayValue(rec.over_under_delivery_status)
  }
  if (id === 'lt_spot') {
    return formatSapDisplayValue(rec.lt_spot)
  }
  if (id === 'month_delivery_end') {
    const formatted = column.getSortValue?.(rec)
    return dashIfEmpty(formatted == null ? '' : String(formatted))
  }
  if (CONTRACT_PERF_EXPORT_DATE_COLUMN_IDS.has(id)) {
    const raw = column.getSortValue?.(rec)
    return raw ? formatDateDMY(String(raw)) : '-'
  }
  if (CONTRACT_PERF_EXPORT_QTY_MT_COLUMN_IDS.has(id)) {
    // Missing qty is 0, as in the table (received included).
    return kgToMtNumber(rec[QTY_ROW_FIELD_BY_COLUMN_ID[id]])
  }
  if (id === 'outstanding_qty_mt') {
    // Negative = over-delivered (the table shows it as "+N MT"), so the column nets out when summed.
    return kgToMtNumber(rec.outstanding_quantity)
  }
  if (id === 'log_cycle_days') {
    return cycleDaysMagnitudeCell(rec.log_cycle_days)
  }
  if (CONTRACT_PERF_EXPORT_SIGNED_CYCLE_COLUMN_IDS.has(id)) {
    return cycleDaysMagnitudeCell(rec[id])
  }

  return dashIfEmpty(column.getSortValue ? column.getSortValue(rec) : '')
}

/** Header + body using only the caller-supplied visible columns (user picker order). */
export function buildContractPerfExportMatrix(
  visibleColumns: ContractPerfExportColumn[],
  rows: object[],
  formatters: ContractPerfExportFormatters,
): (string | number)[][] {
  const header = visibleColumns.map((col) =>
    exportHeaderWithUnit(col.label, CONTRACT_PERF_EXPORT_UNIT_BY_COLUMN_ID[col.id]),
  )
  const body = rows.map((row) =>
    visibleColumns.map((col) => resolveContractPerfExportCell(col, row, formatters)),
  )
  return [header, ...body]
}
