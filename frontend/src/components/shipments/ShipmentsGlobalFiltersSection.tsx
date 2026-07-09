'use client'

import { Search, X } from 'lucide-react'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  SHIPMENT_PAGE_PIPELINE_CARDS,
  type ShipmentPagePipelineStage,
} from '@/lib/shipmentPagePipeline'
import type { ShipmentsPipelineStageFilter } from '@/lib/shipmentsPageFilterState'

export interface ShipmentsGlobalFiltersSectionProps {
  searchDraft: string
  onSearchDraftChange: (value: string) => void
  onSearchApply: () => void
  pipelineStage: ShipmentsPipelineStageFilter
  onPipelineStageChange: (stage: ShipmentsPipelineStageFilter) => void
  lateIndicatorFilter: string
  onLateIndicatorChange: (value: string) => void
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
}

export function ShipmentsGlobalFiltersSection({
  searchDraft,
  onSearchDraftChange,
  onSearchApply,
  pipelineStage,
  onPipelineStageChange,
  lateIndicatorFilter,
  onLateIndicatorChange,
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
}: ShipmentsGlobalFiltersSectionProps) {
  return (
    <Card aria-label="Global filters">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Global Filters</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
              <Input
                placeholder="Search by Contract Ext No, Contract No, PO No, STO No, or Vessel Name..."
                value={searchDraft}
                onChange={(e) => onSearchDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSearchApply()
                  }
                }}
                className="pl-10"
              />
            </div>
            <select
              value={pipelineStage}
              onChange={(e) =>
                onPipelineStageChange(e.target.value as ShipmentsPipelineStageFilter)
              }
              className="rounded-lg border px-4 py-2"
              aria-label="Pipeline status filter"
            >
              <option value="ALL">All Status</option>
              {SHIPMENT_PAGE_PIPELINE_CARDS.map((card) => (
                <option key={card.status} value={card.status}>
                  {card.label}
                </option>
              ))}
            </select>
            <select
              value={lateIndicatorFilter}
              onChange={(e) => onLateIndicatorChange(e.target.value)}
              className="rounded-lg border px-4 py-2"
              aria-label="Late indicator filter"
            >
              <option value="ALL">All Late Indicator</option>
              <option value="ON_TIME">On Time</option>
              <option value="LATE">Late</option>
              <option value="NA">N/A</option>
            </select>
          </div>

          <PerformanceScopeFilters
            hideGroupPlantFilter={false}
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
            selectedGroupPlants={selectedGroupPlants}
            onGroupPlantsChange={onGroupPlantsChange}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={onDateFromChange}
            onDateToChange={onDateToChange}
            showDateRange={false}
            incotermEmptyMessage="Loading incoterms..."
            productEmptyMessage="Loading products..."
            supplierEmptyMessage="Loading suppliers..."
            groupPlantPlaceholder="Select group plant(s)"
            groupPlantEmptyMessage="No group plants"
          />

          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Contract Date:</label>
              <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={onDateFromChange} className="w-40" />
              <span className="text-gray-500">to</span>
              <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={onDateToChange} className="w-40" />
              {hasActiveFilters ? (
                <Button
                  type="button"
                  onClick={onClearFilters}
                  variant="ghost"
                  size="sm"
                  className="text-gray-500"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
