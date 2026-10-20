'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileText, Layers, Loader2, Upload } from 'lucide-react'
import Layout from '@/components/Layout'
import { HeaderFilterSlot } from '@/components/HeaderFilterSlot'
import { PerformanceContractDateControl } from '@/components/performance/PerformanceContractDateControl'
import { StitchFields } from '@/components/shared/stitchField'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { canViewCommercialDashboardPage, usePermissions } from '@/components/PermissionsContext'
import { usePageHeaderBusy } from '@/components/PageHeaderBusyContext'
import api from '@/lib/api'
import { buildCacheKey, cachedGet } from '@/lib/clientDataCache'
import {
  buildPerformancePeriodOptions,
  resolvePerformancePeriodDateRange,
  type PerformancePeriodKey,
} from '@/lib/performancePeriodFilters'
import { defaultCommercialDocsYtdRange } from '@/lib/commercialDocumentsTypes'
import { cn } from '@/lib/utils'

type PlantCompleteness = {
  plant: string
  contractCount: number
  uploadedSlots: number
  totalSlots: number
  missingSlots: number
  completenessPct: number
}

type CompletenessPayload = {
  plants: PlantCompleteness[]
  totals: PlantCompleteness
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

const HIGH_GAP_PCT = 50
const TOP_PLANT_LIMIT = 10

type ActionScope = 'all' | 'high-gaps'

function pctClass(value: number): string {
  if (value >= 80) return 'text-green-700'
  if (value >= HIGH_GAP_PCT) return 'text-amber-700'
  return 'text-red-700'
}

function byMissingDesc(a: PlantCompleteness, b: PlantCompleteness): number {
  if (b.missingSlots !== a.missingSlots) return b.missingSlots - a.missingSlots
  return a.plant.localeCompare(b.plant)
}

export default function CommercialDashboardPage() {
  return (
    <Layout>
      <StitchFields>
        <CommercialDashboardContent />
      </StitchFields>
    </Layout>
  )
}

function CommercialDashboardContent() {
  const router = useRouter()
  const perms = usePermissions()
  const canViewPage = canViewCommercialDashboardPage(perms)
  const ytdDefault = useMemo(() => defaultCommercialDocsYtdRange(), [])
  const [period, setPeriod] = useState<PerformancePeriodKey>('YTD')
  const [dateFrom, setDateFrom] = useState(ytdDefault.dateFrom)
  const [dateTo, setDateTo] = useState(ytdDefault.dateTo)
  const [payload, setPayload] = useState<CompletenessPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [actionScope, setActionScope] = useState<ActionScope>('all')
  const [showAllPlants, setShowAllPlants] = useState(false)

  usePageHeaderBusy(loading || fetching)

  useEffect(() => {
    if (canViewPage === false) router.replace('/dashboard')
  }, [canViewPage, router])

  const fetchCompleteness = useCallback(async () => {
    setFetching(true)
    try {
      const params = new URLSearchParams()
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      const url = `/commercial-documents/completeness-by-plant?${params.toString()}`
      const cacheKey = buildCacheKey('GET', url)
      const { data } = await cachedGet(cacheKey, (signal) => api.get(url, { signal }).then((r) => r.data))
      const body = data?.data as CompletenessPayload | undefined
      setPayload(
        body?.plants && body.totals
          ? body
          : {
              plants: [],
              totals: {
                plant: 'All',
                contractCount: 0,
                uploadedSlots: 0,
                totalSlots: 0,
                missingSlots: 0,
                completenessPct: 0,
              },
            },
      )
    } catch {
      setPayload(null)
    } finally {
      setFetching(false)
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (!perms.loaded || canViewPage !== true) return
    void fetchCompleteness()
  }, [fetchCompleteness, perms.loaded, canViewPage])

  const plants = payload?.plants ?? []
  const totals = payload?.totals
  const scopedPlants = useMemo(() => {
    const rows =
      actionScope === 'high-gaps' ? plants.filter((row) => row.completenessPct < HIGH_GAP_PCT) : plants
    return [...rows].sort(byMissingDesc)
  }, [actionScope, plants])
  const displayPlants = showAllPlants ? scopedPlants : scopedPlants.slice(0, TOP_PLANT_LIMIT)

  if (!perms.loaded) {
    return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>
  }
  if (canViewPage !== true) return null

  return (
    <div className="space-y-6">
      <HeaderFilterSlot>
        <PerformanceContractDateControl
          header
          period={period}
          options={buildPerformancePeriodOptions()}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onPeriodChange={(value) => {
            setPeriod(value)
            const range = resolvePerformancePeriodDateRange(value)
            setDateFrom(range.dateFrom)
            setDateTo(range.dateTo)
          }}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          resolvePeriodRange={resolvePerformancePeriodDateRange}
        />
      </HeaderFilterSlot>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Commercial Documents Completeness
                <span className="rounded-full border border-blue-200/60 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                  Active Scope
                </span>
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Commercial document completeness by Region/Plant. Each contract has nine checklist slots.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                <span className="mr-1.5 h-2 w-2 rounded-full bg-red-500" />
                9 slots / contract
              </span>
              {fetching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <ScopeButton
                active={actionScope === 'all'}
                onClick={() => {
                  setActionScope('all')
                  setShowAllPlants(false)
                }}
              >
                All plants
              </ScopeButton>
              <ScopeButton
                active={actionScope === 'high-gaps'}
                onClick={() => {
                  setActionScope('high-gaps')
                  setShowAllPlants(false)
                }}
              >
                High gaps
              </ScopeButton>
            </div>
            <p className="text-[11px] text-slate-400">High gaps are plants under {HIGH_GAP_PCT}% complete.</p>
          </div>

          <div className="grid grid-cols-12 items-stretch gap-5">
            <div className="col-span-12 flex flex-col justify-between gap-2.5 lg:col-span-3">
              <StackedKpi
                label="Contracts"
                hint="Contracts in the selected period"
                value={totals ? totals.contractCount.toLocaleString('en-US') : '—'}
                loading={loading}
                icon={<FileText className="h-3.5 w-3.5" />}
              />
              <StackedKpi
                label="Uploaded"
                hint="Checklist slots with a file"
                value={totals ? totals.uploadedSlots.toLocaleString('en-US') : '—'}
                loading={loading}
                icon={<Upload className="h-3.5 w-3.5 text-emerald-500" />}
              />
              <StackedKpi
                label="Total slots"
                hint="Nine documents expected per contract"
                value={totals ? totals.totalSlots.toLocaleString('en-US') : '—'}
                loading={loading}
                icon={<Layers className="h-3.5 w-3.5" />}
              />
              <StackedKpi
                label="Completeness"
                hint={
                  totals && totals.completenessPct < HIGH_GAP_PCT
                    ? `${totals.missingSlots.toLocaleString('en-US')} slots missing`
                    : 'Uploaded slots divided by expected slots'
                }
                value={totals ? formatPct(totals.completenessPct) : '—'}
                loading={loading}
                urgent={Boolean(totals && totals.totalSlots > 0 && totals.completenessPct < HIGH_GAP_PCT)}
                valueClassName={totals ? pctClass(totals.completenessPct) : undefined}
              />
            </div>

            <div className="col-span-12 flex min-h-[280px] flex-col rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 lg:col-span-4">
              <div className="mb-2 text-xs font-semibold text-slate-700">
                {showAllPlants ? 'All plants by missing slots' : 'Top 10 plants by missing slots'}
              </div>
              {loading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Loading chart...</div>
              ) : displayPlants.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                  No plants in this scope.
                </div>
              ) : (
                <div className="min-h-[240px] flex-1 overflow-x-auto">
                  <div
                    className="h-full min-h-[240px]"
                    style={{ width: showAllPlants ? Math.max(280, displayPlants.length * 48) : '100%' }}
                  >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={displayPlants} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="plant"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        interval={0}
                        angle={-35}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} width={36} />
                      <Tooltip
                        cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const row = payload[0].payload as PlantCompleteness
                          return (
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
                              <div className="mb-1 font-semibold text-gray-900">{row.plant}</div>
                              <div className="text-gray-600">
                                Contracts: {row.contractCount.toLocaleString('en-US')}
                              </div>
                              <div className="text-gray-600">
                                Uploaded: {row.uploadedSlots.toLocaleString('en-US')}
                              </div>
                              <div className="text-gray-600">Total: {row.totalSlots.toLocaleString('en-US')}</div>
                              <div className="text-gray-600">Missing: {row.missingSlots.toLocaleString('en-US')}</div>
                              <div className={cn('mt-1 font-semibold', pctClass(row.completenessPct))}>
                                {formatPct(row.completenessPct)}
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Bar dataKey="missingSlots" name="Missing" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            <div className="col-span-12 flex flex-col overflow-hidden rounded-lg border border-slate-200 lg:col-span-5">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <div className="text-xs font-semibold text-slate-700">Top Region/Plant records</div>
                <span className="text-[11px] text-slate-400">
                  Showing {displayPlants.length} of {scopedPlants.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Region/Plant</th>
                      <th className="px-3 py-2 text-right">Missing</th>
                      <th className="px-3 py-2 text-right">Uploaded</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Completeness</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayPlants.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                          No plants in this scope.
                        </td>
                      </tr>
                    ) : (
                      displayPlants.map((row) => (
                        <tr key={row.plant} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-800">{row.plant}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-700">
                            {row.missingSlots.toLocaleString('en-US')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.uploadedSlots.toLocaleString('en-US')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.totalSlots.toLocaleString('en-US')}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-2 text-right font-medium tabular-nums',
                              pctClass(row.completenessPct),
                            )}
                          >
                            {formatPct(row.completenessPct)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {scopedPlants.length > TOP_PLANT_LIMIT ? (
                <div className="border-t border-slate-100 px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-xs font-medium text-blue-700 hover:text-blue-800"
                    onClick={() => setShowAllPlants((open) => !open)}
                  >
                    {showAllPlants ? 'Show top 10' : 'View all plants'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <UpcomingSection
        code="S2"
        title="Section 2: Shortage Claim"
        subtitle="Reserved for the next phase: shortage summary by Region/Plant."
        slots={['Outstanding qty', 'Claim amount', 'Aging']}
      />
      <UpcomingSection
        code="S3"
        title="Section 3: Quality Claim"
        subtitle="Reserved for the next phase: quality-claim summary by Region/Plant."
        slots={['Claim qty', 'Claim amount', 'Aging']}
      />
    </div>
  )
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 font-medium',
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  )
}

function StackedKpi({
  label,
  hint,
  value,
  loading,
  icon,
  urgent,
  valueClassName,
}: {
  label: string
  hint: string
  value: string
  loading: boolean
  icon?: ReactNode
  urgent?: boolean
  valueClassName?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        urgent ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50/70',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {urgent ? (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Urgent</span>
        ) : icon ? (
          <span className="rounded border border-slate-200 bg-white p-1 text-slate-400">{icon}</span>
        ) : null}
      </div>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums text-slate-900', loading && 'opacity-40', valueClassName)}>
        {value}
      </p>
      <p className={cn('mt-0.5 text-[10px]', urgent ? 'font-medium text-red-600' : 'text-slate-400')}>{hint}</p>
    </div>
  )
}

function UpcomingSection({
  code,
  title,
  subtitle,
  slots,
}: {
  code: string
  title: string
  subtitle: string
  slots: string[]
}) {
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
            {code}
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-700">{title}</h3>
            <p className="text-xs text-slate-400">{subtitle}</p>
          </div>
        </div>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-400">Upcoming</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {slots.map((slot) => (
          <div
            key={slot}
            className="flex h-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 text-xs text-slate-400"
          >
            {slot}
          </div>
        ))}
      </div>
    </section>
  )
}
