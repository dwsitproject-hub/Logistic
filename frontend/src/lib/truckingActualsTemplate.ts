import * as XLSX from 'xlsx'
import { parseDdMmYyyyToIso } from './dateFormat'
import {
  derivePerDayMtFromDailyDeliverables,
  enumerateInclusivePlanningDates,
} from './truckingPlanningDeliverables'

export type TruckingActualsTemplateRow = {
  contract_ext_no?: string
  contract_number?: string
  po_number?: string
  planning_start_date?: string
  planning_end_date?: string
  /** SAP Due Date Delivery (End) — used for Unplanned template window. */
  delivery_end_date?: string
  /** Contract outstanding qty from API (kg) — shown as MT on Unplanned template. */
  outstanding_quantity?: number
  daily_deliverables?: Array<{ date?: string; quantity_delivered?: number }>
  /** Unplanned rows derive date columns from today −15 … due end +30. */
  templateKind?: 'default' | 'unplanned'
}

export const UNPLANNED_TEMPLATE_OUTSTANDING_QTY_HEADER = 'Outstanding Qty (MT)'

export const UNPLANNED_PLANNING_START_BUFFER_DAYS = 15
export const UNPLANNED_PLANNING_END_BUFFER_DAYS = 30

const DOWNLOAD_TEMPLATE_DISABLED_TOOLTIP =
  'Download template is available when the status filter is Unplanned, Planned, or In Progress.'

export function isActualsTemplateDownloadEnabled(statusFilter: string): boolean {
  return (
    statusFilter === 'UNPLANNED' ||
    statusFilter === 'PLANNED' ||
    statusFilter === 'IN_PROGRESS'
  )
}

export function isUnplannedPlanningTemplateMode(statusFilter: string): boolean {
  return statusFilter === 'UNPLANNED'
}

export { DOWNLOAD_TEMPLATE_DISABLED_TOOLTIP }

