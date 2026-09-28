'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import { cn } from '@/lib/utils'
import {
  CLAIM_MUTU_BLANK,
  addPair,
  compareUnit,
  formatClaimMutuCompact,
  formatClaimMutuIdr,
  formatClaimMutuKg,
  formatClaimMutuMonth,
  formatShare,
  groupByCommodity,
  pairValue,
  trendUnits,
  ZERO_PAIR,
  type ClaimMutuB2bScope,
  type ClaimMutuCommodityUnitRow,
  type ClaimMutuMeasure,
  type ClaimMutuSidePair,
  type ClaimMutuTrendRow,
} from '@/lib/claimMutuView'

/**
 * Section 1 of Claim Mutu: three cards, then ONE recap card whose tabs are the four summary sheets
 * of the claim team's workbook - Pivot (aging), Rekap Klaim Per Lokasi, Summary Per Komoditi and
 * Summary Per Unit - recomputed from the imported OS_Claim / Real_Claim rows. One card instead of
 * four stacked tables keeps the section to a single screen; numbers are short (34,46 M) with the
 * full figure in each cell's tooltip. Everything follows the page filters and the B2B choice.
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

type RecapTab = 'aging' | 'lokasi' | 'komoditi' | 'unit'

const TABS: Array<{ id: RecapTab; label: string }> = [
  { id: 'aging', label: 'Aging' },
  { id: 'lokasi', label: 'By Location' },
  { id: 'komoditi', label: 'By Commodity' },
  { id: 'unit', label: 'By Unit' },
]

const AGING_COLUMNS: Array<{ key: keyof ClaimMutuAgingGroupRow; label: string }> = [
  { key: 'a_0_30', label: '0-30' },
  { key: 'a_31_60', label: '31-60' },
  { key: 'a_61_90', label: '61-90' },
  { key: 'a_gt_90', label: '> 90 Days' },
]

const TH = 'px-3 py-2 font-medium text-gray-600 whitespace-nowrap'
const TD = 'px-3 py-1.5 tabular-nums whitespace-nowrap'

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

/** Units in the order the Summary Per Unit sheet lists them - exported for the page's unit filter. */
export const sortUnitOptions = (units: string[]) => [...units].sort(compareUnit)

function scopeLabel(b2b: ClaimMutuB2bScope) {
  return b2b === 'include' ? 'Include B2B' : 'Exclude B2B'
}

const fullOf = (m: ClaimMutuMeasure, v: number) =>
  m === 'amount' ? `Rp ${formatClaimMutuIdr(v)}` : `${formatClaimMutuKg(v)} kg`

/** A short number with the full one on hover. */
function Num({ v, m, strong }: { v: number; m: ClaimMutuMeasure; strong?: boolean }) {
  return (
    <span title={v ? fullOf(m, v) : undefined} className={strong ? 'font-semibold text-gray-900' : undefined}>
      {formatClaimMutuCompact(v)}
    </span>
  )
}

