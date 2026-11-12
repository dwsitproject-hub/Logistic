'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PERFORMANCE_SECTION1_CARD_ACCENTS, type PerformanceSection1CardVariant } from '@/lib/performanceSection1CardUi'
import { onTimeLateSplit } from '@/lib/performanceStatusCard'

export interface PerformanceStatCell {
  /** What the number is (may carry its own hover help). */
  label: ReactNode
  value: string
  /** Native tooltip, for a label that has no help component of its own. */
  title?: string
}

export interface PerformanceStatGroup {
  /** A small heading over the group ("Loading", "Discharge"). */
  heading?: string
  stats: PerformanceStatCell[]
}

export interface PerformanceStatusCardProps {
  variant: PerformanceSection1CardVariant
  title: string
  selected: boolean
  /** The card is a filter button when this is given; without it the card is a plain panel (the claim pages). */
  onClick?: () => void
  /** The line under the title: what the big number counts (may carry a help icon). */
  label: ReactNode
  value: ReactNode
  /** Between the number and the stats: the On Time / Late bar, or a contracts badge. */
  middle?: ReactNode
  groups: PerformanceStatGroup[]
  /** A line under the row, full width (e.g. "Not narrowed by the Group filter"). */
  footer?: ReactNode
  className?: string
}

/**
 * Section 1 status card of Contract and Shipping Performance (Open / Close, On Going / Completed), laid out in ONE row so it stays flat:
 * icon and title, the big number, an optional middle block, and the averages. The row wraps on a narrow screen instead of clipping.
 * The whole card is the filter button, as before. The averages are neutral; their meaning is in the label.
 */
export function PerformanceStatusCard({
  variant,
  title,
  selected,
  onClick,
  label,
  value,
  middle,
  groups,
  footer,
  className,
}: PerformanceStatusCardProps) {
  const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
  const Icon = accent.icon

  const chrome = cn(
    'flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-4 py-2.5 text-left transition-all focus:outline-none',
    selected ? accent.selected : cn('border shadow-sm', accent.surface, onClick && accent.hover),
    onClick && accent.focus,
    className,
  )

  const body = (
    <>
      <div className="flex min-w-[10rem] items-center gap-2.5">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent.chip)}>
          <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase leading-tight tracking-wide text-slate-800">{title}</div>
          <div className="flex items-center gap-1 text-[0.6875rem] leading-tight text-gray-500">{label}</div>
        </div>
      </div>

      <div className="whitespace-nowrap text-2xl font-semibold tabular-nums leading-none text-gray-900">{value}</div>

      {middle ? <div className="shrink-0">{middle}</div> : null}

      <div className="ml-auto flex flex-wrap items-start gap-x-5 gap-y-2">
        {groups.map((group, groupIndex) => (
          <div key={group.heading ?? groupIndex}>
            {group.heading ? (
              <div className="mb-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-gray-400">{group.heading}</div>
            ) : null}
            <div className="flex">
              {group.stats.map((stat, index) => (
                <div
                  key={index}
                  title={stat.title}
                  className={cn('px-3 first:pl-0 last:pr-0', index > 0 && 'border-l border-gray-200', stat.title && 'cursor-help')}
                >
                  <div className="whitespace-nowrap text-[0.6875rem] text-gray-500">{stat.label}</div>
                  <div className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {footer ? <div className="basis-full text-[0.6875rem] text-amber-700">{footer}</div> : null}
    </>
  )

  if (!onClick) return <div className={chrome}>{body}</div>
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={chrome}>
      {body}
    </button>
  )
}

/** On Time / Late as two percentages over one bar (replaces the pair of badges in the card header). */
export function PerformanceOnTimeBar({ onTimeCount, lateCount }: { onTimeCount: number; lateCount: number }) {
  const split = onTimeLateSplit(onTimeCount, lateCount)
  return (
    <div className="w-40">
      <div className="mb-1 flex justify-between text-[0.6875rem] font-medium">
        <span className="text-emerald-700">On Time {split.onTimeLabel}</span>
        <span className="text-red-600">Late {split.lateLabel}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`On Time ${split.onTimeLabel}, Late ${split.lateLabel}`}>
        <div className="h-full bg-emerald-500" style={{ width: `${split.onTimeWidth}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${split.lateWidth}%` }} />
      </div>
    </div>
  )
}
