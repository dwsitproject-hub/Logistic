'use client'

import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { MASTER_DHM_FILTERS, type MasterDhmFilter } from '@/lib/masterDirectory'

interface Props {
  search: string
  onSearch: (value: string) => void
  placeholder: string
  ariaLabel: string
  /** The DHM status filter; leave both out for a master that is not sent to DHM. */
  dhm?: MasterDhmFilter
  onDhm?: (value: MasterDhmFilter) => void
  /** Page-specific filters (a select), placed between the search and the status switch. */
  children?: ReactNode
  /** True when a page-specific filter is on, so "Clear filters" shows. */
  extraActive?: boolean
  onClear: () => void
}

/** Search, the page's own filter, and the DHM status switch (All / Synced / Not synced / Failed) in one row: the Users filter bar, for a Master list. */
export function MasterFilterBar({ search, onSearch, placeholder, ariaLabel, dhm, onDhm, children, extraActive = false, onClear }: Props) {
  const anyOn = search.trim() !== '' || extraActive || (dhm != null && dhm !== 'all')
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} className="h-9 pl-9" aria-label={ariaLabel} />
      </div>

      {children}

      {dhm != null && onDhm ? (
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs" role="group" aria-label="Filter by DHM status">
          {MASTER_DHM_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onDhm(option.id)}
              aria-pressed={dhm === option.id}
              className={dhm === option.id ? 'bg-gray-100 px-3 py-2 font-medium text-gray-900' : 'px-3 py-2 text-gray-600 hover:bg-gray-50'}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {anyOn ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear filters
        </button>
      ) : null}
    </div>
  )
}
