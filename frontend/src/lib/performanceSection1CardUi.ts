import type { ComponentType } from 'react'
import { CircleCheck, Clock, Ship } from 'lucide-react'

export type PerformanceSection1CardVariant = 'open' | 'close' | 'ongoing' | 'completed'

export interface PerformanceSection1CardAccent {
  icon: ComponentType<{ className?: string }>
  /** White surface with the quiet grey outline of the Contracts and master cards (default / unselected). */
  surface: string
  /** Icon tile background + icon colour. */
  chip: string
  /** Selected: the same card with an outline and a thin ring in the accent colour (no gradient, no thicker border). */
  selected: string
  /** Unselected hover. */
  hover: string
  /** Focus ring: matches the accent. */
  focus: string
}

const AMBER: Omit<PerformanceSection1CardAccent, 'icon'> = {
  surface: 'border-gray-200 bg-white',
  chip: 'bg-amber-50 text-amber-600',
  selected: 'border-amber-400 bg-white ring-1 ring-amber-200',
  hover: 'hover:bg-gray-50',
  focus: 'focus-visible:ring-2 focus-visible:ring-amber-200',
}

const EMERALD: Omit<PerformanceSection1CardAccent, 'icon'> = {
  surface: 'border-gray-200 bg-white',
  chip: 'bg-emerald-50 text-emerald-600',
  selected: 'border-emerald-400 bg-white ring-1 ring-emerald-200',
  hover: 'hover:bg-gray-50',
  focus: 'focus-visible:ring-2 focus-visible:ring-emerald-200',
}

/**
 * Visual tokens for the Section 1 status cards of Contract Performance (Open / Close), Shipping Performance (On Going / Completed) and the claim pages.
 * The same card as the Contracts and master pages: white, a grey outline, a small icon tile. Open / On Going follow the Open card of Contracts (amber, a clock or
 * a ship); Close / Completed follow its Close card (green, a check).
 */
export const PERFORMANCE_SECTION1_CARD_ACCENTS: Record<
  PerformanceSection1CardVariant,
  PerformanceSection1CardAccent
> = {
  open: { icon: Clock, ...AMBER },
  close: { icon: CircleCheck, ...EMERALD },
  ongoing: { icon: Ship, ...AMBER },
  completed: { icon: CircleCheck, ...EMERALD },
}
