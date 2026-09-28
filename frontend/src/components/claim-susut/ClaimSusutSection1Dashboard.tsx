'use client'

import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import { formatQtyMtFromKg } from '@/lib/utils'
import { CLAIM_SUSUT_BLANK, formatClaimSusutIdr } from '@/lib/claimSusutView'

/**
 * Section 1 of Claim Susut: the two summaries the SAP workbook carries as its PIVOT and REAL_CLAIM
 * sheets, recomputed from what KLIP imported.
 *
 * - Outstanding x aging is built from OS_CLAIM rows - the same aggregate the PIVOT sheet shows, not
 *   an import of it - so it follows the page filters like the view table below.
 * - Realisation is the REAL_CLAIM sheet of the same upload, shown whole: it is a short period list,
 *   and the page filters resolve through SAP contract data that only the outstanding rows carry.
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
}

const AGING_COLUMNS: Array<{ key: keyof ClaimSusutAgingGroupRow; label: string }> = [
  { key: 'a_0_30', label: '0-30' },
  { key: 'a_31_60', label: '31-60' },
  { key: 'a_61_90', label: '61-90' },
  { key: 'a_gt_90', label: '> 90 Days' },
]

/** Kilograms, as REAL_CLAIM reports them. Whole MT would show a 100 kg claim as "0 MT". */
export function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString('en-US')} kg`
}

/** Alphabetical like the PIVOT sheet, with (Blank) last. */
export function sortGroups(rows: ClaimSusutAgingGroupRow[]): ClaimSusutAgingGroupRow[] {
  return [...rows].sort((a, b) => {
    if (a.group_of_transport === CLAIM_SUSUT_BLANK) return 1
    if (b.group_of_transport === CLAIM_SUSUT_BLANK) return -1
    return a.group_of_transport.localeCompare(b.group_of_transport)
  })
}

export function ClaimSusutSection1Dashboard({
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
  const groups = sortGroups(groupRows)
  const total = (key: keyof ClaimSusutAgingGroupRow) =>
    groups.reduce((s, g) => s + (Number(g[key]) || 0), 0)
  const agingTotal = total('grand_total')
  const over90 = total('a_gt_90')
  const over90Share = agingTotal > 0 ? over90 / agingTotal : 0
  const realizedAvailable = Boolean(realized?.available)
  const vendors = realized?.byVendor ?? []
  const crsByVendor = new Map<string, string[]>()
  for (const r of realized?.rows ?? []) {
    const k = r.vendor_code || r.vendor_name || CLAIM_SUSUT_BLANK
    crsByVendor.set(k, [...(crsByVendor.get(k) ?? []), r.cr_no])
  }

  return (
    <div className="space-y-4">
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-3 transition-opacity duration-200 ${
          summaryLoading || groupLoading ? 'opacity-65' : 'opacity-100'
        }`}
      >
        <PerformanceSection1CardShell variant="open" title="Outstanding Shortage Claim" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Claim Qty</div>
          <div className="mb-3 text-xl font-bold text-gray-900">{formatQtyMtFromKg(summary.qtyClaim)}</div>
          <div className="text-xs text-gray-500">
            Amount:{' '}
            <span className="font-semibold tabular-nums text-gray-900">{formatClaimSusutIdr(summary.amountAfterTax)}</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">{summary.rowCount.toLocaleString('en-US')}</span> claims
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="ongoing" title="Outstanding > 90 Days" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Amount</div>
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
              <div className="mb-1 text-sm text-gray-500">Approved Qty</div>
              <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">
                {formatKg(realized?.totals?.qty ?? 0)}
              </div>
              <div className="text-xs text-gray-500">
                Amount:{' '}
                <span className="font-semibold tabular-nums text-gray-900">
                  {formatClaimSusutIdr(realized?.totals?.amount ?? 0)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                <span className="font-semibold tabular-nums text-gray-900">{realized?.totals?.claims ?? 0}</span> claims
                {realized?.periodLabel ? <> · Period {realized.periodLabel}</> : null}
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>Outstanding Claims by Aging</span>
              {groupLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
            </CardTitle>
            <p className="text-xs text-gray-500">
              Amount after tax (IDR) per group{realized?.osPeriodLabel ? ` · Period ${realized.osPeriodLabel}` : ''} ·
              follows the filters. Click a group to filter the table below.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                {hasImport ? 'No data for these filters.' : 'Upload a file to see the summary.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Group</th>
                      {AGING_COLUMNS.map((c) => (
                        <th key={c.key} className="px-3 py-2 text-right font-medium text-gray-600">
                          {c.label}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium text-gray-800">Grand Total</th>
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
                          <td className="px-3 py-2 font-medium">{g.group_of_transport}</td>
                          {AGING_COLUMNS.map((c) => (
                            <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                              {Number(g[c.key]) ? formatClaimSusutIdr(Number(g[c.key])) : '-'}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatClaimSusutIdr(g.grand_total)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 font-semibold">Grand Total</td>
                      {AGING_COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2 text-right font-semibold tabular-nums">
                          {formatClaimSusutIdr(total(c.key))}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{formatClaimSusutIdr(agingTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>Realised Claims</span>
              {realizedLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
            </CardTitle>
            <p className="text-xs text-gray-500">
              Approved claims{realized?.periodLabel ? ` · Period ${realized.periodLabel}` : ''} · the whole
              REAL_CLAIM sheet, not narrowed by the filters.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {!realizedAvailable || vendors.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                {hasImport ? 'This import has no REAL_CLAIM sheet.' : 'Upload a file to see realised claims.'}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Vendor</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Claims</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Approved Qty</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-800">Amount (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {vendors.map((v) => {
                        const key = v.vendor_code || v.vendor_name || CLAIM_SUSUT_BLANK
                        const crs = crsByVendor.get(key) ?? []
                        return (
                          <tr key={key}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{v.vendor_name || v.vendor_code || CLAIM_SUSUT_BLANK}</div>
                              <div className="text-[11px] text-gray-500">
                                {v.vendor_code ? `${v.vendor_code} · ` : ''}CR {crs.join(', ')}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{v.claims}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatKg(v.qty)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatClaimSusutIdr(v.amount)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                      <tr>
                        <td className="px-3 py-2 font-semibold">Grand Total</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{realized?.totals?.claims ?? 0}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKg(realized?.totals?.qty ?? 0)}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">
                          {formatClaimSusutIdr(realized?.totals?.amount ?? 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {realized?.byTransport && realized.byTransport.length > 0 ? (
                  <p className="mt-3 text-xs text-gray-500">
                    Per transport:{' '}
                    {realized.byTransport.map((t, i) => (
                      <span key={t.transport_group}>
                        {i > 0 ? ' · ' : ''}
                        <span className="font-medium text-gray-700">{t.transport_group}</span>{' '}
                        {t.claims} claims, {formatClaimSusutIdr(t.amount)}
                      </span>
                    ))}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