function sliceIsoDate(value: unknown): string {
  if (value == null || String(value).trim() === '') return ''
  return String(value).trim().slice(0, 10)
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!parts) return isoDate
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function todayIsoDate(reference = new Date()): string {
  const yyyy = reference.getFullYear()
  const mm = String(reference.getMonth() + 1).padStart(2, '0')
  const dd = String(reference.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Unplanned planning window: today −15 days … SAP due delivery end +30 days. */
export function resolveUnplannedPlanningWindow(
  deliveryEndIso: string,
  referenceToday?: string,
): { startIso: string; endIso: string } | null {
  const endBase = sliceIsoDate(deliveryEndIso)
  if (!endBase) return null
  const today = sliceIsoDate(referenceToday ?? todayIsoDate())
  if (!today) return null
  const startIso = shiftIsoDate(today, -UNPLANNED_PLANNING_START_BUFFER_DAYS)
  const endIso = shiftIsoDate(endBase, UNPLANNED_PLANNING_END_BUFFER_DAYS)
  if (startIso > endIso) return null
  return { startIso, endIso }
}

function formatDateColumnHeader(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function resolveContractExtNo(row: TruckingActualsTemplateRow): string {
  const ext = String(row.contract_ext_no ?? '').trim()
  if (ext) return ext
  // Internal SAP contract id (e.g. 1004030707) is not a valid upload key — avoid PO/contract_id confusion.
  return ''
}

function resolvePerDayMt(row: TruckingActualsTemplateRow, start: string, end: string): number | null {
  if (!start || !end) return null
  const daily = Array.isArray(row.daily_deliverables) ? row.daily_deliverables : []
  return derivePerDayMtFromDailyDeliverables(daily, start, end)
}

/** API outstanding qty is kg; template displays MT (same as trucking list column). */
export function formatTemplateOutstandingQtyMt(kg: unknown): string {
  if (kg === null || kg === undefined || kg === '') return ''
  const n = typeof kg === 'string' ? Number(String(kg).replace(/,/g, '')) : Number(kg)
  if (!Number.isFinite(n)) return ''
  const mt = n / 1000
  return String(Math.round(mt * 100) / 100)
}

function isUnplannedTemplateRow(row: TruckingActualsTemplateRow): boolean {
  return (
    row.templateKind === 'unplanned' ||
    (!sliceIsoDate(row.planning_start_date) &&
      !sliceIsoDate(row.planning_end_date) &&
      Boolean(sliceIsoDate(row.delivery_end_date)))
  )
}

function isWideTemplateMetadataHeader(header: string): boolean {
  const h = header.trim().toLowerCase()
  return h.includes('outstanding')
}

function collectWideTemplateDateColumns(
  headerRow: unknown[],
): Array<{ colIndex: number; dateIso: string }> {
  const dateColumns: Array<{ colIndex: number; dateIso: string }> = []
  for (let ci = 2; ci < headerRow.length; ci += 1) {
    const headerText = cellToString(headerRow[ci])
    if (isWideTemplateMetadataHeader(headerText)) continue
    const iso = parseTemplateHeaderDateFromCell(headerRow[ci])
    if (iso) dateColumns.push({ colIndex: ci, dateIso: iso })
  }
  return dateColumns
}

function resolveRowPlanningWindow(row: TruckingActualsTemplateRow): { start: string; end: string } | null {
  const isUnplanned =
    row.templateKind === 'unplanned' ||
    (!sliceIsoDate(row.planning_start_date) &&
      !sliceIsoDate(row.planning_end_date) &&
      Boolean(sliceIsoDate(row.delivery_end_date)))

  if (isUnplanned) {
    const window = resolveUnplannedPlanningWindow(String(row.delivery_end_date ?? ''))
    if (!window) return null
    return { start: window.startIso, end: window.endIso }
  }

  const start = sliceIsoDate(row.planning_start_date)
  const end = sliceIsoDate(row.planning_end_date)
  if (!start || !end) return null
  return { start, end }
}

/** Build dynamic date columns (ISO) from earliest planning start to latest planning end. */
export function buildActualsTemplateDateColumns(rows: TruckingActualsTemplateRow[]): string[] {
  let minStart = ''
  let maxEnd = ''
  for (const row of rows) {
    const window = resolveRowPlanningWindow(row)
    if (!window) continue
    if (!minStart || window.start < minStart) minStart = window.start
    if (!maxEnd || window.end > maxEnd) maxEnd = window.end
  }
  if (!minStart || !maxEnd) return []
  return enumerateInclusivePlanningDates(minStart, maxEnd)
}

function cellToString(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear()
    const mm = String(value.getMonth() + 1).padStart(2, '0')
    const dd = String(value.getDate()).padStart(2, '0')
    return `${dd}/${mm}/${yyyy}`
  }
  return String(value).trim()
}

function isPlausibleExcelDateSerial(n: number): boolean {
  return Number.isFinite(n) && n > 20000 && n < 70000
}

function excelSerialToIso10(serial: number): string | null {
  if (!isPlausibleExcelDateSerial(serial)) return null
  const p = XLSX.SSF.parse_date_code(serial)
  if (!p || p.y == null || p.m == null || p.d == null) return null
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** Build header + data rows for wide planning template (CSV / XLSX). */
export function buildActualsTemplateMatrix(rows: TruckingActualsTemplateRow[]): string[][] {
  const eligible = rows.filter((row) => {
    const ext = resolveContractExtNo(row)
    return ext && resolveRowPlanningWindow(row)
  })

  const dateColumns = buildActualsTemplateDateColumns(eligible)
  const isUnplannedTemplate = eligible.some(isUnplannedTemplateRow)
  const headerCells = isUnplannedTemplate
    ? ['Contract Ext No', 'PO', UNPLANNED_TEMPLATE_OUTSTANDING_QTY_HEADER, ...dateColumns.map(formatDateColumnHeader)]
    : ['Contract Ext No', 'PO', ...dateColumns.map(formatDateColumnHeader)]
  const matrix: string[][] = [headerCells]

  for (const row of eligible) {
    const ext = resolveContractExtNo(row)
    const po = String(row.po_number ?? '').trim()
    const window = resolveRowPlanningWindow(row)!
    const isUnplanned = isUnplannedTemplateRow(row)
    const perDayMt = isUnplanned ? null : resolvePerDayMt(row, window.start, window.end)
    const rowDates = new Set(enumerateInclusivePlanningDates(window.start, window.end))

    const qtyCells = dateColumns.map((iso) => {
      if (!rowDates.has(iso) || perDayMt == null) return ''
      return String(perDayMt)
    })

    if (isUnplannedTemplate) {
      matrix.push([ext, po, formatTemplateOutstandingQtyMt(row.outstanding_quantity), ...qtyCells])
    } else {
      matrix.push([ext, po, ...qtyCells])
    }
  }

  return matrix
}

export function buildTruckingActualsTemplateCsv(rows: TruckingActualsTemplateRow[]): string {
  const matrix = buildActualsTemplateMatrix(rows)
  const lines = matrix.map((line) => line.map(escapeCsvCell).join(','))
  return `\ufeff${lines.join('\n')}\n`
}

export function buildTruckingActualsTemplateXlsxBlob(rows: TruckingActualsTemplateRow[]): Blob {
  const matrix = buildActualsTemplateMatrix(rows)
  const ws = XLSX.utils.aoa_to_sheet(matrix)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planning')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function normalizeTemplateHeaderLabels(headers: string[]): boolean {
  if (headers.length < 3) return false
  const first = headers[0] ?? ''
  const second = headers[1] ?? ''
  const hasExt = first.includes('contract') && first.includes('ext')
  const hasPo = second === 'po' || second === 'po number'
  return hasExt && hasPo
}

/** Detect list-tab actuals template (Contract Ext No + PO + date columns). */
export function isActualsWideTemplateHeaderCells(headers: string[]): boolean {
  const normalized = headers.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/^"|"$/g, ''),
  )
  return normalizeTemplateHeaderLabels(normalized)
}

/** Detect list-tab actuals template (Contract Ext No + PO + date columns). */
export function isActualsWideTemplateHeader(firstHeaderLine: string): boolean {
  const headers = firstHeaderLine
    .replace(/^\ufeff/, '')
    .split(',')
    .map((h) => h.trim().replace(/^"|"$/g, ''))
  return isActualsWideTemplateHeaderCells(headers)
}

export function isActualsWideTemplateMatrix(matrix: unknown[][]): boolean {
  const headerRow = matrix[0]
  if (!headerRow || headerRow.length < 3) return false
  return isActualsWideTemplateHeaderCells(headerRow.map((cell) => cellToString(cell)))
}

export function isExcelPlanningTemplateFilename(filename: string): boolean {
  return /\.(xlsx|xls)$/i.test(filename.trim())
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  return cells
}

function parseTemplateHeaderDateToIso(header: string): string | null {
  const trimmed = header.trim().replace(/^"|"$/g, '')
  return parseDdMmYyyyToIso(trimmed)
}

function parseTemplateHeaderDateFromCell(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return excelSerialToIso10(raw)
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const yyyy = raw.getFullYear()
    const mm = String(raw.getMonth() + 1).padStart(2, '0')
    const dd = String(raw.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const asText = cellToString(raw)
  const dmy = parseTemplateHeaderDateToIso(asText)
  if (dmy) return dmy
  if (/^\d+(\.\d+)?$/.test(asText)) {
    return excelSerialToIso10(Number(asText))
  }
  return null
}

function parseTemplateQtyMt(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export type ParsedWidePlanningTemplateRow = {
  rowNumber: number
  contract_ext_no: string
  po_number: string
  entries: Array<{ dateIso: string; qtyMt: number; colIndex: number }>
}

export function parseTruckingWidePlanningTemplateMatrix(matrix: unknown[][]): {
  rows: ParsedWidePlanningTemplateRow[]
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>
} {
  const rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }> = []
  const rows: ParsedWidePlanningTemplateRow[] = []

  if (matrix.length < 2) {
    return { rows, rowParseFailures }
  }

  const headerRow = matrix[0] ?? []
  const dateColumns = collectWideTemplateDateColumns(headerRow)

  if (dateColumns.length === 0) {
    rowParseFailures.push({
      rowNumber: 1,
      contract_ext_no: '-',
      reason: 'No date columns found in header row',
    })
    return { rows, rowParseFailures }
  }

  for (let rIdx = 1; rIdx < matrix.length; rIdx += 1) {
    const cells = matrix[rIdx] ?? []
    const contractExtNo = cellToString(cells[0])
    const poNumber = cellToString(cells[1])
    const rowNumber = rIdx + 1
    const hasAnyQty = dateColumns.some(({ colIndex }) => cellToString(cells[colIndex]) !== '')

    if (!contractExtNo && !poNumber && !hasAnyQty) continue
    if (!contractExtNo && !poNumber) {
      rowParseFailures.push({
        rowNumber,
        contract_ext_no: '-',
        reason: 'Contract Ext No or PO is required',
      })
      continue
    }

    const entries: ParsedWidePlanningTemplateRow['entries'] = []
    for (const { colIndex, dateIso } of dateColumns) {
      const qtyMt = parseTemplateQtyMt(cellToString(cells[colIndex]))
      if (qtyMt == null || qtyMt === 0) continue
      entries.push({ dateIso, qtyMt, colIndex })
    }

    if (entries.length === 0) continue

    rows.push({ rowNumber, contract_ext_no: contractExtNo, po_number: poNumber, entries })
  }

  return { rows, rowParseFailures }
}

export function parseTruckingWidePlanningTemplateCsv(text: string): {
  rows: ParsedWidePlanningTemplateRow[]
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>
} {
  const normalized = text.replace(/^\ufeff/, '')
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim())
  const matrix = lines.map((line) => parseCsvLine(line))
  return parseTruckingWidePlanningTemplateMatrix(matrix)
}

export async function readPlanningTemplateMatrix(file: File): Promise<unknown[][]> {
  if (isExcelPlanningTemplateFilename(file.name)) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) return []
    const ws = wb.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][]
    return matrix.filter((row) => row.some((cell) => cellToString(cell) !== ''))
  }

  const text = await file.text()
  const normalized = text.replace(/^\ufeff/, '')
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim())
  return lines.map((line) => parseCsvLine(line))
}

