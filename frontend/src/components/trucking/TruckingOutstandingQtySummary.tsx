'use client'

import { useMemo } from 'react'
import { StitchNavIcons } from '@/components/shared/stitchIcons'
import {
  OutstandingStripBucket,
  OutstandingStripFrame,
  OutstandingStripHeadline,
  type OutstandingStripPart,
} from '@/components/shared/OutstandingQtyStrip'
import { formatOutstandingQtyMtFromKg } from '@/lib/utils'

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

function truckingParts(bucket: TruckingOutstandingQtyBucket): OutstandingStripPart[] {
  return [
    { key: 'frc', label: 'FRC', kg: bucket.frcKg, dot: 'bg-sky-500' },
    { key: 'lco', label: 'LCO', kg: bucket.lcoKg, dot: 'bg-indigo-400' },
  ]
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
    <OutstandingStripFrame className="md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]" loading={loading}>
      <OutstandingStripHeadline
        icon={<StitchNavIcons.trucking className="h-5 w-5" />}
        help={helpText}
        loading={loading}
        pending={false}
        kg={summary.totalKg}
        hint="Unplanned OS + Planned OS"
      />
      <OutstandingStripBucket title="3rd Party" parts={truckingParts(summary.thirdParty)} pending={false} />
      <OutstandingStripBucket title="Interco" parts={truckingParts(summary.interco)} pending={false} />
    </OutstandingStripFrame>
  )
}
