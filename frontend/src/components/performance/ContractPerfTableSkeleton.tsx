'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type ContractPerfTableSkeletonProps = {
  columnCount?: number
  rowCount?: number
  className?: string
}

/** Section 3 table placeholder — fixed min-height to limit layout shift while data loads. */
export function ContractPerfTableSkeleton({
  columnCount = 10,
  rowCount = 8,
  className,
}: ContractPerfTableSkeletonProps) {
  const cols = Math.max(6, Math.min(columnCount, 14))

  return (
    <div
      className={cn('min-h-[480px]', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading contract table"
    >
      <div className="hidden lg:block border rounded-lg overflow-hidden bg-white">
        <div className="border-b bg-gray-50 px-3 py-3 flex gap-2">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton
              key={`h-${i}`}
              className="h-4 flex-1 min-w-[64px] max-w-[128px]"
              style={{ maxWidth: i === 0 ? 140 : 110 }}
            />
          ))}
          <Skeleton className="h-4 w-14 shrink-0" />
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: rowCount }).map((_, row) => (
            <div key={row} className="px-3 py-3.5 flex gap-2 items-center">
              {Array.from({ length: cols }).map((_, col) => (
                <Skeleton
                  key={`${row}-${col}`}
                  className={cn('h-4 flex-1 min-w-[56px]', col === 0 ? 'max-w-[140px]' : 'max-w-[100px]')}
                />
              ))}
              <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      <div className="lg:hidden space-y-3">
        {Array.from({ length: Math.min(rowCount, 6) }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-3 bg-white">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 shrink-0 rounded" />
              <Skeleton className="h-5 flex-1 max-w-[200px]" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export type ContractTableBodySkeletonProps = {
  columnCount: number
  rowCount?: number
  actionsColMinWidth?: 'compact' | 'wide'
  /** When false, skeleton rows match tables without a trailing Actions column. */
  showActionsColumn?: boolean
}

/** Placeholder rows inside an existing <tbody> — keeps <thead> visible during refetch. */
export function ContractTableBodySkeleton({
  columnCount,
  rowCount = 8,
  actionsColMinWidth = 'wide',
  showActionsColumn = true,
}: ContractTableBodySkeletonProps) {
  const cols = Math.max(1, columnCount)
  const actionsMin = actionsColMinWidth === 'compact' ? 'min-w-[80px]' : 'min-w-[160px]'

  return (
    <>
      {Array.from({ length: rowCount }).map((_, idx) => {
        const stripeClass = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
        return (
          <tr key={`sk-row-${idx}`} className={stripeClass} aria-hidden>
            {Array.from({ length: cols }).map((__, colIdx) => (
              <td
                key={`sk-${idx}-${colIdx}`}
                className={`min-w-0 align-middle px-2 py-1.5 ${stripeClass}`}
              >
                <div className="flex items-center min-h-[32px] min-w-0">
                  <div
                    className={`h-4 bg-gray-200 rounded animate-pulse ${
                      colIdx % 3 === 0 ? 'w-full max-w-[128px]' : colIdx % 3 === 1 ? 'w-3/4' : 'w-1/2'
                    }`}
                  />
                </div>
              </td>
            ))}
            {showActionsColumn ? (
              <td
                className={`sticky right-0 z-10 border-l border-gray-200 align-middle px-4 py-1.5 ${stripeClass} ${actionsMin}`}
              >
                <div
                  className={`flex items-center gap-2 ${
                    actionsColMinWidth === 'compact' ? 'justify-center' : 'justify-end'
                  }`}
                >
                  <div className="h-8 w-8 bg-gray-200 rounded animate-pulse shrink-0" />
                  {actionsColMinWidth === 'wide' ? (
                    <>
                      <div className="h-8 w-8 bg-gray-200 rounded animate-pulse shrink-0" />
                      <div className="h-8 w-8 bg-gray-200 rounded animate-pulse shrink-0" />
                    </>
                  ) : null}
                </div>
              </td>
            ) : null}
          </tr>
        )
      })}
    </>
  )
}

/** Mobile card placeholders while Section 3 data loads. */
export function ContractPerfTableMobileSkeleton({
  rowCount = 6,
  className,
}: {
  rowCount?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-busy="true" aria-label="Loading contracts">
      {Array.from({ length: rowCount }).map((_, i) => (
        <div key={i} className="border rounded-lg p-4 space-y-3 bg-white">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 shrink-0 rounded bg-gray-200 animate-pulse" />
            <div className="h-5 flex-1 max-w-[200px] rounded bg-gray-200 animate-pulse" />
            <div className="h-6 w-16 rounded-full bg-gray-200 animate-pulse" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-4 w-full rounded bg-gray-200 animate-pulse" />
            <div className="h-4 w-full rounded bg-gray-200 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-gray-200 animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-gray-200 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Section 3 CardHeader subtitle — matches compact “N contracts · Linked · … · Page · rows” line. */
export function ContractPerfTableSubtitleSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 max-w-full', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading contract summary"
    >
      <Skeleton className="h-3.5 w-[88px] shrink-0" />
      <span className="text-gray-300 select-none" aria-hidden>
        ·
      </span>
      <Skeleton className="h-3.5 w-[100px] shrink-0" />
      <span className="text-gray-300 select-none" aria-hidden>
        ·
      </span>
      <Skeleton className="h-3.5 w-[120px] shrink-0" />
    </div>
  )
}
