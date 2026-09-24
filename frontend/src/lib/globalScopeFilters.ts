/** Shared helpers for Incoterm / Product / Group Plant toolbar filters across list & performance pages. */

export type ToolbarMultiFilterState = {
  selectedIncoterms: string[]
  selectedProducts: string[]
  selectedSuppliers?: string[]
  selectedGroups?: string[]
  selectedGroupPlants: string[]
  /**
   * 'Planned' / 'Unplanned'. Planned means scheduled and still running - up to but not including
   * completed, never cancelled - so a finished row belongs to neither value. Selecting both is
   * therefore NOT "everything": only a single selection filters.
   */
  selectedPlanningStatuses?: string[]
}

type MultiColumnFilter = {
  type: 'multi'
  values: string[]
  includeBlank?: boolean
}

export function isBlankFilterOption(value: unknown): boolean {
  const text = String(value ?? '').trim()
  return text.length === 0 || text.toLowerCase() === 'blank'
}

export function filterRegionSiteOptions(options: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const option of options) {
    if (isBlankFilterOption(option)) continue
    const trimmed = String(option).trim()
    const key = trimmed.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/** Map stored Region/Plant labels onto the current dropdown option strings (case-insensitive). */
export function alignSelectedToRegionSiteOptions(selected: string[], options: string[]): string[] {
  const byKey = new Map<string, string>()
  for (const option of filterRegionSiteOptions(options)) {
    byKey.set(option.trim().toUpperCase(), option)
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of selected) {
    const trimmed = String(value ?? '').trim()
    if (isBlankFilterOption(trimmed)) continue
    const key = trimmed.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(byKey.get(key) ?? trimmed)
  }
  return out
}

export function valueInRegionSiteList(value: unknown, selected: string[]): boolean {
  const destSelected = selected.filter((item) => !isBlankFilterOption(item))
  if (destSelected.length === 0) return true
  const row = String(value ?? '').trim()
  if (isBlankFilterOption(row)) return false
  const rowKey = row.toUpperCase()
  return destSelected.some((item) => String(item).trim().toUpperCase() === rowKey)
}

export function filterIncotermOptions(options: string[]): string[] {
  return options.filter((option) => !isBlankFilterOption(option))
}

export function appendToolbarMultiToColumnFilters(
  base: Record<string, unknown>,
  toolbar: Partial<ToolbarMultiFilterState>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }

  if (toolbar.selectedIncoterms && toolbar.selectedIncoterms.length > 0) {
    const values = filterIncotermOptions(toolbar.selectedIncoterms)
    if (values.length > 0) {
      merged.incoterm = { type: 'multi', values } satisfies MultiColumnFilter
    }
  }

  if (toolbar.selectedProducts && toolbar.selectedProducts.length > 0) {
    const includeBlank = toolbar.selectedProducts.includes('Blank')
    const values = toolbar.selectedProducts.filter((v) => v !== 'Blank')
    merged.product = { type: 'multi', values, includeBlank } satisfies MultiColumnFilter
  }

  if (toolbar.selectedGroups && toolbar.selectedGroups.length > 0) {
    const includeBlank = toolbar.selectedGroups.includes('Blank')
    const values = toolbar.selectedGroups.filter((v) => v !== 'Blank')
    merged.group_name = { type: 'multi', values, includeBlank } satisfies MultiColumnFilter
  }

  if (toolbar.selectedSuppliers && toolbar.selectedSuppliers.length > 0) {
    const includeBlank = toolbar.selectedSuppliers.includes('Blank')
    const values = toolbar.selectedSuppliers.filter((v) => v !== 'Blank')
    merged.supplier = { type: 'multi', values, includeBlank } satisfies MultiColumnFilter
  }

  return merged
}

export function normalizeScopeGroupKey(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : 'Blank'
}

/**
 * The distinct values of a field that may carry several, comma-joined.
 *
 * Shipping Performance groups by STO, and an STO can span contracts with different suppliers: 298
 * of 10,477 have more than one. The API joins those into `"SUP A, SUP B"`, so an exact-match filter
 * on `"SUP A"` misses the row entirely. No supplier or group name contains a comma, and the API
 * builds the string by splitting on one, so splitting here is its exact inverse.
 */
export function scopeGroupKeyParts(value: unknown): string[] {
  const parts = String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : ['Blank']
}

