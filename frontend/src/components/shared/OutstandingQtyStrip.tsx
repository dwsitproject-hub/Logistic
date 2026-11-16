'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { FieldHelp } from '@/components/FieldHelp'
import { cn, formatOutstandingQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'

/**
 * The Outstanding Qty strip above the Shipments and Trucking lists: one framed card, its parts split by thin lines instead of boxes inside a box.
 * The parts are a headline (the total), a Late ATC shortcut (Shipments only) and one block per source (3rd Party, Interco) with the split by incoterm.
 */

/** "106,950 MT" -> "106,950"; the unit is drawn smaller next to it. */
function qtyText(kg: number | undefined, pending: boolean): string {
  return formatOutstandingQtyMtFromKg(pending ? 0 : kg, { maxFractionDigits: 0 }).replace(/ MT$/, '')
}

export function OutstandingStripFrame({
  className,
  loading,
  children,
}: {
  /** The grid columns of the strip at md and up. */
  className: string
  loading?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'grid grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white transition-opacity duration-200',
        '[&>*+*]:border-t [&>*+*]:border-gray-100 md:[&>*+*]:border-l md:[&>*+*]:border-t-0',
        className,
        loading ? 'opacity-65' : 'opacity-100',
      )}
    >
      {children}
    </section>
  )
}

export function OutstandingStripHeadline({
  icon,
  help,
  loading,
  pending,
  kg,
  hint,
}: {
  icon: ReactNode
  help: string
  loading: boolean
  pending: boolean
  kg: number | undefined
  hint: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600" aria-hidden>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
          <span>Outstanding Qty</span>
          <FieldHelp text={help} />
          {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" aria-label="Loading outstanding qty" /> : null}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className={cn('text-2xl font-semibold tabular-nums', pending ? 'text-gray-400' : outstandingQtyMtColorClass(kg))}>
            {qtyText(kg, pending)}
          </span>
          <span className="text-sm font-medium text-gray-400">MT</span>
        </div>
        <p className="mt-0.5 truncate text-[0.6875rem] text-gray-400" title={hint}>
          {hint}
        </p>
      </div>
    </div>
  )
}

export interface OutstandingStripPart {
  key: string
  label: string
  kg: number | undefined
  /** Tailwind background class of the dot and of this part of the bar. */
  dot: string
}

/** One source (3rd Party / Interco): its parts by incoterm side by side, with a thin bar showing how the total splits. */
export function OutstandingStripBucket({ title, parts, pending }: { title: string; parts: OutstandingStripPart[]; pending: boolean }) {
  const weights = parts.map((part) => (pending ? 0 : Math.max(0, Number(part.kg) || 0)))
  const sum = weights.reduce((a, b) => a + b, 0)
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</div>
      <div className="mt-2 grid gap-x-3" style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}>
        {parts.map((part) => (
          <div key={part.key} className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', part.dot)} aria-hidden />
              {part.label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className={cn('text-base font-semibold tabular-nums', pending ? 'text-gray-400' : outstandingQtyMtColorClass(part.kg))}>
                {qtyText(part.kg, pending)}
              </span>
              <span className="text-[0.6875rem] font-medium text-gray-400">MT</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        {sum > 0
          ? parts.map((part, index) =>
              weights[index] > 0 ? <span key={part.key} className={part.dot} style={{ width: `${(weights[index] / sum) * 100}%` }} /> : null,
            )
          : null}
      </div>
    </div>
  )
}
