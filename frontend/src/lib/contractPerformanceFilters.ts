/**
 * Single source of truth for Contract Performance filtering (Sections 1–3).
 * All sections MUST derive scope and row sets from this module — no localized filter() copies.
 */

import { valueInRegionSiteList } from '@/lib/globalScopeFilters'

export type ContractPerfProductTab = 'All' | 'CPO' | 'PK' | 'POME' | 'Shell Palm'

export const CONTRACT_PERF_PRODUCT_TABS: ContractPerfProductTab[] = ['All', 'CPO', 'PK', 'POME', 'Shell Palm']

/** API / DB product values for each tab (Shell Palm is stored as `SHELL PALM`). */
export const CONTRACT_PERF_PRODUCT_TAB_API_VALUE: Record<
  Exclude<ContractPerfProductTab, 'All'>,
  string
> = {
  CPO: 'CPO',
  PK: 'PK',
  POME: 'POME',
  'Shell Palm': 'SHELL PALM',
}

/** Top-level Contract Performance source filter (maps to `contracts.source_type`). */
export type ContractPerfSourceFilter = 'All' | 'Interco' | '3rd Party'

export const CONTRACT_PERF_SOURCE_TABS: ContractPerfSourceFilter[] = ['All', 'Interco', '3rd Party']

/** Multi-select Source options (Section 1 — empty selection = all). */
export const CONTRACT_PERF_SOURCE_MULTI_OPTIONS = ['Interco', '3rd Party'] as const

/** Multi-select Product options (Section 1 — empty selection = all). */
export const CONTRACT_PERF_PRODUCT_MULTI_OPTIONS = [
  'CPO',
  'PK',
  'POME',
  'Shell Palm',
] as const

/** Map auth/role product assignments onto Contract/Shipping Performance multi-select labels. */
export function mapUserProductsToContractPerfOptions(products: string[]): string[] {
  const matched: string[] = []
  for (const product of products) {
    const match = CONTRACT_PERF_PRODUCT_MULTI_OPTIONS.find(
      (option) =>
        normalizePerfProductGroupKey(option) === normalizePerfProductGroupKey(product),
    )
    if (match && !matched.includes(match)) matched.push(match)
  }
  return matched
}

export type ContractPerfDrilldownFilters = {
  product: string | null
  plant: string | null
  incoterm: string | null
  supplier: string | null
}

export const EMPTY_CONTRACT_PERF_DRILLDOWN: ContractPerfDrilldownFilters = {
  product: null,
  plant: null,
  incoterm: null,
  supplier: null,
}

export type ContractPerfHotspot = {
  contract_id?: string
  incoterm: string
  product: string
  plant_site: string
  group_name: string
  supplier: string
  count: number
  totalDays: number
  maxDays: number
  totalQtyDelivery: number
}

export type LatePerfApiTreeNode = {
  key: string
  count: number
  totalDays: number
  maxDays: number
  totalQtyDelivery?: number
  children?: LatePerfApiTreeNode[]
}

export type ContractPerfColumnFilter =
  | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }
  | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
  | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
  | { type: 'multi'; values: string[]; includeBlank?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }

export type ContractPerformanceGlobalFilters = {
  dateFrom: string
  dateTo: string
  selectedSources: string[]
  selectedProducts: string[]
  selectedIncoterms: string[]
  selectedSuppliers: string[]
  selectedGroupPlants: string[]
  summaryCardStatus: 'All' | 'Open' | 'Close'
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME'
  perfDashMode: 'late' | 'ontrack'
  perfTransportMode: 'ALL' | 'SEA' | 'LAND'
  b2bFlagFilter: string
  search: string
}

/** Resolved scope — the only filter payload Sections 1–3 should use. */
export type ContractPerformanceScope = {
  global: ContractPerformanceGlobalFilters
  drilldown: ContractPerfDrilldownFilters
  resolvedProduct: string | undefined
  resolvedProducts: string[]
  resolvedPlants: string[]
  resolvedIncoterms: string[]
  resolvedSupplier: string | null
  contractStatus: 'All' | 'Open' | 'Close'
}

export type ContractPerformanceTableFetchScope = {
  columnFilters: Record<string, unknown>
  plants: string[]
  product: string | undefined
}

