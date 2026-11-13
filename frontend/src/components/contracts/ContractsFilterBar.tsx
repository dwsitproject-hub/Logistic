'use client'

import { useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

/** The look of a searchable multi-select button in the Contracts filters: 36px, round, blue when something is chosen. Pass it as `buttonClassName`. */
export function contractFilterButtonClass(active: boolean): string {
  return `flex h-9 w-full items-center gap-2 rounded-[10px] border px-2.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
    active ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
  }`
}

interface Props {
  /** The search box: the draft text, how it changes, and Enter (the search is applied on Enter, as before). */
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  placeholder: string
  /** Filters that sit in the row from the `lg` breakpoint up (Status, Incoterm); below it they move into More filters. */
  wide: ReactNode
  /** The same filters again, drawn only inside More filters on a screen narrower than `lg`. */
  narrowOnly: ReactNode
  /** The filters that always live in More filters (Contract Type, Product, Group, Supplier). */
  more: ReactNode
  /** How many of the `more` filters are on, and how many of all of them (wide + more) when the row is too narrow to show the wide ones. */
  activeMore: number
  activeAll: number
  /** True when anything (search included) narrows the list, so Reset shows. */
  anyActive: boolean
  onReset: () => void
  /** The icon buttons at the right end of the row (Template, Upload). */
  actions?: ReactNode
}

function CountBadge({ value, className }: { value: number; className: string }) {
  if (value <= 0) return null
  return <span className={`rounded-full bg-blue-600 px-1.5 text-[0.6875rem] font-medium leading-4 text-white ${className}`}>{value}</span>
}

/** "2 filters active" for the panel footer; empty when none. */
function activeText(count: number): string {
  if (count <= 0) return 'No filters on'
  return count === 1 ? '1 filter active' : `${count} filters active`
}

/**
 * The Contracts filter row: one line at every width. Search first, then the filters that fit (Status, Incoterm from `lg` up), a More filters
 * button for the rest with a count of the filters that are on, and the icon buttons at the right end. More filters opens a panel under the
 * row, in the page flow, so a dropdown opened inside it is never closed by clicking into it.
 */
export function ContractsFilterBar({
  search,
  onSearchChange,
  onSearchSubmit,
  placeholder,
  wide,
  narrowOnly,
  more,
  activeMore,
  activeAll,
  anyActive,
  onReset,
  actions,
}: Props) {
  const [open, setOpen] = useState(false)
  const anyFilterOn = activeAll > 0
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-nowrap items-center gap-2 px-3 py-3 sm:px-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSearchSubmit()
              }
            }}
            placeholder={placeholder}
            aria-label="Search contracts"
            className="h-9 rounded-[10px] pl-9"
          />
        </div>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">{wide}</div>

        {anyActive ? (
          <button
            type="button"
            onClick={onReset}
            title="Reset filters"
            aria-label="Reset filters"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title="More filters"
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-sm ${
            open || anyFilterOn ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">More filters</span>
          <CountBadge value={activeMore} className="hidden lg:inline" />
          <CountBadge value={activeAll} className="lg:hidden" />
        </button>

        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>

      {open ? (
        <div className="rounded-b-xl border-t border-gray-100 bg-gray-50/70 px-3 py-4 sm:px-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <div className="contents lg:hidden">{narrowOnly}</div>
            {more}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-gray-500">
            <span>
              <span className="hidden lg:inline">{activeText(activeMore)}</span>
              <span className="lg:hidden">{activeText(activeAll)}</span>
            </span>
            {anyActive ? (
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Reset filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** A label above a filter field inside More filters: sentence case, small and quiet. */
export function ContractsFilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  )
}
