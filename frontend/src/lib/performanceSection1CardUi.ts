import type { LucideIcon } from 'lucide-react'
import { BadgeCheck, CheckCircle2, FolderOpen, Ship } from 'lucide-react'

export type PerformanceSection1CardVariant = 'open' | 'close' | 'ongoing' | 'completed'

export interface PerformanceSection1CardAccent {
  icon: LucideIcon
  /** White surface + colored border (default / unselected). */
  surface: string
  /** Icon chip background + icon color. */
  chip: string
  /**
   * Selected chrome — replaces `surface` (bold border + App Tour / Logout gradient).
   * Open / On Going → App Tour blue; Close / Completed → Logout amber.
   */
  selected: string
  /** Unselected hover border. */
  hover: string
  /** Focus ring — must match card accent (never a hardcoded global blue). */
  focus: string
}

/**
 * Visual tokens for Contract / Shipping Performance Section 1 status cards.
 * Unselected: white surface + colored border. Selected: bold outline + header-button gradient.
 * Open / On Going = blue (App Tour); Close / Completed = amber (Logout).
 */
export const PERFORMANCE_SECTION1_CARD_ACCENTS: Record<
  PerformanceSection1CardVariant,
  PerformanceSection1CardAccent
> = {
  open: {
    icon: FolderOpen,
    surface: 'border-blue-400 bg-white',
    chip: 'bg-blue-50 text-blue-700',
    selected:
      'border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50 ring-2 ring-blue-200 shadow-sm',
    hover: 'hover:border-blue-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-blue-200',
  },
  close: {
    icon: CheckCircle2,
    surface: 'border-amber-400 bg-white',
    chip: 'bg-amber-50 text-amber-700',
    selected:
      'border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-orange-50 ring-2 ring-amber-200 shadow-sm',
    hover: 'hover:border-amber-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-amber-200',
  },
  ongoing: {
    icon: Ship,
    surface: 'border-blue-400 bg-white',
    chip: 'bg-blue-50 text-blue-700',
    selected:
      'border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50 ring-2 ring-blue-200 shadow-sm',
    hover: 'hover:border-blue-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-blue-200',
  },
  completed: {
    icon: BadgeCheck,
    surface: 'border-amber-400 bg-white',
    chip: 'bg-amber-50 text-amber-700',
    selected:
      'border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-orange-50 ring-2 ring-amber-200 shadow-sm',
    hover: 'hover:border-amber-500',
    focus: 'focus-visible:ring-2 focus-visible:ring-amber-200',
  },
}
