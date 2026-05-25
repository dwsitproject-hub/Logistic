'use client'

import { Button } from '@/components/ui/button'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { X } from 'lucide-react'

export type PerformanceStatusFilter = 'All' | 'Open' | 'Closed'

export type PerformanceScopeFiltersProps = {
  /** When true, hides the plant / group plant dropdown (e.g. Shipping Performance table toolbar). */
  hidePlantFilter?: boolean
  plantLabel?: string
  incotermOptions: string[]
  selectedIncoterms: string[]
  onIncotermsChange: (values: string[]) => void
  plantOptions: string[]
  selectedPlantSites: string[]
  onPlantSitesChange: (values: string[]) => void
  dateFrom: string
  dateTo: string
  onDateFromChange: (iso: string) => void
  onDateToChange: (iso: string) => void
  showIncoterm?: boolean
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
  plantPlaceholder?: string
  plantEmptyMessage?: string
}

export function PerformanceScopeFilters({
  hidePlantFilter = false,
  plantLabel = 'Plant/Site',
  incotermOptions,
  selectedIncoterms,
  onIncotermsChange,
  plantOptions,
  selectedPlantSites,
  onPlantSitesChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  showIncoterm = true,
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
  plantPlaceholder = 'Select plant/site(s)',
  plantEmptyMessage = 'No plants',
}: PerformanceScopeFiltersProps) {
  const showPlant = !hidePlantFilter
  const selectorCount =
    (showIncoterm ? 1 : 0) +
    (showPlant ? 1 : 0) +
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
    selectedPlantSites.length > 0 ||
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
          {showPlant && (
            <SearchableMultiSelect
              label={plantLabel}
              options={plantOptions}
              selected={selectedPlantSites}
              onChange={onPlantSitesChange}
              placeholder={plantPlaceholder}
              emptyMessage={plantEmptyMessage}
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
