'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { truckingOutstandingQtyFormulaTooltip } from '@/lib/fieldHelpText'
import { formatOutstandingQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'

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

  const colorClass = outstandingQtyMtColorClass(outstandingKg)

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className={`text-sm break-words tabular-nums ${colorClass} ${triggerClass}`}>
          {formatOutstandingQtyMtFromKg(outstandingKg, { maxFractionDigits: 0 })}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs leading-relaxed max-w-xs whitespace-pre-wrap">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
