'use client'

import type { ReactNode } from 'react'

export interface MasterKpiItem {
  id: string
  icon: ReactNode
  label: string
  value: number | null
  /** Tailwind classes for the icon tile, e.g. "bg-blue-50 text-blue-600". */
  tone: string
  /** One short line under the number: what it counts. */
  hint?: string
  /** Makes the card a button (a shortcut to a filter). Leave out for a plain card. */
  onSelect?: () => void
  /** The card whose filter is on now (only drawn on a card that has onSelect). */
  active?: boolean
}

/**
 * The cards above a list: the same card as the Users page (icon tile, label, number), with a one-line hint of what the number counts.
 * `columns={3}` keeps three cards on one row at every width (Contracts); the default is two across on a phone, four on a desktop.
 */
export function MasterKpis({ items, columns = 4 }: { items: MasterKpiItem[]; columns?: 3 | 4 }) {
  return (
    <div className={columns === 3 ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3 lg:grid-cols-4'}>
      {items.map((item) => {
        const body = (
          <>
            <div className={`flex shrink-0 items-center justify-center rounded-lg ${columns === 3 ? 'h-8 w-8 sm:h-9 sm:w-9' : 'h-9 w-9'} ${item.tone}`} aria-hidden>
              {item.icon}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-gray-500">{item.label}</div>
              <div className="text-xl font-semibold tabular-nums text-gray-900">{item.value == null ? '-' : item.value.toLocaleString('en-US')}</div>
              {item.hint ? <div className="truncate text-[0.6875rem] text-gray-400">{item.hint}</div> : null}
            </div>
          </>
        )
        const base = `flex items-center rounded-xl border bg-white ${columns === 3 ? 'gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3' : 'gap-3 px-4 py-3'}`
        if (!item.onSelect) {
          return (
            <div key={item.id} className={`${base} border-gray-200`}>
              {body}
            </div>
          )
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onSelect}
            aria-pressed={item.active === true}
            className={`${base} text-left transition-colors hover:bg-gray-50 ${item.active ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}
