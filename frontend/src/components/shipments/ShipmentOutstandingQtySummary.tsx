'use client'

import { Loader2, Ship } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatOutstandingQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'

export interface ShipmentOutstandingQtyBucket {
  fobKg: number
  cifKg: number
}

export interface ShipmentOutstandingQtySummaryData {
  totalKg: number
  thirdParty: ShipmentOutstandingQtyBucket
  interco: ShipmentOutstandingQtyBucket
}

export const EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY: ShipmentOutstandingQtySummaryData = {
  totalKg: 0,
  thirdParty: { fobKg: 0, cifKg: 0 },
  interco: { fobKg: 0, cifKg: 0 },
}

type ShipmentOutstandingQtySummaryProps = {
  loading?: boolean
  data: ShipmentOutstandingQtySummaryData | null | undefined
}

function formatQtyOrPending(
  kg: number | undefined,
  pending: boolean,
): string {
  if (pending) return formatOutstandingQtyMtFromKg(0, { maxFractionDigits: 0 })
  return formatOutstandingQtyMtFromKg(kg, { maxFractionDigits: 0 })
}

function BucketColumn({
  title,
  bucket,
  pending,
}: {
  title: string
  bucket: ShipmentOutstandingQtyBucket | null
  pending: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="mt-2 space-y-1 text-sm text-gray-600">
        <div className="flex items-baseline justify-between gap-3">
          <span>FOB</span>
          <span
            className={cn(
              'font-semibold tabular-nums',
              pending ? 'text-gray-400' : outstandingQtyMtColorClass(bucket?.fobKg),
            )}
          >
            {formatQtyOrPending(bucket?.fobKg, pending)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span>CIF</span>
          <span
            className={cn(
              'font-semibold tabular-nums',
              pending ? 'text-gray-400' : outstandingQtyMtColorClass(bucket?.cifKg),
            )}
          >
            {formatQtyOrPending(bucket?.cifKg, pending)}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Toolbar + status-card scoped Outstanding Qty strip (FOB/CIF × Interco / 3rd Party).
 * Shows 0 MT while loading when no prior value is available yet.
 */
export function ShipmentOutstandingQtySummary({
  loading = false,
  data,
}: ShipmentOutstandingQtySummaryProps) {
  const pending = loading && data == null
  const summary = data ?? null

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div
          className={cn(
            'grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 transition-opacity duration-200',
            loading ? 'opacity-65' : 'opacity-100',
          )}
        >
          <div className="flex min-w-0 items-start gap-3 rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50/80 to-cyan-50/40 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-800">
              <Ship className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <span>Outstanding Qty</span>
                {loading ? (
                  <Loader2
                    className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-600"
                    aria-label="Loading outstanding qty"
                  />
                ) : null}
              </div>
              <div
                className={cn(
                  'mt-1 text-2xl font-bold tabular-nums',
                  pending ? 'text-gray-400' : outstandingQtyMtColorClass(summary?.totalKg),
                )}
              >
                {formatQtyOrPending(summary?.totalKg, pending)}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-500">
                FOB + CIF · Unplanned / Planned / At LP / Sailed / At DP
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <BucketColumn title="3rd Party" bucket={summary?.thirdParty ?? null} pending={pending} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <BucketColumn title="Interco" bucket={summary?.interco ?? null} pending={pending} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
