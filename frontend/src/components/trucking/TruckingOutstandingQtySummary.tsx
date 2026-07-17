'use client'

import { Loader2, Truck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatOutstandingQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'

export interface TruckingOutstandingQtyBucket {
  frcKg: number
  lcoKg: number
}

export interface TruckingOutstandingQtySummaryData {
  totalKg: number
  thirdParty: TruckingOutstandingQtyBucket
  interco: TruckingOutstandingQtyBucket
}

export const EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY: TruckingOutstandingQtySummaryData = {
  totalKg: 0,
  thirdParty: { frcKg: 0, lcoKg: 0 },
  interco: { frcKg: 0, lcoKg: 0 },
}

type TruckingOutstandingQtySummaryProps = {
  loading?: boolean
  data: TruckingOutstandingQtySummaryData | null | undefined
}

function BucketColumn({
  title,
  bucket,
}: {
  title: string
  bucket: TruckingOutstandingQtyBucket
}) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="mt-2 space-y-1 text-sm text-gray-600">
        <div className="flex items-baseline justify-between gap-3">
          <span>FRC</span>
          <span className={cn('font-semibold tabular-nums', outstandingQtyMtColorClass(bucket.frcKg))}>
            {formatOutstandingQtyMtFromKg(bucket.frcKg, { maxFractionDigits: 0 })}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span>LCO</span>
          <span className={cn('font-semibold tabular-nums', outstandingQtyMtColorClass(bucket.lcoKg))}>
            {formatOutstandingQtyMtFromKg(bucket.lcoKg, { maxFractionDigits: 0 })}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Toolbar-scoped Outstanding Qty strip (FRC/LCO × Interco / 3rd Party).
 * Static across status-card clicks (Unplanned / Planned / In Progress total).
 */
export function TruckingOutstandingQtySummary({
  loading = false,
  data,
}: TruckingOutstandingQtySummaryProps) {
  const summary = data ?? EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div
          className={cn(
            'grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 transition-opacity duration-200',
            loading ? 'opacity-65' : 'opacity-100',
          )}
        >
          <div className="flex min-w-0 items-start gap-3 rounded-xl border border-amber-100 bg-gradient-to-r from-amber-50/80 to-orange-50/40 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <Truck className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <span>Outstanding Qty</span>
                {loading ? (
                  <Loader2
                    className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600"
                    aria-label="Loading outstanding qty"
                  />
                ) : null}
              </div>
              <div
                className={cn(
                  'mt-1 text-2xl font-bold tabular-nums',
                  outstandingQtyMtColorClass(summary.totalKg),
                )}
              >
                {formatOutstandingQtyMtFromKg(summary.totalKg, { maxFractionDigits: 0 })}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-500">
                FRC + LCO · after WB · Unplanned / Planned / In Progress
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <BucketColumn title="3rd Party" bucket={summary.thirdParty} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <BucketColumn title="Interco" bucket={summary.interco} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
