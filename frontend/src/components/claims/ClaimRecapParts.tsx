'use client'

import { cn } from '@/lib/utils'
import { formatClaimCompact, formatShare } from '@/lib/claimRecapFormat'

/**
 * Building blocks of the one-card Section 1 recap that Quality Claim and Shortage Claim share:
 * a tab switch, a short number with its full value on hover, and a share bar.
 */

export function RecapSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: ReadonlyArray<{ id: T; label: string }>
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'px-3 py-1 text-xs whitespace-nowrap transition-colors',
            value === o.id ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A short number (34,46 B) with the full one, already formatted by the caller, on hover. */
export function CompactNum({ v, full, strong }: { v: number; full: string; strong?: boolean }) {
  return (
    <span title={v ? full : undefined} className={strong ? 'font-semibold text-gray-900' : undefined}>
      {formatClaimCompact(v)}
    </span>
  )
}

/** The share of a total as a thin bar with its percentage, in place of a separate % column. */
export function ShareBar({ part, total, tone = 'indigo' }: { part: number; total: number; tone?: 'indigo' | 'emerald' }) {
  const pct = total > 0 && part > 0 ? Math.min(100, (part / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100">
        <div
          className={cn('h-1.5 rounded-full', tone === 'indigo' ? 'bg-indigo-400' : 'bg-emerald-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-11 text-right text-[11px] tabular-nums text-gray-500">{formatShare(part, total)}</span>
    </div>
  )
}
