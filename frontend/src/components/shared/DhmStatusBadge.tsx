'use client'

import { AlertTriangle, CheckCircle2, CircleOff, GitCompareArrows, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  dhmStatusHint,
  masterVesselDhmStatusLabel,
  type DhmStatusLabel,
  type DhmStatusRow,
} from '@/lib/masterVesselDhmStatus'

const LOOK: Record<DhmStatusLabel, { Icon: LucideIcon; tone: string }> = {
  Sync: { Icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' },
  'Not Sync': { Icon: CircleOff, tone: 'bg-red-50 text-red-600' },
  // Linked to DHM, but the last change did not reach it: the row differs from DHM until the retry succeeds.
  'Sync Failed': { Icon: AlertTriangle, tone: 'bg-amber-50 text-amber-600' },
  // DHM already holds something different under this name or code; a person has to choose.
  Conflict: { Icon: GitCompareArrows, tone: 'bg-orange-50 text-orange-600' },
}

/** The DHM status of a master row as one coloured icon; the word and the reason (if the push failed) show on hover. */
export function DhmStatusBadge({ row }: { row: DhmStatusRow }) {
  const label = masterVesselDhmStatusLabel(row)
  const hint = dhmStatusHint(row)
  const { Icon, tone } = LOOK[label]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={hint ? `DHM ${label}: ${hint}` : `DHM ${label}`}
          tabIndex={0}
          className={`inline-flex h-7 w-7 shrink-0 cursor-help items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${tone}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs normal-case leading-relaxed">
        <div className="font-semibold">DHM: {label}</div>
        {hint ? <div className="mt-0.5 text-gray-600">{hint}</div> : null}
      </TooltipContent>
    </Tooltip>
  )
}
