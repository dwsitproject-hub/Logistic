import * as XLSX from 'xlsx'

export type WbRekapFailedRow = {
  sheetName?: string
  rowNumber: number
  po_number?: string
  reason: string
  cells?: string[]
}

/** Same filter as backend — exclude structural rows and PO-missing noise. */
export function filterUserFacingWbRekapFailedRows(failures: WbRekapFailedRow[]): WbRekapFailedRow[] {
  return failures.filter(
    (f) =>
      f.rowNumber > 0 &&
      String(f.po_number ?? '').trim() !== '' &&
      f.po_number !== '-',
  )
}

const META_HEADERS = ['Excel Row', 'Reason'] as const

function sanitizeSheetName(name: string): string {
  const trimmed = name.trim().slice(0, 31) || 'Failed Rows'
  return trimmed.replace(/[\\/?*[\]:]/g, '_')
}

function uniqueSheetNames(failures: WbRekapFailedRow[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const f of failures) {
    const key = f.sheetName?.trim() || 'Failed Rows'
    if (seen.has(key)) continue
    seen.add(key)
    names.push(key)
  }
  return names.length > 0 ? names : ['Failed Rows']
}

function buildSheetMatrix(failures: WbRekapFailedRow[]): string[][] {
  const maxCells = failures.reduce((max, f) => Math.max(max, f.cells?.length ?? 0), 0)
  const colHeaders = Array.from({ length: maxCells }, (_, i) => `Col ${i + 1}`)
  const header = [...META_HEADERS, ...colHeaders]
  const matrix: string[][] = [header]

  for (const row of failures) {
    const cells = row.cells ?? []
    const padded = [...cells]
    while (padded.length < maxCells) padded.push('')
    matrix.push([String(row.rowNumber), row.reason, ...padded.slice(0, maxCells)])
  }
  return matrix
}

/** XLSX of failed WB rekap upload rows — one worksheet per source sheet. */
export function buildFailedWbRekapUploadXlsx(args: { failures: WbRekapFailedRow[] }): Blob {
  const failures = filterUserFacingWbRekapFailedRows(args.failures)
  const wb = XLSX.utils.book_new()
  const sheetNames = uniqueSheetNames(args.failures)

  for (const sheetName of sheetNames) {
    const rows = args.failures.filter((f) => (f.sheetName?.trim() || 'Failed Rows') === sheetName)
    const matrix = buildSheetMatrix(rows)
    const ws = XLSX.utils.aoa_to_sheet(matrix)
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName))
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function triggerFailedWbRekapUploadDownload(args: {
  failures: WbRekapFailedRow[]
  filename?: string
}): void {
  const blob = buildFailedWbRekapUploadXlsx(args)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = args.filename ?? 'wb_rekap_failed_rows.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function buildWbRekapFailedRowsFilename(originalFilename: string): string {
  const base = originalFilename.replace(/\.(xlsx|xls)$/i, '').trim() || 'wb_rekap_upload'
  return `${base}-failed-rows.xlsx`
}
