'use client'

import { Search, X } from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export interface MasterVesselFilterOptions {
  owners: string[]
  vesselTypes: string[]
  lambungTypes: string[]
  terms: string[]
}

export interface MasterVesselGlobalFiltersSectionProps {
  searchDraft: string
  onSearchDraftChange: (value: string) => void
  onSearchApply: () => void
  filterOptions: MasterVesselFilterOptions
  selectedOwners: string[]
  onOwnersChange: (values: string[]) => void
  selectedVesselTypes: string[]
  onVesselTypesChange: (values: string[]) => void
  selectedHeating: string[]
  onHeatingChange: (values: string[]) => void
  selectedLambungTypes: string[]
  onLambungTypesChange: (values: string[]) => void
  selectedTerms: string[]
  onTermsChange: (values: string[]) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
}

const HEATING_FILTER_OPTIONS = ['Yes', 'No', '(Blank)'] as const
const TERMS_FILTER_OPTIONS = ['V/C', 'T/C', '(Blank)'] as const

export function MasterVesselGlobalFiltersSection({
  searchDraft,
  onSearchDraftChange,
  onSearchApply,
  filterOptions,
  selectedOwners,
  onOwnersChange,
  selectedVesselTypes,
  onVesselTypesChange,
  selectedHeating,
  onHeatingChange,
  selectedLambungTypes,
  onLambungTypesChange,
  selectedTerms,
  onTermsChange,
  hasActiveFilters,
  onClearFilters,
}: MasterVesselGlobalFiltersSectionProps) {
  return (
    <Card aria-label="Global filters">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Global Filters</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
            <Input
              placeholder="Search by Vessel Code or Name..."
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
          {hasActiveFilters ? (
            <Button
              type="button"
              onClick={onClearFilters}
              variant="ghost"
              size="sm"
              className="text-gray-500"
            >
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <SearchableMultiSelect
            label="Owner"
            options={filterOptions.owners}
            selected={selectedOwners}
            onChange={onOwnersChange}
            placeholder="All owners"
            emptyMessage="No owners"
            uppercaseOptionLabels
          />
          <SearchableMultiSelect
            label="Vessel Type"
            options={filterOptions.vesselTypes}
            selected={selectedVesselTypes}
            onChange={onVesselTypesChange}
            placeholder="All types"
            emptyMessage="No types"
          />
          <SearchableMultiSelect
            label="Heating"
            options={[...HEATING_FILTER_OPTIONS]}
            selected={selectedHeating}
            onChange={onHeatingChange}
            placeholder="All heating"
            emptyMessage="No options"
          />
          <SearchableMultiSelect
            label="Lambung Type"
            options={filterOptions.lambungTypes}
            selected={selectedLambungTypes}
            onChange={onLambungTypesChange}
            placeholder="All lambung types"
            emptyMessage="No lambung types"
          />
          <SearchableMultiSelect
            label="Term / Charter"
            options={[...TERMS_FILTER_OPTIONS, ...filterOptions.terms.filter((t) => t !== 'V/C' && t !== 'T/C')]}
            selected={selectedTerms}
            onChange={onTermsChange}
            placeholder="All terms"
            emptyMessage="No terms"
          />
        </div>
      </CardContent>
    </Card>
  )
}

/** Map UI heating labels to API query tokens. */
export function heatingFilterToApi(values: string[]): string[] {
  return values.map((v) => {
    if (v === '(Blank)') return 'blank'
    if (v === 'Yes') return 'yes'
    if (v === 'No') return 'no'
    return v.toLowerCase()
  })
}

/** Map UI terms labels to API query tokens. */
export function termsFilterToApi(values: string[]): string[] {
  return values.map((v) => (v === '(Blank)' ? 'blank' : v))
}
