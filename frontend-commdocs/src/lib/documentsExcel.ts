import { DOCUMENT_LABELS, DOCUMENT_TYPES, hasType, typesDone } from './documentTypes'
import { saveBlob } from './files'
import { plantLabel } from './format'
import type { DocumentRow } from './types'

/**
 * The Documents table as an Excel file. Every column goes in, whether or not it is shown in the table.
 * Rules (Ryan, 2026-11-06): a unit lives in the header, never in the value; numbers are real numbers so Excel can sum them.
 * Dates are real Excel dates (shown dd/mm/yy), so they sort and filter as dates. Each document type is its own 1/0 column,
 * so "how many POs have SPPB" is a plain SUM.
 */

type Cell = string | number | Date | null
type ExportColumn = { header: string; width: number; value: (r: DocumentRow) => Cell; kind?: 'date' | 'int' | 'qty' | 'money' }

/** A calendar date from an API value ('2026-07-23' or midnight UTC), as a UTC date so no timezone shifts the day. */
function dateCell(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? null : new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()))
}

function numberCell(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function statusLabel(r: DocumentRow): string {
  const done = typesDone(r)
  if (done === DOCUMENT_TYPES.length) return 'Complete'
  return done === 0 ? 'Nothing yet' : 'In progress'
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'PO', width: 14, value: (r) => r.po_number },
  { header: 'Contract Ext No', width: 18, value: (r) => r.contract_ext_no },
  { header: 'Contract Date', width: 13, kind: 'date', value: (r) => dateCell(r.contract_date) },
  { header: 'Supplier', width: 28, value: (r) => r.supplier },
  { header: 'Buyer', width: 24, value: (r) => r.buyer },
  { header: 'Product', width: 20, value: (r) => r.product },
  { header: 'Incoterm', width: 10, value: (r) => r.incoterm },
  { header: 'Region/Plant', width: 18, value: (r) => (r.plant_site ? plantLabel(r.plant_site) : null) },
  { header: 'Contract Qty (kg)', width: 18, kind: 'qty', value: (r) => numberCell(r.quantity_ordered) },
  { header: 'Payment Due Date', width: 17, kind: 'date', value: (r) => dateCell(r.payment_due_date) },
  { header: 'DP Date', width: 12, kind: 'date', value: (r) => dateCell(r.dp_due_date) },
  { header: 'Payoff Date', width: 12, kind: 'date', value: (r) => dateCell(r.payoff_date) },
  { header: 'Unit Price (IDR)', width: 16, kind: 'money', value: (r) => numberCell(r.unit_price) },
  { header: 'Total Price (IDR)', width: 18, kind: 'money', value: (r) => numberCell(r.total_price) },
  // The price headers say IDR (as in the table); this column tells which rows are not in IDR.
  { header: 'Currency', width: 10, value: (r) => (String(r.currency || '').trim() || 'IDR').toUpperCase() },
  { header: 'B2B', width: 8, value: (r) => r.b2b_flag },
  ...DOCUMENT_TYPES.map<ExportColumn>((t) => ({
    header: DOCUMENT_LABELS[t],
    width: 14,
    kind: 'int',
    value: (r) => (hasType(r, t) ? 1 : 0),
  })),
  { header: 'Documents Uploaded', width: 18, kind: 'int', value: (r) => typesDone(r) },
  { header: 'Status', width: 13, value: (r) => statusLabel(r) },
]

const FORMATS = { date: 'dd/mm/yy', int: '0', qty: '#,##0.##', money: '#,##0' } as const

/** Rows in the order given, saved as `fileName`. The xlsx library is loaded only when someone exports. */
export async function saveDocumentsExcel(fileName: string, rows: DocumentRow[]): Promise<void> {
  const XLSX = await import('xlsx')
  const aoa: Cell[][] = [EXPORT_COLUMNS.map((c) => c.header), ...rows.map((r) => EXPORT_COLUMNS.map((c) => c.value(r)))]
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })

  EXPORT_COLUMNS.forEach((c, col) => {
    if (!c.kind) return
    for (let row = 1; row <= rows.length; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })]
      if (cell) cell.z = FORMATS[c.kind]
    }
  })
  ws['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: Math.max(c.width, c.header.length + 2) }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: EXPORT_COLUMNS.length - 1 } }) }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Documents')
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true }) as ArrayBuffer
  saveBlob(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName,
  )
}
