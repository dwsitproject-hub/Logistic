/** Saving and exporting in the browser. */

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  // A leading = + - @ would run as a formula when the file is opened in Excel.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function saveCsv(fileName: string, header: string[], rows: unknown[][]): void {
  // BOM so Excel reads UTF-8 names correctly.
  saveBlob(new Blob(['﻿', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }), fileName)
}
