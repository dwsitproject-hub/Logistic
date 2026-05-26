'use client'

import { Button } from '@/components/ui/button'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { X } from 'lucide-react'

export type PerformanceStatusFilter = 'All' | 'Open' | 'Closed'

export type PerformanceScopeFiltersProps = {
  /** When true, hides the group plant dropdown (e.g. Shipping Performance table toolbar). */
  hideGroupPlantFilter?: boolean
  groupPlantLabel?: string
  incotermOptions: string[]
  selectedIncoterms: string[]
  onIncotermsChange: (values: string[]) => void
  groupPlantOptions: string[]
  selectedGroupPlants: string[]
  onGroupPlantsChange: (values: string[]) => void
  dateFrom: string
  dateTo: string
  onDateFromChange: (iso: string) => void
  onDateToChange: (iso: string) => void
  showIncoterm?: boolean
  showProductFilter?: boolean
  productOptions?: string[]
  selectedProducts?: string[]
  onProductsChange?: (values: string[]) => void
  productLabel?: string
  productPlaceholder?: string
  productEmptyMessage?: string
  showDateRange?: boolean
  showStatusFilter?: boolean
  statusFilter?: PerformanceStatusFilter
  onStatusFilterChange?: (value: PerformanceStatusFilter) => void
  showVesselFilter?: boolean
  vesselOptions?: string[]
  selectedVessels?: string[]
  onVesselsChange?: (values: string[]) => void
  vesselPlaceholder?: string
  vesselEmptyMessage?: string
  showClearButton?: boolean
  onClear?: () => void
  incotermPlaceholder?: string
  incotermEmptyMessage?: string
  groupPlantPlaceholder?: string
  groupPlantEmptyMessage?: string
}

export function PerformanceScopeFilters({
  hideGroupPlantFilter = false,
  groupPlantLabel = 'Group Plant',
  incotermOptions,
  selectedIncoterms,
  onIncotermsChange,
  groupPlantOptions,
  selectedGroupPlants,
  onGroupPlantsChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  showIncoterm = true,
  showProductFilter = false,
  productOptions = [],
  selectedProducts = [],
  onProductsChange,
  productLabel = 'Product',
  productPlaceholder = 'Select product(s)',
  productEmptyMessage = 'No products',
  showDateRange = true,
  showStatusFilter = false,
  statusFilter = 'All',
  onStatusFilterChange,
  showVesselFilter = false,
  vesselOptions = [],
  selectedVessels = [],
  onVesselsChange,
  vesselPlaceholder = 'Select vessel(s)',
  vesselEmptyMessage = 'No vessels',
  showClearButton = false,
  onClear,
  incotermPlaceholder = 'Select incoterm(s)',
  incotermEmptyMessage = 'No incoterms',
  groupPlantPlaceholder = 'Select group plant(s)',
  groupPlantEmptyMessage = 'No group plants',
}: PerformanceScopeFiltersProps) {
  const showGroupPlant = !hideGroupPlantFilter
  const selectorCount =
    (showIncoterm ? 1 : 0) +
    (showProductFilter ? 1 : 0) +
    (showGroupPlant ? 1 : 0) +
    (showVesselFilter ? 1 : 0) +
    (showStatusFilter ? 1 : 0)
  const gridClass =
    selectorCount <= 1
      ? 'grid grid-cols-1 gap-4'
      : selectorCount === 2
        ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
        : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'

  const hasClearableSelection =
    selectedIncoterms.length > 0 ||
    selectedProducts.length > 0 ||
    selectedGroupPlants.length > 0 ||
    selectedVessels.length > 0 ||
    (showStatusFilter && statusFilter !== 'All') ||
    Boolean(dateFrom) ||
    Boolean(dateTo)

  return (
    <div className="space-y-4">
      {selectorCount > 0 && (
        <div className={gridClass}>
          {showIncoterm && (
            <SearchableMultiSelect
              label="Incoterm"
              options={incotermOptions}
              selected={selectedIncoterms}
              onChange={onIncotermsChange}
              placeholder={incotermPlaceholder}
              emptyMessage={incotermEmptyMessage}
            />
          )}
          {showProductFilter && onProductsChange && (
            <SearchableMultiSelect
              label={productLabel}
              options={productOptions}
              selected={selectedProducts}
              onChange={onProductsChange}
              placeholder={productPlaceholder}
              emptyMessage={productEmptyMessage}
            />
          )}
          {showGroupPlant && (
            <SearchableMultiSelect
              label={groupPlantLabel}
              options={groupPlantOptions}
              selected={selectedGroupPlants}
              onChange={onGroupPlantsChange}
              placeholder={groupPlantPlaceholder}
              emptyMessage={groupPlantEmptyMessage}
            />
          )}
          {showVesselFilter && onVesselsChange && (
            <SearchableMultiSelect
              label="Vessel"
              options={vesselOptions}
              selected={selectedVessels}
              onChange={onVesselsChange}
              placeholder={vesselPlaceholder}
              emptyMessage={vesselEmptyMessage}
            />
          )}
          {showStatusFilter && onStatusFilterChange && (
            <div className="space-y-1.5">
              <label htmlFor="performance-status-filter" className="text-sm font-medium text-gray-700">
                Status
              </label>
              <select
                id="performance-status-filter"
                value={statusFilter}
                onChange={(e) => onStatusFilterChange(e.target.value as PerformanceStatusFilter)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              >
                <option value="All">All</option>
                <option value="Open">Open</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          )}
        </div>
      )}

      {showDateRange && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Contract Date:</label>
            <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={onDateFromChange} className="w-40" />
            <span className="text-gray-500">to</span>
            <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={onDateToChange} className="w-40" />
          </div>
          {showClearButton && hasClearableSelection && onClear && (
            <Button type="button" onClick={onClear} variant="ghost" size="sm" className="text-gray-500">
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
