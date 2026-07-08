import * as XLSX from 'xlsx'
import { parseDdMmYyyyToIso } from './dateFormat'
import {
  formatPlanningTemplateDateHeader,
  parsePlanningTemplateDateText,
} from './planningTemplateDateFormat'
import {
  derivePerDayMtFromDailyDeliverables,
  enumerateInclusivePlanningDates,
} from './truckingPlanningDeliverables'

export type TruckingActualsTemplateRow = {
  contract_ext_no?: string
  contract_number?: string
  po_number?: string
  /** SAP vendor group (contracts.group_name). */
  group_name?: string
  supplier?: string
  /** SAP Source — Interco / 3rd Party (contracts.source_type). */
  source_type?: string
  contract_date?: string
  planning_start_date?: string
  planning_end_date?: string
  /** Legacy — no longer required for Unplanned template date columns. */
  delivery_end_date?: string
  /** Contract OS Qty actual from KLIP (kg) — shown as MT on Unplanned template. */
  outstanding_quantity?: number
  daily_deliverables?: Array<{ date?: string; quantity_delivered?: number }>
  /** Unplanned rows use date columns from today … today + 60 days. */
  templateKind?: 'default' | 'unplanned' | 'planned'
}

export const UNPLANNED_TEMPLATE_OS_QTY_HEADER = 'OS Qty (MT)'
export const UNPLANNED_TEMPLATE_PLAN_QTY_HEADER = 'Plan Qty (MT)'
/** @deprecated Use UNPLANNED_TEMPLATE_OS_QTY_HEADER */
export const UNPLANNED_TEMPLATE_OUTSTANDING_QTY_HEADER = UNPLANNED_TEMPLATE_OS_QTY_HEADER

export const UNPLANNED_PLANNING_FORWARD_DAYS = 60
/** @deprecated Unplanned window is now today … today + UNPLANNED_PLANNING_FORWARD_DAYS */
export const UNPLANNED_PLANNING_START_BUFFER_DAYS = 0
/** @deprecated Unplanned window is now today … today + UNPLANNED_PLANNING_FORWARD_DAYS */
export const UNPLANNED_PLANNING_END_BUFFER_DAYS = UNPLANNED_PLANNING_FORWARD_DAYS

export const UNPLANNED_TEMPLATE_METADATA_HEADERS = [
  'Group',
  'Supplier',
  'Source',
  'Contract Date',
  'Contract Ext No',
  'PO',
  UNPLANNED_TEMPLATE_OS_QTY_HEADER,
  UNPLANNED_TEMPLATE_PLAN_QTY_HEADER,
] as const

export const UNPLANNED_TEMPLATE_PLAN_QTY_COL_INDEX = UNPLANNED_TEMPLATE_METADATA_HEADERS.length - 1
export const UNPLANNED_TEMPLATE_FIRST_DATE_COL_INDEX = UNPLANNED_TEMPLATE_METADATA_HEADERS.length

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

export function isPlannedPlanningTemplateMode(statusFilter: string): boolean {
  return statusFilter === 'PLANNED' || statusFilter === 'IN_PROGRESS'
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

/** Unplanned planning window: today … today + 60 days (inclusive). */
export function resolveUnplannedPlanningWindow(
  _deliveryEndIso?: string,
  referenceToday?: string,
): { startIso: string; endIso: string } | null {
  const today = sliceIsoDate(referenceToday ?? todayIsoDate())
  if (!today) return null
  const startIso = today
  const endIso = shiftIsoDate(today, UNPLANNED_PLANNING_FORWARD_DAYS)
  if (startIso > endIso) return null
  return { startIso, endIso }
}

export function buildUnplannedTemplateDateColumns(referenceToday?: string): string[] {
  const window = resolveUnplannedPlanningWindow('', referenceToday)
  if (!window) return []
  return enumerateInclusivePlanningDates(window.startIso, window.endIso)
}

function formatDateColumnHeader(iso: string): string {
  return formatPlanningTemplateDateHeader(iso)
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

/** API / DB quantities are kg; wide planning template displays MT. */
export function formatTemplateQtyMtFromKg(kg: unknown, opts?: { maxFractionDigits?: number }): string {
  if (kg === null || kg === undefined || kg === '') return ''
  const n = typeof kg === 'string' ? Number(String(kg).replace(/,/g, '')) : Number(kg)
  if (!Number.isFinite(n)) return ''
  const mt = n / 1000
  const maxFractionDigits = opts?.maxFractionDigits ?? 2
  return mt.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
    useGrouping: false,
  })
}

