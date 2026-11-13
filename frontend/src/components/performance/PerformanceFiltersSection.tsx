'use client'

import { Anchor, CircleDot, Database, Factory, Layers, Package } from 'lucide-react'
import { ListFilterBar, ListFilterField } from '@/components/shared/ListFilterBar'
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
 * The filter bar of Shipping Performance and Contract Performance: no search, so Product and Incoterm sit in the row from `lg` up and the rest
 * in More filters (everything in it below `lg`). The same fields as the other list pages.
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
  const productField = (wrapper: string) => (
    <div className={wrapper}>
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
    </div>
  )
  const incotermField = (wrapper: string) => (
    <div className={wrapper}>
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
    </div>
  )

  const wideOn = (products.selected.length > 0 ? 1 : 0) + (incoterms.selected.length > 0 ? 1 : 0)
  const moreOn =
    (sources.selected.length > 0 ? 1 : 0) +
    (supplierGroups.selected.length > 0 ? 1 : 0) +
    (suppliers.selected.length > 0 ? 1 : 0) +
    (planningStatuses.length > 0 ? 1 : 0)

  return (
    <ListFilterBar
      wide={
        <>
          {productField('w-48 shrink-0')}
          {incotermField('w-44 shrink-0')}
        </>
      }
      narrowOnly={
        <>
          <ListFilterField label="Product">{productField('w-full')}</ListFilterField>
          <ListFilterField label="Incoterm">{incotermField('w-full')}</ListFilterField>
        </>
      }
      more={
        <>
          <ListFilterField label="Source">
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
          </ListFilterField>
          <ListFilterField label="Group supplier">
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
          </ListFilterField>
          <ListFilterField label="Supplier">
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
          </ListFilterField>
          <ListFilterField label="Planning status">
            <SingleValueField
              label="Planning Status"
              options={PLANNING_OPTIONS}
              value={planningStatuses[0] ?? 'ALL'}
              onChange={(value) => onPlanningStatusesChange(value === 'ALL' ? [] : [value])}
              icon={<CircleDot className="h-4 w-4" />}
            />
          </ListFilterField>
        </>
      }
      activeMore={moreOn}
      activeAll={moreOn + wideOn}
      anyActive={anyActive}
      onReset={onReset}
    />
  )
}
