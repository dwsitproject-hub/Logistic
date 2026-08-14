'use client'

import { useMemo } from 'react'
import { Loader2, Truck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FieldHelp } from '@/components/FieldHelp'
import { cn, formatOutstandingQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'

export interface TruckingOutstandingQtyBucket {
  frcKg: number
  lcoKg: number
}

export interface TruckingOutstandingQtySummaryData {
  totalKg: number
  thirdParty: TruckingOutstandingQtyBucket
  interco: TruckingOutstandingQtyBucket
  otherKg?: number
}

export const EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY: TruckingOutstandingQtySummaryData = {
  totalKg: 0,
  thirdParty: { frcKg: 0, lcoKg: 0 },
  interco: { frcKg: 0, lcoKg: 0 },
  otherKg: 0,
}

function sumClassifiedBucketsKg(data: TruckingOutstandingQtySummaryData): number {
  return (
    (data.thirdParty?.frcKg ?? 0) +
    (data.thirdParty?.lcoKg ?? 0) +
    (data.interco?.frcKg ?? 0) +
    (data.interco?.lcoKg ?? 0)
  )
}

export function buildTruckingOutstandingQtyStripHelpText(
  data: TruckingOutstandingQtySummaryData | null | undefined,
): string {
  const lines = [
    'Total equals Unplanned Outstanding Qty plus Planned Outstanding Qty on the status cards (over-delivery is floored at 0). Planned includes In Progress.',
    '3rd Party and Interco are that same mix, sliced by source (3rd Party / Interco-Inhouse) and incoterm (FRC / LCO).',
  ]
  const otherKg = Number(data?.otherKg ?? 0) || 0
  if (otherKg > 0) {
    lines.push(
      `Other ${formatOutstandingQtyMtFromKg(otherKg, { maxFractionDigits: 0 })} does not classify as 3rd Party or Interco × FRC/LCO (blank/other source or incoterm) — not shown as a column. 3rd Party + Interco + Other = Total.`,
    )
  } else {
    lines.push('When every tonne classifies as 3rd Party or Interco × FRC/LCO, Other is 0.')
  }
  return lines.join('\n\n')
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
 * Toolbar-scoped Outstanding Qty strip.
 * Total = Unplanned OS + Planned/In Progress OS (clamped at 0).
 */
export function TruckingOutstandingQtySummary({
  loading = false,
  data,
}: TruckingOutstandingQtySummaryProps) {
  const summary = data ?? EMPTY_TRUCKING_OUTSTANDING_QTY_SUMMARY
  const helpText = useMemo(
    () =>
      buildTruckingOutstandingQtyStripHelpText({
        ...summary,
        otherKg: summary.otherKg ?? Math.max(0, summary.totalKg - sumClassifiedBucketsKg(summary)),
      }),
    [summary],
  )

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
                <FieldHelp text={helpText} />
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
                Unplanned OS + Planned OS
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
