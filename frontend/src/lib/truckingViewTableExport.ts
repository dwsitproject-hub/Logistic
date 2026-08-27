/**
 * Trucking View Table "Download Table" — visible columns only, values match the table.
 */

import { computeLateIndicatorDisplay } from '@/lib/calendarDays'
import { formatDateDMY } from '@/lib/dateFormat'
import {
  formatOperationalTableTextDisplayForColumn,
  formatSapDisplayNumber,
  formatSapOutstandingQtyMtDisplay,
  formatSapQtyMtDisplay,
} from '@/lib/sapDisplayValue'

export interface TruckingViewTableExportColumn {
  id: string
  label: string
}

const QTY_MT_OPTS = { maxFractionDigits: 0 } as const

const TRUCKING_STATUS_LABELS: Record<string, string> = {
  UNPLANNED: 'Unplanned',
  PLANNED: 'Planned',
  IN_PROGRESS: 'Planned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const TRUCKING_EXPORT_DATE_COLUMN_IDS = new Set([
  'contract_date',
  'trucking_start_date',
  'trucking_completion_date',
  'cargo_readiness_date',
  'delivery_start_date',
  'delivery_end_date',
  'created_at',
])

const QTY_MT_COLUMN_IDS = new Set([
  'contract_qty',
  'sto_quantity',
  'quantity_delivered',
  'quantity_receive',
])

function asRecord(row: object): Record<string, unknown> {
  return row as Record<string, unknown>
}

function dashIfEmpty(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined || value === '') return '-'
  return value
}

export function parseTruckingExportQtyKg(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = Number(String(value).replace(/,/g, '').replace(/\s+/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function truckingStatusLabel(status: unknown): string {
  const key = String(status ?? '').trim().toUpperCase()
  if (!key) return '-'
  return TRUCKING_STATUS_LABELS[key] ?? key
}

function isContractBacklog(row: Record<string, unknown>): boolean {
  return String(row.row_kind ?? '').trim() === 'contract_backlog'
}

export function resolveTruckingViewTableExportCell(
  column: TruckingViewTableExportColumn,
  row: object,
): string | number {
  const id = column.id
  const rec = asRecord(row)

  if (id === 'late_indicator') {
    return computeLateIndicatorDisplay(
      rec.delivery_end_date,
      rec.trucking_completion_date,
      rec.eta_trucking_completion_date,
    ).text
  }
  if (id === 'sto_number') {
    if (isContractBacklog(rec)) return '-'
    const sto = String(rec.sto_numbers ?? rec.sto_number ?? '').trim()
    return sto || '-'
  }
  if (id === 'status') {
    return truckingStatusLabel(rec.status)
  }
  if (id === 'contract_ext_no') {
    return formatOperationalTableTextDisplayForColumn(
      id,
      rec.contract_ext_no ?? rec.contract_number,
    )
  }
  if (id === 'loading_location') {
    return formatOperationalTableTextDisplayForColumn(
      id,
      rec.loading_location ?? rec.location,
    )
  }
  if (id === 'quantity_receive') {
    const kg = parseTruckingExportQtyKg(rec.quantity_receive ?? rec.quantity_delivered) ?? 0
    return formatSapQtyMtDisplay(kg, QTY_MT_OPTS)
  }
  if (id === 'quantity_delivered') {
    const kg = parseTruckingExportQtyKg(rec.quantity_delivered) ?? 0
    return formatSapQtyMtDisplay(kg, QTY_MT_OPTS)
  }
  if (QTY_MT_COLUMN_IDS.has(id)) {
    return formatSapQtyMtDisplay(rec[id] as number | string | null, QTY_MT_OPTS)
  }
  if (id === 'outstanding_qty_mt') {
    if (rec.outstanding_quantity == null || rec.outstanding_quantity === '') return '-'
    return formatSapOutstandingQtyMtDisplay(
      rec.outstanding_quantity as number | string | null,
      QTY_MT_OPTS,
    )
  }
  if (TRUCKING_EXPORT_DATE_COLUMN_IDS.has(id)) {
    const raw = rec[id]
    return raw ? formatDateDMY(String(raw)) : '-'
  }
  if (id === 'gain_loss_percentage') {
    if (rec.gain_loss_percentage == null || rec.gain_loss_percentage === '') return '-'
    const formatted = formatSapDisplayNumber(rec.gain_loss_percentage as number | string)
    return formatted === '-' ? '-' : `${formatted}%`
  }
  if (id === 'gain_loss_amount') {
    if (rec.gain_loss_amount == null || rec.gain_loss_amount === '') return '-'
    const formatted = formatSapDisplayNumber(rec.gain_loss_amount as number | string)
    return formatted === '-' ? '-' : `${formatted} Kg`
  }
  if (id === 'oa_budget' || id === 'oa_actual') {
    const amount = rec[id]
    if (amount == null || amount === '') return '-'
    const formatted = formatSapDisplayNumber(amount as number | string)
    if (formatted === '-') return '-'
    const currencyField = id === 'oa_budget' ? rec.oa_budget_currency : rec.oa_actual_currency
    const cur = String(currencyField ?? '').trim()
    return cur ? `${formatted} ${cur}` : formatted
  }
  if (id === 'estimated_km') {
    if (rec.estimated_km == null || rec.estimated_km === '' || rec.estimated_km === 0) return '-'
    return `${formatSapDisplayNumber(rec.estimated_km as number | string)} km`
  }

  return dashIfEmpty(formatOperationalTableTextDisplayForColumn(id, rec[id]))
}

export function buildTruckingViewTableExportMatrix(
  visibleColumns: TruckingViewTableExportColumn[],
  rows: object[],
): (string | number)[][] {
  const header = visibleColumns.map((col) => col.label)
  const body = rows.map((row) =>
    visibleColumns.map((col) => resolveTruckingViewTableExportCell(col, row)),
  )
  return [header, ...body]
}
