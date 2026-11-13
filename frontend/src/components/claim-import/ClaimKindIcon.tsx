'use client'

import { CircleCheck, Hourglass, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ClaimDataKind } from '@/lib/claimDataImportView'

export const CLAIM_KIND_LOOK: Record<ClaimDataKind, { Icon: LucideIcon; tone: string; hover: string; detail: string }> = {
  os: {
    Icon: Hourglass,
    tone: 'bg-amber-50 text-amber-600',
    hover: 'Not claimed yet',
    detail: 'Outstanding: claims that are not paid yet.',
  },
  real: {
    Icon: CircleCheck,
    tone: 'bg-emerald-50 text-emerald-600',
    hover: 'Already claimed',
    detail: 'Realised: claims that are already paid.',
  },
}

/** Outstanding or Realised as one coloured icon; "Not claimed yet" or "Already claimed" shows on hover. */
export function ClaimKindIcon({ kind, size = 'md' }: { kind: ClaimDataKind; size?: 'sm' | 'md' }) {
  const { Icon, tone, hover, detail } = CLAIM_KIND_LOOK[kind]
  const box = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={`${hover}. ${detail}`}
          tabIndex={0}
          className={`inline-flex ${box} shrink-0 cursor-help items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${tone}`}
        >
          <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        <div className="font-semibold">{hover}</div>
        <div className="mt-0.5 text-gray-600">{detail}</div>
      </TooltipContent>
    </Tooltip>
  )
}
