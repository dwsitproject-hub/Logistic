'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import {
  formatDischargePortBreakdownTooltip,
  formatLoadingPortBreakdownTooltip,
  pipelineCountForStage,
  SHIPMENT_PAGE_PIPELINE_CARDS,
  type DischargePortBreakdown,
  type LoadingPortBreakdown,
  type ShipmentPagePipelineStage,
  type ShipmentPagePipelineStatusCounts,
} from '@/lib/shipmentPagePipeline'

export interface ShipmentStatusDistributionProps {
  loading: boolean
  statusFilter: string
  counts: ShipmentPagePipelineStatusCounts
  loadingPortBreakdown: LoadingPortBreakdown
  dischargePortBreakdown: DischargePortBreakdown
  onStageClick: (stage: ShipmentPagePipelineStage) => void
}

export function ShipmentStatusDistribution({
  loading,
  statusFilter,
  counts,
  loadingPortBreakdown,
  dischargePortBreakdown,
  onStageClick,
}: ShipmentStatusDistributionProps) {
  const renderPipelineCard = (card: (typeof SHIPMENT_PAGE_PIPELINE_CARDS)[number]) => {
    const isActive = statusFilter === card.status
    const count = pipelineCountForStage(card.status, counts)
    const breakdownTooltip =
      card.breakdown === 'loading'
        ? formatLoadingPortBreakdownTooltip(loadingPortBreakdown)
        : card.breakdown === 'discharge'
          ? formatDischargePortBreakdownTooltip(dischargePortBreakdown)
          : null
    const title = breakdownTooltip ? `${card.tooltip}\n\n${breakdownTooltip}` : card.tooltip

    const button = (
      <button
        type="button"
        title={breakdownTooltip ? undefined : card.tooltip}
        onClick={() => onStageClick(card.status)}
        className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-white shadow-lg transition-all cursor-pointer hover:shadow-xl hover:scale-[1.02] ${card.color} flex items-center justify-center ${
          isActive ? 'ring-4 ring-blue-400 ring-offset-2' : ''
        }`}
      >
        <div
          className={`absolute -top-3 -right-3 text-white text-xs md:text-sm font-bold rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center shadow-lg z-10 ${card.badgeColor}`}
        >
          {count}
        </div>
        <span
          className={`text-xs md:text-sm font-semibold px-2 leading-tight ${card.textColor} text-center ${
            isActive ? 'font-bold' : ''
          }`}
        >
          {card.label}
        </span>
      </button>
    )

    return (
      <div className="relative">
        {breakdownTooltip ? (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed">
              {title}
            </TooltipContent>
          </Tooltip>
        ) : (
          button
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Summary Shipment Status</span>
          {loading ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-blue-500"
              aria-label="Loading summary shipment status"
            />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0 pt-0 sm:px-6 sm:pb-6 sm:pt-0">
        <div
          className="overflow-x-auto overscroll-x-contain scroll-smooth [-webkit-overflow-scrolling:touch]"
          aria-label="Shipment pipeline status — scroll horizontally on small screens"
        >
          <div
            className={`mx-auto flex w-max min-w-full items-center gap-3 px-4 pb-4 pt-5 transition-opacity duration-200 md:gap-6 md:px-6 md:pb-6 md:pt-6 ${
              loading ? 'opacity-65' : 'opacity-100'
            }`}
          >
            {SHIPMENT_PAGE_PIPELINE_CARDS.map((card, index, array) => (
              <div key={card.status} className="flex flex-shrink-0 items-center">
                {renderPipelineCard(card)}
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
