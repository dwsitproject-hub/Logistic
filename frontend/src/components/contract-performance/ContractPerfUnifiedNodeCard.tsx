'use client'

import { cn } from '@/lib/utils'
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
    label: 'all',
    idle: 'bg-slate-50/80 border-slate-100 text-slate-800',
    active: 'bg-white border-blue-500 shadow-sm ring-1 ring-blue-100',
    count: 'text-slate-800',
  },
  ON_TIME: {
    label: 'on time',
    idle: 'bg-emerald-50/40 border-emerald-100/60 text-emerald-700',
    active: 'bg-white border-emerald-500 shadow-sm ring-1 ring-emerald-100',
    count: 'text-emerald-700',
  },
  LATE: {
    label: 'late',
    idle: 'bg-rose-50/40 border-rose-100/60 text-rose-700',
    active: 'bg-white border-rose-500 shadow-sm ring-1 ring-rose-100',
    count: 'text-rose-700',
  },
}

function formatCompactAvgValue(days: number | null): string {
  if (days == null || Number.isNaN(days)) return '—'
  return `${days.toFixed(1)}d`
}

/** Display MT with suffix (compact row). */
function formatCompactQtyValue(kg: number): string {
  const mt = (kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return `${mt}MT`
}

function segmentStatsTooltip(summaryCardStatus?: 'All' | 'Open' | 'Close'): string {
  if (summaryCardStatus === 'Open') {
    return 'Avg Trade (days) | Outstanding Qty (MT)'
  }
  if (summaryCardStatus === 'Close') {
    return 'Avg Trade (days) | Contract Qty (MT)'
  }
  return 'Avg Trade (days) | Qty (MT)'
}

function SegmentBlock({
  segment,
  metrics,
  isActive,
  disabled,
  summaryCardStatus,
  onSelect,
}: {
  segment: PerfSegmentFilter
  metrics: UnifiedPerfSegment
  isActive: boolean
  disabled?: boolean
  summaryCardStatus?: 'All' | 'Open' | 'Close'
  onSelect: () => void
}) {
  const ui = SEGMENT_UI[segment]

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={isActive}
      className={cn(
        'min-w-0 p-1 rounded-md border text-center transition-all duration-150',
        isActive ? ui.active : ui.idle,
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:brightness-[0.98]',
      )}
    >
      <div className="leading-none pointer-events-none whitespace-nowrap">
        <span className="text-[8px] tracking-tight font-semibold text-slate-500 normal-case">{ui.label}</span>
        <span className="text-[8px] font-normal text-slate-300 mx-px" aria-hidden>
          -
        </span>
        <span className={cn('text-xs font-extrabold tabular-nums', ui.count)}>
          {metrics.count.toLocaleString('en-US')}
        </span>
        <span className="text-[8px] font-normal text-slate-400 ml-0.5">Ctx</span>
      </div>
      <div
        className="flex items-center justify-center gap-0.5 mt-0.5 pt-0.5 border-t border-slate-100/60 text-[9px] font-semibold text-gray-900 tabular-nums leading-none"
        title={segmentStatsTooltip(summaryCardStatus)}
      >
        <span>{formatCompactAvgValue(metrics.avgTradeDays)}</span>
        <span className="text-gray-300 shrink-0" aria-hidden>
          |
        </span>
        <span>{formatCompactQtyValue(metrics.totalQtyKg)}</span>
      </div>
    </button>
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
        'w-full rounded-lg border bg-white px-3 py-2 transition-colors',
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
      <div className="grid grid-cols-3 gap-1.5 mt-1.5">
        {SEGMENTS.map((segment) => (
          <SegmentBlock
            key={segment}
            segment={segment}
            metrics={segment === 'ALL' ? node.all : segment === 'ON_TIME' ? node.onTime : node.late}
            isActive={selected && activeSegment === segment}
            disabled={disabled}
            summaryCardStatus={summaryCardStatus}
            onSelect={() => onSegmentSelect(segment)}
          />
        ))}
      </div>
    </div>
  )
}