export type PerformanceTableContract = {
  contract_id: string
  source_type?: string | null
  product?: string | null
  incoterm?: string | null
  supplier?: string | null
  plant_site?: string | null
  delivery_end_date?: string | null
  trade_cycle_days?: number | null
  /** Set by GET /contracts — mirrors Section 2 on-time vs late classification. */
  contract_perf_on_time?: boolean | null
  /** Set by GET /contracts when excludeUnscheduled — matches tree inclusion rules. */
  contract_perf_in_tree?: boolean | null
  import_status?: string | null
  status?: string | null
}

export function contractPerfProductQueryValue(tab: ContractPerfProductTab): string | undefined {
  if (tab === 'All') return undefined
  return CONTRACT_PERF_PRODUCT_TAB_API_VALUE[tab]
}

/** Section 1 plant dropdown — single group plant or none (All). */
export function contractPerfGroupPlantsQueryValue(plantTab: string): string[] {
  const trimmed = String(plantTab ?? '').trim()
  if (!trimmed || trimmed === 'All') return []
  return [trimmed]
}

/**
 * First step in the Contract Performance pipeline — `contracts.source_type` from API/DB.
 * DB values are typically `3rd Party` or `Inhouse`; UI "Interco" matches Inhouse/Interco variants.
 */
export function matchesContractPerfSourceFilter(
  sourceType: unknown,
  filter: ContractPerfSourceFilter,
): boolean {
  if (filter === 'All') return true
  const upper = String(sourceType ?? '').trim().toUpperCase()
  if (filter === '3rd Party') {
    return upper.includes('3RD') && upper.includes('PARTY')
  }
  if (filter === 'Interco') {
    return upper.includes('INTERCO') || upper.includes('INHOUSE') || upper.includes('IN-HOUSE')
  }
  return true
}

export function contractPerfProductLabelToApiValue(label: string): string {
  const trimmed = String(label ?? '').trim()
  if (!trimmed) return ''
  const tab = trimmed as Exclude<ContractPerfProductTab, 'All'>
  if (tab in CONTRACT_PERF_PRODUCT_TAB_API_VALUE) {
    return CONTRACT_PERF_PRODUCT_TAB_API_VALUE[tab]
  }
  return trimmed.toUpperCase()
}

export function contractPerfProductMultiApiValues(selectedProducts: readonly string[]): string[] {
  return selectedProducts
    .map((p) => contractPerfProductLabelToApiValue(p))
    .filter(Boolean)
}

/** OR match — empty selection = all sources. */
export function matchesContractPerfSourceMultiFilter(
  sourceType: unknown,
  selectedSources: readonly string[],
): boolean {
  if (!selectedSources.length) return true
  return selectedSources.some((source) =>
    matchesContractPerfSourceFilter(sourceType, source as ContractPerfSourceFilter),
  )
}

/** OR substring match — empty selection = all products. */
export function matchesContractPerfProductMultiFilter(
  rowProduct: unknown,
  selectedProducts: readonly string[],
): boolean {
  if (!selectedProducts.length) return true
  return selectedProducts.some((product) =>
    matchesContractPerfProductTabFilter(rowProduct, contractPerfProductLabelToApiValue(product)),
  )
}

export function isContractPerfDrilldownValueSet(value: string | null | undefined): value is string {
  return value != null && value !== ''
}

export function hasContractPerfDrilldownSelection(selection: ContractPerfDrilldownFilters): boolean {
  return (
    isContractPerfDrilldownValueSet(selection.product) ||
    isContractPerfDrilldownValueSet(selection.plant) ||
    isContractPerfDrilldownValueSet(selection.incoterm) ||
    isContractPerfDrilldownValueSet(selection.supplier)
  )
}

/** Section 3 lazy gate — reveal table when any top-level or drilldown filter is active. */
export function isContractPerfSection3FilterApplied(input: {
  selectedSources: string[]
  selectedProducts: string[]
  summaryCardStatus: 'All' | 'Open' | 'Close'
  appliedDrilldown: ContractPerfDrilldownFilters
}): boolean {
  return (
    input.selectedSources.length > 0 ||
    input.selectedProducts.length > 0 ||
    input.summaryCardStatus === 'Open' ||
    input.summaryCardStatus === 'Close' ||
    hasContractPerfDrilldownSelection(input.appliedDrilldown)
  )
}

export function contractMatchesSummaryCardStatus(
  c: PerformanceTableContract,
  contractStatus: 'All' | 'Open' | 'Close',
): boolean {
  if (contractStatus === 'All') return true
  const status = String(c.import_status || c.status || '').trim().toUpperCase()
  const isClosed = status === 'CLOSE' || status === 'CLOSED' || status === 'COMPLETED'
  const isOpen = status === 'OPEN' || status === 'ACTIVE'
  if (contractStatus === 'Open') return isOpen
  if (contractStatus === 'Close') return isClosed
  return true
}

