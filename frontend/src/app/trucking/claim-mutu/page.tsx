'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Layout from '@/components/Layout'
import { StitchFields } from '@/components/shared/stitchField'
import { usePageHeaderBusy } from '@/components/PageHeaderBusyContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeftRight, CircleDot, Columns3, Factory, GripVertical, Layers, Loader2, MapPin, Package, SlidersHorizontal, Wallet, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { CONTRACT_PERF_TABLE_CELL_PAD } from '@/lib/contractPerformanceColumns'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  LIST_PAGE_TABLE_HEADER_ROW_CLASS,
  compactTableColWidthCss,
  compactTableHeaderMinWidthPx,
} from '@/lib/compactTableUi'
import { operationalTableColumnClass } from '@/lib/operationalTableLayout'
import api from '@/lib/api'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { FilterSingleSelect } from '@/components/FilterSingleSelect'
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  selectionChips,
  LIST_FILTER_FIELDS_ROW_CLASS,
} from '@/components/shared/ListFilterPanel'
import { HeaderFilterSlot } from '@/components/HeaderFilterSlot'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { HeaderScopeField } from '@/components/shared/HeaderScopeField'
import { ListFilterBar, ListFilterField } from '@/components/shared/ListFilterBar'
import { FitFilterBar } from '@/components/shared/FitFilterBar'
import { MultiValueField, SingleValueField } from '@/components/shared/ListFilterFields'
import { iconButtonClass } from '@/lib/iconButton'
import { listRangeText } from '@/lib/listRangeText'
import {
  formatContractDateScopeLabel,
  PerformanceContractDateControl,
  periodRangeMatchesDates,
} from '@/components/performance/PerformanceContractDateControl'
import {
  ClaimMutuSection1Dashboard,
  sortUnitOptions,
  type ClaimMutuDashboard,
} from '@/components/claim-mutu/ClaimMutuSection1Dashboard'
import {
  buildClaimSusutPeriodOptions,
  CLAIM_B2B_FILTER_OPTIONS,
  claimSusutAgingBucket,
  formatClaimB2bStatus,
  resolveClaimSusutPeriodRange,
  type ClaimSusutPeriodKey,
} from '@/lib/claimSusutView'
import {
  appendClaimMutuFilterParams,
  CLAIM_MUTU_COLUMN_ORDER_KEY,
  CLAIM_MUTU_COLUMNS,
  CLAIM_MUTU_DEFAULT_B2B,
  CLAIM_MUTU_DEFAULT_VISIBLE_IDS,
  CLAIM_MUTU_NUMERIC_SORT_KEYS,
  CLAIM_MUTU_VIEW_PREF_KEY,
  compareCommodity,
  formatClaimMutuIdr,
  formatClaimMutuKg,
  type ClaimMutuApiFilters,
  type ClaimMutuB2bScope,
} from '@/lib/claimMutuView'

type ClaimMutuRow = Record<string, unknown> & { id: string; is_b2b?: boolean; b2b_status?: string }

/** The imports list only picks the active import; its file name is shown in the table header. */
type ClaimMutuImportItem = { id: string; file_name?: string | null }

const columns = CLAIM_MUTU_COLUMNS
const B2B_SCOPE_OPTIONS = [
  { value: 'exclude', label: 'Exclude B2B' },
  { value: 'include', label: 'Include B2B' },
]
const pageSize = 20

function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || fallback
}

function formatCell(kind: string | undefined, v: unknown): string {
  if (v == null || v === '') return '-'
  switch (kind) {
    case 'date':
      return formatDateDMY(String(v))
    case 'idr':
      return Number(v) ? formatClaimMutuIdr(Number(v)) : '-'
    case 'kg':
      return formatClaimMutuKg(Number(v))
    case 'number':
      return Number.isFinite(Number(v)) ? Number(v).toLocaleString('id-ID', { maximumFractionDigits: 3 }) : String(v)
    case 'b2b':
      return v ? formatClaimB2bStatus(String(v)) : '-'
    default:
      return formatSapDisplayValue(v)
  }
}

/** Claim Status filter: narrows the view table only; Section 1 already shows the two apart. */
const CLAIM_MUTU_CLAIM_STATUS_OPTIONS = ['Claimed', 'Not Claimed']
/** CR date opens on YTD, as on Shortage Claim. */
const CLAIM_MUTU_DEFAULT_PERIOD: ClaimSusutPeriodKey = 'YTD'

