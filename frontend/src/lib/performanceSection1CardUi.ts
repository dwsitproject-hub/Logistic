import type { LucideIcon } from 'lucide-react'
import { BadgeCheck, CheckCircle2, FolderOpen, Ship } from 'lucide-react'

export type PerformanceSection1CardVariant = 'open' | 'close' | 'ongoing' | 'completed'

export interface PerformanceSection1CardAccent {
  icon: LucideIcon
  /** White surface + colored border (default / unselected). */
  surface: string
  /** Icon chip background + icon color. */
  chip: string
  /** Selected ring / border emphasis. */
  selected: string
  /** Unselected hover border. */
  hover: string
  /** Focus ring — must match card accent (never a hardcoded global blue). */
  focus: string
}

/**
 * Visual tokens for Contract / Shipping Performance Section 1 status cards.
 * White background; accent only on border (and matching icon chip).
 * Open / On Going = blue; Close / Completed = amber.
 */
export const PERFORMANCE_SECTION1_CARD_ACCENTS: Record<
  PerformanceSection1CardVariant,
  PerformanceSection1CardAccent
> = {
  open: {
    icon: FolderOpen,
    surface: 'border-blue-400 bg-white',
    chip: 'bg-blue-50 text-blue-700',
    selected: 'border-blue-600 ring-2 ring-blue-200',
    hover: 'hover:border-blue-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-blue-200',
  },
  close: {
    icon: CheckCircle2,
    surface: 'border-amber-400 bg-white',
    chip: 'bg-amber-50 text-amber-700',
    selected: 'border-amber-600 ring-2 ring-amber-200',
    hover: 'hover:border-amber-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-amber-200',
  },
  ongoing: {
    icon: Ship,
    surface: 'border-blue-400 bg-white',
    chip: 'bg-blue-50 text-blue-700',
    selected: 'border-blue-600 ring-2 ring-blue-200',
    hover: 'hover:border-blue-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-blue-200',
  },
  completed: {
    icon: BadgeCheck,
    surface: 'border-amber-400 bg-white',
    chip: 'bg-amber-50 text-amber-700',
    selected: 'border-amber-600 ring-2 ring-amber-200',
    hover: 'hover:border-amber-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-amber-200',
  },
}
