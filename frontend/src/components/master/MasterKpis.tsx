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
}

/** The cards above a Master list: the same card as the Users page (icon tile, label, number), with a one-line hint of what the number counts. */
export function MasterKpis({ items }: { items: MasterKpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.tone}`} aria-hidden>
            {item.icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-500">{item.label}</div>
            <div className="text-xl font-semibold tabular-nums text-gray-900">{item.value == null ? '-' : item.value.toLocaleString('en-US')}</div>
            {item.hint ? <div className="truncate text-[0.6875rem] text-gray-400">{item.hint}</div> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
