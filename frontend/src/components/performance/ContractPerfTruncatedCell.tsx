'use client'

import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type ContractPerfTruncatedCellProps = {
  tooltip?: string | null
  children: ReactNode
  className?: string
}

/** Truncated cell with hover tooltip for full text (Contract Performance Section 3). */
export function ContractPerfTruncatedCell({
  tooltip,
  children,
  className,
}: ContractPerfTruncatedCellProps) {
  const full = tooltip?.trim()
  const inner = (
    <div className={cn('min-w-0 max-w-full truncate text-sm', className)}>{children}</div>
  )

  if (!full || full === '-') {
    return inner
  }

  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div className="min-w-0 max-w-full cursor-default">{inner}</div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md text-xs leading-snug break-words whitespace-pre-line">
        {full}
      </TooltipContent>
    </Tooltip>
  )
}