function renderCell(c: { id: string; kind?: string }, r: ClaimMutuRow) {
  const kind = c.kind
  if (kind === 'b2b') {
    const status = String(r.b2b_status ?? (r.is_b2b ? 'B2B' : '')).toUpperCase()
    return (
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-xs font-medium',
          status === 'B2B'
            ? 'bg-indigo-50 text-indigo-700'
            : status === 'DIRECT'
              ? 'bg-gray-100 text-gray-700'
              : 'bg-amber-50 text-amber-700',
        )}
      >
        {formatClaimB2bStatus(status)}
      </span>
    )
  }
  if (kind === 'status') {
    const v = r.claim_status as string | undefined
    if (!v) return '-'
    return (
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-xs font-medium',
          v === 'Claimed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
        )}
      >
        {v}
      </span>
    )
  }
  if (kind === 'aging') {
    const days = r.os_days as number | null | undefined
    if (days == null) return '-'
    const bucket = claimSusutAgingBucket(days)
    return (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span>{Number(days).toLocaleString('en-US')}</span>
        {bucket ? (
          <span
            className={cn(
              'rounded px-1 text-[0.625rem] font-medium',
              bucket === '> 90' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600',
            )}
          >
            {bucket}
          </span>
        ) : null}
      </span>
    )
  }
  return formatCell(kind, r[c.id])
}

/** A text cell the column width cuts short shows its whole value on hover. */
function hoverTitle(kind: string | undefined, v: unknown): string | undefined {
  if (kind && kind !== 'number') return undefined
  if (v == null || v === '') return undefined
  const text = formatCell(kind, v)
  return text === '-' ? undefined : text
}

