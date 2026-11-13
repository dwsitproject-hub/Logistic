'use client'

import { Loader2, Ship } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const VESSEL_IDLE_TOOLTIP =
  'Opens vessel availability: idle T/C vessels and vessels expected to free within 7 days (ETC at Discharge Port). Does not filter the table.'

export interface VesselIdleInsightChipProps {
  count: number
  loading?: boolean
  error?: boolean
  onClick: () => void
}

/**
 * Compact fleet insight control: a red ship icon button with a round red badge holding the count (a spinner while it loads, "!" when it could not).
 * Separate from the pipeline status circles because vessel idle is reference data, not a shipment execution stage filter. The tooltip names it "Vessel Idle".
 */
export function VesselIdleInsightChip({
  count,
  loading = false,
  error = false,
  onClick,
}: VesselIdleInsightChipProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          aria-label={`Vessel Idle: ${loading ? 'loading' : error ? 'unavailable' : count} vessels`}
        >
          <Ship className="h-[1.125rem] w-[1.125rem]" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[0.625rem] font-bold leading-none tabular-nums text-white ring-2 ring-white">
            {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden /> : error ? '!' : count}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
        <div className="font-semibold">Vessel Idle</div>
        <div className="mt-0.5">
          {error ? 'Vessel idle data could not be loaded. Try again or check backend logs.' : VESSEL_IDLE_TOOLTIP}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
