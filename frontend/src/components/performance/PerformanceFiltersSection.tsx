'use client'

import { Anchor, CircleDot, Database, Factory, Layers, Package } from 'lucide-react'
import { FitFilterBar } from '@/components/shared/FitFilterBar'
import { ListFilterField } from '@/components/shared/ListFilterBar'
import { MultiValueField, SingleValueField } from '@/components/shared/ListFilterFields'
import { PLANNING_STATUS_OPTIONS } from '@/lib/planningStatus'

export interface PerformanceMultiFilter {
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}

interface Props {
  products: PerformanceMultiFilter
  incoterms: PerformanceMultiFilter
  sources: PerformanceMultiFilter
  supplierGroups: PerformanceMultiFilter
  suppliers: PerformanceMultiFilter
  /** Planning Status takes one value; an empty list is all. */
  planningStatuses: string[]
  onPlanningStatusesChange: (values: string[]) => void
  /** True when anything (the header fields included) narrows the page, so Reset shows. */
  anyActive: boolean
  onReset: () => void
}

const PLANNING_OPTIONS = [
  { value: 'ALL', label: 'All planning' },
  ...PLANNING_STATUS_OPTIONS.map((value) => ({ value, label: value })),
]

/**
 * The filter bar of Shipping Performance and Contract Performance: no search, so the filters sit on the left in this order (Product, Incoterm, Source,
 * Group Supplier, Supplier, Planning Status) and as many as really fit the width are shown; the rest are in More filters.
 */
export function PerformanceFiltersSection({
  products,
  incoterms,
  sources,
  supplierGroups,
  suppliers,
  planningStatuses,
  onPlanningStatusesChange,
  anyActive,
  onReset,
}: Props) {
  const productField = (
    <MultiValueField
      label="Product"
      options={products.options}
      selected={products.selected}
      onChange={products.onChange}
      placeholder="All products"
      emptyMessage="No products"
      icon={<Package className="h-4 w-4" />}
      uppercase
    />
  )
  const incotermField = (
    <MultiValueField
      label="Incoterm"
      options={incoterms.options}
      selected={incoterms.selected}
      onChange={incoterms.onChange}
      placeholder="All incoterms"
      emptyMessage="No incoterms"
      icon={<Anchor className="h-4 w-4" />}
      uppercase
    />
  )
  const sourceField = (
    <MultiValueField
      label="Source"
      options={sources.options}
      selected={sources.selected}
      onChange={sources.onChange}
      placeholder="All sources"
      emptyMessage="No sources"
      icon={<Database className="h-4 w-4" />}
      uppercase
    />
  )
  const groupField = (
    <MultiValueField
      label="Group Supplier"
      options={supplierGroups.options}
      selected={supplierGroups.selected}
      onChange={supplierGroups.onChange}
      placeholder="All supplier groups"
      emptyMessage="No supplier groups"
      icon={<Layers className="h-4 w-4" />}
      uppercase
    />
  )
  const supplierField = (
    <MultiValueField
      label="Supplier"
      options={suppliers.options}
      selected={suppliers.selected}
      onChange={suppliers.onChange}
      placeholder="All suppliers"
      emptyMessage="No suppliers"
      icon={<Factory className="h-4 w-4" />}
      uppercase
    />
  )
  const planningField = (
    <SingleValueField
      label="Planning Status"
      options={PLANNING_OPTIONS}
      value={planningStatuses[0] ?? 'ALL'}
      onChange={(value) => onPlanningStatusesChange(value === 'ALL' ? [] : [value])}
      icon={<CircleDot className="h-4 w-4" />}
    />
  )

  return (
    <FitFilterBar
      items={[
        { key: 'product', width: 10, row: productField, panel: <ListFilterField label="Product">{productField}</ListFilterField>, active: products.selected.length > 0 },
        { key: 'incoterm', width: 9.5, row: incotermField, panel: <ListFilterField label="Incoterm">{incotermField}</ListFilterField>, active: incoterms.selected.length > 0 },
        { key: 'source', width: 9, row: sourceField, panel: <ListFilterField label="Source">{sourceField}</ListFilterField>, active: sources.selected.length > 0 },
        { key: 'group', width: 11, row: groupField, panel: <ListFilterField label="Group supplier">{groupField}</ListFilterField>, active: supplierGroups.selected.length > 0 },
        { key: 'supplier', width: 11, row: supplierField, panel: <ListFilterField label="Supplier">{supplierField}</ListFilterField>, active: suppliers.selected.length > 0 },
        { key: 'planning', width: 10, row: planningField, panel: <ListFilterField label="Planning status">{planningField}</ListFilterField>, active: planningStatuses.length > 0 },
      ]}
      anyActive={anyActive}
      onReset={onReset}
    />
  )
}
