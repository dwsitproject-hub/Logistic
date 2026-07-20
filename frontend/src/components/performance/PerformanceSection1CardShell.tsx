'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  PERFORMANCE_SECTION1_CARD_ACCENTS,
  type PerformanceSection1CardVariant,
} from '@/lib/performanceSection1CardUi'

export interface PerformanceSection1CardShellProps {
  variant: PerformanceSection1CardVariant
  title: string
  selected: boolean
  onClick: () => void
  /** Optional trailing header content (e.g. CP On Time / Late badges). */
  headerEnd?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Shared chrome for Contract / Shipping Performance Section 1 cards.
 * Owns icon chip + white surface + colored border + title typography; metric body stays in children.
 */
export function PerformanceSection1CardShell({
  variant,
  title,
  selected,
  onClick,
  headerEnd,
  children,
  className,
}: PerformanceSection1CardShellProps) {
  const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
  const Icon = accent.icon

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border p-4 shadow-sm text-left transition-all focus:outline-none',
        accent.surface,
        accent.focus,
        selected ? accent.selected : accent.hover,
        className,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              accent.chip,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <span className="text-base font-semibold text-gray-800">{title}</span>
        </div>
        {headerEnd ? <div className="shrink-0">{headerEnd}</div> : null}
      </div>
      {children}
    </button>
  )
}
