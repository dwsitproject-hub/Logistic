'use client'

import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = {
  text: string
  className?: string
  iconClassName?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/** Small (i) icon; hover shows formula / logic explanation */
export function FieldHelp({ text, className, iconClassName, side = 'top' }: Props) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30',
            className
          )}
          aria-label="How this field is calculated"
        >
          <HelpCircle className={cn('h-3.5 w-3.5', iconClassName)} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="text-xs leading-relaxed whitespace-pre-wrap max-w-sm">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
