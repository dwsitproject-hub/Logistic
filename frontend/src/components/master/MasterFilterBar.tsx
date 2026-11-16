'use client'

import type { ReactNode } from 'react'
import { Cloud, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FitFilterBar } from '@/components/shared/FitFilterBar'
import { ListFilterField } from '@/components/shared/ListFilterBar'
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
  /** What the page-specific filter is called inside More filters, where it gets a label ("Site", "Company"). */
  extraLabel?: string
  /** The least width of the page-specific filter in the row, in rem (default 15.75, which holds the 250px selects the pages use). */
  extraWidthRem?: number
}

const optionLabel = (id: MasterDhmFilter, label: string, counts?: Props['dhmCounts']) => {
  const n = counts?.[id]
  const name = id === 'all' ? 'All DHM status' : label
  return n == null ? name : `${name} (${n.toLocaleString('en-US')})`
}

/** The search field of a Master list bar. */
export function MasterSearchInput({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (value: string) => void; placeholder: string; ariaLabel: string }) {
  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 pl-9" aria-label={ariaLabel} />
    </div>
  )
}

/** The DHM status field of a Master list bar (All / Synced / Not synced / Failed, with the counts). */
export function MasterDhmSelect({ value, onChange, counts }: { value: MasterDhmFilter; onChange: (value: MasterDhmFilter) => void; counts?: Props['dhmCounts'] }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as MasterDhmFilter)}>
      <SelectTrigger className="h-9 w-full gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by DHM status">
        <Cloud className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MASTER_DHM_FILTERS.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {optionLabel(option.id, option.label, counts)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * One measured row: search, the page's own filter, the DHM status as a field (All / Synced / Not synced / Failed) and the icon buttons; whatever does not fit the
 * width moves behind a More filters button, the page's own filter first, then the DHM status. The Users filter bar, for a Master list.
 */
export function MasterFilterBar({
  search,
  onSearch,
  placeholder,
  ariaLabel,
  dhm,
  onDhm,
  dhmCounts,
  children,
  extraActive = false,
  onClear,
  actions,
  extraLabel = 'Filter',
  extraWidthRem = 15.75,
}: Props) {
  const anyOn = search.trim() !== '' || extraActive || (dhm != null && dhm !== 'all')
  // the pages give their select a fixed width; inside the bar it fills the room the row gives it
  const extra = children ? <div className="[&_[role=combobox]]:!w-full">{children}</div> : null
  return (
    <FitFilterBar
      bare
      anyActive={anyOn}
      onReset={onClear}
      actions={actions}
      items={[
        {
          key: 'search',
          width: 12,
          grow: 3,
          maxRem: null,
          priority: 1000,
          active: search.trim() !== '',
          row: <MasterSearchInput value={search} onChange={onSearch} placeholder={placeholder} ariaLabel={ariaLabel} />,
          panel: (
            <ListFilterField label="Search">
              <MasterSearchInput value={search} onChange={onSearch} placeholder={placeholder} ariaLabel={ariaLabel} />
            </ListFilterField>
          ),
        },
        ...(extra
          ? [
              {
                key: 'extra',
                width: extraWidthRem,
                maxRem: extraWidthRem + 3,
                priority: 500,
                active: extraActive,
                row: extra,
                panel: <ListFilterField label={extraLabel}>{extra}</ListFilterField>,
              },
            ]
          : []),
        ...(dhm != null && onDhm
          ? [
              {
                key: 'dhm',
                width: 12,
                maxRem: 14.5,
                priority: 900,
                active: dhm !== 'all',
                row: <MasterDhmSelect value={dhm} onChange={onDhm} counts={dhmCounts} />,
                panel: (
                  <ListFilterField label="DHM status">
                    <MasterDhmSelect value={dhm} onChange={onDhm} counts={dhmCounts} />
                  </ListFilterField>
                ),
              },
            ]
          : []),
      ]}
    />
  )
}
