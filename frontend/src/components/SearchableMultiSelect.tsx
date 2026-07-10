'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { sortFilterOptionsWithSelectedFirst } from '@/lib/globalScopeFilters'

// Searchable multi-select dropdown (type to filter, multiple selection with OR).
// Copied from Dashboard to keep Plant/Site and Incoterm UX consistent.
export function SearchableMultiSelect({
  label,
  options,
  selected = [],
  onChange,
  placeholder,
  emptyMessage = 'Loading...',
  /** When true, selected values appear at the top of the list (for plotted Product / Group Plant). */
  pinSelectedToTop = false,
}: {
  label: string
  options: string[]
  selected?: string[]
  onChange: (value: string[]) => void
  placeholder: string
  emptyMessage?: string
  pinSelectedToTop?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const orderedOptions = useMemo(
    () => (pinSelectedToTop ? sortFilterOptionsWithSelectedFirst(options, selected) : options),
    [options, selected, pinSelectedToTop],
  )

  const filtered = search.trim()
    ? orderedOptions.filter((o) => o.toLowerCase().includes(search.toLowerCase().trim()))
    : orderedOptions

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((s) => s !== value))
    else onChange([...selected, value])
  }

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const displayLabel = selected.length === 0 ? placeholder : `${selected.length} selected (OR)`

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="text-sm font-medium text-gray-700 mb-1 block">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 h-10 px-3 py-2 text-left text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <span className={selected.length === 0 ? 'text-gray-500' : 'text-gray-900'}>{displayLabel}</span>
        <ChevronDown className={`h-4 w-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <Input
              type="text"
              placeholder="Type to search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {options.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">{emptyMessage}</div>
            ) : filtered.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No matches</div>
            ) : (
              filtered.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-100 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggle(option)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="truncate">{option}</span>
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button type="button" onClick={clearSelection} className="text-xs text-blue-600 hover:underline">
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

