'use client'

import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'

export interface FilterSelectOption {
  value: string
  label: string
}

const ALL = '__all__'

/** A filter as a field: a small icon, the chosen value (or "All ..."), and the options under it. An empty value means "all". */
export function FilterSelect({
  icon,
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  className = 'w-[200px]',
}: {
  icon: ReactNode
  value: string
  onChange: (value: string) => void
  options: FilterSelectOption[]
  allLabel: string
  ariaLabel: string
  className?: string
}) {
  return (
    <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
      <SelectTrigger className={`h-9 gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left ${className}`} aria-label={ariaLabel}>
        {/* a div, not a span: the trigger gives every direct child span flex-1 (the value), which would push the text away from the icon */}
        <div className="shrink-0 text-gray-400" aria-hidden>
          {icon}
        </div>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The one-row filter strip of the activity pages, in the style of the Users page: it sits on top of the table inside the same bordered card. Search, then the filters the
 * page puts in `children`, then the date range, a Clear link while anything is filtered, and the icon buttons at the right end.
 */
export function ActivityFilterBar({
  search,
  onSearch,
  searchPlaceholder,
  searchLabel,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  hasFilters,
  onClear,
  actions,
  children,
}: {
  search: string
  onSearch: (value: string) => void
  searchPlaceholder: string
  searchLabel: string
  dateFrom: string
  dateTo: string
  onDateFrom: (iso: string) => void
  onDateTo: (iso: string) => void
  /** Anything other than the default is on: shows the Clear link. */
  hasFilters: boolean
  onClear: () => void
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
      <div className="relative min-w-[160px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 pl-9"
          aria-label={searchLabel}
        />
      </div>

      {children}

      <div className="flex items-center gap-1.5">
        <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={onDateFrom} className="h-9 w-[130px] text-sm" />
        <span className="text-xs text-gray-400" aria-hidden>
          to
        </span>
        <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={onDateTo} className="h-9 w-[130px] text-sm" />
      </div>

      {hasFilters ? (
        <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear
        </button>
      ) : null}

      {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