export async function isActualsWidePlanningTemplateFile(file: File): Promise<boolean> {
  if (isExcelPlanningTemplateFilename(file.name)) {
    const matrix = await readPlanningTemplateMatrix(file)
    return isActualsWideTemplateMatrix(matrix)
  }
  const text = await file.text()
  const firstLine = text.replace(/^\ufeff/, '').split(/\r?\n/).find((line) => line.trim()) ?? ''
  return isActualsWideTemplateHeader(firstLine)
}

export async function parseTruckingWidePlanningTemplateFile(file: File): Promise<{
  rows: ParsedWidePlanningTemplateRow[]
  rowParseFailures: Array<{ rowNumber: number; contract_ext_no: string; reason: string }>
}> {
  const matrix = await readPlanningTemplateMatrix(file)
  return parseTruckingWidePlanningTemplateMatrix(matrix)
}

export function buildDailyDeliverablesFromWidePlanningEntries(
  entries: Array<{ dateIso: string; qtyMt: number }>,
): Array<{ date: string; quantity_delivered: number }> {
  const byDate = new Map<string, number>()
  for (const entry of entries) {
    const kg = Math.round(entry.qtyMt * 1000 * 100) / 100
    byDate.set(entry.dateIso, kg)
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, quantity_delivered]) => ({ date, quantity_delivered }))
}

export function resolvePlanningStartEndFromDeliverables(
  daily: Array<{ date: string; quantity_delivered: number }>,
): { startIso: string; endIso: string } | null {
  if (daily.length === 0) return null
  const dates = daily.map((d) => d.date).sort()
  return { startIso: dates[0], endIso: dates[dates.length - 1] }
}

export function isDateWithinUnplannedPlanningWindow(
  dateIso: string,
  deliveryEndIso: string,
  referenceToday?: string,
): boolean {
  const window = resolveUnplannedPlanningWindow(deliveryEndIso, referenceToday)
  if (!window) return false
  return dateIso >= window.startIso && dateIso <= window.endIso
}
