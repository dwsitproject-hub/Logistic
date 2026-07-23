'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatQtyMtFromKg } from '@/lib/utils'

export type TruckingStatusCardKey =
  | 'UNPLANNED'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'

const TRUCKING_STATUS_CARDS: ReadonlyArray<{
  status: TruckingStatusCardKey
  label: string
  color: string
  textColor: string
  tooltip: string
}> = [
  {
    status: 'UNPLANNED',
    label: 'Unplanned',
    color: 'bg-slate-100',
    textColor: 'text-slate-800',
    tooltip: FIELD_HELP.truckingStatusUnplanned,
  },
  {
    status: 'PLANNED',
    label: 'Planned',
    color: 'bg-blue-100',
    textColor: 'text-blue-800',
    tooltip: FIELD_HELP.truckingStatusPlanned,
  },
  {
    status: 'IN_PROGRESS',
    label: 'In Progress',
    color: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    tooltip: FIELD_HELP.truckingStatusInProgress,
  },
  {
    status: 'COMPLETED',
    label: 'Completed',
    color: 'bg-green-100',
    textColor: 'text-green-800',
    tooltip: FIELD_HELP.truckingStatusCompleted,
  },
  {
    status: 'CANCELLED',
    label: 'Cancelled',
    color: 'bg-red-100',
    textColor: 'text-red-800',
    tooltip: FIELD_HELP.truckingStatusCancelled,
  },
]

export interface TruckingStatusDistributionProps {
  loading: boolean
  statusFilter: string
  counts: Partial<Record<TruckingStatusCardKey, number>>
  /** Contract quantity_ordered sums in kg, one contract once per status. */
  contractQtys?: Partial<Record<TruckingStatusCardKey, number>>
  onStageClick: (status: TruckingStatusCardKey) => void
}

/**
 * Rectangle status cards aligned with Shipments Summary Status styling.
 * Count = row/status total; Contract Qty = sum of contract qty under that card.
 */
export function TruckingStatusDistribution({
  loading,
  statusFilter,
  counts,
  contractQtys,
  onStageClick,
}: TruckingStatusDistributionProps) {
  const renderCard = (card: (typeof TRUCKING_STATUS_CARDS)[number]) => {
    const isActive = statusFilter === card.status
    const count = Number(counts[card.status] ?? 0)
    const qtyKg = Number(contractQtys?.[card.status] ?? 0)
    const qtyLabel = formatQtyMtFromKg(qtyKg)

    const button = (
      <button
        type="button"
        // Clicking a stage while the summary/table is still loading fires a scope
        // refresh against half-loaded state (reported as "planning tab shows daily
        // actuals / cannot edit" on slow loads) — ignore clicks until settled.
        disabled={loading}
        aria-busy={loading || undefined}
        onClick={() => {
          if (!loading) onStageClick(card.status)
        }}
        className={`relative flex min-h-[6.75rem] w-36 flex-col justify-center md:w-40 rounded-xl border border-black/5 px-4 py-3 text-left shadow-sm transition-all ${
          loading ? 'cursor-wait opacity-70' : 'cursor-pointer hover:shadow-md hover:-translate-y-0.5'
        } ${card.color} ${
          isActive ? 'ring-2 ring-blue-500 ring-offset-2 shadow-md' : ''
        }`}
      >
        <div
          className={`text-xs md:text-sm font-semibold leading-tight ${card.textColor} ${
            isActive ? 'font-bold' : ''
          }`}
        >
          {card.label}
        </div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${card.textColor}`}>
          {count.toLocaleString('en-US')}
        </div>
        <div
          className={`mt-1.5 border-t border-black/10 pt-1.5 text-[11px] leading-snug ${card.textColor} opacity-80`}
        >
          <div className="font-medium">Contract Qty</div>
          <div className="mt-0.5 tabular-nums font-semibold opacity-90">{qtyLabel}</div>
        </div>
      </button>
    )

    return (
      <div className="relative">
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-h-72 max-w-xs overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed"
          >
            {card.tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Summary Trucking Status</span>
          {loading ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-blue-500"
              aria-label="Loading summary trucking status"
            />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0 pt-0 sm:px-6 sm:pb-6 sm:pt-0">
        <div
          className="overflow-x-auto overscroll-x-contain scroll-smooth [-webkit-overflow-scrolling:touch]"
          aria-label="Trucking pipeline status — scroll horizontally on small screens"
        >
          <div
            className={`mx-auto flex w-max min-w-full items-center gap-3 px-4 pb-4 pt-5 transition-opacity duration-200 md:gap-6 md:px-6 md:pb-6 md:pt-6 ${
              loading ? 'opacity-65' : 'opacity-100'
            }`}
          >
            {TRUCKING_STATUS_CARDS.map((card, index, array) => (
              <div key={card.status} className="flex flex-shrink-0 items-center">
                {renderCard(card)}
                {index < array.length - 1 && (
                  <div className="mx-2 flex-shrink-0 md:mx-3">
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="text-gray-400"
                      aria-hidden
                    >
                      <path
                        d="M9 18L15 12L9 6"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
