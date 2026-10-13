import { canonicalProductName, sameProduct } from '@/lib/productAlias'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import {
  isOilLossPageIncoterm,
  matchesOilLossModeFilter,
} from '@/lib/oilLossEligibility'
import { matchesOilLossLoadingPortFilter } from '@/lib/oilLossLoadingPort'
import { valueInRegionSiteList } from '@/lib/globalScopeFilters'

export type OilLossGlobalPeriodKey = 'YTD' | 'MTD' | `month-${number}`

export type OilLossGlobalProductFilter = 'All' | 'CPO' | 'PK' | 'POME' | 'SHELL PALM'

export const OIL_LOSS_GLOBAL_PRODUCT_MULTI_OPTIONS = ['CPO', 'PK', 'POME', 'SHELL PALM'] as const

export type OilLossGlobalProductMultiOption = (typeof OIL_LOSS_GLOBAL_PRODUCT_MULTI_OPTIONS)[number]

/**
 * The Product dropdown of Oil Loss: every product the rows have, plus whatever is picked.
 *
 * It was OIL_LOSS_GLOBAL_PRODUCT_MULTI_OPTIONS verbatim, so a product outside those four (UCO, RPO, RBDPS, ...) could never be offered however
 * many contracts it had. The rows are the source of truth, as on Contract and Shipping Performance. POME and WASTE OIL (POME) are one option
 * (lib/productAlias.ts). A picked value goes in first so it keeps its own spelling and stays checked; the rest keep the spelling the rows have.
 * With no rows and nothing picked (still loading) the fallback list is shown rather than an empty menu.
 */
export function oilLossProductOptions(
  rows: readonly { product?: unknown }[],
  selected: readonly string[],
  fallback: readonly string[] = OIL_LOSS_GLOBAL_PRODUCT_MULTI_OPTIONS,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: unknown) => {
    const text = canonicalProductName(value)
    const key = text.toUpperCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    out.push(text)
  }
  selected.forEach(add)
  rows.forEach((row) => add(row.product))
  if (out.length === 0) return [...fallback]
  return out.sort((a, b) => a.localeCompare(b))
}

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

/** Oil Loss counts FOB transactions only (page rule, lib/oilLossEligibility.ts). */
export function matchesOilLossGlobalIncotermFilter(row: OilLossSourceRow): boolean {
  return isOilLossPageIncoterm(row.incoterm)
}

export function matchesOilLossGlobalProductsMultiFilter(
  row: OilLossSourceRow,
  selectedProducts: readonly string[],
): boolean {
  if (selectedProducts.length === 0) return true
  // sameProduct, not ===: the POME option has to match WASTE OIL (POME) rows too (lib/productAlias.ts)
  return selectedProducts.some((product) => sameProduct(row.product, product))
}

/** @deprecated Single product tab — use matchesOilLossGlobalProductsMultiFilter */
export function matchesOilLossGlobalProductFilter(
  row: OilLossSourceRow,
  filter: OilLossGlobalProductFilter,
): boolean {
  if (filter === 'All') return true
  return sameProduct(row.product, filter)
}

export type ApplyOilLossGlobalFiltersInput = {
  rows: OilLossSourceRow[]
  period: OilLossGlobalPeriodKey
  selectedProducts?: string[]
  selectedLoadingPorts?: string[]
  selectedGroupPlants?: string[]
  selectedModes?: string[]
  selectedIncoterms?: string[]
  /** When set, overrides dates resolved from `period`. */
  dateFrom?: string
  dateTo?: string
  referenceDate?: Date
}

/** SSOT pipeline for Oil Loss Section 1 (R1-Loss), the drilldown and the table: FOB only, then period, region/plant, product and loading port. */
export function applyOilLossGlobalFilters({
  rows,
  period,
  selectedProducts = [],
  selectedLoadingPorts = [],
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
    if (selectedGroupPlants.length > 0 && !valueInRegionSiteList(row.group_plant || row.plant_site, selectedGroupPlants)) {
      return false
    }
    if (!matchesOilLossGlobalIncotermFilter(row)) return false
    if (!matchesOilLossLoadingPortFilter(row, selectedLoadingPorts)) return false
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
