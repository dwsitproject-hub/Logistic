import * as XLSX from 'xlsx'

/**
 * Write an AOA matrix to an .xlsx file and trigger a browser download.
 */
export function downloadAoaXlsx(
  matrix: (string | number)[][],
  opts: { sheetName: string; fileName: string },
): void {
  const ws = XLSX.utils.aoa_to_sheet(matrix)
  const wb = XLSX.utils.book_new()
  const sheetName = (opts.sheetName || 'Sheet1').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
