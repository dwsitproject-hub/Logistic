import * as XLSX from 'xlsx'

export const CARGO_READINESS_TEMPLATE_HEADERS = ['po_number', 'cargo_readiness_date'] as const

export const CARGO_READINESS_UPLOAD_ACCEPT =
  '.csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

/** Excel template for bulk cargo readiness upload (DD/MM/YYYY or Excel date). */
export function buildCargoReadinessTemplateXlsxBlob(): Blob {
  const matrix: string[][] = [
    [...CARGO_READINESS_TEMPLATE_HEADERS],
    ['1001000001', '15/05/2026'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(matrix)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cargo Readiness')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function triggerCargoReadinessTemplateDownload(): void {
  const blob = buildCargoReadinessTemplateXlsxBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'cargo_readiness_template.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
