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
  daily_deliverables?: Array<{ date?: string; quantity_delivered?: number }>
}

const DOWNLOAD_TEMPLATE_DISABLED_TOOLTIP =
  'Download template is only available for Planned and In Progress status.'

export function isActualsTemplateDownloadEnabled(statusFilter: string): boolean {
  return statusFilter === 'PLANNED' || statusFilter === 'IN_PROGRESS'
}

export { DOWNLOAD_TEMPLATE_DISABLED_TOOLTIP }

function sliceIsoDate(value: unknown): string {
  if (value == null || String(value).trim() === '') return ''
  return String(value).trim().slice(0, 10)
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
  // Match list/calendar display: SAP ext no when present, else contract_id (stable for re-upload).
  return String(row.contract_ext_no || row.contract_number || '').trim()
}

function resolvePerDayMt(row: TruckingActualsTemplateRow): number | null {
  const start = sliceIsoDate(row.planning_start_date)
  const end = sliceIsoDate(row.planning_end_date)
  if (!start || !end) return null
  const daily = Array.isArray(row.daily_deliverables) ? row.daily_deliverables : []
  return derivePerDayMtFromDailyDeliverables(daily, start, end)
}

/** Build dynamic date columns (ISO) from earliest planning start to latest planning end. */
export function buildActualsTemplateDateColumns(rows: TruckingActualsTemplateRow[]): string[] {
  let minStart = ''
  let maxEnd = ''
  for (const row of rows) {
    const start = sliceIsoDate(row.planning_start_date)
    const end = sliceIsoDate(row.planning_end_date)
    if (!start || !end) continue
    if (!minStart || start < minStart) minStart = start
    if (!maxEnd || end > maxEnd) maxEnd = end
  }
  if (!minStart || !maxEnd) return []
  return enumerateInclusivePlanningDates(minStart, maxEnd)
}

export function buildTruckingActualsTemplateCsv(rows: TruckingActualsTemplateRow[]): string {
  const eligible = rows.filter((row) => {
    const ext = resolveContractExtNo(row)
    return ext && sliceIsoDate(row.planning_start_date) && sliceIsoDate(row.planning_end_date)
  })

  const dateColumns = buildActualsTemplateDateColumns(eligible)
  const headerCells = ['Contract Ext No', 'PO', ...dateColumns.map(formatDateColumnHeader)]
  const lines: string[] = [headerCells.map(escapeCsvCell).join(',')]

  for (const row of eligible) {
    const ext = resolveContractExtNo(row)
    const po = String(row.po_number ?? '').trim()
    const start = sliceIsoDate(row.planning_start_date)
    const end = sliceIsoDate(row.planning_end_date)
    const perDayMt = resolvePerDayMt(row)
    const rowDates = new Set(enumerateInclusivePlanningDates(start, end))

    const qtyCells = dateColumns.map((iso) => {
      if (!rowDates.has(iso) || perDayMt == null) return ''
      return String(perDayMt)
    })

    lines.push([ext, po, ...qtyCells].map(escapeCsvCell).join(','))
  }

  return `\ufeff${lines.join('\n')}\n`
}

/** Detect list-tab actuals template (Contract Ext No + PO + date columns). */
export function isActualsWideTemplateHeader(firstHeaderLine: string): boolean {
  const headers = firstHeaderLine
    .replace(/^\ufeff/, '')
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  if (headers.length < 3) return false
  const first = headers[0] ?? ''
  const second = headers[1] ?? ''
  const hasExt = first.includes('contract') && first.includes('ext')
  const hasPo = second === 'po' || second === 'po number'
  return hasExt && hasPo
}
