'use client'

import { useMemo } from 'react'
import { AlertTriangle, Loader2, Ship } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
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

export interface ShipmentEtcNoAtcDueWithin7dData {
  count: number
  outstandingQtyKg: number
}

export const EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY: ShipmentOutstandingQtySummaryData = {
  totalKg: 0,
  thirdParty: { fobKg: 0, cifKg: 0, cfrKg: 0 },
  interco: { fobKg: 0, cifKg: 0, cfrKg: 0 },
  otherKg: 0,
}

export const EMPTY_SHIPMENT_ETC_NO_ATC_DUE: ShipmentEtcNoAtcDueWithin7dData = {
  count: 0,
  outstandingQtyKg: 0,
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
  etcNoAtcDue?: ShipmentEtcNoAtcDueWithin7dData | null
  etcNoAtcDueLoading?: boolean
  etcNoAtcDueActive?: boolean
  onEtcNoAtcDueClick?: () => void
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
  etcNoAtcDue,
  etcNoAtcDueLoading = false,
  etcNoAtcDueActive = false,
  onEtcNoAtcDueClick,
}: ShipmentOutstandingQtySummaryProps) {
  const summary = data ?? null
  const pending = loading && summary == null
  const helpText = useMemo(() => buildOutstandingQtyStripHelpText(summary), [summary])

  const etcPending = etcNoAtcDueLoading && etcNoAtcDue == null
  const etcCount = Number(etcNoAtcDue?.count ?? 0) || 0
  const etcOsKg = Number(etcNoAtcDue?.outstandingQtyKg ?? 0) || 0

  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div
          className={cn(
            'grid grid-cols-1 items-stretch gap-4 transition-opacity duration-200',
            'md:grid-cols-[minmax(8.5rem,0.65fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-4',
            loading || etcNoAtcDueLoading ? 'opacity-65' : 'opacity-100',
          )}
        >
          <button
            type="button"
            onClick={onEtcNoAtcDueClick}
            disabled={!onEtcNoAtcDueClick}
            className={cn(
              'flex h-full min-w-0 flex-col rounded-xl border border-red-200/90 bg-gradient-to-r from-red-50 to-rose-50 p-3 text-left shadow-sm transition-all',
              onEtcNoAtcDueClick &&
                'cursor-pointer hover:border-red-300 hover:from-red-100 hover:to-rose-100 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2',
              etcNoAtcDueActive && 'ring-2 ring-red-400 ring-offset-2 shadow-md',
              !onEtcNoAtcDueClick && 'cursor-default',
            )}
            title="Show shipments with no ATC, overdue or due within 7 days"
          >
            <div className="flex items-start gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-800">
                <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1 text-[11px] font-semibold leading-tight text-red-950">
                  <span>Pending ATC (Overdue / Due ≤7d)</span>
                  <FieldHelp text={FIELD_HELP.shipmentEtcNoAtcDueWithin7d} />
                  {etcNoAtcDueLoading ? (
                    <Loader2
                      className="h-3 w-3 shrink-0 animate-spin text-red-700"
                      aria-label="Loading pending ATC KPI"
                    />
                  ) : null}
                </div>
                <div
                  className={cn(
                    'mt-1 text-xl font-bold tabular-nums text-red-950',
                    etcPending && 'text-red-400',
                  )}
                >
                  {etcPending ? '—' : etcCount.toLocaleString('en-US')}
                </div>
                <p className="mt-0.5 text-[10px] font-medium text-red-950/75">Shipments</p>
                <div className="mt-2 border-t border-red-200/70 pt-1.5 text-[10px] leading-snug text-red-950">
                  <div className="font-medium opacity-75">OS Qty</div>
                  <div
                    className={cn(
                      'mt-0.5 text-sm font-semibold tabular-nums',
                      etcPending ? 'text-red-400' : outstandingQtyMtColorClass(etcOsKg),
                    )}
                  >
                    {etcPending
                      ? formatOutstandingQtyMtFromKg(0, { maxFractionDigits: 0 })
                      : formatOutstandingQtyMtFromKg(etcOsKg, { maxFractionDigits: 0 })}
                  </div>
                </div>
              </div>
            </div>
          </button>

          <div className="flex h-full min-w-0 items-start gap-3 rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50/80 to-cyan-50/40 p-4">
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

          <div className="h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <BucketColumn title="3rd Party" bucket={summary?.thirdParty ?? null} pending={pending} />
          </div>

          <div className="h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <BucketColumn title="Interco" bucket={summary?.interco ?? null} pending={pending} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
