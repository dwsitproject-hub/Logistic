'use client'

import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { FilterSingleSelect } from '@/components/FilterSingleSelect'
import { Input } from '@/components/ui/input'
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  selectionChips,
  LIST_FILTER_FIELDS_ROW_CLASS,
} from '@/components/shared/ListFilterPanel'
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
  dateFrom: string
  dateTo: string
  onDateFromChange: (iso: string) => void
  onDateToChange: (iso: string) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  dateRangeActive?: boolean
  onResetDateRange?: () => void
}

const LATE_INDICATOR_OPTIONS = [
  { value: 'ALL', label: 'All Late Indicator' },
  { value: 'ON_TIME', label: 'On Time' },
  { value: 'LATE', label: 'Late' },
  { value: 'NA', label: 'N/A' },
] as const

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
  availableGroupPlants,
  selectedGroupPlants,
  onGroupPlantsChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  hasActiveFilters,
  onClearFilters,
  dateRangeActive = false,
  onResetDateRange,
}: ShipmentsGlobalFiltersSectionProps) {
  const globalStatusValue = mapShipmentPipelineStageToGlobalStatusBucket(pipelineStage)

  const statusLabel = SHIPMENT_GLOBAL_STATUS_OPTIONS.find((option) => option.value === globalStatusValue)?.label
  const lateLabel = LATE_INDICATOR_OPTIONS.find((option) => option.value === lateIndicatorFilter)?.label
  const charterLabel = SHIPMENT_CHARTER_TYPE_FILTER_OPTIONS.find((option) => option.value === charterTypeFilter)?.label
  const sourceLabel = LOGISTICS_SOURCE_FILTER_OPTIONS.find((option) => option.value === sourceTypeFilter)?.label

  return (
    <ListFilterPanel
      onReset={onClearFilters}
      showReset={hasActiveFilters}
      chips={[
        ...(globalStatusValue !== 'ALL' && statusLabel
          ? [{ id: 'status', label: `Status: ${statusLabel}`, onRemove: () => onPipelineStageChange('ALL') }]
          : []),
        ...(lateIndicatorFilter !== 'ALL' && lateLabel
          ? [{ id: 'late', label: `Late: ${lateLabel}`, onRemove: () => onLateIndicatorChange('ALL') }]
          : []),
        ...(charterTypeFilter !== 'ALL' && charterLabel
          ? [{ id: 'charter', label: `Charter: ${charterLabel}`, onRemove: () => onCharterTypeChange('ALL') }]
          : []),
        ...(sourceTypeFilter !== 'ALL' && sourceLabel
          ? [{ id: 'source', label: `Source: ${sourceLabel}`, onRemove: () => onSourceTypeChange('ALL') }]
          : []),
        ...selectionChips('Incoterm', selectedIncoterms, onIncotermsChange),
        ...selectionChips('Product', selectedProducts, onProductsChange),
        ...selectionChips('Supplier', selectedSuppliers, onSuppliersChange),
        ...selectionChips('Region/Plant', selectedGroupPlants, onGroupPlantsChange),
        ...(dateRangeActive && onResetDateRange
          ? [{
              id: 'contract-date',
              label: `Contract date: ${dateFrom || '…'} to ${dateTo || '…'}`,
              onRemove: onResetDateRange,
            }]
          : []),
      ]}
    >
      <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
        <div className="min-w-[12rem] flex-[1.4]">
          <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
          <div className="relative">
            <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Contract, PO, STO, vessel"
              value={searchDraft}
              onChange={(e) => onSearchDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSearchApply()
                }
              }}
              className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
            />
          </div>
        </div>
        <div className="min-w-[7.5rem] flex-1">
          <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Status</label>
          <FilterSingleSelect
            value={globalStatusValue}
            onChange={(value) => onPipelineStageChange(value as ShipmentsPipelineStageFilter)}
            options={SHIPMENT_GLOBAL_STATUS_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === 'ALL' ? 'All' : option.label,
            }))}
            ariaLabel="Pipeline status filter"
            className="w-full min-w-0"
          />
        </div>
        <div className="min-w-[7.5rem] flex-1">
          <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Late Indicator</label>
          <FilterSingleSelect
            value={lateIndicatorFilter}
            onChange={onLateIndicatorChange}
            options={LATE_INDICATOR_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === 'ALL' ? 'All' : option.label,
            }))}
            ariaLabel="Late indicator filter"
            className="w-full min-w-0"
          />
        </div>
        <div className="min-w-[7.5rem] flex-1">
          <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Charter Type</label>
          <FilterSingleSelect
            value={charterTypeFilter}
            onChange={onCharterTypeChange}
            options={SHIPMENT_CHARTER_TYPE_FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === 'ALL' ? 'All' : option.label,
            }))}
            ariaLabel="Charter type filter"
            className="w-full min-w-0"
          />
        </div>
        <div className="min-w-[7.5rem] flex-1">
          <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Source</label>
          <FilterSingleSelect
            value={sourceTypeFilter}
            onChange={onSourceTypeChange}
            options={LOGISTICS_SOURCE_FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === 'ALL' ? 'All' : option.label,
            }))}
            ariaLabel="Source filter"
            className="w-full min-w-0"
          />
        </div>
        <PerformanceScopeFilters
          inlineRow
          microLabels
          hideGroupPlantFilter
          incotermOptions={availableIncoterms}
          selectedIncoterms={selectedIncoterms}
          onIncotermsChange={onIncotermsChange}
          showProductFilter
          productOptions={availableProducts}
          selectedProducts={selectedProducts}
          onProductsChange={onProductsChange}
          showSupplierFilter
          supplierOptions={availableSuppliers}
          selectedSuppliers={selectedSuppliers}
          onSuppliersChange={onSuppliersChange}
          groupPlantOptions={availableGroupPlants}
          uppercaseGroupPlantLabels
          selectedGroupPlants={selectedGroupPlants}
          onGroupPlantsChange={onGroupPlantsChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
          showDateRange={false}
          incotermPlaceholder="All"
          productPlaceholder="All"
          supplierPlaceholder="All"
          incotermEmptyMessage="Loading incoterms..."
          productEmptyMessage="Loading products..."
          supplierEmptyMessage="Loading suppliers..."
          groupPlantPlaceholder="All"
          groupPlantEmptyMessage="No region/plant values"
        />
      </div>
    </ListFilterPanel>
  )
}
