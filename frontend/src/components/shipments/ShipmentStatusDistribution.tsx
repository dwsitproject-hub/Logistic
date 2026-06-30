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
      <CardContent>
        <div
          className={`flex w-full min-w-0 items-center justify-start gap-3 overflow-x-auto py-4 px-4 md:gap-6 transition-opacity duration-200 ${
            loading ? 'opacity-65' : 'opacity-100'
          }`}
        >
          <div className="flex flex-nowrap items-center shrink-0">
            {SHIPMENT_PAGE_PIPELINE_CARDS.map((card, index, array) => {
              const isActive = statusFilter === card.status
              const count = pipelineCountForStage(card.status, counts)
              const breakdownTooltip =
                card.breakdown === 'loading'
                  ? formatLoadingPortBreakdownTooltip(loadingPortBreakdown)
                  : card.breakdown === 'discharge'
                    ? formatDischargePortBreakdownTooltip(dischargePortBreakdown)
                    : null
              const title = breakdownTooltip
                ? `${card.tooltip}\n\n${breakdownTooltip}`
                : card.tooltip

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
                    className={`text-xs md:text-sm font-semibold px-2 leading-tight ${card.textColor} text-center`}
                  >
                    {card.label}
                  </span>
                </button>
              )

              return (
                <div key={card.status} className="flex items-center flex-shrink-0">
                  <div className="relative">
                    {breakdownTooltip ? (
                      <Tooltip delayDuration={200}>
                        <TooltipTrigger asChild>{button}</TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          className="max-w-xs whitespace-pre-wrap text-xs leading-relaxed"
                        >
                          {title}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      button
                    )}
                  </div>
                  {index < array.length - 1 && (
                    <div className="flex-shrink-0 mx-2 md:mx-3">
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
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