/** The share of a total as a thin bar with its percentage, in place of a separate % column. */
function ShareBar({ part, total, tone = 'indigo' }: { part: number; total: number; tone?: 'indigo' | 'emerald' }) {
  const pct = total > 0 && part > 0 ? Math.min(100, (part / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div className="h-1.5 flex-1 rounded-full bg-gray-100">
        <div
          className={cn('h-1.5 rounded-full', tone === 'indigo' ? 'bg-indigo-400' : 'bg-emerald-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-11 text-right text-[11px] tabular-nums text-gray-500">{formatShare(part, total)}</span>
    </div>
  )
}

/** OS amount per month for one unit, oldest to newest; only drawn once there are two months. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-[11px] text-gray-400">-</span>
  const max = Math.max(...values, 1)
  const w = 64
  const h = 18
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-indigo-500" />
    </svg>
  )
}

function Empty({ hasImport }: { hasImport: boolean }) {
  return (
    <div className="py-8 text-center text-sm text-gray-500">
      {hasImport ? 'No data for these filters.' : 'Upload a file to see the summary.'}
    </div>
  )
}

function SideHeader({ m }: { m: ClaimMutuMeasure }) {
  const unit = m === 'amount' ? '(Rp)' : '(Kg)'
  return (
    <>
      <th className={`${TH} text-right`}>OS {unit}</th>
      <th className={`${TH} text-left`}>OS Share</th>
      <th className={`${TH} text-right`}>Real {unit}</th>
      <th className={`${TH} text-left`}>Real Share</th>
    </>
  )
}

function SideCells({ p, total, m, strong }: { p: ClaimMutuSidePair; total: ClaimMutuSidePair; m: ClaimMutuMeasure; strong?: boolean }) {
  return (
    <>
      <td className={`${TD} text-right`}>
        <Num v={pairValue(p, 'os', m)} m={m} strong={strong} />
      </td>
      <td className="px-3 py-1.5">
        <ShareBar part={pairValue(p, 'os', m)} total={pairValue(total, 'os', m)} />
      </td>
      <td className={`${TD} text-right`}>
        <Num v={pairValue(p, 'real', m)} m={m} strong={strong} />
      </td>
      <td className="px-3 py-1.5">
        <ShareBar part={pairValue(p, 'real', m)} total={pairValue(total, 'real', m)} tone="emerald" />
      </td>
    </>
  )
}

function TotalRow({ label, total, m, colSpan = 1 }: { label: string; total: ClaimMutuSidePair; m: ClaimMutuMeasure; colSpan?: number }) {
  return (
    <tr className="border-t-2 border-gray-200 bg-gray-50">
      <td className="px-3 py-2 font-semibold" colSpan={colSpan}>
        {label}
      </td>
      <td className={`${TD} text-right`}>
        <Num v={pairValue(total, 'os', m)} m={m} strong />
      </td>
      <td />
      <td className={`${TD} text-right`}>
        <Num v={pairValue(total, 'real', m)} m={m} strong />
      </td>
      <td />
    </tr>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'px-3 py-1 text-xs whitespace-nowrap transition-colors',
            value === o.id ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-50',
          )}
        >
          {o.label}
        </button>
      ))}
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
  const [tab, setTab] = useState<RecapTab>('aging')
  const [measure, setMeasure] = useState<ClaimMutuMeasure>('amount')
  const [openCommodities, setOpenCommodities] = useState<Set<string>>(() => new Set())
  const [month, setMonth] = useState<string>('')

  const os = dashboard?.os ?? { claims: 0, qty: 0, amount: 0, over90: 0 }
  const real = dashboard?.real ?? { claims: 0, qty: 0, amount: 0 }
  const period = dashboard?.periodLabel ? `Period ${dashboard.periodLabel}` : ''
  const scope = scopeLabel(b2b)

  const tabNote: Record<RecapTab, string> = {
    aging: 'Claim value after tax per group (Pivot sheet). Click a group to filter the page.',
    lokasi: 'OS and realised claims per DEST code (Rekap Klaim Per Lokasi sheet).',
    komoditi: 'OS and realised claims per commodity; open a commodity to see its units (Summary Per Komoditi sheet).',
    unit: `OS and realised claims per unit for one month - that month's latest import, not narrowed by the CR date period (Summary Per Unit sheet${
      b2b === 'exclude' ? ', which the workbook builds as Include B2B' : ''
    }).`,
  }
  const realNote = osOnlyFilterActive && tab !== 'aging' ? ' The Group and Payment Method filters apply to OS only.' : ''
  const tabLoading = tab === 'unit' ? trendLoading : loading

  return (
    <div className="space-y-4">
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-3 transition-opacity duration-200 ${
          loading ? 'opacity-65' : 'opacity-100'
        }`}
      >
        <PerformanceSection1CardShell variant="open" title="Outstanding Quality Claim" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Claim Value (IDR)</div>
          <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimMutuIdr(os.amount)}</div>
          <div className="text-xs text-gray-500">
            Qty: <span className="font-semibold tabular-nums text-gray-900">{formatClaimMutuKg(os.qty)} kg</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">{os.claims.toLocaleString('en-US')}</span> claims ·{' '}
            {scope}
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="ongoing" title="Outstanding > 90 Days" selected onClick={() => undefined}>
          <div className="mb-1 text-sm text-gray-500">Claim Value (IDR)</div>
          <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimMutuIdr(os.over90)}</div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold tabular-nums text-gray-900">{formatShare(os.over90, os.amount)}</span> of total
            outstanding
          </div>
        </PerformanceSection1CardShell>

        <PerformanceSection1CardShell variant="completed" title="Realised Claims" selected onClick={() => undefined}>
          {dashboard?.realAvailable ? (
            <>
              <div className="mb-1 text-sm text-gray-500">Claim Value (IDR)</div>
              <div className="mb-3 text-xl font-bold tabular-nums text-gray-900">{formatClaimMutuIdr(real.amount)}</div>
              <div className="text-xs text-gray-500">
                Qty: <span className="font-semibold tabular-nums text-gray-900">{formatClaimMutuKg(real.qty)} kg</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                <span className="font-semibold tabular-nums text-gray-900">{real.claims.toLocaleString('en-US')}</span> claims
                {dashboard.realPeriodLabel ? <> · Period {dashboard.realPeriodLabel}</> : null}
              </div>
              {osOnlyFilterActive ? (
                <div className="mt-1 text-[11px] text-amber-700">Not narrowed by the Group / Payment Method filters.</div>
              ) : null}
            </>
          ) : (
            <div className="text-xs text-gray-500">
              {loading
                ? 'Loading…'
                : hasImport
                  ? 'This import has no Real_Claim sheet.'
                  : 'Upload a file to see realised claims.'}
            </div>
          )}
        </PerformanceSection1CardShell>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span>Quality Claim Summary</span>
              {tabLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={tab} options={TABS} onChange={setTab} ariaLabel="Summary" />
              {tab !== 'aging' ? (
                <Segmented
                  value={measure}
                  options={[
                    { id: 'amount', label: 'Value' },
                    { id: 'qty', label: 'Qty' },
                  ]}
                  onChange={setMeasure}
                  ariaLabel="Measure"
                />
              ) : null}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {[scope, tab === 'unit' ? '' : period].filter(Boolean).join(' · ')} · {tabNote[tab]}
            {realNote} Hover a number for the full value.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          {tab === 'aging' ? (
            <AgingTab dashboard={dashboard} hasImport={hasImport} selectedGroups={selectedGroups} onToggleGroup={onToggleGroup} />
          ) : tab === 'lokasi' ? (
            <LokasiTab dashboard={dashboard} hasImport={hasImport} m={measure} />
          ) : tab === 'komoditi' ? (
            <KomoditiTab
              dashboard={dashboard}
              hasImport={hasImport}
              m={measure}
              open={openCommodities}
              onToggle={(c) =>
                setOpenCommodities((prev) => {
                  const next = new Set(prev)
                  if (next.has(c)) next.delete(c)
                  else next.add(c)
                  return next
                })
              }
              onSetAll={(all) => setOpenCommodities(new Set(all))}
            />
          ) : (
            <UnitTab trend={trend} hasImport={hasImport} m={measure} month={month} onMonth={setMonth} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TableShell({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

function AgingTab({
  dashboard,
  hasImport,
  selectedGroups,
  onToggleGroup,
}: {
  dashboard: ClaimMutuDashboard | null
  hasImport: boolean
  selectedGroups: string[]
  onToggleGroup: (group: string) => void
}) {
  const groups = sortAgingGroups(dashboard?.agingByGroup ?? [])
  if (groups.length === 0) return <Empty hasImport={hasImport} />
  const total = (key: keyof ClaimMutuAgingGroupRow) => groups.reduce((s, g) => s + (Number(g[key]) || 0), 0)
  const grand = total('grand_total')
  return (
    <TableShell>
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
          const selected = selectedGroups.length === 1 && selectedGroups[0] === g.claim_group
          return (
            <tr
              key={g.claim_group}
              className={`cursor-pointer ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              onClick={() => onToggleGroup(g.claim_group)}
            >
              <td className="px-3 py-1.5 font-medium">{g.claim_group}</td>
              {AGING_COLUMNS.map((c) => (
                <td key={c.key} className={`${TD} text-right ${c.key === 'a_gt_90' && Number(g[c.key]) ? 'text-red-700' : ''}`}>
                  <Num v={Number(g[c.key])} m="amount" />
                </td>
              ))}
              <td className={`${TD} text-right`}>
                <Num v={g.grand_total} m="amount" strong />
              </td>
              <td className="px-3 py-1.5">
                <ShareBar part={g.grand_total} total={grand} />
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
              <Num v={total(c.key)} m="amount" strong />
            </td>
          ))}
          <td className={`${TD} text-right`}>
            <Num v={grand} m="amount" strong />
          </td>
          <td className="px-3 py-1.5 text-[11px] text-gray-500">{grand ? '100%' : '-'}</td>
        </tr>
      </tfoot>
    </TableShell>
  )
}

function LokasiTab({ dashboard, hasImport, m }: { dashboard: ClaimMutuDashboard | null; hasImport: boolean; m: ClaimMutuMeasure }) {
  const rows = sortLocations(dashboard?.byLocation ?? [])
  if (rows.length === 0) return <Empty hasImport={hasImport} />
  const total = rows.reduce<ClaimMutuSidePair>((s, r) => addPair(s, r), ZERO_PAIR)
  return (
    <TableShell>
      <thead className="bg-gray-100">
        <tr>
          <th className={`${TH} text-left`}>Location</th>
          <SideHeader m={m} />
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r) => (
          <tr key={r.dest} className="hover:bg-gray-50">
            <td className="px-3 py-1.5 whitespace-nowrap">
              <span className="font-medium text-gray-900">{r.dest}</span>
              {r.unit && r.unit !== r.dest ? <span className="ml-2 text-xs text-gray-500">{r.unit}</span> : null}
            </td>
            <SideCells p={r} total={total} m={m} />
          </tr>
        ))}
      </tbody>
      <tfoot>
        <TotalRow label="Grand Total" total={total} m={m} />
      </tfoot>
    </TableShell>
  )
}

function KomoditiTab({
  dashboard,
  hasImport,
  m,
  open,
  onToggle,
  onSetAll,
}: {
  dashboard: ClaimMutuDashboard | null
  hasImport: boolean
  m: ClaimMutuMeasure
  open: Set<string>
  onToggle: (commodity: string) => void
  onSetAll: (commodities: string[]) => void
}) {
  const { groups, total } = useMemo(() => groupByCommodity(dashboard?.byCommodityUnit ?? []), [dashboard])
  if (groups.length === 0) return <Empty hasImport={hasImport} />
  const allOpen = groups.every((g) => open.has(g.commodity))
  return (
    <>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="text-xs text-indigo-700 hover:underline"
          onClick={() => onSetAll(allOpen ? [] : groups.map((g) => g.commodity))}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <TableShell>
        <thead className="bg-gray-100">
          <tr>
            <th className={`${TH} text-left`}>Commodity / Unit</th>
            <SideHeader m={m} />
          </tr>
        </thead>
        <tbody className="divide-y">
          {groups.flatMap((g) => {
            const isOpen = open.has(g.commodity)
            const head = (
              <tr key={g.commodity} className="cursor-pointer hover:bg-gray-50" onClick={() => onToggle(g.commodity)}>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 font-medium text-gray-900">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {g.commodity}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">{g.units.length} unit</span>
                </td>
                <SideCells p={g.subtotal} total={total} m={m} strong />
              </tr>
            )
            if (!isOpen) return [head]
            return [
              head,
              ...g.units.map((u) => (
                <tr key={`${g.commodity}|${u.unit}`} className="bg-slate-50/60 text-gray-600">
                  <td className="py-1 pl-9 pr-3 whitespace-nowrap">{u.unit}</td>
                  <SideCells p={u} total={total} m={m} />
                </tr>
              )),
            ]
          })}
        </tbody>
        <tfoot>
          <TotalRow label="Grand Total All Commodities" total={total} m={m} />
        </tfoot>
      </TableShell>
    </>
  )
}

function UnitTab({
  trend,
  hasImport,
  m,
  month,
  onMonth,
}: {
  trend: ClaimMutuTrend | null
  hasImport: boolean
  m: ClaimMutuMeasure
  month: string
  onMonth: (m: string) => void
}) {
  const rows = trend?.rows ?? []
  const months = [...(trend?.months ?? [])].sort()
  const units = trendUnits(rows)
  if (months.length === 0 || units.length === 0) return <Empty hasImport={hasImport} />
  const active = months.includes(month) ? month : months[months.length - 1]
  const cell = new Map(rows.map((r) => [`${r.month}|${r.unit}`, r]))
  const at = (mo: string, u: string): ClaimMutuSidePair => cell.get(`${mo}|${u}`) ?? ZERO_PAIR
  const monthRows = units.map((u) => ({ unit: u, p: at(active, u) })).filter((r) => r.p.os_amount || r.p.os_qty || r.p.real_amount || r.p.real_qty)
  const total = monthRows.reduce<ClaimMutuSidePair>((s, r) => addPair(s, r.p), ZERO_PAIR)
  return (
    <>
      <div className="mb-2 flex items-center justify-end gap-2 text-xs text-gray-600">
        <label htmlFor="claim-mutu-unit-month">Month</label>
        <select
          id="claim-mutu-unit-month"
          className="h-7 rounded-md border border-gray-300 bg-white px-2 text-xs"
          value={active}
          onChange={(e) => onMonth(e.target.value)}
        >
          {[...months].reverse().map((mo) => (
            <option key={mo} value={mo}>
              {formatClaimMutuMonth(mo)}
            </option>
          ))}
        </select>
        <span className="text-gray-400">{months.length} month(s) imported</span>
      </div>
      <TableShell>
        <thead className="bg-gray-100">
          <tr>
            <th className={`${TH} text-left`}>Unit</th>
            <SideHeader m={m} />
            <th className={`${TH} text-left`}>OS Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {monthRows.map((r) => (
            <tr key={r.unit} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 font-medium whitespace-nowrap">{r.unit}</td>
              <SideCells p={r.p} total={total} m={m} />
              <td className="px-3 py-1.5">
                <Sparkline values={months.map((mo) => pairValue(at(mo, r.unit), 'os', m))} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50">
            <td className="px-3 py-2 font-semibold">Total {formatClaimMutuMonth(active)}</td>
            <td className={`${TD} text-right`}>
              <Num v={pairValue(total, 'os', m)} m={m} strong />
            </td>
            <td />
            <td className={`${TD} text-right`}>
              <Num v={pairValue(total, 'real', m)} m={m} strong />
            </td>
            <td />
            <td />
          </tr>
        </tfoot>
      </TableShell>
    </>
  )
}
