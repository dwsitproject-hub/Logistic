'use client'

import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import {
  CLAIM_MUTU_BLANK,
  addPair,
  compareUnit,
  formatClaimMutuIdr,
  formatClaimMutuKg,
  formatClaimMutuMonth,
  formatShare,
  groupByCommodity,
  trendUnits,
  ZERO_PAIR,
  type ClaimMutuB2bScope,
  type ClaimMutuCommodityUnitRow,
  type ClaimMutuSidePair,
  type ClaimMutuTrendRow,
} from '@/lib/claimMutuView'

/**
 * Section 1 of Claim Mutu: the four summary sheets of the claim team's workbook, recomputed from
 * the imported OS_Claim and Real_Claim rows - Pivot, Rekap Klaim Per Lokasi, Summary Per Komoditi
 * and Summary Per Unit. All of them follow the page filters and the Exclude / Include B2B choice.
 */

export type ClaimMutuAgingGroupRow = {
  claim_group: string
  qty: number
  a_0_30: number
  a_31_60: number
  a_61_90: number
  a_gt_90: number
  grand_total: number
}

export type ClaimMutuLocationRow = ClaimMutuSidePair & { dest: string; unit: string }

export type ClaimMutuDashboard = {
  importId: string | null
  periodLabel: string | null
  realPeriodLabel: string | null
  periodMonth: string | null
  b2bSource: string | null
  realAvailable: boolean
  warnings: string[]
  b2b: ClaimMutuB2bScope
  os: { claims: number; qty: number; amount: number; over90: number }
  real: { claims: number; qty: number; amount: number }
  agingByGroup: ClaimMutuAgingGroupRow[]
  byCommodityUnit: ClaimMutuCommodityUnitRow[]
  byLocation: ClaimMutuLocationRow[]
}

export type ClaimMutuTrend = { b2b: ClaimMutuB2bScope; months: string[]; rows: ClaimMutuTrendRow[] }

const AGING_COLUMNS: Array<{ key: keyof ClaimMutuAgingGroupRow; label: string }> = [
  { key: 'a_0_30', label: '0-30' },
  { key: 'a_31_60', label: '31-60' },
  { key: 'a_61_90', label: '61-90' },
  { key: 'a_gt_90', label: '> 90 Hari' },
]

const TH = 'px-3 py-2 font-medium text-gray-600 whitespace-nowrap'
const TD = 'px-3 py-2 tabular-nums whitespace-nowrap'

/** Alphabetical like the Pivot sheet, with (Blank) last. */
export function sortAgingGroups(rows: ClaimMutuAgingGroupRow[]): ClaimMutuAgingGroupRow[] {
  return [...rows].sort((a, b) => {
    if (a.claim_group === CLAIM_MUTU_BLANK) return 1
    if (b.claim_group === CLAIM_MUTU_BLANK) return -1
    return a.claim_group.localeCompare(b.claim_group)
  })
}

/** Rekap Klaim Per Lokasi: DEST codes alphabetically, as the sheet lists them. */
export function sortLocations(rows: ClaimMutuLocationRow[]): ClaimMutuLocationRow[] {
  return rows
    .filter((r) => r.os_qty || r.os_amount || r.real_qty || r.real_amount)
    .sort((a, b) => {
      if (a.dest === CLAIM_MUTU_BLANK) return 1
      if (b.dest === CLAIM_MUTU_BLANK) return -1
      return a.dest.localeCompare(b.dest)
    })
}

const kgOrDash = (n: number) => (n ? formatClaimMutuKg(n) : '-')
const idrOrDash = (n: number) => (n ? formatClaimMutuIdr(n) : '-')

function scopeLabel(b2b: ClaimMutuB2bScope) {
  return b2b === 'include' ? 'Include B2B' : 'Exclude B2B'
}

function SectionTitle({ title, loading }: { title: string; loading: boolean }) {
  return (
    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
      <span>{title}</span>
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
    </CardTitle>
  )
}