export function contractPerfDrilldownSelectionsEqual(
  a: ContractPerfDrilldownFilters,
  b: ContractPerfDrilldownFilters,
): boolean {
  return (
    a.product === b.product &&
    a.plant === b.plant &&
    a.incoterm === b.incoterm &&
    a.supplier === b.supplier
  )
}

/** Normalize row values to the same keys used in drilldown tree nodes. */
export function normalizePerfGroupKey(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || 'Blank'
}

export function normalizePerfProductGroupKey(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return 'Uncategorized'
  const upper = trimmed.toUpperCase()
  if (upper === 'SHELL PALM' || (upper.includes('SHELL') && upper.includes('PALM'))) {
    return 'SHELL PALM'
  }
  return upper
}

/**
 * Product tab filter — substring match aligned with GET /contracts `ILIKE '%value%'`.
 * Used for toolbar tabs (POME, CPO, …); drilldown product nodes keep exact dimension match.
 */
export function matchesContractPerfProductTabFilter(
  rowProduct: unknown,
  tabProduct: string | undefined,
): boolean {
  if (!tabProduct?.trim()) return true
  const row = String(rowProduct ?? '').trim().toUpperCase()
  const needle = tabProduct.trim().toUpperCase()
  if (!needle) return true
  return row.includes(needle)
}

/** Filter sentinel "Blank" (or null/empty filter) matches nullish/empty row values. */
export function isBlankFilterSentinel(value: string | null | undefined): boolean {
  if (value == null) return true
  const t = String(value).trim()
  return t === '' || t === 'Blank'
}

/** True when a row dimension satisfies an active drilldown filter (Blank-safe). */
export function matchesPerformanceDimensionFilter(
  rowValue: unknown,
  filterValue: string | null,
  mode: 'group' | 'product',
): boolean {
  if (!isContractPerfDrilldownValueSet(filterValue)) return true
  const rowKey = mode === 'product' ? normalizePerfProductGroupKey(rowValue) : normalizePerfGroupKey(rowValue)
  if (isBlankFilterSentinel(filterValue)) {
    return isBlankFilterSentinel(rowKey) || rowKey === 'Blank' || rowKey === 'Uncategorized'
  }
  const filterKey =
    mode === 'product' ? normalizePerfProductGroupKey(filterValue) : filterValue
  if (mode === 'product') return rowKey === filterKey
  return rowKey.toUpperCase() === String(filterKey).trim().toUpperCase()
}

export function resolveContractPerfTablePlants(
  globalPlants: string[],
  drilldownPlant: string | null,
): string[] {
  if (isContractPerfDrilldownValueSet(drilldownPlant)) return [drilldownPlant]
  return globalPlants
}

export function resolveContractPerfIncoterms(
  globalIncoterms: string[],
  drilldownIncoterm: string | null,
): string[] {
  if (isContractPerfDrilldownValueSet(drilldownIncoterm)) return [drilldownIncoterm]
  return globalIncoterms
}

export function resolveContractPerfTableProduct(
  selectedProducts: readonly string[],
  drilldownProduct: string | null,
): string | undefined {
  if (isContractPerfDrilldownValueSet(drilldownProduct)) {
    if (drilldownProduct === 'Blank' || drilldownProduct === 'Uncategorized') return undefined
    return normalizePerfProductGroupKey(drilldownProduct)
  }
  if (selectedProducts.length === 1) {
    return normalizePerfProductGroupKey(contractPerfProductLabelToApiValue(selectedProducts[0]))
  }
  return undefined
}

export function resolveContractPerfTableProducts(
  selectedProducts: readonly string[],
  drilldownProduct: string | null,
): string[] {
  if (isContractPerfDrilldownValueSet(drilldownProduct)) {
    const single = resolveContractPerfTableProduct(selectedProducts, drilldownProduct)
    return single ? [single] : []
  }
  return contractPerfProductMultiApiValues(selectedProducts)
}

