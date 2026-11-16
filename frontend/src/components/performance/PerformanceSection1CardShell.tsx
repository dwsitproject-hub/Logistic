'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  PERFORMANCE_SECTION1_CARD_ACCENTS,
  type PerformanceSection1CardVariant,
} from '@/lib/performanceSection1CardUi'

export interface PerformanceSection1CardShellProps {
  variant: PerformanceSection1CardVariant
  /** The card's name ("Open", "On Going"). Large and bold like the number when the card has a `value`; a small bold label otherwise (the claim cards). */
  title: string
  selected: boolean
  onClick: () => void
  /** Optional chips under the number at the right (the On Time / Late chips, the contract count). */
  headerEnd?: ReactNode
  /** What the number is ("Outstanding Qty"): small, under the title. */
  label?: ReactNode
  /** The main number, large, at the right. */
  value?: ReactNode
  /** The unit after the number ("MT"), smaller and grey. */
  unit?: string
  /** Kept so existing callers still compile; the title is one size now. */
  titleSize?: 'sm' | 'base'
  /** The details under the header (the three averages); a thin line sits above them. */
  children?: ReactNode
  className?: string
}

/**
 * The status card of the performance pages, in the style of the Contracts and master cards: white, a quiet grey outline, an icon tile. The name of the card and
 * the number are the two big things, on the left and the right of one row, with the small label under the name and the chips under the number; the details sit in
 * one thin row below. Selected adds an accent outline and ring. The whole card is the button.
 */
export function PerformanceSection1CardShell({
  variant,
  title,
  selected,
  onClick,
  headerEnd,
  label,
  value,
  unit,
  children,
  className,
}: PerformanceSection1CardShellProps) {
  const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
  const Icon = accent.icon
  const hasValue = value != null

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        // A <button> centres its content vertically; cards in one row share the tallest card's height, so keep the content on the top edge.
        'flex w-full flex-col justify-start rounded-xl border px-4 py-3 text-left transition-colors focus:outline-none',
        selected ? accent.selected : cn(accent.surface, accent.hover),
        accent.focus,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent.chip)} aria-hidden>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('font-semibold text-gray-900', hasValue ? 'text-xl leading-snug' : 'text-sm')}>{title}</div>
          {label ? <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500">{label}</div> : null}
        </div>
        {hasValue || headerEnd ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {hasValue ? (
              <div className="whitespace-nowrap text-xl font-semibold tabular-nums leading-snug text-gray-900">
                {value}
                {unit ? <span className="ml-1 text-sm font-medium text-gray-500">{unit}</span> : null}
              </div>
            ) : null}
            {headerEnd}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-2 border-t border-gray-100 pt-2">{children}</div> : null}
    </button>
  )
}