export default function ClaimMutuPage() {
  const [imports, setImports] = useState<ClaimMutuImportItem[]>([])
  const [selectedImportId, setSelectedImportId] = useState<string>('')
  const [rows, setRows] = useState<ClaimMutuRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dashboard, setDashboard] = useState<ClaimMutuDashboard | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [b2b, setB2b] = useState<ClaimMutuB2bScope>(CLAIM_MUTU_DEFAULT_B2B)
  const [period, setPeriod] = useState<ClaimSusutPeriodKey>(CLAIM_MUTU_DEFAULT_PERIOD)
  const [dateFrom, setDateFrom] = useState(() => resolveClaimSusutPeriodRange(CLAIM_MUTU_DEFAULT_PERIOD).dateFrom)
  const [dateTo, setDateTo] = useState(() => resolveClaimSusutPeriodRange(CLAIM_MUTU_DEFAULT_PERIOD).dateTo)
  const [selectedCommodities, setSelectedCommodities] = useState<string[]>([])
  const [selectedUnits, setSelectedUnits] = useState<string[]>([])
  const [selectedVendorTypes, setSelectedVendorTypes] = useState<string[]>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [selectedMetodes, setSelectedMetodes] = useState<string[]>([])
  const [selectedClaimStatuses, setSelectedClaimStatuses] = useState<string[]>([])
  const [selectedB2bStatuses, setSelectedB2bStatuses] = useState<string[]>([])
  const [claimedCount, setClaimedCount] = useState(0)
  const [commodityOptions, setCommodityOptions] = useState<string[]>([])
  const [unitOptions, setUnitOptions] = useState<string[]>([])
  const [vendorTypeOptions, setVendorTypeOptions] = useState<string[]>([])
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  const [metodeOptions, setMetodeOptions] = useState<string[]>([])

  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string>('os_days')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => new Set(CLAIM_MUTU_DEFAULT_VISIBLE_IDS))
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem(CLAIM_MUTU_COLUMN_ORDER_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  })
  const [dragColId, setDragColId] = useState<string | null>(null)
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)
  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)

  const scopeFilters: ClaimMutuApiFilters = useMemo(
    () => ({
      importId: selectedImportId || undefined,
      b2b,
      dateFrom,
      dateTo,
      commodities: selectedCommodities,
      units: selectedUnits,
      vendorTypes: selectedVendorTypes,
      claimGroups: selectedGroups,
      metodePayments: selectedMetodes,
      claimStatuses: selectedClaimStatuses,
      b2bStatuses: selectedB2bStatuses,
    }),
    [
      selectedImportId,
      b2b,
      dateFrom,
      dateTo,
      selectedCommodities,
      selectedUnits,
      selectedVendorTypes,
      selectedGroups,
      selectedMetodes,
      selectedClaimStatuses,
      selectedB2bStatuses,
    ],
  )

  useEffect(() => {
    const { dateFrom: from, dateTo: to } = resolveClaimSusutPeriodRange(period)
    setDateFrom(from)
    setDateTo(to)
  }, [period])

  useEffect(() => {
    const allIds = columns.map((c) => c.id)
    setColumnOrderIds((prev) => {
      const base = prev.length > 0 ? prev : allIds
      const deduped = Array.from(new Set(base))
      const missing = allIds.filter((id) => !deduped.includes(id))
      return [...deduped, ...missing].filter((id) => allIds.includes(id))
    })
  }, [])

  const visibleColumns = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c] as const))
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : columns.map((c) => c.id)).filter((id) => byId.has(id))
    return orderedIds.map((id) => byId.get(id)!).filter((c) => visibleColumnIds.has(c.id))
  }, [columnOrderIds, visibleColumnIds])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  useEffect(() => {
    const calc = () => {
      const el = bottomScrollRef.current
      if (el) setTableScrollWidth(el.scrollWidth)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [visibleColumns, rows.length, loading])

  useEffect(() => {
    try {
      if (columnOrderIds.length > 0) localStorage.setItem(CLAIM_MUTU_COLUMN_ORDER_KEY, JSON.stringify(columnOrderIds))
    } catch {
      /* ignore */
    }
  }, [columnOrderIds])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(CLAIM_MUTU_VIEW_PREF_KEY)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const known = new Set(columns.map((c) => c.id))
        if (Array.isArray(value?.visibleColumnIds) && value.visibleColumnIds.length > 0) {
          setVisibleColumnIds(new Set(value.visibleColumnIds.map(String).filter((id: string) => known.has(id))))
        }
        if (Array.isArray(value?.columnOrderIds) && value.columnOrderIds.length > 0) {
          setColumnOrderIds(value.columnOrderIds.map(String))
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    saveViewTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: CLAIM_MUTU_VIEW_PREF_KEY,
          value: { visibleColumnIds: Array.from(visibleColumnIds), columnOrderIds },
        })
        .catch(() => null)
    }, 600)
    return () => {
      if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    }
  }, [columnOrderIds, visibleColumnIds])

  const reorderColumnByDrag = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setColumnOrderIds((prev) => {
      const ids = prev.length > 0 ? [...prev] : columns.map((c) => c.id)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(dropId)
      if (from < 0 || to < 0) return ids
      ids.splice(from, 1)
      ids.splice(to, 0, dragId)
      return ids
    })
  }

  const loadImports = async () => {
    const res = await api.get('/claim-mutu/imports')
    setImports(res.data.data || [])
    const first = (res.data.data || [])?.[0]?.id
    if (!selectedImportId && first) setSelectedImportId(first)
  }

  const loadFilterOptions = useCallback(async (filters: ClaimMutuApiFilters) => {
    const res = await api.get(`/claim-mutu/filter-options?${appendClaimMutuFilterParams(new URLSearchParams(), filters)}`)
    const data = res.data?.data || {}
    setCommodityOptions([...(data.commodities || []).map(String)].sort(compareCommodity))
    setUnitOptions(sortUnitOptions((data.units || []).map(String)))
    setVendorTypeOptions((data.vendorTypes || []).map(String))
    setGroupOptions((data.claimGroups || []).map(String))
    setMetodeOptions((data.metodePayments || []).map(String))
  }, [])

  const loadDashboard = useCallback(async (filters: ClaimMutuApiFilters) => {
    setDashboardLoading(true)
    try {
      const res = await api.get(`/claim-mutu/dashboard?${appendClaimMutuFilterParams(new URLSearchParams(), filters)}`)
      setDashboard((res.data?.data ?? null) as ClaimMutuDashboard | null)
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  // Only the latest rows request may fill the table: requests are not cancelled, so a slower,
  // older one (the filter before the user changed it) could otherwise land last and show the
  // wrong rows - which reads as "the filter does nothing".
  const rowsRequestRef = useRef(0)
  const loadRows = useCallback(
    async (filters: ClaimMutuApiFilters, opts: { page: number; sortKey: string; sortDir: 'asc' | 'desc' }) => {
      const seq = ++rowsRequestRef.current
      setLoading(true)
      try {
        const params = appendClaimMutuFilterParams(new URLSearchParams(), filters)
        params.set('limit', String(pageSize))
        params.set('offset', String((opts.page - 1) * pageSize))
        params.set('sortKey', opts.sortKey)
        params.set('sortDir', opts.sortDir)
        const res = await api.get(`/claim-mutu/rows?${params}`)
        if (seq !== rowsRequestRef.current) return
        setRows(res.data.data || [])
        setTotalCount(Number(res.data.meta?.totalCount) || 0)
        setClaimedCount(Number(res.data.meta?.claimedCount) || 0)
      } finally {
        if (seq === rowsRequestRef.current) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    loadImports().catch((e) => setError(apiErrorMessage(e, 'Failed to load Quality Claim imports')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setPage(1)
  }, [scopeFilters, sortKey, sortDir])

  useEffect(() => {
    if (!selectedImportId) return
    loadFilterOptions(scopeFilters).catch((e) => setError(apiErrorMessage(e, 'Failed to load Quality Claim filters')))
  }, [selectedImportId, loadFilterOptions, scopeFilters])

  useEffect(() => {
    if (!selectedImportId) return
    loadDashboard(scopeFilters).catch((e) => setError(apiErrorMessage(e, 'Failed to load Quality Claim summary')))
  }, [selectedImportId, loadDashboard, scopeFilters])

  useEffect(() => {
    if (!selectedImportId) return
    loadRows(scopeFilters, { page, sortKey, sortDir }).catch((e) =>
      setError(apiErrorMessage(e, 'Failed to load Quality Claim rows')),
    )
  }, [selectedImportId, loadRows, scopeFilters, page, sortKey, sortDir])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!columnsOpen) return
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [columnsOpen])

  usePageHeaderBusy(loading || dashboardLoading)

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(CLAIM_MUTU_NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc')
    }
  }

  const periodFiltered = period !== 'ALL' || !periodRangeMatchesDates(resolveClaimSusutPeriodRange('ALL'), dateFrom, dateTo)
  const periodIsDefault =
    period === CLAIM_MUTU_DEFAULT_PERIOD &&
    periodRangeMatchesDates(resolveClaimSusutPeriodRange(CLAIM_MUTU_DEFAULT_PERIOD), dateFrom, dateTo)
  const otherFilters =
    b2b !== CLAIM_MUTU_DEFAULT_B2B ||
    selectedCommodities.length > 0 ||
    selectedUnits.length > 0 ||
    selectedVendorTypes.length > 0 ||
    selectedGroups.length > 0 ||
    selectedMetodes.length > 0 ||
    selectedB2bStatuses.length > 0 ||
    selectedClaimStatuses.length > 0
  const anyFilter = periodFiltered || otherFilters

  const resetFilters = () => {
    const { dateFrom: from, dateTo: to } = resolveClaimSusutPeriodRange(CLAIM_MUTU_DEFAULT_PERIOD)
    setB2b(CLAIM_MUTU_DEFAULT_B2B)
    setPeriod(CLAIM_MUTU_DEFAULT_PERIOD)
    setDateFrom(from)
    setDateTo(to)
    setSelectedCommodities([])
    setSelectedUnits([])
    setSelectedVendorTypes([])
    setSelectedGroups([])
    setSelectedMetodes([])
    setSelectedClaimStatuses([])
    setSelectedB2bStatuses([])
    setPage(1)
  }

  const periodOptions = useMemo(() => buildClaimSusutPeriodOptions(), [])
  /** "YTD (01/01/2026 – 29/09/2026)", a custom "01/03/2026 – 31/03/2026", or "All". */
  const crDateLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return 'All'
    const range = `${dateFrom ? formatDateDMY(dateFrom) : '…'} – ${dateTo ? formatDateDMY(dateTo) : '…'}`
    const preset = resolveClaimSusutPeriodRange(period)
    return period !== 'ALL' && periodRangeMatchesDates(preset, dateFrom, dateTo) ? `${preset.label} (${range})` : range
  }, [period, dateFrom, dateTo])
  const selectedImport = imports.find((i) => i.id === selectedImportId)

  // The new export has no METODE PAYMENT column: offer the filter only when a value exists.
  const hasPaymentMethods = metodeOptions.some((o) => o !== '(Blank)')
  const b2bStatusField = (
    <MultiValueField label="B2B Status" options={[...CLAIM_B2B_FILTER_OPTIONS]} selected={selectedB2bStatuses} onChange={setSelectedB2bStatuses} placeholder="Scope above" emptyMessage="No values" icon={<ArrowLeftRight className="h-4 w-4" />} />
  )
  const vendorTypeField = (
    <MultiValueField label="Vendor Type" options={vendorTypeOptions} selected={selectedVendorTypes} onChange={setSelectedVendorTypes} placeholder="All vendor types" emptyMessage="No vendor types" icon={<Factory className="h-4 w-4" />} uppercase />
  )
  const groupField = (
    <MultiValueField label="Group (OS only)" options={groupOptions} selected={selectedGroups} onChange={setSelectedGroups} placeholder="All groups" emptyMessage="No groups" icon={<Layers className="h-4 w-4" />} uppercase />
  )
  const metodeField = (
    <MultiValueField label="Payment Method (OS only)" options={metodeOptions} selected={selectedMetodes} onChange={setSelectedMetodes} placeholder="All payment methods" emptyMessage="No payment methods" icon={<Wallet className="h-4 w-4" />} uppercase />
  )
  const claimStatusField = (
    <MultiValueField label="Claim Status" options={[...CLAIM_MUTU_CLAIM_STATUS_OPTIONS]} selected={selectedClaimStatuses} onChange={setSelectedClaimStatuses} placeholder="All statuses" emptyMessage="No statuses" icon={<CircleDot className="h-4 w-4" />} />
  )

  const b2bScopeField = (
    <SingleValueField label="B2B" options={B2B_SCOPE_OPTIONS} value={b2b} onChange={(v) => setB2b(v === 'include' ? 'include' : 'exclude')} icon={<ArrowLeftRight className="h-4 w-4" />} />
  )
  const productField = (
    <MultiValueField label="Product" options={commodityOptions} selected={selectedCommodities} onChange={setSelectedCommodities} placeholder="All products" emptyMessage="No products" icon={<Package className="h-4 w-4" />} uppercase />
  )

  return (
    <Layout>
      <StitchFields>
        <div className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
              {error}
            </div>
          )}

          {(dashboard?.warnings ?? []).length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
              {dashboard!.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          ) : null}

          <HeaderFilterSlot>
            <PerformanceContractDateControl
              header
              period={period}
              options={periodOptions}
              dateFrom={dateFrom}
              dateTo={dateTo}
              dateLabel="CR Date"
              onPeriodChange={setPeriod}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              resolvePeriodRange={resolveClaimSusutPeriodRange}
              fieldStyle
              active={!periodIsDefault}
            />
            <HeaderScopeField
              label="Region/Plant"
              options={unitOptions}
              selected={selectedUnits}
              onChange={setSelectedUnits}
              emptyMessage="No region/plant values"
              icon={<MapPin className="h-4 w-4" />}
              uppercaseOptionLabels
            />
          </HeaderFilterSlot>
          <FitFilterBar
            items={[
              { key: 'b2b', width: 11, row: b2bScopeField, panel: <ListFilterField label="B2B">{b2bScopeField}</ListFilterField>, active: b2b !== CLAIM_MUTU_DEFAULT_B2B },
              { key: 'product', width: 12, row: productField, panel: <ListFilterField label="Product">{productField}</ListFilterField>, active: selectedCommodities.length > 0 },
              { key: 'b2bStatus', width: 11, row: b2bStatusField, panel: <ListFilterField label="B2B status">{b2bStatusField}</ListFilterField>, active: selectedB2bStatuses.length > 0 },
              { key: 'vendorType', width: 12, row: vendorTypeField, panel: <ListFilterField label="Vendor type">{vendorTypeField}</ListFilterField>, active: selectedVendorTypes.length > 0 },
              { key: 'group', width: 12, row: groupField, panel: <ListFilterField label="Group (OS only)">{groupField}</ListFilterField>, active: selectedGroups.length > 0 },
              ...(hasPaymentMethods
                ? [{ key: 'metode', width: 13, row: metodeField, panel: <ListFilterField label="Payment method (OS only)">{metodeField}</ListFilterField>, active: selectedMetodes.length > 0 }]
                : []),
              { key: 'status', width: 12, row: claimStatusField, panel: <ListFilterField label="Claim status">{claimStatusField}</ListFilterField>, active: selectedClaimStatuses.length > 0 },
            ]}
            anyActive={!periodIsDefault || otherFilters}
            onReset={resetFilters}
          />

          <ClaimMutuSection1Dashboard
            crDateLabel={crDateLabel}
            dashboard={dashboard}
            loading={dashboardLoading}
            trend={null}
            trendLoading={false}
            b2b={b2b}
            hasImport={Boolean(selectedImportId)}
            osOnlyFilterActive={selectedGroups.length > 0 || selectedMetodes.length > 0}
            selectedGroups={selectedGroups}
            onToggleGroup={(group) => setSelectedGroups((prev) => (prev.length === 1 && prev[0] === group ? [] : [group]))}
          />

          <Card className="overflow-hidden rounded-xl border-gray-200 shadow-none">
            <CardHeader className="space-y-0 border-b border-gray-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <span>All Quality Claim</span>
                    {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
                  </CardTitle>
                  <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                    <span className="whitespace-nowrap tabular-nums text-gray-700">
                      <span className="font-semibold">{totalCount.toLocaleString('en-US')}</span> rows
                      {claimedCount > 0 ? (
                        <span className="text-gray-500">
                          {' '}({(totalCount - claimedCount).toLocaleString('en-US')} not claimed, {claimedCount.toLocaleString('en-US')} claimed)
                        </span>
                      ) : null}
                    </span>
                    <span className="text-gray-400" aria-hidden>·</span>
                    <span className="whitespace-nowrap font-medium text-gray-600">
                      {selectedB2bStatuses.length > 0 ? `B2B: ${selectedB2bStatuses.join(', ')}` : b2b === 'include' ? 'Include B2B' : 'Exclude B2B'} · {anyFilter ? 'Filtered' : 'All'}
                    </span>
                    {selectedImport?.file_name ? (
                      <>
                        <span className="text-gray-400" aria-hidden>·</span>
                        <span className="truncate max-w-[18rem]" title={selectedImport.file_name}>
                          {selectedImport.file_name}
                        </span>
                      </>
                    ) : null}
                    <span className="text-gray-400" aria-hidden>·</span>
                    <span className="whitespace-nowrap tabular-nums">
                      Page {page}/{totalPages} · {rows.length} rows
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative" ref={columnsRef}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={iconButtonClass('neutral')}
                      title="Columns"
                      aria-label="Columns"
                      aria-expanded={columnsOpen}
                      onClick={() => setColumnsOpen((o) => !o)}
                      disabled={loading}
                    >
                      <Columns3 className="h-[1.125rem] w-[1.125rem]" aria-hidden />
                    </Button>
                    {columnsOpen && (
                      <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setColumnsOpen(false)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-1 mb-2">
                          <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={() => setVisibleColumnIds(new Set(columns.map((c) => c.id)))}>
                            Select All
                          </Button>
                          <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={() => setVisibleColumnIds(new Set())}>
                            Unselect All
                          </Button>
                          <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={() => setVisibleColumnIds(new Set(CLAIM_MUTU_DEFAULT_VISIBLE_IDS))}>
                            Reset
                          </Button>
                        </div>
                        <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                          {[
                            ...visibleColumns,
                            ...columns.filter((c) => !visibleColumnIds.has(c.id)).sort((a, b) => a.label.localeCompare(b.label)),
                          ].map((c) => (
                            <div
                              key={c.id}
                              draggable
                              onDragStart={() => setDragColId(c.id)}
                              onDragEnd={() => setDragColId(null)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (dragColId && dragColId !== c.id) reorderColumnByDrag(dragColId, c.id)
                              }}
                              className={`flex items-center gap-2 text-sm cursor-grab select-none rounded px-1 py-0.5 ${dragColId === c.id ? 'opacity-40' : 'hover:bg-gray-50'}`}
                            >
                              <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                              <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                                <Checkbox
                                  checked={visibleColumnIds.has(c.id)}
                                  onCheckedChange={() =>
                                    setVisibleColumnIds((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(c.id)) next.delete(c.id)
                                      else next.add(c.id)
                                      return next
                                    })
                                  }
                                />
                                <span className="truncate">{c.label}</span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-hidden">
                <div
                  ref={topScrollRef}
                  className={cn(COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS, 'border-b bg-white')}
                  onScroll={() => {
                    if (isSyncingScroll.current) return
                    const top = topScrollRef.current
                    const bottom = bottomScrollRef.current
                    if (!top || !bottom) return
                    isSyncingScroll.current = true
                    bottom.scrollLeft = top.scrollLeft
                    window.requestAnimationFrame(() => {
                      isSyncingScroll.current = false
                    })
                  }}
                >
                  <div style={{ width: tableScrollWidth || 0, height: 1 }} />
                </div>
                <div
                  ref={bottomScrollRef}
                  className={COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS}
                  onScroll={() => {
                    if (isSyncingScroll.current) return
                    const top = topScrollRef.current
                    const bottom = bottomScrollRef.current
                    if (!top || !bottom) return
                    isSyncingScroll.current = true
                    top.scrollLeft = bottom.scrollLeft
                    window.requestAnimationFrame(() => {
                      isSyncingScroll.current = false
                    })
                  }}
                >
                  <table className={cn(COMPACT_OPERATIONAL_TABLE_CLASS, COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS, 'klip-compact-table--perf-narrow-cols', 'klip-table--directory')}>
                    <colgroup>
                      {visibleColumns.map((c) => (
                        <col key={c.id} style={{ width: compactTableColWidthCss(compactTableHeaderMinWidthPx(c.label, { hasSort: true })) }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className={LIST_PAGE_TABLE_HEADER_ROW_CLASS}>
                        {visibleColumns.map((c) => {
                          const layout = c.align === 'right' ? 'short' : 'truncate'
                          return (
                            <th
                              key={c.id}
                              scope="col"
                              className={cn(
                                'relative cursor-move select-none text-left font-semibold align-top sticky top-0 z-20 bg-slate-50',
                                CONTRACT_PERF_TABLE_CELL_PAD,
                                operationalTableColumnClass(layout),
                                dragColId === c.id && 'opacity-60',
                              )}
                              draggable
                              onDragStart={(e) => {
                                setDragColId(c.id)
                                e.dataTransfer.setData('text/plain', c.id)
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onDragEnd={() => setDragColId(null)}
                              onDragOver={(e) => {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                const dragged = e.dataTransfer.getData('text/plain')
                                if (dragged) reorderColumnByDrag(dragged, c.id)
                                setDragColId(null)
                              }}
                            >
                              <ContractPerfTableSortHeader
                                label={c.label}
                                activeSort={sortKey === c.sortKey}
                                sortDir={sortDir}
                                onSortClick={() => toggleSort(c.sortKey)}
                              />
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loading ? (
                        <tr className="bg-white">
                          <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-gray-500">
                            Loading…
                          </td>
                        </tr>
                      ) : rows.length === 0 ? (
                        <tr className="bg-white">
                          <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-gray-500">
                            {selectedImportId ? 'No rows' : 'Import claim data to start.'}
                          </td>
                        </tr>
                      ) : (
                        rows.map((r, idx) => {
                          const stripeClass = 'bg-white'
                          return (
                            <tr key={r.id} className={stripeClass}>
                              {visibleColumns.map((c) => {
                                const layout = c.align === 'right' ? 'short' : 'truncate'
                                return (
                                  <td
                                    key={c.id}
                                    className={`${COMPACT_OPERATIONAL_TABLE_CELL_CLASS} ${operationalTableColumnClass(layout)} align-middle ${CONTRACT_PERF_TABLE_CELL_PAD} ${stripeClass} ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                                  >
                                    <div
                                      className={cn(COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS, 'text-sm')}
                                      title={hoverTitle(c.kind, r[c.id])}
                                    >
                                      {renderCell(c, r)}
                                    </div>
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <MasterTableFooter
                countText={listRangeText(totalCount, page, pageSize, 'rows')}
                kinds={[]}
                pager={{ page, totalPages, onPageChange: setPage, disabled: loading }}
              />
            </CardContent>
          </Card>
        </div>
      </StitchFields>
    </Layout>
  )
}
