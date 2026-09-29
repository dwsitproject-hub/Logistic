'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import { RecapSegmented, ShareBar } from '@/components/claims/ClaimRecapParts'
import { CLAIM_SUSUT_BLANK, formatClaimSusutIdr } from '@/lib/claimSusutView'

/**
 * Section 1 of Shortage Claim: three cards, then ONE summary card whose tabs are the two summaries
 * the SAP workbook carries as its PIVOT and REAL_CLAIM sheets, recomputed from what KLIP imported -
 * the same one-card layout as Quality Claim, so the section fits on a screen. Unlike Quality Claim,
 * amounts are shown in full IDR rather than shortened to B / M.
 *
 * - Aging is built from OS_CLAIM rows - the same aggregate the PIVOT sheet shows, not an import of
 *   it - so it follows the page filters like the view table below.
 * - Realised Claims is REAL_CLAIM across every import, cut to the page's CR date range (YTD by
 *   default) on its CLAIM DATE; the Product / Vendor / Transport filters do not apply to it.
 *   Those filters resolve through SAP contract data that only the outstanding rows carry.
 */

export type ClaimSusutAgingGroupRow = {
  group_of_transport: string
  qty_claim: number
  a_0_30: number
  a_31_60: number
  a_61_90: number
  a_gt_90: number
  grand_total: number
}

export type ClaimSusutRealizedVendor = {
  vendor_code: string | null
  vendor_name: string | null
  claims: number
  qty: number
  amount: number
}

export type ClaimSusutRealizedRow = {
  vendor_code: string | null
  vendor_name: string | null
  cr_no: string
  cm_date: string | null
  qty_approved: number
  amount_after_tax_idr: number
  transport_group: string
}

export type ClaimSusutRealized = {
  importId: string | null
  available: boolean
  periodLabel?: string | null
  osPeriodLabel?: string | null
  totals?: { claims: number; qty: number; amount: number }
  byTransport?: Array<{ transport_group: string; claims: number; qty: number; amount: number }>
  byVendor?: ClaimSusutRealizedVendor[]
  rows: ClaimSusutRealizedRow[]
  /** The CR date range the figures were cut to; null = unbounded. */
  dateFrom?: string | null
  dateTo?: string | null
  /** The REAL_CLAIM files the figures come from - one per imported month. */
  sources?: Array<{ importId: string; fileName: string | null; periodLabel: string | null; claims: number }>
}

type RecapTab = 'aging' | 'realised'

const TABS: ReadonlyArray<{ id: RecapTab; label: string }> = [
  { id: 'aging', label: 'Aging' },
  { id: 'realised', label: 'Realised Claims' },
]

const AGING_COLUMNS: Array<{ key: keyof ClaimSusutAgingGroupRow; label: string }> = [
  { key: 'a_0_30', label: '0-30' },
  { key: 'a_31_60', label: '31-60' },
  { key: 'a_61_90', label: '61-90' },
  { key: 'a_gt_90', label: '> 90 Days' },
]

const TH = 'px-3 py-2 font-medium text-gray-600 whitespace-nowrap'
const TD = 'px-3 py-1.5 tabular-nums whitespace-nowrap'

/**
 * Whole kilograms, as OS_CLAIM and REAL_CLAIM report them - MT would show a 100 kg claim as "0 MT".
 * No unit suffix: every label that shows it already says (Kg).
 */
export function formatKg(kg: number): string {
  return Math.round(kg).toLocaleString('en-US')
}

/** Alphabetical like the PIVOT sheet, with (Blank) last. */
export function sortGroups(rows: ClaimSusutAgingGroupRow[]): ClaimSusutAgingGroupRow[] {
  return [...rows].sort((a, b) => {
    if (a.group_of_transport === CLAIM_SUSUT_BLANK) return 1
    if (b.group_of_transport === CLAIM_SUSUT_BLANK) return -1
    return a.group_of_transport.localeCompare(b.group_of_transport)
  })
}

/** Full IDR, as the PIVOT and REAL_CLAIM sheets print it - no B / M shortening on this page. */
const Idr = ({ v, strong }: { v: number; strong?: boolean }) => (
  <span className={strong ? 'font-semibold text-gray-900' : undefined}>{v ? formatClaimSusutIdr(v) : '-'}</span>
)

