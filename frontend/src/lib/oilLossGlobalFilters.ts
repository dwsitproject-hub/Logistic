import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import {
  matchesOilLossModeFilter,
  matchesOilLossTruckSegment,
  matchesOilLossVesselSegment,
} from '@/lib/oilLossEligibility'

export type OilLossGlobalPeriodKey = 'YTD' | 'MTD' | `month-${number}`

export type OilLossGlobalTransportFilter = 'All' | 'Vessel' | 'Truck'

export type OilLossGlobalProductFilter = 'All' | 'CPO' | 'PK' | 'POME' | 'SHELL PALM'

export const OIL_LOSS_GLOBAL_TRANSPORT_OPTIONS: readonly OilLossGlobalTransportFilter[] = [
  'All',
  'Vessel',
  'Truck',
] as const

export const OIL_LOSS_GLOBAL_PRODUCT_MULTI_OPTIONS = ['CPO', 'PK', 'POME', 'SHELL PALM'] as const

export type OilLossGlobalProductMultiOption = (typeof OIL_LOSS_GLOBAL_PRODUCT_MULTI_OPTIONS)[number]

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export type OilLossPeriodOption = {
  value: OilLossGlobalPeriodKey
  label: string
}

/**
 * YTD + MTD + calendar months before the current month (descending),
 * same order as Contract / Shipping Performance.
 * Current month is covered by MTD — not listed separately.
 */
export function buildOilLossPeriodOptions(referenceDate = new Date()): OilLossPeriodOption[] {
  const currentMonthIndex = referenceDate.getMonth()
  const monthOptions: OilLossPeriodOption[] = []
  for (let m = currentMonthIndex - 1; m >= 0; m -= 1) {
    monthOptions.push({
      value: `month-${m}`,
      label: MONTH_NAMES[m],
    })
  }
  return [
    { value: 'YTD', label: 'YTD' },
    { value: 'MTD', label: 'MTD' },
    ...monthOptions,
  ]
}

export function resolveOilLossPeriodDateRange(
  period: OilLossGlobalPeriodKey,
  referenceDate = new Date(),
): { dateFrom: string; dateTo: string; label: string } {
  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  const day = referenceDate.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${year}-${pad(month + 1)}-${pad(day)}`

  if (period === 'MTD') {
    return {
      dateFrom: `${year}-${pad(month + 1)}-01`,
      dateTo: today,
      label: 'MTD',
    }
  }
  if (period === 'YTD') {
    return {
      dateFrom: `${year}-01-01`,
      dateTo: today,
      label: 'YTD',
    }
  }
  if (period.startsWith('month-')) {
    const monthIndex = Number(period.slice('month-'.length))
    const lastDay = new Date(year, monthIndex + 1, 0).getDate()
    const monthEnd = `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`
    const isCurrentMonth = monthIndex === month
    return {
      dateFrom: `${year}-${pad(monthIndex + 1)}-01`,
      dateTo: isCurrentMonth ? today : monthEnd,
      label: MONTH_NAMES[monthIndex] ?? `Month ${monthIndex + 1}`,
    }
  }
  return { dateFrom: `${year}-01-01`, dateTo: today, label: 'YTD' }
}

function resolveRowDate(row: OilLossSourceRow): string {
  return String(row.contract_date ?? row.operation_date ?? '').slice(0, 10)
}

/** Vessel / Truck toggle — incoterm × transport segment (SSOT with global eligibility). */
export function matchesOilLossGlobalTransportFilter(
  row: OilLossSourceRow,
  filter: OilLossGlobalTransportFilter,
): boolean {
  if (filter === 'All') return true
  if (filter === 'Vessel') return matchesOilLossVesselSegment(row)
  if (filter === 'Truck') return matchesOilLossTruckSegment(row)
  return true
}

export function matchesOilLossGlobalProductsMultiFilter(
  row: OilLossSourceRow,
  selectedProducts: readonly string[],
): boolean {
  if (selectedProducts.length === 0) return true
  const rowProduct = String(row.product ?? '').trim()
  return selectedProducts.some((product) => rowProduct === product)
}

/** @deprecated Single product tab — use matchesOilLossGlobalProductsMultiFilter */
export function matchesOilLossGlobalProductFilter(
  row: OilLossSourceRow,
  filter: OilLossGlobalProductFilter,
): boolean {
  if (filter === 'All') return true
  return String(row.product ?? '').trim() === filter
}

export type ApplyOilLossGlobalFiltersInput = {
  rows: OilLossSourceRow[]
  period: OilLossGlobalPeriodKey
  transport: OilLossGlobalTransportFilter
  selectedProducts?: string[]
  selectedGroupPlants?: string[]
  selectedModes?: string[]
  selectedIncoterms?: string[]
  /** When set, overrides dates resolved from `period`. */
  dateFrom?: string
  dateTo?: string
  referenceDate?: Date
}

/** SSOT pipeline for Oil Loss Section 1 + Section 3 (global bar + toolbar mode/incoterm). */
export function applyOilLossGlobalFilters({
  rows,
  period,
  transport,
  selectedProducts = [],
  selectedGroupPlants = [],
  selectedModes = [],
  selectedIncoterms = [],
  dateFrom: dateFromOverride,
  dateTo: dateToOverride,
  referenceDate = new Date(),
}: ApplyOilLossGlobalFiltersInput): OilLossSourceRow[] {
  const resolved = resolveOilLossPeriodDateRange(period, referenceDate)
  const dateFrom = dateFromOverride || resolved.dateFrom
  const dateTo = dateToOverride || resolved.dateTo

  return rows.filter((row) => {
    if (!matchesOilLossModeFilter(row.transport_mode, selectedModes)) return false
    const incoterm = String(row.incoterm || '').trim() || 'Blank'
    if (selectedIncoterms.length > 0 && !selectedIncoterms.includes(incoterm)) return false
    const groupPlant = String(row.group_plant || '').trim() || 'Blank'
    if (selectedGroupPlants.length > 0 && !selectedGroupPlants.includes(groupPlant)) return false
    if (!matchesOilLossGlobalTransportFilter(row, transport)) return false
    if (!matchesOilLossGlobalProductsMultiFilter(row, selectedProducts)) return false
    const d = resolveRowDate(row)
    if (!d) return false
    if (d < dateFrom || d > dateTo) return false
    return true
  })
}

/** Contract Performance — segmented toggle button classes. */
export function oilLossGlobalToggleButtonClass(active: boolean): string {
  return cnToggle(active)
}

function cnToggle(active: boolean): string {
  return active
    ? 'bg-slate-800 text-white'
    : 'text-slate-700 hover:bg-slate-100'
}

export const OIL_LOSS_GLOBAL_TOGGLE_BUTTON_BASE =
  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors'

export const OIL_LOSS_GLOBAL_TOGGLE_GROUP_CLASS =
  'inline-flex rounded-lg border bg-white p-1 flex-wrap gap-1'