export function rowMatchesToolbarMultiFilters(
  row: {
    incoterm?: unknown
    product?: unknown
    supplier?: unknown
    group_name?: unknown
    plant_site?: unknown
    group_plant?: unknown
    status?: unknown
  },
  filters: Partial<ToolbarMultiFilterState>,
): boolean {
  if (filters.selectedIncoterms && filters.selectedIncoterms.length > 0) {
    const selectedIncoterms = filterIncotermOptions(filters.selectedIncoterms)
    if (selectedIncoterms.length === 0) return true
    const inc = normalizeScopeGroupKey(row.incoterm)
    if (!selectedIncoterms.includes(inc)) return false
  }
  if (filters.selectedProducts && filters.selectedProducts.length > 0) {
    const prod = normalizeScopeGroupKey(row.product)
    if (!filters.selectedProducts.includes(prod)) return false
  }
  // A row that carries several groups or suppliers matches if ANY of them is selected - dropping a
  // two-supplier STO because only one of its suppliers was ticked would hide real cargo.
  if (filters.selectedGroups && filters.selectedGroups.length > 0) {
    const groups = scopeGroupKeyParts(row.group_name)
    if (!groups.some((group) => filters.selectedGroups!.includes(group))) return false
  }
  if (filters.selectedSuppliers && filters.selectedSuppliers.length > 0) {
    const suppliers = scopeGroupKeyParts(row.supplier)
    if (!suppliers.some((supplier) => filters.selectedSuppliers!.includes(supplier))) return false
  }
  if (filters.selectedGroupPlants && filters.selectedGroupPlants.length > 0) {
    if (!valueInRegionSiteList(row.group_plant ?? row.plant_site, filters.selectedGroupPlants)) return false
  }
  if (filters.selectedPlanningStatuses && filters.selectedPlanningStatuses.length === 1) {
    const st = String(row.status ?? '').trim().toUpperCase()
    const wanted = filters.selectedPlanningStatuses[0].trim().toUpperCase()
    // Trucking reports IN_PROGRESS where shipments report PLANNED/SAILED/ARRIVED_LP; both mean
    // scheduled and under way, so both count here and the caller need not say which page it is.
    const isPlanned =
      st === 'PLANNED' || st === 'SAILED' || st === 'ARRIVED_LP' || st === 'IN_PROGRESS'
    if (wanted === 'PLANNED' && !isPlanned) return false
    if (wanted === 'UNPLANNED' && st !== 'UNPLANNED') return false
  }
  return true
}

/** Client-side text search across common row fields (min 2 chars). */
export function rowMatchesGlobalSearch(
  row: object,
  searchTrim: string,
  fields: readonly string[],
): boolean {
  if (searchTrim.length < 2) return true
  const needle = searchTrim.toLowerCase()
  const record = row as Record<string, unknown>
  return fields.some((field) => {
    const raw = record[field]
    if (raw === null || raw === undefined) return false
    return String(raw).toLowerCase().includes(needle)
  })
}

export function hasToolbarMultiSelection(filters: Partial<ToolbarMultiFilterState>): boolean {
  return (
    (filters.selectedIncoterms?.length ?? 0) > 0 ||
    (filters.selectedProducts?.length ?? 0) > 0 ||
    (filters.selectedGroups?.length ?? 0) > 0 ||
    (filters.selectedSuppliers?.length ?? 0) > 0 ||
    (filters.selectedGroupPlants?.length ?? 0) > 0
  )
}

/**
 * Puts selected values first (in selection order), then the rest in their original order.
 * Used in global Product / Group Plant filters so user-plotted values from User Management
 * stay visible at the top of the dropdown.
 */
export function sortFilterOptionsWithSelectedFirst(
  options: string[],
  selected: string[],
): string[] {
  if (selected.length === 0 || options.length === 0) return options

  const optionSet = new Set(options)
  const selectedFirst: string[] = []
  for (const value of selected) {
    if (optionSet.has(value) && !selectedFirst.includes(value)) {
      selectedFirst.push(value)
    }
  }
  if (selectedFirst.length === 0) return options

  const selectedSet = new Set(selectedFirst)
  const rest = options.filter((option) => !selectedSet.has(option))
  return [...selectedFirst, ...rest]
}