/** @deprecated Use formatTemplateQtyMtFromKg */
export function formatTemplateOutstandingQtyKg(kg: unknown): string {
  return formatTemplateQtyMtFromKg(kg)
}

/** @deprecated Use formatTemplateQtyMtFromKg */
export function formatTemplateOutstandingQtyMt(kg: unknown): string {
  return formatTemplateQtyMtFromKg(kg)
}

/** Detect qty unit from wide planning template metadata headers. */
export function resolveWidePlanningTemplateQtyUnit(headerRow: unknown[]): 'kg' | 'mt' {
  for (const cell of headerRow) {
    const h = cellToString(cell).toLowerCase()
    if (h.includes('(mt)') || h.includes('os qty') || h.includes('oq qty')) return 'mt'
    if (h.includes('(kg)')) return 'kg'
    if (h.includes('outstanding') && h.includes('mt')) return 'mt'
  }
  return 'mt'
}

function parseTemplateQtyToKg(raw: string, unit: 'kg' | 'mt'): number | null {
  const s = raw.trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  const kg = unit === 'mt' ? n * 1000 : n
  return Math.round(kg * 100) / 100
}

function isUnplannedTemplateRow(row: TruckingActualsTemplateRow): boolean {
  return (
    row.templateKind === 'unplanned' ||
    (!sliceIsoDate(row.planning_start_date) &&
      !sliceIsoDate(row.planning_end_date) &&
      Boolean(sliceIsoDate(row.delivery_end_date)) &&
      row.templateKind !== 'planned')
  )
}

function isPlannedTemplateRow(row: TruckingActualsTemplateRow): boolean {
  return row.templateKind === 'planned'
}

function isWidePlanningTemplateRow(row: TruckingActualsTemplateRow): boolean {
  return isUnplannedTemplateRow(row) || isPlannedTemplateRow(row)
}

/** Download template sort: Source (3rd Party → Interco) → Supplier → PO. */
export function truckingTemplateSourceSortRank(sourceType: unknown): number {
  const upper = String(sourceType ?? '').trim().toUpperCase()
  if (upper.includes('3RD') && upper.includes('PARTY')) return 0
  if (upper.includes('INTERCO') || upper.includes('INHOUSE') || upper.includes('IN-HOUSE')) return 1
  return 2
}

export function compareTruckingActualsTemplateRows(
  a: TruckingActualsTemplateRow,
  b: TruckingActualsTemplateRow,
): number {
  const sourceCmp =
    truckingTemplateSourceSortRank(a.source_type) - truckingTemplateSourceSortRank(b.source_type)
  if (sourceCmp !== 0) return sourceCmp

  const supplierCmp = String(a.supplier ?? '').localeCompare(String(b.supplier ?? ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  })
  if (supplierCmp !== 0) return supplierCmp

  return String(a.po_number ?? '').localeCompare(String(b.po_number ?? ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  })
}

function isWideTemplateMetadataHeader(header: string): boolean {
  const h = header.trim().toLowerCase()
  if (parseDdMmYyyyToIso(header.trim())) return false
  if (parsePlanningTemplateDateText(header.trim())) return false
  if (
    h === 'group' ||
    h === 'supplier' ||
    h === 'source' ||
    h === 'contract date' ||
    h === 'contract ext no' ||
    h === 'po' ||
    h === 'po number' ||
    h === 'os qty' ||
    h === 'os qty (kg)' ||
    h === 'os qty' ||
    h === 'os qty (mt)' ||
    h === 'oq qty' ||
    h === 'oq qty (mt)' ||
    h === 'plan qty' ||
    h === 'plan qty (kg)' ||
    h === 'plan qty (mt)' ||
    h === 'reason' ||
    h === 'failure reason' ||
    h.includes('outstanding')
  ) {
    return true
  }
  return false
}

function computePlanQtyMtFromDeliverables(row: TruckingActualsTemplateRow): string {
  const daily = Array.isArray(row.daily_deliverables) ? row.daily_deliverables : []
  const kg = daily.reduce((sum, d) => sum + Number(d?.quantity_delivered ?? 0), 0)
  if (!Number.isFinite(kg) || kg <= 0) return ''
  return formatTemplateQtyMtFromKg(kg)
}

function resolveDailyQtyMtForDate(
  row: TruckingActualsTemplateRow,
  dateIso: string,
): string {
  const daily = Array.isArray(row.daily_deliverables) ? row.daily_deliverables : []
  const entry = daily.find((d) => sliceIsoDate(d?.date) === dateIso)
  const kg = Number(entry?.quantity_delivered ?? 0)
  if (!Number.isFinite(kg) || kg <= 0) return ''
  return formatTemplateQtyMtFromKg(kg)
}

