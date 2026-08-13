'use client'

import { useMemo } from 'react'
import { Loader2, Ship } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FieldHelp } from '@/components/FieldHelp'
import { cn, formatOutstandingQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'

export interface ShipmentOutstandingQtyBucket {
  fobKg: number
  cifKg: number
  cfrKg: number
}

export interface ShipmentOutstandingQtySummaryData {
  totalKg: number
  thirdParty: ShipmentOutstandingQtyBucket
  interco: ShipmentOutstandingQtyBucket
  bucketsComplete?: boolean
  /** Residual so 3rd+Interco+Other = total; helper/tooltip only — not a column. */
  otherKg?: number
}

export const EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY: ShipmentOutstandingQtySummaryData = {
  totalKg: 0,
  thirdParty: { fobKg: 0, cifKg: 0, cfrKg: 0 },
  interco: { fobKg: 0, cifKg: 0, cfrKg: 0 },
  otherKg: 0,
}

function sumClassifiedBucketsKg(data: ShipmentOutstandingQtySummaryData): number {
  const t = data.thirdParty
  const i = data.interco
  return (
    (t?.fobKg ?? 0) +
    (t?.cifKg ?? 0) +
    (t?.cfrKg ?? 0) +
    (i?.fobKg ?? 0) +
    (i?.cifKg ?? 0) +
    (i?.cfrKg ?? 0)
  )
}

/** Reconcile Other residual for display (matches backend reconcile). */
export function reconcileOutstandingQtyStripForDisplay(
  data: ShipmentOutstandingQtySummaryData,
  cardTotalKg?: number | null,
): ShipmentOutstandingQtySummaryData {
  const classified = sumClassifiedBucketsKg(data)
  const totalKg =
    cardTotalKg != null && Number.isFinite(Number(cardTotalKg))
      ? Number(cardTotalKg) || 0
      : Number(data.totalKg) || 0
  return {
    ...data,
    totalKg,
    otherKg: Math.max(0, totalKg - classified),
  }
}

export function buildOutstandingQtyStripHelpText(
  data: ShipmentOutstandingQtySummaryData | null | undefined,
): string {
  const lines = [
    'Total equals the sum of Outstanding Qty on the six status cards (Unplanned, Preplanned, Planned, At Loading Port, Sailed, At Discharge Port).',
    '3rd Party and Interco are that same OS, sliced only by source (3rd Party / Interco-Inhouse) and incoterm (FOB / CIF / CFR). Unplanned and Preplanned are included.',
  ]
  const otherKg = Number(data?.otherKg ?? 0) || 0
  if (otherKg > 0) {
    lines.push(
      `Other ${formatOutstandingQtyMtFromKg(otherKg, { maxFractionDigits: 0 })} is OS that does not classify as 3rd Party or Interco × FOB/CIF/CFR (blank/other source or incoterm) — not shown as a column. 3rd Party + Interco + Other = Total.`,
    )
  } else {
    lines.push('When every tonne classifies as 3rd Party or Interco × FOB/CIF/CFR, Other is 0.')
  }
  return lines.join('\n\n')
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
        <div className="flex items-baseline justify-between gap-3">
          <span>CFR</span>
          <span
            className={cn(
              'font-semibold tabular-nums',
              pending ? 'text-gray-400' : outstandingQtyMtColorClass(bucket?.cfrKg),
            )}
          >
            {formatQtyOrPending(bucket?.cfrKg, pending)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ShipmentOutstandingQtySummary({
  loading = false,
  data,
}: ShipmentOutstandingQtySummaryProps) {
  const summary = data ?? null
  const pending = loading && summary == null
  const helpText = useMemo(() => buildOutstandingQtyStripHelpText(summary), [summary])

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
                <FieldHelp text={helpText} />
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
                Matches status-card OS sum · 3rd Party + Interco + Other (in help) = Total
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
