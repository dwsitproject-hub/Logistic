'use client'

import type { ReactNode } from 'react'
import { Anchor, CircleDot, Database, Factory, Package, Ship, Timer } from 'lucide-react'
import { ListFilterBar, ListFilterField } from '@/components/shared/ListFilterBar'
import { MultiValueField, SingleValueField } from '@/components/shared/ListFilterFields'
import { filterIncotermOptions } from '@/lib/globalScopeFilters'
import type { ShipmentsPipelineStageFilter } from '@/lib/shipmentsPageFilterState'
import {
  mapShipmentPipelineStageToGlobalStatusBucket,
  SHIPMENT_GLOBAL_STATUS_OPTIONS,
} from '@/lib/shipmentsPageFilterState'
import { SHIPMENT_CHARTER_TYPE_FILTER_OPTIONS } from '@/lib/shipmentCharterTypeFilter'
import { LOGISTICS_SOURCE_FILTER_OPTIONS } from '@/lib/logisticsSourceFilter'

export interface ShipmentsGlobalFiltersSectionProps {
  searchDraft: string
  onSearchDraftChange: (value: string) => void
  onSearchApply: () => void
  pipelineStage: ShipmentsPipelineStageFilter
  onPipelineStageChange: (stage: ShipmentsPipelineStageFilter) => void
  lateIndicatorFilter: string
  onLateIndicatorChange: (value: string) => void
  charterTypeFilter: string
  onCharterTypeChange: (value: string) => void
  sourceTypeFilter: string
  onSourceTypeChange: (value: string) => void
  availableIncoterms: string[]
  selectedIncoterms: string[]
  onIncotermsChange: (values: string[]) => void
  availableProducts: string[]
  selectedProducts: string[]
  onProductsChange: (values: string[]) => void
  availableSuppliers: string[]
  selectedSuppliers: string[]
  onSuppliersChange: (values: string[]) => void
  availableGroupPlants: string[]
  selectedGroupPlants: string[]
  onGroupPlantsChange: (values: string[]) => void
  selectedDischargePorts: string[]
  onDischargePortsChange: (values: string[]) => void
  dateFrom: string
  dateTo: string
  onDateFromChange: (iso: string) => void
  onDateToChange: (iso: string) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  dateRangeActive?: boolean
  onResetDateRange?: () => void
  /** Icon buttons at the right end of the filter row. */
  actions?: ReactNode
}

const LATE_INDICATOR_OPTIONS = [
  { value: 'ALL', label: 'All Late Indicator' },
  { value: 'ON_TIME', label: 'On Time' },
  { value: 'LATE', label: 'Late' },
  { value: 'NA', label: 'N/A' },
] as const

/** The Shipments search and filters: one row (search, Status, Late Indicator, More filters, icon buttons), the rest in the More filters panel. */
export function ShipmentsGlobalFiltersSection({
  searchDraft,
  onSearchDraftChange,
  onSearchApply,
  pipelineStage,
  onPipelineStageChange,
  lateIndicatorFilter,
  onLateIndicatorChange,
  charterTypeFilter,
  onCharterTypeChange,
  sourceTypeFilter,
  onSourceTypeChange,
  availableIncoterms,
  selectedIncoterms,
  onIncotermsChange,
  availableProducts,
  selectedProducts,
  onProductsChange,
  availableSuppliers,
  selectedSuppliers,
  onSuppliersChange,
  hasActiveFilters,
  onClearFilters,
  actions,
}: ShipmentsGlobalFiltersSectionProps) {
  const globalStatusValue = mapShipmentPipelineStageToGlobalStatusBucket(pipelineStage)

  const statusField = (wrapperClass: string) => (
    <SingleValueField
      label="Status"
      options={SHIPMENT_GLOBAL_STATUS_OPTIONS}
      value={globalStatusValue}
      onChange={(value) => onPipelineStageChange(value as ShipmentsPipelineStageFilter)}
      icon={<CircleDot className="h-4 w-4" />}
      wrapperClass={wrapperClass}
    />
  )
  const lateField = (wrapperClass: string) => (
    <SingleValueField
      label="Late Indicator"
      options={LATE_INDICATOR_OPTIONS}
      value={lateIndicatorFilter}
      onChange={onLateIndicatorChange}
      icon={<Timer className="h-4 w-4" />}
      wrapperClass={wrapperClass}
    />
  )

  const wideOn = (globalStatusValue !== 'ALL' ? 1 : 0) + (lateIndicatorFilter !== 'ALL' ? 1 : 0)
  const moreOn =
    (charterTypeFilter !== 'ALL' ? 1 : 0) +
    (sourceTypeFilter !== 'ALL' ? 1 : 0) +
    (selectedIncoterms.length > 0 ? 1 : 0) +
    (selectedProducts.length > 0 ? 1 : 0) +
    (selectedSuppliers.length > 0 ? 1 : 0)

  return (
    <ListFilterBar
      search={searchDraft}
      onSearchChange={onSearchDraftChange}
      onSearchSubmit={onSearchApply}
      placeholder="Contract, PO, STO, Operation ID, vessel"
      wide={
        <>
          {statusField('w-40 shrink-0')}
          {lateField('w-44 shrink-0')}
        </>
      }
      narrowOnly={
        <>
          <ListFilterField label="Status">{statusField('w-full')}</ListFilterField>
          <ListFilterField label="Late indicator">{lateField('w-full')}</ListFilterField>
        </>
      }
      more={
        <>
          <ListFilterField label="Charter type">
            <SingleValueField
              label="Charter Type"
              options={SHIPMENT_CHARTER_TYPE_FILTER_OPTIONS}
              value={charterTypeFilter}
              onChange={onCharterTypeChange}
              icon={<Ship className="h-4 w-4" />}
            />
          </ListFilterField>
          <ListFilterField label="Source">
            <SingleValueField
              label="Source"
              options={LOGISTICS_SOURCE_FILTER_OPTIONS}
              value={sourceTypeFilter}
              onChange={onSourceTypeChange}
              icon={<Database className="h-4 w-4" />}
            />
          </ListFilterField>
          <ListFilterField label="Incoterm">
            <MultiValueField
              label="Incoterm"
              options={filterIncotermOptions(availableIncoterms)}
              selected={selectedIncoterms}
              onChange={onIncotermsChange}
              placeholder="All incoterms"
              emptyMessage="Loading incoterms..."
              icon={<Anchor className="h-4 w-4" />}
            />
          </ListFilterField>
          <ListFilterField label="Product">
            <MultiValueField
              label="Product"
              options={availableProducts}
              selected={selectedProducts}
              onChange={onProductsChange}
              placeholder="All products"
              emptyMessage="Loading products..."
              icon={<Package className="h-4 w-4" />}
            />
          </ListFilterField>
          <ListFilterField label="Supplier">
            <MultiValueField
              label="Supplier"
              options={availableSuppliers}
              selected={selectedSuppliers}
              onChange={onSuppliersChange}
              placeholder="All suppliers"
              emptyMessage="Loading suppliers..."
              icon={<Factory className="h-4 w-4" />}
            />
          </ListFilterField>
        </>
      }
      activeMore={moreOn}
      activeAll={moreOn + wideOn}
      anyActive={hasActiveFilters || searchDraft.trim().length > 0}
      onReset={onClearFilters}
      actions={actions}
    />
  )
}
