'use client'

import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { Input } from '@/components/ui/input'
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  selectionChips,
} from '@/components/shared/ListFilterPanel'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'

export interface MasterVesselFilterOptions {
  owners: string[]
  vesselTypes: string[]
  lambungTypes: string[]
  terms: string[]
}

export interface MasterVesselGlobalFiltersSectionProps {
  searchDraft: string
  searchTerm: string
  onSearchDraftChange: (value: string) => void
  onSearchApply: () => void
  onSearchClear: () => void
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
const TERMS_FILTER_OPTIONS = ['T/C', 'V/C', 'CIF', '(Blank)'] as const

export function MasterVesselGlobalFiltersSection({
  searchDraft,
  searchTerm,
  onSearchDraftChange,
  onSearchApply,
  onSearchClear,
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
  const termOptions = [
    ...TERMS_FILTER_OPTIONS,
    ...filterOptions.terms.filter((t) => t !== 'T/C' && t !== 'V/C' && t !== 'CIF'),
  ]

  return (
    <ListFilterPanel
      onReset={onClearFilters}
      showReset={hasActiveFilters || searchDraft.trim().length > 0}
      chips={[
        ...(searchTerm.trim()
          ? [{ id: 'search', label: `Search: ${searchTerm.trim()}`, onRemove: onSearchClear }]
          : []),
        ...selectionChips('Owner', selectedOwners, onOwnersChange),
        ...selectionChips('Vessel type', selectedVesselTypes, onVesselTypesChange),
        ...selectionChips('Heating', selectedHeating, onHeatingChange),
        ...selectionChips('Lambung type', selectedLambungTypes, onLambungTypesChange),
        ...selectionChips('Term', selectedTerms, onTermsChange),
      ]}
    >
      <div className="flex flex-nowrap items-end gap-2 overflow-x-auto px-0.5 pb-1.5 pt-0.5">
        <div className="min-w-[12rem] flex-[1.4]">
          <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
          <div className="relative">
            <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Vessel Code or Name"
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
        <SearchableMultiSelect
          className="min-w-[7.5rem] flex-1"
          labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
          label="Owner"
          options={filterOptions.owners}
          selected={selectedOwners}
          onChange={onOwnersChange}
          placeholder="All"
          emptyMessage="No owners"
          uppercaseOptionLabels
        />
        <SearchableMultiSelect
          className="min-w-[7.5rem] flex-1"
          labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
          label="Vessel Type"
          options={filterOptions.vesselTypes}
          selected={selectedVesselTypes}
          onChange={onVesselTypesChange}
          placeholder="All"
          emptyMessage="No types"
        />
        <SearchableMultiSelect
          className="min-w-[7.5rem] flex-1"
          labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
          label="Heating"
          options={[...HEATING_FILTER_OPTIONS]}
          selected={selectedHeating}
          onChange={onHeatingChange}
          placeholder="All"
          emptyMessage="No options"
        />
        <SearchableMultiSelect
          className="min-w-[7.5rem] flex-1"
          labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
          label="Lambung Type"
          options={filterOptions.lambungTypes}
          selected={selectedLambungTypes}
          onChange={onLambungTypesChange}
          placeholder="All"
          emptyMessage="No lambung types"
        />
        <SearchableMultiSelect
          className="min-w-[7.5rem] flex-1"
          labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
          label="Term / Charter"
          options={termOptions}
          selected={selectedTerms}
          onChange={onTermsChange}
          placeholder="All"
          emptyMessage="No terms"
        />
      </div>
    </ListFilterPanel>
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