/** Build the unified scope object consumed by every section. */
export function resolveContractPerformanceScope(input: {
  global: ContractPerformanceGlobalFilters
  drilldown: ContractPerfDrilldownFilters
}): ContractPerformanceScope {
  const { global, drilldown } = input
  const resolvedProducts = resolveContractPerfTableProducts(global.selectedProducts, drilldown.product)
  return {
    global,
    drilldown,
    resolvedProduct: resolveContractPerfTableProduct(global.selectedProducts, drilldown.product),
    resolvedProducts,
    resolvedPlants: resolveContractPerfTablePlants(global.selectedGroupPlants, drilldown.plant),
    resolvedIncoterms: resolveContractPerfIncoterms(global.selectedIncoterms, drilldown.incoterm),
    resolvedSupplier: drilldown.supplier,
    contractStatus: global.summaryCardStatus,
  }
}

/**
 * Scope for Section 1 Open/Close card totals only.
 * Uses toolbar globals (date, product tab, incoterm, plant, search, etc.) but never
 * the active summary-card status — cards must always show both Open and Close totals.
 */
export function resolveContractPerformanceCardSummaryScope(
  global: ContractPerformanceGlobalFilters,
): ContractPerformanceScope {
  return resolveContractPerformanceScope({
    global: { ...global, summaryCardStatus: 'All' },
    drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
  })
}

export type Section3FilterMode = 'linked' | 'global'

/**
 * Section 3 filter mode:
 * - linked: applied Section 2 drilldown path drives the table (S1 globals + S2 Apply).
 * - global: toolbar/search/global filters only — table independent of drilldown cards.
 */
export function resolveSection3FilterMode(
  appliedDrilldown: ContractPerfDrilldownFilters,
): Section3FilterMode {
  return hasContractPerfDrilldownSelection(appliedDrilldown) ? 'linked' : 'global'
}

export function resolveSection3Scope(
  global: ContractPerformanceGlobalFilters,
  appliedDrilldown: ContractPerfDrilldownFilters,
): { mode: Section3FilterMode; scope: ContractPerformanceScope } {
  const mode = resolveSection3FilterMode(appliedDrilldown)
  const scope = resolveContractPerformanceScope({
    global,
    drilldown: mode === 'linked' ? appliedDrilldown : EMPTY_CONTRACT_PERF_DRILLDOWN,
  })
  return { mode, scope }
}

type FilterHotspotOptions = {
  /** When false, ignore drilldown path (Section 1 global scope). Default true. */
  applyDrilldown?: boolean
}

/**
 * THE unified row filter — Sections 1, 2, and 3 client checks MUST use this.
 */
export function filterPerformanceHotspots(
  rows: ContractPerfHotspot[],
  scope: ContractPerformanceScope,
  options: FilterHotspotOptions = {},
): ContractPerfHotspot[] {
  const applyDrilldown = options.applyDrilldown !== false
  const { drilldown } = scope

  return rows.filter((row) => {
    if (scope.resolvedIncoterms.length > 0) {
      const inc = normalizePerfGroupKey(row.incoterm)
      if (!scope.resolvedIncoterms.includes(inc)) return false
    }
    if (scope.resolvedPlants.length > 0) {
      if (!valueInRegionSiteList(row.plant_site, scope.resolvedPlants)) return false
    }
    if (
      scope.resolvedProduct &&
      !isContractPerfDrilldownValueSet(drilldown.product) &&
      !matchesContractPerfProductTabFilter(row.product, scope.resolvedProduct)
    ) {
      return false
    }

    if (!applyDrilldown) return true

    if (!matchesPerformanceDimensionFilter(row.product, drilldown.product, 'product')) return false
    if (!matchesPerformanceDimensionFilter(row.plant_site, drilldown.plant, 'group')) return false
    if (!matchesPerformanceDimensionFilter(row.incoterm, drilldown.incoterm, 'group')) return false
    if (!matchesPerformanceDimensionFilter(row.supplier, drilldown.supplier, 'group')) return false

    return true
  })
}

export function contractMatchesLateOnTimeFilter(
  tradeCycleDays: number | null | undefined,
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME',
  contractPerfOnTime?: boolean | null,
): boolean {
  if (lateOnTimeFilter === 'ALL') return true
  // null trade_cycle_days = no Completion Date (unscheduled). Never late/on-time.
  if (tradeCycleDays == null || Number.isNaN(tradeCycleDays)) {
    return false
  }
  if (typeof contractPerfOnTime === 'boolean') {
    return lateOnTimeFilter === 'ON_TIME' ? contractPerfOnTime : !contractPerfOnTime
  }
  return lateOnTimeFilter === 'LATE' ? tradeCycleDays > 0 : tradeCycleDays <= 0
}

