'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type StatusDistributionSkeletonProps = {
  /** Number of circular status placeholders (e.g. 8 shipments, 4 trucking). */
  itemCount: number
  variant: 'shipments' | 'trucking'
}

function StatusDistributionSkeletonItem({ showArrow }: { showArrow: boolean }) {
  return (
    <div className="flex items-center flex-shrink-0">
      <div className="relative">
        <Skeleton className="w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-white shadow-lg" />
        <Skeleton className="absolute -top-3 -right-3 w-8 h-8 md:w-9 md:h-9 rounded-full" />
        <Skeleton className="absolute left-1/2 top-1/2 h-3 w-14 md:w-16 -translate-x-1/2 -translate-y-1/2 rounded" />
      </div>
      {showArrow ? (
        <div className="flex-shrink-0 mx-2 md:mx-3">
          <Skeleton className="h-7 w-7 rounded-full" />
        </div>
      ) : null}
    </div>
  )
}

/** Section 1 status distribution placeholder — mirrors real card row layout to prevent layout shift. */
export function StatusDistributionSkeleton({ itemCount, variant }: StatusDistributionSkeletonProps) {
  const items = Array.from({ length: Math.max(1, itemCount) }, (_, i) => i)

  const row =
    variant === 'shipments' ? (
      <div className="flex flex-nowrap items-center shrink-0">
        {items.map((i) => (
          <StatusDistributionSkeletonItem key={i} showArrow={i < items.length - 1} />
        ))}
      </div>
    ) : (
      <>
        {items.map((i) => (
          <StatusDistributionSkeletonItem key={i} showArrow={i < items.length - 1} />
        ))}
      </>
    )

  return (
    <div
      className={cn(
        'overflow-x-auto py-4 px-4',
        variant === 'shipments'
          ? 'flex w-full min-w-0 items-center justify-start gap-3 md:gap-6'
          : 'flex items-center justify-center gap-3 md:gap-6',
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading status distribution"
    >
      {row}
    </div>
  )
}
