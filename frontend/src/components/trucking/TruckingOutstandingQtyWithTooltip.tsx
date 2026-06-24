'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { truckingOutstandingQtyFormulaTooltip } from '@/lib/fieldHelpText'
import { formatOutstandingQtyMtFromKg } from '@/lib/utils'

type Props = {
  outstandingKg: number | null | undefined
  incoterm?: string | null
  className?: string
}

export function TruckingOutstandingQtyWithTooltip({
  outstandingKg,
  incoterm,
  className,
}: Props) {
  const tooltip = truckingOutstandingQtyFormulaTooltip(incoterm)
  const triggerClass = `cursor-help border-b border-dotted border-transparent hover:border-gray-300 ${className ?? ''}`

  if (outstandingKg === null || outstandingKg === undefined || !Number.isFinite(Number(outstandingKg))) {
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <span className={`text-sm text-gray-400 tabular-nums ${triggerClass}`}>—</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs leading-relaxed max-w-xs whitespace-pre-wrap">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    )
  }

  const n = Number(outstandingKg)
  const isOver = n < 0
  const isUnder = n > 0
  const colorClass = isOver ? 'text-green-600' : isUnder ? 'text-red-600' : 'text-gray-500'

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className={`text-sm break-words tabular-nums font-medium ${colorClass} ${triggerClass}`}>
          {formatOutstandingQtyMtFromKg(n)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs leading-relaxed max-w-xs whitespace-pre-wrap">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