export function ClaimSusutSection1Dashboard({
  crDateLabel,
  summary,
  summaryLoading,
  groupRows,
  groupLoading,
  realized,
  realizedLoading,
  selectedGroups,
  onToggleGroup,
  hasImport,
}: {
  /** The page's CR date range in words - YTD by default - which every figure here follows. */
  crDateLabel: string
  summary: { qtyClaim: number; amountAfterTax: number; rowCount: number }
  summaryLoading: boolean
  groupRows: ClaimSusutAgingGroupRow[]
  groupLoading: boolean
  realized: ClaimSusutRealized | null
  realizedLoading: boolean
  selectedGroups: string[]
  onToggleGroup: (group: string) => void
  hasImport: boolean
}) {
  const [tab, setTab] = useState<RecapTab>('aging')
  const groups = sortGroups(groupRows)
  const total = (key: keyof ClaimSusutAgingGroupRow) =>
    groups.reduce((s, g) => s + (Number(g[key]) || 0), 0)
  const agingTotal = total('grand_total')
  const over90 = total('a_gt_90')
  const over90Share = agingTotal > 0 ? over90 / agingTotal : 0
  const realizedAvailable = Boolean(realized?.available)
  const vendors = realized?.byVendor ?? []
  const realTotalAmount = realized?.totals?.amount ?? 0
  const crsByVendor = new Map<string, string[]>()
  for (const r of realized?.rows ?? []) {
    const k = r.vendor_code || r.vendor_name || CLAIM_SUSUT_BLANK
    crsByVendor.set(k, [...(crsByVendor.get(k) ?? []), r.cr_no])
  }

  const note =
    tab === 'aging'
      ? `Amount after tax (IDR) per group · CR date ${crDateLabel}${realized?.osPeriodLabel ? ` · outstanding as of ${realized.osPeriodLabel}` : ''} · follows the filters. Click a group to filter the table below.`
      : `Approved claims with a CR date in ${crDateLabel}. Product, vendor and transport filters do not apply.`
  const tabLoading = tab === 'aging' ? groupLoading : realizedLoading
  const empty = (text: string) => <div className="py-8 text-center text-sm text-gray-500">{text}</div>

  return (
    <div className="space-y-4">
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-3 transition-opacity duration-200 ${
          summaryLoading || groupLoading ? 'opacity-65' : 'opacity-100'
        }`}
      >
        <PerformanceSection1CardShell variant="open" title="Outstanding Shortage Claim" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Claim Qty (Kg)</div>
          <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatKg(summary.qtyClaim)}</div>
          <div className="text-xs text-gray-500">
            Amount:{' '}
            <span className="font-semibold tabular-nums text-gray-900">{formatClaimSusutIdr(summary.amountAfterTax)} IDR</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">{summary.rowCount.toLocaleString('en-US')}</span> claims
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="ongoing" title="Outstanding > 90 Days" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Amount (IDR)</div>
          <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimSusutIdr(over90)}</div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">
              {(over90Share * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%
            </span>{' '}
            of total outstanding
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="completed" title="Realised Claims" selected onClick={() => undefined}>
          {realizedAvailable ? (
            <>
              <div className="mb-1 text-sm text-gray-500">Approved Qty (Kg)</div>
              <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">
                {formatKg(realized?.totals?.qty ?? 0)}
              </div>
              <div className="text-xs text-gray-500">
                Amount:{' '}
                <span className="font-semibold tabular-nums text-gray-900">{formatClaimSusutIdr(realTotalAmount)} IDR</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                <span className="font-semibold tabular-nums text-gray-900">{realized?.totals?.claims ?? 0}</span> claims
                {' '}· CR date {crDateLabel}
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-500">
              {realizedLoading
                ? 'Loading…'
                : hasImport
                  ? 'This import has no REAL_CLAIM sheet.'
                  : 'Upload a file to see realised claims.'}
            </div>
          )}
        </PerformanceSection1CardShell>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span>Shortage Claim Summary</span>
              {tabLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
            </CardTitle>
            <RecapSegmented value={tab} options={TABS} onChange={setTab} ariaLabel="Summary" />
          </div>
          <p className="text-xs text-gray-500">{note}</p>
        </CardHeader>
        <CardContent className="pt-2">
          {tab === 'aging' ? (
            groups.length === 0 ? (
              empty(hasImport ? 'No data for these filters.' : 'Upload a file to see the summary.')
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className={`${TH} text-left`}>Group</th>
                      {AGING_COLUMNS.map((c) => (
                        <th key={c.key} className={`${TH} text-right`}>
                          {c.label}
                        </th>
                      ))}
                      <th className={`${TH} text-right text-gray-800`}>Grand Total</th>
                      <th className={`${TH} text-left`}>Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {groups.map((g) => {
                      const selected = selectedGroups.length === 1 && selectedGroups[0] === g.group_of_transport
                      return (
                        <tr
                          key={g.group_of_transport}
                          className={`cursor-pointer ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                          onClick={() => onToggleGroup(g.group_of_transport)}
                        >
                          <td className="px-3 py-1.5 font-medium">{g.group_of_transport}</td>
                          {AGING_COLUMNS.map((c) => (
                            <td
                              key={c.key}
                              className={`${TD} text-right ${c.key === 'a_gt_90' && Number(g[c.key]) ? 'text-red-700' : ''}`}
                            >
                              <Idr v={Number(g[c.key])} />
                            </td>
                          ))}
                          <td className={`${TD} text-right`}>
                            <Idr v={g.grand_total} strong />
                          </td>
                          <td className="px-3 py-1.5">
                            <ShareBar part={g.grand_total} total={agingTotal} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 font-semibold">Grand Total</td>
                      {AGING_COLUMNS.map((c) => (
                        <td key={c.key} className={`${TD} text-right`}>
                          <Idr v={total(c.key)} strong />
                        </td>
                      ))}
                      <td className={`${TD} text-right`}>
                        <Idr v={agingTotal} strong />
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-gray-500">{agingTotal ? '100%' : '-'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : !realizedAvailable || vendors.length === 0 ? (
            empty(
              realizedLoading
                ? 'Loading…'
                : realizedAvailable
                  ? 'No realised claims with a CR date in this range.'
                  : hasImport
                    ? 'This import has no REAL_CLAIM sheet.'
                    : 'Upload a file to see realised claims.',
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className={`${TH} text-left`}>Vendor</th>
                      <th className={`${TH} text-right`}>Claims</th>
                      <th className={`${TH} text-right`}>Approved Qty (Kg)</th>
                      <th className={`${TH} text-right text-gray-800`}>Amount (IDR)</th>
                      <th className={`${TH} text-left`}>Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {vendors.map((v) => {
                      const key = v.vendor_code || v.vendor_name || CLAIM_SUSUT_BLANK
                      const crs = crsByVendor.get(key) ?? []
                      return (
                        <tr key={key} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5">
                            <span className="font-medium text-gray-900">{v.vendor_name || v.vendor_code || CLAIM_SUSUT_BLANK}</span>
                            <span className="ml-2 text-[11px] text-gray-500">
                              {v.vendor_code ? `${v.vendor_code} · ` : ''}CR {crs.join(', ')}
                            </span>
                          </td>
                          <td className={`${TD} text-right`}>{v.claims}</td>
                          <td className={`${TD} text-right`}>{formatKg(v.qty)}</td>
                          <td className={`${TD} text-right`}>
                            <Idr v={v.amount} strong />
                          </td>
                          <td className="px-3 py-1.5">
                            <ShareBar part={v.amount} total={realTotalAmount} tone="emerald" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 font-semibold">Grand Total</td>
                      <td className={`${TD} text-right font-semibold`}>{realized?.totals?.claims ?? 0}</td>
                      <td className={`${TD} text-right font-semibold`}>{formatKg(realized?.totals?.qty ?? 0)}</td>
                      <td className={`${TD} text-right`}>
                        <Idr v={realTotalAmount} strong />
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-gray-500">{realTotalAmount ? '100%' : '-'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {realized?.byTransport && realized.byTransport.length > 0 ? (
                <p className="mt-3 text-xs text-gray-500">
                  By transport:{' '}
                  {realized.byTransport.map((t, i) => (
                    <span key={t.transport_group}>
                      {i > 0 ? ' · ' : ''}
                      <span className="font-medium text-gray-700">{t.transport_group}</span> {t.claims} claims,{' '}
                      <Idr v={t.amount} />
                    </span>
                  ))}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