function formatContractDateForTemplate(value: unknown): string {
  const iso = sliceIsoDate(value)
  if (!iso) return ''
  return formatPlanningTemplateDateHeader(iso, { includeYear: true })
}

function collectWideTemplateDateColumns(
  headerRow: unknown[],
): Array<{ colIndex: number; dateIso: string }> {
  const dateColumns: Array<{ colIndex: number; dateIso: string }> = []
  for (let ci = 0; ci < headerRow.length; ci += 1) {
    const headerText = cellToString(headerRow[ci])
    if (isWideTemplateMetadataHeader(headerText)) continue
    const iso = parseTemplateHeaderDateFromCell(headerRow[ci])
    if (iso) dateColumns.push({ colIndex: ci, dateIso: iso })
  }
  return dateColumns
}

function resolveWideTemplateRowKeys(
  headerRow: unknown[],
  cells: unknown[],
): { contractExtNo: string; poNumber: string } {
  const headers = headerRow.map((h) => cellToString(h).toLowerCase())
  const extIdx = headers.findIndex((h) => h.includes('contract') && h.includes('ext'))
  const poIdx = headers.findIndex((h) => h === 'po' || h === 'po number')
  if (extIdx >= 0 || poIdx >= 0) {
    return {
      contractExtNo: extIdx >= 0 ? cellToString(cells[extIdx]) : '',
      poNumber: poIdx >= 0 ? cellToString(cells[poIdx]) : '',
    }
  }
  return {
    contractExtNo: cellToString(cells[0]),
    poNumber: cellToString(cells[1]),
  }
}

function resolveRowPlanningWindow(
  row: TruckingActualsTemplateRow,
  referenceToday?: string,
): { start: string; end: string } | null {
  const isUnplanned =
    row.templateKind === 'unplanned' ||
    (row.templateKind !== 'planned' &&
      !sliceIsoDate(row.planning_start_date) &&
      !sliceIsoDate(row.planning_end_date) &&
      Boolean(sliceIsoDate(row.delivery_end_date)))

  if (isUnplanned || row.templateKind === 'planned') {
    const window = resolveUnplannedPlanningWindow('', referenceToday)
    if (!window) return null
    return { start: window.startIso, end: window.endIso }
  }

  const start = sliceIsoDate(row.planning_start_date)
  const end = sliceIsoDate(row.planning_end_date)
  if (!start || !end) return null
  return { start, end }
}

