/**
 * Contract Performance "Download Table" — cell values must match the visible table,
 * and the sheet must include only columns the user set visible (same left-to-right order).
 */

import {
  formatLogCycleDaysCompact,
  formatSignedCycleDaysCompact,
} from '@/lib/cycleDaysDisplay'
import { formatDateDMY } from '@/lib/dateFormat'
import {
  formatSapDisplayValue,
  formatSapOutstandingQtyMtDisplay,
  formatSapQtyMtDisplay,
} from '@/lib/sapDisplayValue'

export interface ContractPerfExportColumn {
  id: string
  label: string
  getSortValue?: (row: object) => string | number | null | undefined
}

export interface ContractPerfExportFormatters {
  formatStatusOverall: (row: object) => string
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

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
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
    return formatters.formatStatusOverall(row) || '-'
  }
  if (id === 'over_under_delivery_status') {
    return formatSapDisplayValue(rec.over_under_delivery_status)
  }
  if (id === 'lt_spot') {
    return formatSapDisplayValue(rec.lt_spot)
  }
  if (id === 'month_delivery_end') {
    const formatted = column.getSortValue?.(row)
    return dashIfEmpty(formatted == null ? '' : String(formatted))
  }
  if (CONTRACT_PERF_EXPORT_DATE_COLUMN_IDS.has(id)) {
    const raw = column.getSortValue?.(row)
    return raw ? formatDateDMY(String(raw)) : '-'
  }
  if (CONTRACT_PERF_EXPORT_QTY_MT_COLUMN_IDS.has(id)) {
    const field = QTY_ROW_FIELD_BY_COLUMN_ID[id]
    if (id === 'received_qty') {
      return formatContractViewTableReceiveQtyMt(rec[field])
    }
    return formatSapQtyMtDisplay(rec[field] as number | string | null | undefined)
  }
  if (id === 'outstanding_qty_mt') {
    return formatSapOutstandingQtyMtDisplay(
      rec.outstanding_quantity as number | string | null | undefined,
    )
  }
  if (id === 'log_cycle_days') {
    return formatLogCycleDaysCompact(parseOptionalNumber(rec.log_cycle_days))
  }
  if (CONTRACT_PERF_EXPORT_SIGNED_CYCLE_COLUMN_IDS.has(id)) {
    return formatSignedCycleDaysCompact(parseOptionalNumber(rec[id]))
  }

  return dashIfEmpty(column.getSortValue ? column.getSortValue(row) : '')
}

/** Header + body using only the caller-supplied visible columns (user picker order). */
export function buildContractPerfExportMatrix(
  visibleColumns: ContractPerfExportColumn[],
  rows: object[],
  formatters: ContractPerfExportFormatters,
): (string | number)[][] {
  const header = visibleColumns.map((col) => col.label)
  const body = rows.map((row) =>
    visibleColumns.map((col) => resolveContractPerfExportCell(col, row, formatters)),
  )
  return [header, ...body]
}
