'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Ship } from 'lucide-react'
import {
  formatDischargePortBreakdownTooltip,
  formatLoadingPortBreakdownTooltip,
  pipelineCountForStage,
  pipelineVesselNamesForStage,
  splitVesselNamesForCard,
  SHIPMENT_PAGE_PIPELINE_CARDS,
  type DischargePortBreakdown,
  type LoadingPortBreakdown,
  type ShipmentPagePipelineStage,
  type ShipmentPagePipelineStatusCounts,
  type ShipmentPagePipelineVesselNames,
} from '@/lib/shipmentPagePipeline'

export interface ShipmentStatusDistributionProps {
  loading: boolean
  statusFilter: string
  counts: ShipmentPagePipelineStatusCounts
  vesselNames?: ShipmentPagePipelineVesselNames
  loadingPortBreakdown: LoadingPortBreakdown
  dischargePortBreakdown: DischargePortBreakdown
  onStageClick: (stage: ShipmentPagePipelineStage) => void
}

export function ShipmentStatusDistribution({
  loading,
  statusFilter,
  counts,
  vesselNames,
  loadingPortBreakdown,
  dischargePortBreakdown,
  onStageClick,
}: ShipmentStatusDistributionProps) {
  const renderPipelineCard = (card: (typeof SHIPMENT_PAGE_PIPELINE_CARDS)[number]) => {
    const isActive = statusFilter === card.status
    const count = pipelineCountForStage(card.status, counts)
    const stageVessels = pipelineVesselNamesForStage(card.status, vesselNames) ?? []
    const { preview, moreCount } = splitVesselNamesForCard(stageVessels)
    const breakdownTooltip =
      card.breakdown === 'loading'
        ? formatLoadingPortBreakdownTooltip(loadingPortBreakdown)
        : card.breakdown === 'discharge'
          ? formatDischargePortBreakdownTooltip(dischargePortBreakdown)
          : null
    const vesselListTooltip =
      stageVessels.length > 0
        ? `Vessels (${stageVessels.length}):\n${stageVessels.join('\n')}`
        : null
    const tooltipBody = [card.tooltip, breakdownTooltip, vesselListTooltip]
      .filter(Boolean)
      .join('\n\n')

    const button = (
      <button
        type="button"
        onClick={() => onStageClick(card.status)}
        className={`relative flex h-full min-h-[11.5rem] w-40 flex-col md:w-44 rounded-xl border border-black/5 px-4 py-3 text-left shadow-sm transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5 ${card.color} ${
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
          className={`mt-1.5 flex min-h-[4.75rem] flex-1 flex-col border-t border-black/10 pt-1.5 text-[11px] font-medium ${card.textColor}`}
        >
          <div className="flex items-center gap-1 opacity-80">
            <Ship className="h-3 w-3 shrink-0" aria-hidden />
            <span>{stageVessels.length === 0 ? 'No vessels' : 'Vessels'}</span>
          </div>
          {preview.length > 0 ? (
            <ul className="mt-1 space-y-0.5 opacity-90">
              {preview.map((name) => (
                <li key={name} className="truncate leading-tight" title={name}>
                  {name}
                </li>
              ))}
              {moreCount > 0 ? (
                <li className="font-semibold opacity-80">+{moreCount.toLocaleString('en-US')} more</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </button>
    )

    return (
      <div className="relative h-full">
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-h-72 max-w-xs overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed"
          >
            {tooltipBody}
          </TooltipContent>
        </Tooltip>
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
            className={`mx-auto flex w-max min-w-full items-stretch gap-3 px-4 pb-4 pt-5 transition-opacity duration-200 md:gap-6 md:px-6 md:pb-6 md:pt-6 ${
              loading ? 'opacity-65' : 'opacity-100'
            }`}
          >
            {SHIPMENT_PAGE_PIPELINE_CARDS.map((card, index, array) => (
              <div key={card.status} className="flex flex-shrink-0 items-stretch self-stretch">
                {renderPipelineCard(card)}
                {index < array.length - 1 && (
                  <div className="mx-2 flex flex-shrink-0 items-center self-center md:mx-3">
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
