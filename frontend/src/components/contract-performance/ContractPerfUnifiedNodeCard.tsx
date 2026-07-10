'use client'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type UnifiedPerfNode,
  type UnifiedPerfNodeLevel,
  type UnifiedPerfSegment,
} from '@/lib/contractPerfUnifiedDrilldown'

export type PerfSegmentFilter = 'ALL' | 'ON_TIME' | 'LATE'

const SEGMENTS: PerfSegmentFilter[] = ['ALL', 'ON_TIME', 'LATE']

const LEVEL_CARD_BORDER: Record<
  UnifiedPerfNodeLevel,
  { idle: string; selected: string }
> = {
  product: {
    idle: 'border-gray-200 hover:border-gray-300',
    selected: 'border-amber-200/90 ring-1 ring-amber-100/80',
  },
  plant: {
    idle: 'border-gray-200 hover:border-gray-300',
    selected: 'border-emerald-200/90 ring-1 ring-emerald-100/80',
  },
  incoterm: {
    idle: 'border-gray-200 hover:border-gray-300',
    selected: 'border-violet-200/90 ring-1 ring-violet-100/80',
  },
  supplier: {
    idle: 'border-gray-200 hover:border-gray-300',
    selected: 'border-rose-200/90 ring-1 ring-rose-100/80',
  },
}

const SEGMENT_UI: Record<
  PerfSegmentFilter,
  {
    label: string
    idle: string
    active: string
    count: string
  }
> = {
  ALL: {
    label: 'All',
    idle: 'bg-slate-50/80 border-slate-100 text-slate-800',
    active: 'bg-white border-blue-500 shadow-sm ring-1 ring-blue-100',
    count: 'text-slate-800',
  },
  ON_TIME: {
    label: 'On Time',
    idle: 'bg-emerald-50/40 border-emerald-100/60 text-emerald-700',
    active: 'bg-white border-emerald-500 shadow-sm ring-1 ring-emerald-100',
    count: 'text-emerald-700',
  },
  LATE: {
    label: 'Late',
    idle: 'bg-rose-50/40 border-rose-100/60 text-rose-700',
    active: 'bg-white border-rose-500 shadow-sm ring-1 ring-rose-100',
    count: 'text-rose-700',
  },
}

/** Display MT with suffix (segment card primary value). */
export function formatSegmentCardQtyMt(kg: number): string {
  const mt = (kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return `${mt} MT`
}

export function formatSegmentCardAvgTrade(days: number | null): string {
  if (days == null || Number.isNaN(days)) return '—'
  return `${days.toFixed(1)} days`
}

export function buildSegmentCardTooltip(metrics: UnifiedPerfSegment): string {
  return `Total Contract: ${metrics.count.toLocaleString('en-US')}\nAvg Trade: ${formatSegmentCardAvgTrade(metrics.avgTradeDays)}`
}

function SegmentBlock({
  segment,
  metrics,
  isActive,
  disabled,
  onSelect,
}: {
  segment: PerfSegmentFilter
  metrics: UnifiedPerfSegment
  isActive: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const ui = SEGMENT_UI[segment]

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onSelect}
          aria-pressed={isActive}
          className={cn(
            'min-w-0 w-full px-1 py-1 rounded-md border text-center transition-all duration-150',
            isActive ? ui.active : ui.idle,
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:brightness-[0.98]',
          )}
        >
          <div className="flex flex-col items-center gap-0 pointer-events-none min-w-0 w-full">
            <span className={cn('text-[10px] leading-none', ui.count)}>{ui.label}</span>
            <span className={cn('text-xs tabular-nums leading-tight mt-0.5 font-medium', ui.count)}>
              {formatSegmentCardQtyMt(metrics.totalQtyKg)}
            </span>
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs whitespace-pre-line">
        {buildSegmentCardTooltip(metrics)}
      </TooltipContent>
    </Tooltip>
  )
}

/** Flat drilldown row — label + compact 3-column segment grid (All | On Time | Late). */
export function ContractPerfUnifiedNodeCard({
  node,
  level,
  selected,
  activeSegment,
  disabled,
  summaryCardStatus,
  onSegmentSelect,
}: {
  node: UnifiedPerfNode
  level: UnifiedPerfNodeLevel
  summaryCardStatus?: 'All' | 'Open' | 'Close'
  selected: boolean
  activeSegment: PerfSegmentFilter
  disabled?: boolean
  onSegmentSelect: (segment: PerfSegmentFilter) => void
}) {
  const levelBorder = LEVEL_CARD_BORDER[level]

  return (
    <div
      className={cn(
        'w-full rounded-lg border bg-white px-3 py-1.5 transition-colors',
        selected ? levelBorder.selected : levelBorder.idle,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSegmentSelect(activeSegment)}
        className={cn(
          'text-sm font-semibold text-gray-900 truncate text-left w-full',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:text-gray-700',
        )}
      >
        {node.label}
      </button>
      <div className="grid grid-cols-3 gap-1 mt-1">
        {SEGMENTS.map((segment) => (
          <SegmentBlock
            key={segment}
            segment={segment}
            metrics={segment === 'ALL' ? node.all : segment === 'ON_TIME' ? node.onTime : node.late}
            isActive={selected && activeSegment === segment}
            disabled={disabled}
            onSelect={() => onSegmentSelect(segment)}
          />
        ))}
      </div>
    </div>
  )
}
