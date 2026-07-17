/** Shared helpers for Incoterm / Product / Group Plant toolbar filters across list & performance pages. */

export type ToolbarMultiFilterState = {
  selectedIncoterms: string[]
  selectedProducts: string[]
  selectedSuppliers?: string[]
  selectedGroups?: string[]
  selectedGroupPlants: string[]
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

export function rowMatchesToolbarMultiFilters(
  row: {
    incoterm?: unknown
    product?: unknown
    supplier?: unknown
    group_name?: unknown
    plant_site?: unknown
    group_plant?: unknown
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
  if (filters.selectedGroups && filters.selectedGroups.length > 0) {
    const group = normalizeScopeGroupKey(row.group_name)
    if (!filters.selectedGroups.includes(group)) return false
  }
  if (filters.selectedSuppliers && filters.selectedSuppliers.length > 0) {
    const sup = normalizeScopeGroupKey(row.supplier)
    if (!filters.selectedSuppliers.includes(sup)) return false
  }
  if (filters.selectedGroupPlants && filters.selectedGroupPlants.length > 0) {
    const groupPlant = normalizeScopeGroupKey(row.group_plant ?? row.plant_site)
    if (!filters.selectedGroupPlants.includes(groupPlant)) return false
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
