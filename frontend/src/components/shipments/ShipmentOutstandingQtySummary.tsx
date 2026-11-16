'use client'

import { useMemo } from 'react'
import { Loader2, Ship } from 'lucide-react'
import { StitchAlertIcon } from '@/components/shared/stitchIcons'
import {
  OutstandingStripBucket,
  OutstandingStripFrame,
  OutstandingStripHeadline,
  type OutstandingStripPart,
} from '@/components/shared/OutstandingQtyStrip'
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

function shipmentParts(bucket: ShipmentOutstandingQtyBucket | null): OutstandingStripPart[] {
  return [
    { key: 'fob', label: 'FOB', kg: bucket?.fobKg, dot: 'bg-blue-300' },
    { key: 'cif', label: 'CIF', kg: bucket?.cifKg, dot: 'bg-amber-300' },
    { key: 'cfr', label: 'CFR', kg: bucket?.cfrKg, dot: 'bg-sky-200' },
  ]
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
    <OutstandingStripFrame
      className="lg:grid-cols-[minmax(10rem,0.75fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]"
      loading={loading || etcNoAtcDueLoading}
    >
      <div className="p-2.5">
        <button
          type="button"
          onClick={onEtcNoAtcDueClick}
          disabled={!onEtcNoAtcDueClick}
          className={cn(
            'flex h-full w-full min-w-0 items-center gap-3 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2 text-left transition-colors',
            onEtcNoAtcDueClick &&
              'cursor-pointer hover:border-rose-200 hover:bg-rose-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1',
            etcNoAtcDueActive && 'border-red-300 ring-2 ring-red-400 ring-offset-1',
            !onEtcNoAtcDueClick && 'cursor-default',
          )}
          title="Late ATC — Overdue / Due ≤7d"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-rose-600 shadow-sm" aria-hidden>
            <StitchAlertIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-xs font-medium text-rose-900">
              <span>Late ATC</span>
              <FieldHelp text={FIELD_HELP.shipmentEtcNoAtcDueWithin7d} />
              {etcNoAtcDueLoading ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-rose-700" aria-label="Loading late ATC KPI" />
              ) : null}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className={cn('text-2xl font-semibold tabular-nums text-rose-950', etcPending && 'text-rose-300')}>
                {etcPending ? '—' : etcCount.toLocaleString('en-US')}
              </span>
              <span className="text-xs text-rose-900/70">shipments</span>
            </div>
            <div className="mt-0.5 truncate text-[0.6875rem] text-rose-900/70">
              OS{' '}
              <span className={cn('font-semibold tabular-nums', etcPending ? 'text-rose-300' : 'text-rose-950')}>
                {formatOutstandingQtyMtFromKg(etcPending ? 0 : etcOsKg, { maxFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </button>
      </div>

      <OutstandingStripHeadline
        icon={<Ship className="h-5 w-5" />}
        help={helpText}
        loading={loading}
        pending={pending}
        kg={summary?.totalKg}
        hint="Sum of the status cards · 3rd Party + Interco"
      />
      <OutstandingStripBucket title="3rd Party" parts={shipmentParts(summary?.thirdParty ?? null)} pending={pending} />
      <OutstandingStripBucket title="Interco" parts={shipmentParts(summary?.interco ?? null)} pending={pending} />
    </OutstandingStripFrame>
  )
}