/** Build dynamic date columns (ISO) from earliest planning start to latest planning end. */
export function buildActualsTemplateDateColumns(
  rows: TruckingActualsTemplateRow[],
  referenceToday?: string,
): string[] {
  if (rows.some(isWidePlanningTemplateRow)) {
    return buildUnplannedTemplateDateColumns(referenceToday)
  }
  let minStart = ''
  let maxEnd = ''
  for (const row of rows) {
    const window = resolveRowPlanningWindow(row, referenceToday)
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
export function buildActualsTemplateMatrix(
  rows: TruckingActualsTemplateRow[],
  referenceToday?: string,
): string[][] {
  const eligible = rows.filter((row) => {
    const ext = resolveContractExtNo(row)
    if (!ext) return false
    const osKg = Number(row.outstanding_quantity ?? 0)
    if (isWidePlanningTemplateRow(row) && (!Number.isFinite(osKg) || osKg <= 0)) return false
    if (isWidePlanningTemplateRow(row)) return true
    return Boolean(resolveRowPlanningWindow(row, referenceToday))
  })

  const isWideTemplate = eligible.some(isWidePlanningTemplateRow)
  const sortedEligible = isWideTemplate
    ? [...eligible].sort(compareTruckingActualsTemplateRows)
    : eligible

  const dateColumns = buildActualsTemplateDateColumns(sortedEligible, referenceToday)
  const headerCells = isWideTemplate
    ? [...UNPLANNED_TEMPLATE_METADATA_HEADERS, ...dateColumns.map(formatDateColumnHeader)]
    : ['Contract Ext No', 'PO', ...dateColumns.map(formatDateColumnHeader)]
  const matrix: string[][] = [headerCells]

  for (const row of sortedEligible) {
    const ext = resolveContractExtNo(row)
    const po = String(row.po_number ?? '').trim()
    const window = resolveRowPlanningWindow(row, referenceToday)!
    const isLegacyPlanned = !isWidePlanningTemplateRow(row)
    const perDayMt = isLegacyPlanned ? resolvePerDayMt(row, window.start, window.end) : null
    const rowDates = new Set(enumerateInclusivePlanningDates(window.start, window.end))

    const qtyCells = dateColumns.map((iso) => {
      if (isWideTemplate) {
        if (!rowDates.has(iso)) return ''
        return resolveDailyQtyMtForDate(row, iso)
      }
      if (!rowDates.has(iso) || perDayMt == null) return ''
      return formatTemplateQtyMtFromKg(perDayMt * 1000)
    })

    if (isWideTemplate) {
      matrix.push([
        String(row.group_name ?? '').trim(),
        String(row.supplier ?? '').trim(),
        String(row.source_type ?? '').trim(),
        formatContractDateForTemplate(row.contract_date),
        ext,
        po,
        formatTemplateQtyMtFromKg(row.outstanding_quantity),
        computePlanQtyMtFromDeliverables(row),
        ...qtyCells,
      ])
    } else {
      matrix.push([ext, po, ...qtyCells])
    }
  }

  return matrix
}

export function buildTruckingActualsTemplateCsv(
  rows: TruckingActualsTemplateRow[],
  referenceToday?: string,
): string {
  const matrix = buildActualsTemplateMatrix(rows, referenceToday)
  const lines = matrix.map((line) => line.map(escapeCsvCell).join(','))
  return `\ufeff${lines.join('\n')}\n`
}

function parseTemplateQtyMtCell(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

function resolveWideTemplateLastDateColIdx(header: string[]): number {
  let lastDateColIdx = header.length - 1
  const trailingHeader = header[lastDateColIdx]?.trim().toLowerCase() ?? ''
  if (trailingHeader === 'reason' || trailingHeader === 'failure reason') {
    lastDateColIdx -= 1
  }
  return lastDateColIdx
}

/** XLSX SUM ignores text cells — coerce qty columns to numeric after aoa_to_sheet. */
function applyWideTemplateNumericQtyCells(ws: XLSX.WorkSheet, matrix: string[][]): void {
  if (matrix.length < 2) return
  const header = matrix[0] ?? []
  const isWideMetadata =
    header.length >= UNPLANNED_TEMPLATE_METADATA_HEADERS.length &&
    header[0]?.trim().toLowerCase() === 'group'
  if (!isWideMetadata) return

  const lastDateColIdx = resolveWideTemplateLastDateColIdx(header)
  if (lastDateColIdx < UNPLANNED_TEMPLATE_FIRST_DATE_COL_INDEX) return

  const osQtyColIdx = UNPLANNED_TEMPLATE_PLAN_QTY_COL_INDEX - 1
  for (let r = 1; r < matrix.length; r += 1) {
    const row = matrix[r] ?? []

    const osQty = parseTemplateQtyMtCell(row[osQtyColIdx])
    if (osQty != null) {
      ws[XLSX.utils.encode_cell({ r, c: osQtyColIdx })] = { t: 'n', v: osQty }
    }

    for (let c = UNPLANNED_TEMPLATE_FIRST_DATE_COL_INDEX; c <= lastDateColIdx; c += 1) {
      const qtyMt = parseTemplateQtyMtCell(row[c])
      if (qtyMt != null) {
        ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v: qtyMt }
      }
    }
  }
}

function applyUnplannedPlanQtyFormulas(ws: XLSX.WorkSheet, matrix: string[][]): void {
  if (matrix.length < 2) return
  const header = matrix[0] ?? []
  const lastDateColIdx = resolveWideTemplateLastDateColIdx(header)
  if (lastDateColIdx < UNPLANNED_TEMPLATE_FIRST_DATE_COL_INDEX) return
  const firstDateCol = XLSX.utils.encode_col(UNPLANNED_TEMPLATE_FIRST_DATE_COL_INDEX)
  const lastDateCol = XLSX.utils.encode_col(lastDateColIdx)
  for (let r = 1; r < matrix.length; r += 1) {
    const excelRow = r + 1
    const cellRef = XLSX.utils.encode_cell({ r, c: UNPLANNED_TEMPLATE_PLAN_QTY_COL_INDEX })
    const row = matrix[r] ?? []
    let cachedSum = 0
    for (let c = UNPLANNED_TEMPLATE_FIRST_DATE_COL_INDEX; c <= lastDateColIdx; c += 1) {
      const qtyMt = parseTemplateQtyMtCell(row[c])
      if (qtyMt != null) cachedSum += qtyMt
    }
    ws[cellRef] = {
      f: `SUM(${firstDateCol}${excelRow}:${lastDateCol}${excelRow})`,
      t: 'n',
      v: cachedSum,
    }
  }
}

export function buildTruckingActualsTemplateXlsxBlob(
  rows: TruckingActualsTemplateRow[],
  referenceToday?: string,
): Blob {
  const matrix = buildActualsTemplateMatrix(rows, referenceToday)
  const ws = XLSX.utils.aoa_to_sheet(matrix)
  if (rows.some(isWidePlanningTemplateRow)) {
    applyWideTemplateNumericQtyCells(ws, matrix)
    applyUnplannedPlanQtyFormulas(ws, matrix)
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planning')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export const UNPLANNED_UPLOAD_FAILURE_REASON_HEADER = 'Reason'

function stripTrailingReasonColumn(headerRow: string[]): string[] {
  const headers = [...headerRow]
  while (headers.length > 0) {
    const last = headers[headers.length - 1]?.trim().toLowerCase() ?? ''
    if (last === 'reason' || last === 'failure reason') {
      headers.pop()
      continue
    }
    break
  }
  return headers
}

/** XLSX of failed Unplanned upload rows — same columns as upload + Reason at the end. */
export function buildFailedUnplannedUploadRetemplateXlsx(args: {
  uploadHeaderRow: string[]
  failedRows: Array<{ cells: string[]; reason: string }>
}): Blob {
  const baseHeader = stripTrailingReasonColumn(args.uploadHeaderRow)
  const header = [...baseHeader, UNPLANNED_UPLOAD_FAILURE_REASON_HEADER]
  const matrix: string[][] = [header]

  for (const row of args.failedRows) {
    const dataCells = row.cells.slice(0, baseHeader.length)
    while (dataCells.length < baseHeader.length) dataCells.push('')
    matrix.push([...dataCells, row.reason])
  }

  const ws = XLSX.utils.aoa_to_sheet(matrix)
  const isUnplannedMetadata =
    baseHeader.length >= UNPLANNED_TEMPLATE_METADATA_HEADERS.length &&
    baseHeader[0]?.trim().toLowerCase() === 'group'
  if (isUnplannedMetadata) {
    applyWideTemplateNumericQtyCells(ws, matrix)
    applyUnplannedPlanQtyFormulas(ws, matrix)
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Planning')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function triggerFailedUnplannedUploadRetemplateDownload(args: {
  uploadHeaderRow: string[]
  failedRows: Array<{ cells: string[]; reason: string }>
  filename?: string
}): void {
  const blob = buildFailedUnplannedUploadRetemplateXlsx(args)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = args.filename ?? 'trucking_unplanned_planning_failed_rows.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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

function parseTemplateHeaderDateToIso(header: string, referenceIso?: string): string | null {
  const trimmed = header.trim().replace(/^"|"$/g, '')
  const planning = parsePlanningTemplateDateText(trimmed, referenceIso)
  if (planning) return planning
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
  const dmy = parseTemplateHeaderDateToIso(asText, todayIsoDate())
  if (dmy) return dmy
  if (/^\d+(\.\d+)?$/.test(asText)) {
    return excelSerialToIso10(Number(asText))
  }
  return null
}

function parseTemplateQtyKg(raw: string, unit: 'kg' | 'mt'): number | null {
  return parseTemplateQtyToKg(raw, unit)
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
  const qtyUnit = resolveWidePlanningTemplateQtyUnit(headerRow)
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
    const { contractExtNo, poNumber } = resolveWideTemplateRowKeys(headerRow, cells)
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
      const qtyKg = parseTemplateQtyKg(cellToString(cells[colIndex]), qtyUnit)
      if (qtyKg == null || qtyKg === 0) continue
      entries.push({ dateIso, qtyMt: qtyKg, colIndex })
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

export function isWidePlanningTemplateMatrix(matrix: unknown[][]): boolean {
  const headerRow = matrix[0]
  if (!headerRow || headerRow.length < 3) return false
  const headers = headerRow.map((cell) => cellToString(cell).toLowerCase())
  const hasGroup = headers.includes('group')
  const hasExt = headers.some((h) => h.includes('contract') && h.includes('ext'))
  const hasPo = headers.some((h) => h === 'po' || h === 'po number')
  const dateColumns = collectWideTemplateDateColumns(headerRow)
  if (hasGroup) {
    return hasExt && hasPo && dateColumns.length > 0
  }
  const first = cellToString(headerRow[0]).toLowerCase()
  const second = cellToString(headerRow[1]).toLowerCase()
  return first.includes('contract') && first.includes('ext') && (second === 'po' || second === 'po number')
}

export async function isWidePlanningTemplateFile(file: File): Promise<boolean> {
  if (!isExcelPlanningTemplateFilename(file.name)) return false
  const matrix = await readPlanningTemplateMatrix(file)
  return isWidePlanningTemplateMatrix(matrix)
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
    const kg = Math.round(entry.qtyMt * 100) / 100
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