/**
 * Section 3 — mirror Section 2 tree inclusion (due date delivery end + schedulable, not unscheduled).
 */
export function isContractPerfUnscheduledRow(c: PerformanceTableContract): boolean {
  if (!String(c.delivery_end_date || '').trim()) return true
  const status = String(c.import_status || c.status || '').trim().toUpperCase()
  const isClosed = status === 'CLOSE' || status === 'CLOSED' || status === 'COMPLETED'
  const isOpen = status === 'OPEN' || status === 'ACTIVE'
  if (
    (isClosed || isOpen) &&
    (c.trade_cycle_days == null || Number.isNaN(Number(c.trade_cycle_days)))
  ) {
    return true
  }
  return false
}

export function contractMeetsPerformanceTreeInclusion(
  c: PerformanceTableContract,
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME',
): boolean {
  if (!String(c.delivery_end_date || '').trim()) return false

  const status = String(c.import_status || c.status || '').trim().toUpperCase()
  if (!status) return false

  const isClosed = status === 'CLOSE' || status === 'CLOSED' || status === 'COMPLETED'
  const isOpen = status === 'OPEN' || status === 'ACTIVE'
  if (!isClosed && !isOpen) return false

  // No Completion Date on payload → unscheduled for Section 3 client guard when backend
  // has not computed trade_cycle_days. Open rows with due end get today fallback at compute time.
  if (c.trade_cycle_days == null || Number.isNaN(Number(c.trade_cycle_days))) {
    return false
  }

  return contractMatchesLateOnTimeFilter(
    c.trade_cycle_days,
    lateOnTimeFilter,
    c.contract_perf_on_time,
  )
}

/** Client-side guard so Section 3 rows match Section 2 node scope (post-API). */
export function filterContractsForPerformanceTable(
  contracts: PerformanceTableContract[],
  scope: ContractPerformanceScope,
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME',
): PerformanceTableContract[] {
  const { drilldown } = scope
  const applyTreeInclusionGuard = hasContractPerfDrilldownSelection(drilldown)
  // All = On Time + Late + Unscheduled — never strip rows via late/on-time tree membership.
  const includeUnscheduledInAll = lateOnTimeFilter === 'ALL'

  return contracts.filter((c) => {
    if (!contractMatchesSummaryCardStatus(c, scope.contractStatus)) {
      return false
    }

    if (!matchesContractPerfSourceMultiFilter(c.source_type, scope.global.selectedSources)) {
      return false
    }

    let backendTreeInclusionApplied = false
    if (applyTreeInclusionGuard && !includeUnscheduledInAll) {
      if (typeof c.contract_perf_in_tree === 'boolean') {
        if (!c.contract_perf_in_tree) return false
        backendTreeInclusionApplied = true
      } else if (!contractMeetsPerformanceTreeInclusion(c, lateOnTimeFilter)) {
        return false
      }
    }

    if (!matchesPerformanceDimensionFilter(c.product, drilldown.product, 'product')) return false
    if (!matchesPerformanceDimensionFilter(c.plant_site, drilldown.plant, 'group')) return false
    if (!matchesPerformanceDimensionFilter(c.incoterm, drilldown.incoterm, 'group')) return false
    if (!matchesPerformanceDimensionFilter(c.supplier, drilldown.supplier, 'group')) return false

    if (scope.resolvedIncoterms.length > 0) {
      const inc = normalizePerfGroupKey(c.incoterm)
      if (!scope.resolvedIncoterms.includes(inc)) return false
    }
    if (scope.resolvedPlants.length > 0) {
      if (!valueInRegionSiteList(c.plant_site, scope.resolvedPlants)) return false
    }
    if (
      !isContractPerfDrilldownValueSet(drilldown.product) &&
      scope.global.selectedProducts.length > 0 &&
      !matchesContractPerfProductMultiFilter(c.product, scope.global.selectedProducts)
    ) {
      return false
    }
    if (
      scope.resolvedProduct &&
      isContractPerfDrilldownValueSet(drilldown.product) &&
      !matchesContractPerfProductTabFilter(c.product, scope.resolvedProduct)
    ) {
      return false
    }

    // All segment: keep Unscheduled (and any other row matching dimensions). Backend already
    // sent excludeUnscheduled=false; do not re-apply late/on-time membership here.
    if (includeUnscheduledInAll) {
      return true
    }

    // When backend set contract_perf_in_tree (excludeUnscheduled=true), late/on-time is already applied.
    if (
      !backendTreeInclusionApplied &&
      !contractMatchesLateOnTimeFilter(
        c.trade_cycle_days,
        lateOnTimeFilter,
        c.contract_perf_on_time,
      )
    ) {
      return false
    }
    return true
  })
}

