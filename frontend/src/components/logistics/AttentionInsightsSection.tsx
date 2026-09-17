'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, Clock3, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn, formatQtyMtFromKg } from '@/lib/utils'
import type { AttentionInsightsData } from '@/lib/attentionInsights'

export type AttentionInsightsVariant = 'trucking' | 'shipment'

type AttentionInsightsSectionProps = {
  variant: AttentionInsightsVariant
  loading?: boolean
  data: AttentionInsightsData | null | undefined
}

function formatMt(kg: number): string {
  return formatQtyMtFromKg(kg, { maxFractionDigits: 0 })
}

function formatMtCompact(kg: number): string {
  const mt = kg / 1000
  return mt.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function SubBullet({ children }: { children: ReactNode }) {
  return (
    <li className="ml-4 list-none text-[11px] leading-snug text-gray-600 before:mr-1.5 before:text-gray-400 before:content-['•']">
      {children}
    </li>
  )
}

export function AttentionInsightsSection({
  variant,
  loading = false,
  data,
}: AttentionInsightsSectionProps) {
  const insights = data
  const overdueCount =
    variant === 'shipment'
      ? (insights?.vesselCount ?? insights?.contractCount ?? 0)
      : (insights?.contractCount ?? 0)
  const overdueUnit = variant === 'shipment' ? 'vessel' : 'contract'
  const hasOverdue = Boolean(insights && overdueCount > 0)
  const hasCarry = Boolean(insights?.carryOver && insights.carryOver.totalKg > 0)
  const hasAnyLeftContent = hasOverdue || hasCarry

  const agingRows = insights
    ? [
        { label: '1–7 days', kg: insights.bucket1To7Kg },
        { label: '8–30 days', kg: insights.bucket8To30Kg },
        { label: '>30 days', kg: insights.bucketGt30Kg },
      ]
    : []

  const emptyMessage =
    variant === 'shipment'
      ? 'No urgent shipment exceptions in the current filter scope.'
      : 'No urgent trucking exceptions in the current filter scope.'

  const splitPrimaryLabel = variant === 'shipment' ? 'FOB' : '3rd party'
  const splitSecondaryLabel = variant === 'shipment' ? 'CIF' : 'In-house'
  const splitPrimaryKg =
    variant === 'shipment' ? (insights?.fobOsKg ?? 0) : (insights?.thirdPartyOsKg ?? 0)
  const splitSecondaryKg =
    variant === 'shipment' ? (insights?.cifOsKg ?? 0) : (insights?.intercoOsKg ?? 0)

  const topVessels =
    variant === 'shipment' && insights?.topVessels?.length ? insights.topVessels : []

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] transition-opacity duration-200',
        loading ? 'opacity-65' : 'opacity-100',
      )}
    >
      <Card className="overflow-hidden border-rose-100 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-rose-400 via-pink-400 to-rose-300" aria-hidden />
        <CardContent className="p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span>Attention needed</span>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" aria-label="Loading insights" />
            ) : null}
          </div>

          {!loading && !hasAnyLeftContent ? (
            <p className="mt-3 text-xs text-gray-500">{emptyMessage}</p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-gray-800">
              {hasOverdue && insights ? (
                <li>
                  <span className="font-semibold">Overdue:</span>{' '}
                  {overdueCount.toLocaleString('en-US')} {overdueUnit}
                  {overdueCount === 1 ? '' : 's'} ·{' '}
                  <span className="font-semibold tabular-nums">{formatMt(insights.totalOsKg)}</span>
                  {insights.pctOfTotalOs != null ? (
                    <>
                      {' '}
                      ({insights.pctOfTotalOs.toLocaleString('en-US')}% of OS)
                    </>
                  ) : null}
                  {' · '}
                  {splitPrimaryLabel}{' '}
                  <span className="tabular-nums font-medium">{formatMtCompact(splitPrimaryKg)}</span>
                  {' · '}
                  {splitSecondaryLabel}{' '}
                  <span className="tabular-nums font-medium">{formatMtCompact(splitSecondaryKg)}</span>
                  {insights.osGt30Kg > 0 ? (
                    <SubBullet>
                      Age &gt; 30 days:{' '}
                      <span className="font-semibold tabular-nums">{formatMt(insights.osGt30Kg)}</span>
                      {' — Expedite delivery'}
                    </SubBullet>
                  ) : null}
                  {insights.topSuppliers.length > 0 ? (
                    <SubBullet>
                      Top:{' '}
                      {insights.topSuppliers
                        .map((s) => `${s.supplier} (${formatMtCompact(s.osKg)})`)
                        .join(', ')}
                    </SubBullet>
                  ) : null}
                  {topVessels.length > 0 ? (
                    <SubBullet>
                      Top vessel:{' '}
                      {topVessels.map((v) => `${v.vessel} (${formatMtCompact(v.osKg)})`).join(', ')}
                    </SubBullet>
                  ) : null}
                </li>
              ) : null}

              {hasCarry && insights?.carryOver ? (
                <li>
                  <span className="font-semibold">
                    Carry {insights.carryOver.labelMonth} (3rd party):
                  </span>{' '}
                  <span className="font-semibold tabular-nums">{formatMt(insights.carryOver.totalKg)}</span>
                  {insights.carryOver.unplannedLateKg > 0 ? (
                    <SubBullet>
                      No plan &amp; already late:{' '}
                      <span className="font-semibold tabular-nums">
                        {formatMt(insights.carryOver.unplannedLateKg)}
                      </span>
                      {' — Most urgent, review unplanned backlog'}
                    </SubBullet>
                  ) : null}
                </li>
              ) : null}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-rose-100 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-rose-300 via-pink-300 to-rose-200" aria-hidden />
        <CardContent className="p-4 md:p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span>Aging overdue</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-gray-500">
                Due date &lt; today &amp; remaining O/S &gt; 0
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px] font-medium text-gray-500">
              MT
            </Badge>
          </div>

          <div className="mt-3 overflow-hidden rounded-md border border-rose-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-rose-50/80 text-[10px] font-semibold tracking-wide text-rose-700">
                  <th className="px-3 py-2 text-left">Bucket</th>
                  <th className="px-3 py-2 text-right">OS qty</th>
                </tr>
              </thead>
              <tbody>
                {agingRows.map((row) => (
                  <tr key={row.label} className="border-t border-rose-50">
                    <td className="px-3 py-2 text-gray-700">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                      {loading ? '—' : formatMtCompact(row.kg)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-rose-100 bg-gray-50/80 font-semibold">
                  <td className="px-3 py-2 text-gray-900">
                    Total ({loading ? '…' : overdueCount.toLocaleString('en-US')} {overdueUnit}
                    {overdueCount === 1 ? '' : 's'})
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                    {loading ? '—' : formatMtCompact(insights?.totalOsKg ?? 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
