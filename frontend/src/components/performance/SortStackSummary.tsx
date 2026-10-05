'use client'

import { ArrowDown, ArrowUp, ChevronRight, X } from 'lucide-react'
import type { SortEntry } from '@/lib/sortStack'

type Props<K extends string> = {
  stack: ReadonlyArray<SortEntry<K>>
  /** Header text of a column, for the chips. */
  labelFor: (key: K) => string
  /** Back to the table's default sort. */
  onReset: () => void
  /** Shown only from this many keys up; a single sort needs no explanation. */
  minKeys?: number
}

/**
 * "Urutan: Incoterm ↑ › Product ↑ › Supplier ↑  [x]" - what a multi-column sort is currently doing, in the order the
 * rows are compared (primary first), with a way back to the default.
 */
export function SortStackSummary<K extends string>({ stack, labelFor, onReset, minKeys = 2 }: Props<K>) {
  if (stack.length < minKeys) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600" aria-label="Urutan kolom">
      <span className="font-medium">Urutan:</span>
      {stack.map((entry, index) => (
        <span key={entry.key} className="inline-flex items-center gap-1.5">
          {index > 0 ? <ChevronRight className="h-3 w-3 text-gray-400" aria-hidden /> : null}
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-800">
            <span className="tabular-nums text-[10px] text-blue-500">{index + 1}</span>
            {labelFor(entry.key)}
            {entry.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </span>
        </span>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        title="Kembali ke urutan awal"
      >
        <X className="h-3 w-3" /> Reset
      </button>
    </div>
  )
}