export function flattenLatePerfApiTreeToHotspots(tree: LatePerfApiTreeNode[]): ContractPerfHotspot[] {
  const out: ContractPerfHotspot[] = []
  for (const inc of tree) {
    for (const plant of inc.children || []) {
      for (const prod of plant.children || []) {
        for (const gn of prod.children || []) {
          for (const sup of gn.children || []) {
            out.push({
              incoterm: inc.key,
              product: normalizePerfProductGroupKey(prod.key),
              plant_site: plant.key,
              group_name: gn.key,
              supplier: sup.key,
              count: sup.count,
              totalDays: sup.totalDays,
              maxDays: sup.maxDays,
              totalQtyDelivery: sup.totalQtyDelivery || 0,
            })
          }
        }
      }
    }
  }
  return out
}

export function selectPerformanceTreeBranch(
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME',
  perfDashMode: 'late' | 'ontrack',
): 'ontrack' | 'late' {
  if (lateOnTimeFilter === 'ON_TIME') return 'ontrack'
  if (lateOnTimeFilter === 'LATE') return 'late'
  return perfDashMode === 'ontrack' ? 'ontrack' : 'late'
}

export function sumHotspotQtyKg(rows: ContractPerfHotspot[]): number {
  return rows.reduce((s, r) => s + (Number(r.totalQtyDelivery) || 0), 0)
}

/** Best-effort unique contract count from hotspot rows (leaf count fallback). */
export function countPerformanceHotspotContracts(rows: ContractPerfHotspot[]): number {
  const ids = new Set<string>()
  let leafCount = 0
  for (const row of rows) {
    leafCount += Number(row.count) || 0
    const id = String(row.contract_id || '').trim()
    if (id) ids.add(id)
  }
  return ids.size > 0 ? ids.size : leafCount
}

export function contractPerfDrilldownToTableColumnFilters(
  drilldown: ContractPerfDrilldownFilters,
): Record<string, ContractPerfColumnFilter> {
  const out: Record<string, ContractPerfColumnFilter> = {}

  const applyMulti = (field: string, key: string | null) => {
    if (!isContractPerfDrilldownValueSet(key)) return
    const includeBlank = isBlankFilterSentinel(key)
    out[field] = { type: 'multi', values: includeBlank ? [] : [key], includeBlank }
  }

  applyMulti('product', drilldown.product)
  applyMulti('incoterm', drilldown.incoterm)

  if (isContractPerfDrilldownValueSet(drilldown.supplier)) {
    if (isBlankFilterSentinel(drilldown.supplier)) {
      out.supplier = { type: 'text', value: '', emptyOnly: true }
    } else {
      out.supplier = { type: 'text', value: drilldown.supplier, exact: true }
    }
  }

  return out
}

export function buildContractPerfTableColumnFilters(
  baseColumnFilters: Record<string, unknown>,
  globalIncoterms: string[],
  globalSuppliers: string[],
  drilldown: ContractPerfDrilldownFilters,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...baseColumnFilters }

  const applyMulti = (field: string, key: string | null) => {
    if (!isContractPerfDrilldownValueSet(key)) return
    const includeBlank = isBlankFilterSentinel(key)
    merged[field] = { type: 'multi', values: includeBlank ? [] : [key], includeBlank }
  }

  applyMulti('product', drilldown.product)
  applyMulti('incoterm', drilldown.incoterm)

  if (!isContractPerfDrilldownValueSet(drilldown.incoterm) && globalIncoterms.length > 0) {
    const includeBlank = globalIncoterms.includes('Blank')
    const values = globalIncoterms.filter((v) => v !== 'Blank')
    merged.incoterm = { type: 'multi', values, includeBlank }
  }

  if (isContractPerfDrilldownValueSet(drilldown.supplier)) {
    if (isBlankFilterSentinel(drilldown.supplier)) {
      merged.supplier = { type: 'text', value: '', emptyOnly: true }
    } else {
      merged.supplier = { type: 'text', value: drilldown.supplier, exact: true }
    }
  } else if (globalSuppliers.length > 0) {
    const includeBlank = globalSuppliers.includes('Blank')
    const values = globalSuppliers.filter((v) => v !== 'Blank')
    merged.supplier = { type: 'multi', values, includeBlank }
  }

  return merged
}

