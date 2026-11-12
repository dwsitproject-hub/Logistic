'use client'

import { CircleCheck, Minus, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Is this vessel on at least one KLIP shipment? A green check when it is, a grey dash when it is not; the sentence shows on hover. */
export function KlipTransactionBadge({ value }: { value: boolean | null | undefined }) {
  const used = value === true
  const Icon: LucideIcon = used ? CircleCheck : Minus
  const tone = used ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'
  const text = used ? 'This vessel is on at least one shipment in KLIP' : 'No shipment in KLIP uses this vessel yet'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={`Klip transaction: ${used ? 'Yes' : 'No'}. ${text}`}
          tabIndex={0}
          className={`inline-flex h-7 w-7 shrink-0 cursor-help items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${tone}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs normal-case leading-relaxed">
        <div className="font-semibold">Klip transaction: {used ? 'Yes' : 'No'}</div>
        <div className="mt-0.5 text-gray-600">{text}</div>
      </TooltipContent>
    </Tooltip>
  )
}
