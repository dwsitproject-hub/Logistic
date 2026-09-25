'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const LIST_FILTER_FIELD_LABEL_CLASS =
  'text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1 block'

export type ListFilterChip = {
  id: string
  label: string
  onRemove: () => void
}

export function selectionChips(
  prefix: string,
  values: readonly string[],
  onChange: (next: string[]) => void,
): ListFilterChip[] {
  return values.map((value) => ({
    id: `${prefix}:${value}`,
    label: `${prefix}: ${value}`,
    onRemove: () => onChange(values.filter((item) => item !== value)),
  }))
}

export function ListFilterPanel({
  title = 'Filters',
  onReset,
  showReset = false,
  chips,
  children,
  className,
}: {
  title?: string
  onReset?: () => void
  showReset?: boolean
  chips?: ListFilterChip[]
  children: ReactNode
  className?: string
}) {
  const visibleChips = chips?.filter((chip) => chip.label.trim().length > 0) ?? []

  return (
    <section
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-4 shadow-sm',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{title}</h2>
        {showReset && onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            Reset
          </button>
        ) : null}
      </div>
      {children}
      {visibleChips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              <span className="max-w-[16rem] truncate">{chip.label}</span>
              <X className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
              <span className="sr-only">Remove {chip.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