export function buildContractPerfTableFetchScope(input: {
  columnFilters: Record<string, unknown>
  scope: ContractPerformanceScope
}): ContractPerformanceTableFetchScope {
  const { scope } = input
  return {
    columnFilters: buildContractPerfTableColumnFilters(
      input.columnFilters,
      scope.global.selectedIncoterms,
      scope.global.selectedSuppliers,
      scope.drilldown,
    ),
    plants: scope.resolvedPlants,
    product: scope.resolvedProduct,
  }
}

/** Late/On Time branch for Section 3 — passes ALL through when no segment is selected. */
export function resolveEffectiveLateOnTimeFilter(
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME',
  _perfDashMode?: 'late' | 'ontrack',
): 'ALL' | 'LATE' | 'ON_TIME' {
  if (lateOnTimeFilter === 'LATE' || lateOnTimeFilter === 'ON_TIME' || lateOnTimeFilter === 'ALL') {
    return lateOnTimeFilter
  }
  return 'ALL'
}

/**
 * GET /contracts query for Contract Performance Section 3.
 * Aligns with Section 1 globals + Section 2 drilldown (when linked) + active Late/On Time branch.
 */
export function buildContractPerfTableListParams(input: {
  scope: ContractPerformanceScope
  section3Mode: Section3FilterMode
  columnFilters: Record<string, unknown>
  lateOnTimeFilter: 'ALL' | 'LATE' | 'ON_TIME'
  perfDashMode: 'late' | 'ontrack'
}): URLSearchParams {
  const params = new URLSearchParams()
  appendContractPerformanceApiParams(params, input.scope, {
    includeDrilldown: input.section3Mode === 'linked',
  })

  const { columnFilters } = buildContractPerfTableFetchScope({
    columnFilters: input.columnFilters,
    scope: input.scope,
  })
  if (Object.keys(columnFilters).length > 0) {
    params.append('columnFilters', JSON.stringify(columnFilters))
  }

  params.append(
    'lateOnTimeFilter',
    resolveEffectiveLateOnTimeFilter(input.lateOnTimeFilter, input.perfDashMode),
  )
  const effectiveLate = resolveEffectiveLateOnTimeFilter(
    input.lateOnTimeFilter,
    input.perfDashMode,
  )
  params.append('excludeUnscheduled', effectiveLate === 'ALL' ? 'false' : 'true')
  params.append('compact', 'true')
  return params
}

export type ContractPerformanceApiParamOptions = {
  includeDrilldown: boolean
  /**
   * Section 1 Open/Close card totals — never send contract status to the API.
   * Toolbar globals (product, date, incoterm, plant, etc.) still apply.
   */
  omitContractStatus?: boolean
}

