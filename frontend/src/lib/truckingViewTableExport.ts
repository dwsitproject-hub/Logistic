/**
 * Trucking View Table "Download Table" — visible columns only, values match the table.
 *
 * Numbers are exported as numbers with the unit in the header ("Contract Qty (MT)"), so the file
 * can be summed and counted; see exportNumbers.ts. OA Budget / OA Actual have no single unit (the
 * currency is per row), so each is followed by its own currency column.
 */

import { computeLateIndicatorDisplay } from '@/lib/calendarDays'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatOperationalTableTextDisplayForColumn } from '@/lib/sapDisplayValue'
import { exportHeaderWithUnit, exportNumberCell, kgToMtNumber } from '@/lib/exportNumbers'

export interface TruckingViewTableExportColumn {
  id: string
  label: string
}

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

/** Unit shown in the export header of a numeric column; the cell itself is a bare number. */
export const TRUCKING_EXPORT_UNIT_BY_COLUMN_ID: Record<string, string> = {
  contract_qty: 'MT',
  sto_quantity: 'MT',
  quantity_delivered: 'MT',
  quantity_receive: 'MT',
  outstanding_qty_mt: 'MT',
  gain_loss_percentage: '%',
  gain_loss_amount: 'Kg',
  estimated_km: 'km',
}

/** Amount columns that carry a per-row currency, and the row field holding it. */
const TRUCKING_EXPORT_CURRENCY_FIELD_BY_COLUMN_ID: Record<string, string> = {
  oa_budget: 'oa_budget_currency',
  oa_actual: 'oa_actual_currency',
}

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
    return kgToMtNumber(rec.quantity_receive ?? rec.quantity_delivered)
  }
  if (id === 'quantity_delivered') {
    return kgToMtNumber(rec.quantity_delivered)
  }
  if (QTY_MT_COLUMN_IDS.has(id)) {
    return kgToMtNumber(rec[id])
  }
  if (id === 'outstanding_qty_mt') {
    // Negative = over-delivered (the table shows it as "+N MT"), so the column nets out when summed.
    return kgToMtNumber(rec.outstanding_quantity)
  }
  if (TRUCKING_EXPORT_DATE_COLUMN_IDS.has(id)) {
    const raw = rec[id]
    return raw ? formatDateDMY(String(raw)) : '-'
  }
  // Blank when missing, so COUNT counts only filled rows.
  if (
    id === 'gain_loss_percentage' ||
    id === 'gain_loss_amount' ||
    id in TRUCKING_EXPORT_CURRENCY_FIELD_BY_COLUMN_ID
  ) {
    return exportNumberCell(rec[id])
  }
  if (id === 'estimated_km') {
    // 0 means "not filled" in the table, so it exports blank.
    const n = exportNumberCell(rec.estimated_km)
    return n === '' || n === 0 ? '' : n
  }

  return dashIfEmpty(formatOperationalTableTextDisplayForColumn(id, rec[id]))
}

/** The row field holding the currency that follows an OA amount column, or null for any other column. */
function currencyFieldFor(columnId: string): string | null {
  return TRUCKING_EXPORT_CURRENCY_FIELD_BY_COLUMN_ID[columnId] ?? null
}

export function buildTruckingViewTableExportMatrix(
  visibleColumns: TruckingViewTableExportColumn[],
  rows: object[],
): (string | number)[][] {
  const header = visibleColumns.flatMap((col) => {
    const label = exportHeaderWithUnit(col.label, TRUCKING_EXPORT_UNIT_BY_COLUMN_ID[col.id])
    return currencyFieldFor(col.id) ? [label, `${col.label} Currency`] : [label]
  })
  const body = rows.map((row) => {
    const rec = asRecord(row)
    return visibleColumns.flatMap((col) => {
      const cell = resolveTruckingViewTableExportCell(col, row)
      const field = currencyFieldFor(col.id)
      return field ? [cell, String(rec[field] ?? '').trim()] : [cell]
    })
  })
  return [header, ...body]
}
