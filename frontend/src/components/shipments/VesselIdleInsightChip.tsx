'use client'

import { Loader2, Ship } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const VESSEL_IDLE_TOOLTIP =
  'Opens vessel availability: idle T/C vessels and vessels expected to free within 7 days (ETC at Discharge Port). Does not filter the table.'

export interface VesselIdleInsightChipProps {
  count: number
  loading?: boolean
  onClick: () => void
}

/**
 * Compact fleet insight control — separate from pipeline status circles because
 * vessel idle is reference data, not a shipment execution stage filter.
 */
export function VesselIdleInsightChip({
  count,
  loading = false,
  onClick,
}: VesselIdleInsightChipProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-amber-200/90 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-1.5 text-sm shadow-sm transition-all hover:border-amber-300 hover:from-amber-100 hover:to-orange-100 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          aria-label={`Vessel idle: ${loading ? 'loading' : count} vessels`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-800">
            <Ship className="h-4 w-4" aria-hidden />
          </span>
          <span className="hidden font-medium text-amber-950 sm:inline">Vessel Idle</span>
          <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md bg-amber-600 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : count}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
        {VESSEL_IDLE_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  )
}