function Empty({ hasImport }: { hasImport: boolean }) {
  return (
    <div className="py-8 text-center text-sm text-gray-500">
      {hasImport ? 'Tidak ada data untuk filter ini.' : 'Upload file untuk melihat rekap.'}
    </div>
  )
}

export function ClaimMutuSection1Dashboard({
  dashboard,
  loading,
  trend,
  trendLoading,
  b2b,
  hasImport,
  osOnlyFilterActive,
  selectedGroups,
  onToggleGroup,
}: {
  dashboard: ClaimMutuDashboard | null
  loading: boolean
  trend: ClaimMutuTrend | null
  trendLoading: boolean
  b2b: ClaimMutuB2bScope
  hasImport: boolean
  /** GROUP or METODE PAYMENT is filtered: those narrow OS only, the Real sheet has neither column. */
  osOnlyFilterActive: boolean
  selectedGroups: string[]
  onToggleGroup: (group: string) => void
}) {
  const os = dashboard?.os ?? { claims: 0, qty: 0, amount: 0, over90: 0 }
  const real = dashboard?.real ?? { claims: 0, qty: 0, amount: 0 }
  const groups = sortAgingGroups(dashboard?.agingByGroup ?? [])
  const agingTotal = (key: keyof ClaimMutuAgingGroupRow) => groups.reduce((s, g) => s + (Number(g[key]) || 0), 0)
  const locations = sortLocations(dashboard?.byLocation ?? [])
  const locTotal = locations.reduce<ClaimMutuSidePair>((s, r) => addPair(s, r), ZERO_PAIR)
  const { groups: commodities, total: commodityTotal } = groupByCommodity(dashboard?.byCommodityUnit ?? [])
  const period = dashboard?.periodLabel ? ` · Periode ${dashboard.periodLabel}` : ''
  const scope = scopeLabel(b2b)
  const realNote = osOnlyFilterActive ? ' Filter Group / Metode Payment hanya berlaku untuk OS.' : ''

  return (
    <div className="space-y-4">
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-3 transition-opacity duration-200 ${
          loading ? 'opacity-65' : 'opacity-100'
        }`}
      >
        <PerformanceSection1CardShell variant="open" title="Outstanding Claim Mutu" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Nilai Klaim (IDR)</div>
          <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimMutuIdr(os.amount)}</div>
          <div className="text-xs text-gray-500">
            Qty: <span className="font-semibold tabular-nums text-gray-900">{formatClaimMutuKg(os.qty)} kg</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">{os.claims.toLocaleString('en-US')}</span> klaim ·{' '}
            {scope}
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="ongoing" title="Outstanding > 90 Hari" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Nilai Klaim (IDR)</div>
          <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimMutuIdr(os.over90)}</div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">{formatShare(os.over90, os.amount)}</span> dari total
            outstanding
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="completed" title="Realisasi Claim" selected onClick={() => undefined}>
          {dashboard?.realAvailable ? (
            <>
              <div className="mb-1 text-sm text-gray-500">Nilai Klaim (IDR)</div>
              <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimMutuIdr(real.amount)}</div>
              <div className="text-xs text-gray-500">
                Qty: <span className="font-semibold tabular-nums text-gray-900">{formatClaimMutuKg(real.qty)} kg</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                <span className="font-semibold tabular-nums text-gray-900">{real.claims.toLocaleString('en-US')}</span> klaim
                {dashboard.realPeriodLabel ? <> · Periode {dashboard.realPeriodLabel}</> : null}
              </div>
              {osOnlyFilterActive ? (
                <div className="mt-1 text-[11px] text-amber-700">Tidak dipersempit filter Group / Metode Payment.</div>
              ) : null}
            </>
          ) : (
            <div className="text-xs text-gray-500">
              {loading
                ? 'Memuat…'
                : hasImport
                  ? 'File import ini tidak menyertakan sheet Real_Claim.'
                  : 'Upload file untuk melihat realisasi.'}
            </div>
          )}
        </PerformanceSection1CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <SectionTitle title="Rekap Outstanding Claim · Aging" loading={loading} />
            <p className="text-xs text-gray-500">
              Nilai klaim after tax (IDR) per group{period} · {scope} · mengikuti filter. Klik group untuk memfilter.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {groups.length === 0 ? (
              <Empty hasImport={hasImport} />
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
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {groups.map((g) => {
                      const selected = selectedGroups.length === 1 && selectedGroups[0] === g.claim_group
                      return (
                        <tr
                          key={g.claim_group}
                          className={`cursor-pointer ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                          onClick={() => onToggleGroup(g.claim_group)}
                        >
                          <td className="px-3 py-2 font-medium">{g.claim_group}</td>
                          {AGING_COLUMNS.map((c) => (
                            <td key={c.key} className={`${TD} text-right`}>
                              {idrOrDash(Number(g[c.key]))}
                            </td>
                          ))}
                          <td className={`${TD} text-right font-semibold`}>{formatClaimMutuIdr(g.grand_total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 font-semibold">Grand Total</td>
                      {AGING_COLUMNS.map((c) => (
                        <td key={c.key} className={`${TD} text-right font-semibold`}>
                          {formatClaimMutuIdr(agingTotal(c.key))}
                        </td>
                      ))}
                      <td className={`${TD} text-right font-bold`}>{formatClaimMutuIdr(agingTotal('grand_total'))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <SectionTitle title="Rekap Klaim Per Lokasi" loading={loading} />
            <p className="text-xs text-gray-500">
              OS dan realisasi per kode DEST{period} · {scope} · mengikuti filter.{realNote}
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {locations.length === 0 ? (
              <Empty hasImport={hasImport} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className={`${TH} text-left`} rowSpan={2}>
                        Lokasi
                      </th>
                      <th className={`${TH} text-center border-l`} colSpan={3}>
                        OS Claim
                      </th>
                      <th className={`${TH} text-center border-l`} colSpan={3}>
                        Real Claim
                      </th>
                    </tr>
                    <tr>
                      <th className={`${TH} text-right border-l`}>Qty (Kg)</th>
                      <th className={`${TH} text-right`}>Nilai (IDR)</th>
                      <th className={`${TH} text-right`}>Nilai %</th>
                      <th className={`${TH} text-right border-l`}>Qty (Kg)</th>
                      <th className={`${TH} text-right`}>Nilai (IDR)</th>
                      <th className={`${TH} text-right`}>Nilai %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {locations.map((r) => (
                      <tr key={r.dest}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{r.dest}</div>
                          {r.unit && r.unit !== r.dest ? <div className="text-[11px] text-gray-500">{r.unit}</div> : null}
                        </td>
                        <td className={`${TD} text-right border-l`}>{kgOrDash(r.os_qty)}</td>
                        <td className={`${TD} text-right`}>{idrOrDash(r.os_amount)}</td>
                        <td className={`${TD} text-right text-gray-500`}>{formatShare(r.os_amount, locTotal.os_amount)}</td>
                        <td className={`${TD} text-right border-l`}>{kgOrDash(r.real_qty)}</td>
                        <td className={`${TD} text-right`}>{idrOrDash(r.real_amount)}</td>
                        <td className={`${TD} text-right text-gray-500`}>
                          {formatShare(r.real_amount, locTotal.real_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 font-semibold">Grand Total</td>
                      <td className={`${TD} text-right font-semibold border-l`}>{formatClaimMutuKg(locTotal.os_qty)}</td>
                      <td className={`${TD} text-right font-bold`}>{formatClaimMutuIdr(locTotal.os_amount)}</td>
                      <td className={`${TD} text-right`}>{locTotal.os_amount ? '100%' : '-'}</td>
                      <td className={`${TD} text-right font-semibold border-l`}>{formatClaimMutuKg(locTotal.real_qty)}</td>
                      <td className={`${TD} text-right font-bold`}>{formatClaimMutuIdr(locTotal.real_amount)}</td>
                      <td className={`${TD} text-right`}>{locTotal.real_amount ? '100%' : '-'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <SectionTitle title="Summary Per Komoditi" loading={loading} />
          <p className="text-xs text-gray-500">
            OS dan realisasi per komoditi dan lokasi / unit{period} · {scope} · mengikuti filter.{realNote}
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          {commodities.length === 0 ? (
            <Empty hasImport={hasImport} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className={`${TH} text-left`} rowSpan={2}>
                      Komoditi
                    </th>
                    <th className={`${TH} text-left`} rowSpan={2}>
                      Lokasi / Unit
                    </th>
                    <th className={`${TH} text-center border-l`} colSpan={2}>
                      OS Claim
                    </th>
                    <th className={`${TH} text-center border-l`} colSpan={2}>
                      Real Claim
                    </th>
                  </tr>
                  <tr>
                    <th className={`${TH} text-right border-l`}>Qty (Kg)</th>
                    <th className={`${TH} text-right`}>Nilai Klaim (IDR)</th>
                    <th className={`${TH} text-right border-l`}>Qty (Kg)</th>
                    <th className={`${TH} text-right`}>Nilai Klaim (IDR)</th>
                  </tr>
                </thead>
                {commodities.map((g) => (
                  <tbody key={g.commodity} className="divide-y border-b">
                    {g.units.map((u, i) => (
                      <tr key={u.unit}>
                        <td className="px-3 py-2 font-medium align-top">{i === 0 ? g.commodity : ''}</td>
                        <td className="px-3 py-2">{u.unit}</td>
                        <td className={`${TD} text-right border-l`}>{kgOrDash(u.os_qty)}</td>
                        <td className={`${TD} text-right`}>{idrOrDash(u.os_amount)}</td>
                        <td className={`${TD} text-right border-l`}>{kgOrDash(u.real_qty)}</td>
                        <td className={`${TD} text-right`}>{idrOrDash(u.real_amount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50">
                      <td className="px-3 py-2 font-semibold" colSpan={2}>
                        Sub Total {g.commodity}
                      </td>
                      <td className={`${TD} text-right font-semibold border-l`}>{kgOrDash(g.subtotal.os_qty)}</td>
                      <td className={`${TD} text-right font-semibold`}>{idrOrDash(g.subtotal.os_amount)}</td>
                      <td className={`${TD} text-right font-semibold border-l`}>{kgOrDash(g.subtotal.real_qty)}</td>
                      <td className={`${TD} text-right font-semibold`}>{idrOrDash(g.subtotal.real_amount)}</td>
                    </tr>
                  </tbody>
                ))}
                <tfoot className="border-t-2 border-gray-200 bg-gray-100">
                  <tr>
                    <td className="px-3 py-2 font-bold" colSpan={2}>
                      Grand Total Semua Komoditi
                    </td>
                    <td className={`${TD} text-right font-bold border-l`}>{formatClaimMutuKg(commodityTotal.os_qty)}</td>
                    <td className={`${TD} text-right font-bold`}>{formatClaimMutuIdr(commodityTotal.os_amount)}</td>
                    <td className={`${TD} text-right font-bold border-l`}>{formatClaimMutuKg(commodityTotal.real_qty)}</td>
                    <td className={`${TD} text-right font-bold`}>{formatClaimMutuIdr(commodityTotal.real_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ClaimMutuTrendCard trend={trend} loading={trendLoading} b2b={b2b} hasImport={hasImport} realNote={realNote} />
    </div>
  )
}

/**
 * Summary Per Unit: one row per month (the latest import of that month), OS and Real per unit.
 * It holds the months KLIP has imported - it grows by one row with every monthly upload.
 */
function ClaimMutuTrendCard({
  trend,
  loading,
  b2b,
  hasImport,
  realNote,
}: {
  trend: ClaimMutuTrend | null
  loading: boolean
  b2b: ClaimMutuB2bScope
  hasImport: boolean
  realNote: string
}) {
  const rows = trend?.rows ?? []
  const units = trendUnits(rows)
  const months = [...(trend?.months ?? [])].sort().reverse()
  const cell = new Map(rows.map((r) => [`${r.month}|${r.unit}`, r]))
  const monthTotal = (month: string) =>
    rows.filter((r) => r.month === month).reduce<ClaimMutuSidePair>((s, r) => addPair(s, r), ZERO_PAIR)

  return (
    <Card>
      <CardHeader className="pb-2">
        <SectionTitle title="Summary Per Unit" loading={loading} />
        <p className="text-xs text-gray-500">
          OS dan realisasi per unit per bulan · {scopeLabel(b2b)} · satu baris per bulan dari import terakhir bulan itu,
          tidak mengikuti filter periode.{realNote}
          {b2b === 'exclude' ? ' Sheet Summary Per Unit di workbook memakai Include B2B.' : ''}
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        {months.length === 0 || units.length === 0 ? (
          <Empty hasImport={hasImport} />
        ) : (
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="text-sm border-separate border-spacing-0">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th className={`${TH} text-left sticky left-0 z-20 bg-gray-100`} rowSpan={3}>
                    Bulan
                  </th>
                  {[...units, 'TOTAL'].map((u) => (
                    <th key={u} className={`${TH} text-center border-l`} colSpan={4}>
                      {u}
                    </th>
                  ))}
                </tr>
                <tr>
                  {[...units, 'TOTAL'].map((u) => (
                    <FragmentPair key={u} a="OS Claim" b="Real Claim" />
                  ))}
                </tr>
                <tr>
                  {[...units, 'TOTAL'].flatMap((u) =>
                    ['Qty (Kg)', 'Nilai (IDR)', 'Qty (Kg)', 'Nilai (IDR)'].map((l, i) => (
                      <th key={`${u}-${i}`} className={`${TH} text-right ${i === 0 ? 'border-l' : ''}`}>
                        {l}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {months.map((m, idx) => {
                  const bg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  const cells = [...units.map((u) => cell.get(`${m}|${u}`) ?? ZERO_PAIR), monthTotal(m)]
                  return (
                    <tr key={m} className={bg}>
                      <td className={`px-3 py-2 font-medium whitespace-nowrap sticky left-0 ${bg} border-b`}>
                        {formatClaimMutuMonth(m)}
                      </td>
                      {cells.flatMap((c, ci) => {
                        const last = ci === cells.length - 1
                        return [
                          <td key={`${ci}-0`} className={`${TD} text-right border-l border-b ${last ? 'font-semibold' : ''}`}>
                            {kgOrDash(c.os_qty)}
                          </td>,
                          <td key={`${ci}-1`} className={`${TD} text-right border-b ${last ? 'font-semibold' : ''}`}>
                            {idrOrDash(c.os_amount)}
                          </td>,
                          <td key={`${ci}-2`} className={`${TD} text-right border-b ${last ? 'font-semibold' : ''}`}>
                            {kgOrDash(c.real_qty)}
                          </td>,
                          <td key={`${ci}-3`} className={`${TD} text-right border-b ${last ? 'font-semibold' : ''}`}>
                            {idrOrDash(c.real_amount)}
                          </td>,
                        ]
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FragmentPair({ a, b }: { a: string; b: string }) {
  return (
    <>
      <th className={`${TH} text-center border-l`} colSpan={2}>
        {a}
      </th>
      <th className={`${TH} text-center`} colSpan={2}>
        {b}
      </th>
    </>
  )
}

/** Units in the order the Summary Per Unit sheet lists them - exported for the page's unit filter. */
export const sortUnitOptions = (units: string[]) => [...units].sort(compareUnit)