/** Late-performance API params — tree/drilldown includes active Open/Close tab; card summary does not. */
export function appendContractPerformanceApiParams(
  params: URLSearchParams,
  scope: ContractPerformanceScope,
  options: ContractPerformanceApiParamOptions,
): void {
  const drilldown = options.includeDrilldown ? scope.drilldown : EMPTY_CONTRACT_PERF_DRILLDOWN
  const resolvedProducts = resolveContractPerfTableProducts(
    scope.global.selectedProducts,
    drilldown.product,
  )
  const resolvedProduct =
    resolvedProducts.length === 1 ? resolvedProducts[0] : scope.resolvedProduct
  const resolvedPlants = resolveContractPerfTablePlants(
    scope.global.selectedGroupPlants,
    drilldown.plant,
  )
  const resolvedIncoterms = resolveContractPerfIncoterms(
    scope.global.selectedIncoterms,
    drilldown.incoterm,
  )
  const supplier = options.includeDrilldown ? scope.resolvedSupplier : null

  const searchTrim = scope.global.search.trim()
  const omitContractStatus = options.omitContractStatus === true
  /** Contract Performance always initializes YTD dates — use filtered scope so plants/incoterms/search apply even when Open/Close tab is "All". */
  const hasToolbarDateScope = Boolean(
    scope.global.dateFrom?.trim() || scope.global.dateTo?.trim(),
  )
  const useFilteredScope =
    hasToolbarDateScope ||
    (!omitContractStatus && scope.contractStatus !== 'All') ||
    scope.global.selectedSources.length > 0 ||
    scope.global.selectedProducts.length > 0 ||
    resolvedIncoterms.length > 0 ||
    resolvedPlants.length > 0 ||
    searchTrim.length >= 2 ||
    isContractPerfDrilldownValueSet(supplier) ||
    Boolean(resolvedProduct) ||
    resolvedProducts.length > 1

  params.append('scope', useFilteredScope ? 'filtered' : 'ytd')
  params.append('_ts', String(Date.now()))
  if (scope.global.dateFrom) params.append('dateFrom', scope.global.dateFrom)
  if (scope.global.dateTo) params.append('dateTo', scope.global.dateTo)
  if (scope.global.perfTransportMode !== 'ALL') {
    params.append('transportMode', scope.global.perfTransportMode)
  }
  if (resolvedProducts.length > 1) {
    params.append('products', resolvedProducts.join(','))
  } else if (resolvedProduct) {
    params.append('product', resolvedProduct)
  }
  if (scope.global.selectedSources.length > 0) {
    params.append('sourceTypes', scope.global.selectedSources.join(','))
  }
  if (scope.global.b2bFlagFilter !== 'ALL') params.append('b2bFlag', scope.global.b2bFlagFilter)
  if (!omitContractStatus && scope.contractStatus !== 'All') {
    params.append('status', scope.contractStatus)
  }
  if (searchTrim.length >= 2) params.append('search', searchTrim)
  if (isContractPerfDrilldownValueSet(supplier) && !isBlankFilterSentinel(supplier)) {
    params.append('supplier', supplier)
  }
  if (resolvedIncoterms.length > 0) {
    params.append('incoterms', resolvedIncoterms.join(','))
  }
  resolvedPlants.forEach((plant) => params.append('plant', plant))
}

export function buildLatePerformanceApiParams(
  scope: ContractPerformanceScope,
  includeDrilldown: boolean,
): URLSearchParams {
  const params = new URLSearchParams()
  appendContractPerformanceApiParams(params, scope, { includeDrilldown })
  return params
}

/**
 * Scope for Section 2 drilldown card totals — toolbar + Open/Close tab only.
 * Applied drilldown path (Product → Region/Plant → Incoterm → Supplier) never narrows the tree API.
 */
export function resolveContractPerformanceTreeScope(
  global: ContractPerformanceGlobalFilters,
): ContractPerformanceScope {
  return resolveContractPerformanceScope({
    global,
    drilldown: EMPTY_CONTRACT_PERF_DRILLDOWN,
  })
}

/** Section 2 tree API — global scope only; Apply/drilldown path does not refilter card counts. */
export function buildLatePerformanceTreeApiParams(
  global: ContractPerformanceGlobalFilters,
): URLSearchParams {
  const params = new URLSearchParams()
  appendContractPerformanceApiParams(params, resolveContractPerformanceTreeScope(global), {
    includeDrilldown: false,
  })
  return params
}

/** Section 1 card totals API — toolbar scope only; never applies Open/Close tab status. */
export function buildLatePerformanceCardSummaryApiParams(
  global: ContractPerformanceGlobalFilters,
): URLSearchParams {
  const params = new URLSearchParams()
  appendContractPerformanceApiParams(params, resolveContractPerformanceCardSummaryScope(global), {
    includeDrilldown: false,
    omitContractStatus: true,
  })
  return params
}

/** Stable cache/fetch key — ignores cache-bust timestamp. */
export function stableContractPerfApiParamsKey(params: URLSearchParams): string {
  const copy = new URLSearchParams(params.toString())
  copy.delete('_ts')
  return copy.toString()
}

/** Toolbar-only global bag for Section 1 cards (excludes Open/Close tab selection). */
export function buildContractPerfToolbarGlobal(input: {
  dateFrom: string
  dateTo: string
  selectedSources: string[]
  selectedProducts: string[]
  selectedIncoterms: string[]
  selectedSuppliers: string[]
  selectedGroupPlants: string[]
  lateOnTimeFilter: ContractPerformanceGlobalFilters['lateOnTimeFilter']
  perfDashMode: ContractPerformanceGlobalFilters['perfDashMode']
  perfTransportMode: ContractPerformanceGlobalFilters['perfTransportMode']
  b2bFlagFilter: string
  search: string
}): ContractPerformanceGlobalFilters {
  return {
    ...input,
    summaryCardStatus: 'All',
  }
}
