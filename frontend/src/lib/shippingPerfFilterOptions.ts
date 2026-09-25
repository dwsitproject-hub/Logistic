/**
 * Which values each Shipping Performance filter can still offer, given the others.
 *
 * This page holds its whole dataset in the browser, so the answer is computed here rather than
 * asked of the API the way Contract Performance has to.
 *
 * Each list is built from the rows that pass every filter EXCEPT its own. Building them from the
 * fully filtered rows is the obvious approach and it is wrong: pick one supplier and the Supplier
 * list collapses to that supplier, so a second one can never be added.
 *
 * Supplier and Group Supplier can carry several comma-joined values on one row - the page groups by
 * STO, and 298 of 10,477 STOs span contracts with different suppliers - so those are split before
 * being offered.
 */
import {
  normalizeScopeGroupKey,
  rowMatchesToolbarMultiFilters,
  scopeGroupKeyParts,
} from '@/lib/globalScopeFilters'
import { applyShippingPerfSourceProductFilter } from '@/lib/shippingPerformanceScopeFilters'

export interface ShippingPerfFilterSelections {
  selectedSources: string[]
  selectedProducts: string[]
  selectedIncoterms: string[]
  selectedGroupPlants: string[]
  selectedSuppliers: string[]
  selectedSupplierGroups: string[]
  selectedPlanningStatuses: string[]
}

export interface ShippingPerfAvailableValues {
  sources: string[]
  products: string[]
  incoterms: string[]
  groupPlants: string[]
  suppliers: string[]
  supplierGroups: string[]
}

type Row = {
  source_type?: unknown
  product?: unknown
  incoterm?: unknown
  plant_site?: unknown
  group_plant?: unknown
  supplier?: unknown
  group_name?: unknown
  status?: unknown
}

const EMPTY: ShippingPerfFilterSelections = {
  selectedSources: [],
  selectedProducts: [],
  selectedIncoterms: [],
  selectedGroupPlants: [],
  selectedSuppliers: [],
  selectedSupplierGroups: [],
  selectedPlanningStatuses: [],
}

function rowsPassing<T extends Row>(rows: T[], sel: ShippingPerfFilterSelections): T[] {
  const scoped = applyShippingPerfSourceProductFilter(
    rows as never[],
    sel.selectedSources,
    sel.selectedProducts,
  ) as unknown as T[]
  return scoped.filter((row) =>
    rowMatchesToolbarMultiFilters(row, {
      selectedIncoterms: sel.selectedIncoterms,
      selectedGroupPlants: sel.selectedGroupPlants,
      selectedSuppliers: sel.selectedSuppliers,
      selectedGroups: sel.selectedSupplierGroups,
      selectedPlanningStatuses: sel.selectedPlanningStatuses,
    }),
  )
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * `rows` should be the date-scoped set - everything the page would show with no toolbar filter at
 * all. Narrowing from an already-filtered set would compound the filters twice.
 */
export function shippingPerfAvailableValues<T extends Row>(
  rows: T[],
  selections: ShippingPerfFilterSelections,
): ShippingPerfAvailableValues {
  const without = (key: keyof ShippingPerfFilterSelections): T[] =>
    rowsPassing(rows, { ...EMPTY, ...selections, [key]: [] })

  return {
    sources: distinct(
      without('selectedSources').map((r) => normalizeScopeGroupKey(r.source_type)),
    ),
    products: distinct(without('selectedProducts').map((r) => normalizeScopeGroupKey(r.product))),
    incoterms: distinct(without('selectedIncoterms').map((r) => normalizeScopeGroupKey(r.incoterm))),
    groupPlants: distinct(
      without('selectedGroupPlants').map((r) => normalizeScopeGroupKey(r.plant_site)),
    ),
    suppliers: distinct(
      without('selectedSuppliers').flatMap((r) => (r.supplier ? scopeGroupKeyParts(r.supplier) : [])),
    ),
    supplierGroups: distinct(
      without('selectedSupplierGroups').flatMap((r) =>
        r.group_name ? scopeGroupKeyParts(r.group_name) : [],
      ),
    ),
  }
}
