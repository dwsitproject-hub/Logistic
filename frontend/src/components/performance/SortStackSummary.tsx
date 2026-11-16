'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, X } from 'lucide-react'
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

function DirIcon({ dir }: { dir: 'asc' | 'desc' }) {
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

/**
 * A multi-column sort in one short piece: "Urutan: [1 STO ↑ +2 ▾] ✕" (the word Urutan shows from 2xl up, the reset is an icon). It sits in the card header's action group, just before
 * the Download Data button, and never wraps, so the header keeps the same height however many columns are sorted. The pill opens the full order (primary first, the order the rows are compared) in a
 * small list; Reset goes back to the table's default sort.
 */
export function SortStackSummary<K extends string>({ stack, labelFor, onReset, minKeys = 2 }: Props<K>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (stack.length < minKeys) return null
  const [first, ...rest] = stack
  return (
    <div
      ref={rootRef}
      className="relative flex max-w-full items-center gap-2 text-xs text-gray-600"
      aria-label="Urutan kolom"
    >
      <span className="hidden font-medium 2xl:inline">Urutan:</span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Lihat urutan lengkap"
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-800 hover:bg-blue-100"
      >
        <span className="tabular-nums text-[0.625rem] text-blue-500">1</span>
        <span className="truncate">{labelFor(first.key)}</span>
        <DirIcon dir={first.dir} />
        {rest.length > 0 ? <span className="tabular-nums text-blue-600">+{rest.length}</span> : null}
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          onReset()
        }}
        className="inline-flex shrink-0 items-center gap-0.5 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        title="Kembali ke urutan awal"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Reset</span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Urutan lengkap"
          className="absolute left-0 top-full z-30 mt-1 min-w-[14rem] max-w-[min(24rem,90vw)] rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
        >
          <p className="mb-1.5 px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-gray-400">
            Dibandingkan berurutan
          </p>
          <ol className="space-y-1">
            {stack.map((entry, index) => (
              <li key={entry.key} className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1 text-blue-800">
                <span className="tabular-nums text-[0.625rem] text-blue-500">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{labelFor(entry.key)}</span>
                <span className="inline-flex items-center gap-0.5 text-blue-700">
                  <DirIcon dir={entry.dir} />
                  {entry.dir === 'asc' ? 'naik' : 'turun'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
