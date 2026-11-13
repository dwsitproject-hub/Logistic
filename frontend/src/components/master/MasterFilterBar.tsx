'use client'

import type { ReactNode } from 'react'
import { Cloud, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MASTER_DHM_FILTERS, type MasterDhmFilter } from '@/lib/masterDirectory'

interface Props {
  search: string
  onSearch: (value: string) => void
  placeholder: string
  ariaLabel: string
  /** The DHM status filter; leave both out for a master that is not sent to DHM. */
  dhm?: MasterDhmFilter
  onDhm?: (value: MasterDhmFilter) => void
  /** How many rows each status holds (all = every row), shown after the name like the role filter of Users. */
  dhmCounts?: Partial<Record<MasterDhmFilter, number>>
  /** Page-specific filters (a select), placed between the search and the DHM filter. */
  children?: ReactNode
  /** True when a page-specific filter is on, so "Clear filters" shows. */
  extraActive?: boolean
  onClear: () => void
  /** Icon buttons at the right end of the row (Sync, Add), like the action icons of a table row. */
  actions?: ReactNode
}

const optionLabel = (id: MasterDhmFilter, label: string, counts?: Props['dhmCounts']) => {
  const n = counts?.[id]
  const name = id === 'all' ? 'All DHM status' : label
  return n == null ? name : `${name} (${n.toLocaleString('en-US')})`
}

/** One row: search, the page's own filter, the DHM status as a field (All / Synced / Not synced / Failed) and the icon buttons. The Users filter bar, for a Master list. */
export function MasterFilterBar({ search, onSearch, placeholder, ariaLabel, dhm, onDhm, dhmCounts, children, extraActive = false, onClear, actions }: Props) {
  const anyOn = search.trim() !== '' || extraActive || (dhm != null && dhm !== 'all')
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} className="h-9 pl-9" aria-label={ariaLabel} />
      </div>

      {children}

      {dhm != null && onDhm ? (
        <Select value={dhm} onValueChange={(value) => onDhm(value as MasterDhmFilter)}>
          <SelectTrigger className="h-9 w-[190px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by DHM status">
            <Cloud className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MASTER_DHM_FILTERS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {optionLabel(option.id, option.label, dhmCounts)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
