'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import Layout from '@/components/Layout'
import { usePageHeaderBusy } from '@/components/PageHeaderBusyContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Upload, ArrowUp, ArrowDown, Loader2, History } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { formatQtyMtFromKg } from '@/lib/utils'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import {
  formatContractDateScopeLabel,
  PerformanceContractDateControl,
} from '@/components/performance/PerformanceContractDateControl'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import PerformanceDrilldownScopeLine from '@/components/performance/PerformanceDrilldownScopeLine'
import { ClaimSusutUploadResultDialog } from '@/components/claim-susut/ClaimSusutUploadResultDialog'
import { ClaimSusutImportHistoryModal } from '@/components/claim-susut/ClaimSusutImportHistoryModal'
import {
  buildPerformancePeriodOptions,
  resolvePerformancePeriodDateRange,
  type PerformancePeriodKey,
} from '@/lib/performancePeriodFilters'
import {
  appendClaimSusutFilterParams,
  buildNextClaimSusutDrilldownSelection,
  CLAIM_SUSUT_COLUMN_ORDER_KEY,
  CLAIM_SUSUT_COLUMNS,
  CLAIM_SUSUT_DEFAULT_VISIBLE_IDS,
  CLAIM_SUSUT_DRILLDOWN_CATEGORIES,
  CLAIM_SUSUT_DRILLDOWN_LEVEL_STYLES,
  CLAIM_SUSUT_NUMERIC_SORT_KEYS,
  CLAIM_SUSUT_VIEW_PREF_KEY,
  claimSusutDrilldownColumnSubtitle,
  claimSusutTreeNodesForLevel,
  EMPTY_CLAIM_SUSUT_DRILLDOWN,
  formatClaimSusutIdr,
  looksLikeLegacyAllVisibleClaimSusutColumns,
  type ClaimSusutApiFilters,
  type ClaimSusutColumnDef,
  type ClaimSusutDrilldownFilters,
  type ClaimSusutDrilldownLevel,
  type ClaimSusutTreeNode,
} from '@/lib/claimSusutView'

type ClaimSusutImport = {
  id: string
  file_name: string
  sheet_name?: string
  uploaded_at: string
  total_rows: number
  inserted_rows: number
  errors?: unknown
  uploaded_by_name?: string | null
  uploaded_by_username?: string | null
}

type ClaimSusutRow = {
  id: string
  vendor_code?: string
  vendor_name?: string
  company?: string
  vendor_type?: string
  source?: string
  created_by?: string
  sta?: string
  crno?: string
  cr_date?: string
  os_days?: number
  group_of_transport?: string
  payment_method?: string
  dest?: string
  region_plant?: string
  incoterm?: string
  po_number?: string
  contract_ext_no?: string
  comm?: string
  commodity?: string
  product?: string
  uom?: string
  currency?: string
  company_code?: string
  remarks?: string
  type?: string
  qty_claim?: number
  amount_before_tax_idr?: number
  tax?: number
  amount_after_tax_idr?: number
  a_0_30?: number
  a_31_60?: number
  a_61_90?: number
  a_gt_90?: number
}

type ClaimSusutGroupTransportRow = {
  group_of_transport: string
  qty_claim: number
  a_0_30: number
  a_31_60: number
  a_61_90: number
  a_gt_90: number
  grand_total: number
}

const columns: ClaimSusutColumnDef[] = CLAIM_SUSUT_COLUMNS
const pageSize = 20

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-gray-400 inline-flex"><ArrowUp className="h-3 w-3 opacity-0" /></span>
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function formatDate(d?: string) {
  if (!d) return '-'
  return formatDateDMY(d)
}

function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || fallback
}

export default function ClaimSusutPage() {
  const [imports, setImports] = useState<ClaimSusutImport[]>([])
  const [selectedImportId, setSelectedImportId] = useState<string>('')
  const [rows, setRows] = useState<ClaimSusutRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [treeLoading, setTreeLoading] = useState(false)
  const [groupTransportLoading, setGroupTransportLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadSummary, setUploadSummary] = useState<{
    totalRows: number
    insertedRows: number
    failedRows: number
    errors: { rowIndex: number; message: string }[]
  } | null>(null)
  const [uploadResultOpen, setUploadResultOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const ytd = resolvePerformancePeriodDateRange('YTD')
  const [period, setPeriod] = useState<PerformancePeriodKey>('YTD')
  const [dateFrom, setDateFrom] = useState(ytd.dateFrom)
  const [dateTo, setDateTo] = useState(ytd.dateTo)
  const [selectedPlants, setSelectedPlants] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [plantOptions, setPlantOptions] = useState<string[]>([])
  const [sourceOptions, setSourceOptions] = useState<string[]>([])
  const [incotermOptions, setIncotermOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [drilldown, setDrilldown] = useState<ClaimSusutDrilldownFilters>(EMPTY_CLAIM_SUSUT_DRILLDOWN)
  const [tree, setTree] = useState<ClaimSusutTreeNode[]>([])
  const [summary, setSummary] = useState({ qtyClaim: 0, amountAfterTax: 0, rowCount: 0 })
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [groupTransportRows, setGroupTransportRows] = useState<ClaimSusutGroupTransportRow[]>([])

  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string>('os_days')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(
    () => new Set(CLAIM_SUSUT_DEFAULT_VISIBLE_IDS),
  )
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem(CLAIM_SUSUT_COLUMN_ORDER_KEY)
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

  const scopeFilters: ClaimSusutApiFilters = useMemo(
    () => ({
      importId: selectedImportId || undefined,
      dateFrom,
      dateTo,
      plants: selectedPlants,
      sources: selectedSources,
      incoterms: selectedIncoterms,
      products: selectedProducts,
      groupOfTransport: selectedGroup,
      drilldown,
    }),
    [
      selectedImportId,
      dateFrom,
      dateTo,
      selectedPlants,
      selectedSources,
      selectedIncoterms,
      selectedProducts,
      selectedGroup,
      drilldown,
    ],
  )

  useEffect(() => {
    const { dateFrom: from, dateTo: to } = resolvePerformancePeriodDateRange(period)
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
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : columns.map((c) => c.id)).filter((id) =>
      byId.has(id),
    )
    return orderedIds.map((id) => byId.get(id)!).filter((c) => visibleColumnIds.has(c.id))
  }, [columnOrderIds, visibleColumnIds])

  useEffect(() => {
    try {
      if (columnOrderIds.length > 0) localStorage.setItem(CLAIM_SUSUT_COLUMN_ORDER_KEY, JSON.stringify(columnOrderIds))
    } catch {
      /* ignore */
    }
  }, [columnOrderIds])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(CLAIM_SUSUT_VIEW_PREF_KEY)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const cols = Array.isArray(value?.visibleColumnIds)
          ? value.visibleColumnIds
          : Array.isArray(value?.visible)
            ? value.visible
            : null
        const order = Array.isArray(value?.columnOrderIds)
          ? value.columnOrderIds
          : Array.isArray(value?.order)
            ? value.order
            : null
        if (Array.isArray(cols) && cols.length > 0) {
          const saved = cols.map((x: unknown) => String(x))
          setVisibleColumnIds(
            new Set(looksLikeLegacyAllVisibleClaimSusutColumns(saved) ? CLAIM_SUSUT_DEFAULT_VISIBLE_IDS : saved),
          )
        }
        if (Array.isArray(order) && order.length > 0) setColumnOrderIds(order.map((x: unknown) => String(x)))
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
          key: CLAIM_SUSUT_VIEW_PREF_KEY,
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
    const res = await api.get('/claim-susut/imports')
    setImports(res.data.data || [])
    const first = (res.data.data || [])?.[0]?.id
    if (!selectedImportId && first) setSelectedImportId(first)
  }

  const loadFilterOptions = useCallback(async (filters: ClaimSusutApiFilters) => {
    if (!filters.importId) {
      setPlantOptions([])
      setSourceOptions([])
      setIncotermOptions([])
      setProductOptions([])
      return
    }
    const params = appendClaimSusutFilterParams(new URLSearchParams(), filters, {
      includeDrilldown: false,
      includeGroup: false,
    })
    params.delete('plant')
    params.delete('source')
    params.delete('incoterm')
    params.delete('product')
    const res = await api.get(`/claim-susut/filter-options?${params.toString()}`)
    const data = res.data?.data || {}
    setPlantOptions((data.plants || []).map(String))
    setSourceOptions((data.sources || []).map(String))
    setIncotermOptions((data.incoterms || []).map(String))
    setProductOptions((data.products || []).map(String))
  }, [])

  const loadSummaryAndTree = useCallback(async (filters: ClaimSusutApiFilters) => {
    if (!filters.importId) {
      setSummary({ qtyClaim: 0, amountAfterTax: 0, rowCount: 0 })
      setTree([])
      return
    }
    const params = appendClaimSusutFilterParams(new URLSearchParams(), filters, {
      includeDrilldown: false,
      includeGroup: false,
    })
    setSummaryLoading(true)
    setTreeLoading(true)
    try {
      const [summaryRes, treeRes] = await Promise.all([
        api.get(`/claim-susut/summary?${params.toString()}`),
        api.get(`/claim-susut/tree?${params.toString()}`),
      ])
      setSummary({
        qtyClaim: Number(summaryRes.data?.data?.qtyClaim) || 0,
        amountAfterTax: Number(summaryRes.data?.data?.amountAfterTax) || 0,
        rowCount: Number(summaryRes.data?.data?.rowCount) || 0,
      })
      setTree((treeRes.data?.data || []) as ClaimSusutTreeNode[])
    } finally {
      setSummaryLoading(false)
      setTreeLoading(false)
    }
  }, [])

  const loadByGroupOfTransport = useCallback(async (filters: ClaimSusutApiFilters) => {
    if (!filters.importId) {
      setGroupTransportRows([])
      return
    }
    setGroupTransportLoading(true)
    try {
      const params = appendClaimSusutFilterParams(new URLSearchParams(), filters, {
        includeDrilldown: true,
        includeGroup: false,
      })
      const res = await api.get(`/claim-susut/by-group-of-transport?${params.toString()}`)
      setGroupTransportRows((res.data?.data || []) as ClaimSusutGroupTransportRow[])
    } finally {
      setGroupTransportLoading(false)
    }
  }, [])

  const loadRows = useCallback(
    async (filters: ClaimSusutApiFilters, opts?: { page?: number; sortKey?: string; sortDir?: 'asc' | 'desc' }) => {
      if (!filters.importId) {
        setRows([])
        setTotalCount(0)
        return
      }
      setLoading(true)
      try {
        const p = opts?.page ?? page
        const params = appendClaimSusutFilterParams(new URLSearchParams(), filters, {
          includeDrilldown: true,
          includeGroup: true,
        })
        params.set('limit', String(pageSize))
        params.set('offset', String((p - 1) * pageSize))
        params.set('sortKey', opts?.sortKey ?? sortKey)
        params.set('sortDir', opts?.sortDir ?? sortDir)
        const res = await api.get(`/claim-susut/rows?${params.toString()}`)
        setRows(res.data.data || [])
        setTotalCount(Number(res.data.meta?.totalCount) || 0)
      } finally {
        setLoading(false)
      }
    },
    [page, sortKey, sortDir],
  )

  useEffect(() => {
    loadImports().catch((e) => setError(String((e as Error)?.message || e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
    setSelectedGroup(null)
  }, [selectedImportId, dateFrom, dateTo, selectedPlants, selectedSources, selectedIncoterms, selectedProducts])

  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
  }, [drilldown, selectedGroup, sortKey, sortDir])

  useEffect(() => {
    if (!selectedImportId) return
    setError(null)
    loadFilterOptions(scopeFilters).catch((e) => setError(apiErrorMessage(e, 'Failed to load Claim Susut filters')))
  }, [selectedImportId, dateFrom, dateTo, loadFilterOptions, scopeFilters])

  useEffect(() => {
    if (!selectedImportId) return
    loadSummaryAndTree(scopeFilters).catch((e) => setError(apiErrorMessage(e, 'Failed to load Claim Susut summary')))
  }, [
    selectedImportId,
    dateFrom,
    dateTo,
    selectedPlants,
    selectedSources,
    selectedIncoterms,
    selectedProducts,
    loadSummaryAndTree,
    scopeFilters,
  ])

  useEffect(() => {
    if (!selectedImportId) return
    loadByGroupOfTransport(scopeFilters).catch((e) =>
      setError(apiErrorMessage(e, 'Failed to load group of transport summary')),
    )
  }, [
    selectedImportId,
    dateFrom,
    dateTo,
    selectedPlants,
    selectedSources,
    selectedIncoterms,
    selectedProducts,
    drilldown,
    loadByGroupOfTransport,
    scopeFilters,
  ])

  useEffect(() => {
    if (!selectedImportId) return
    loadRows(scopeFilters, { page }).catch((e) => setError(apiErrorMessage(e, 'Failed to load Claim Susut rows')))
  }, [
    selectedImportId,
    dateFrom,
    dateTo,
    selectedPlants,
    selectedSources,
    selectedIncoterms,
    selectedProducts,
    drilldown,
    selectedGroup,
    page,
    sortKey,
    sortDir,
    loadRows,
    scopeFilters,
  ])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!columnsOpen) return
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [columnsOpen])

  const busy = loading || summaryLoading || treeLoading || groupTransportLoading || uploading
  usePageHeaderBusy(busy)

  const onUploadFile = async (uploadFile: File) => {
    setUploading(true)
    setError(null)
    setUploadSummary(null)
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      const res = await api.post('/claim-susut/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const importId = res.data?.data?.importId
      const totalRows = Number(res.data?.data?.totalRows) || 0
      const insertedRows = Number(res.data?.data?.insertedRows) || 0
      const errors = (res.data?.data?.errors || []) as { rowIndex: number; message: string }[]
      const failedRows = Number(res.data?.data?.failedRows) || Math.max(0, totalRows - insertedRows)
      setUploadSummary({ totalRows, insertedRows, failedRows, errors })
      setUploadResultOpen(true)
      await loadImports()
      if (importId) setSelectedImportId(importId)
    } catch (e) {
      setError(apiErrorMessage(e, 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const handleClaimSusutFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const uploadFile = e.target.files?.[0]
    e.target.value = ''
    if (!uploadFile) return
    void onUploadFile(uploadFile)
  }

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(CLAIM_SUSUT_NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc')
    }
  }

  const resetFilters = () => {
    setPeriod('YTD')
    const range = resolvePerformancePeriodDateRange('YTD')
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setSelectedPlants([])
    setSelectedSources([])
    setSelectedIncoterms([])
    setSelectedProducts([])
    setDrilldown(EMPTY_CLAIM_SUSUT_DRILLDOWN)
    setSelectedGroup(null)
    setPage(1)
  }

  const applyDrilldown = (level: ClaimSusutDrilldownLevel, label: string) => {
    setDrilldown((prev) => buildNextClaimSusutDrilldownSelection(prev, level, label))
    setSelectedGroup(null)
    setPage(1)
  }

  const drilldownScopeSegments = useMemo(() => {
    const parts: string[] = [
      formatContractDateScopeLabel(period, dateFrom, dateTo, (p) =>
        resolvePerformancePeriodDateRange(p as PerformancePeriodKey),
      ),
    ]
    if (selectedPlants.length > 0) parts.push(selectedPlants.join(', '))
    if (selectedSources.length > 0) parts.push(selectedSources.join(', '))
    if (selectedIncoterms.length > 0) parts.push(selectedIncoterms.join(', '))
    if (selectedProducts.length > 0) parts.push(selectedProducts.join(', '))
    if (drilldown.product) parts.push(drilldown.product)
    if (drilldown.plant) parts.push(drilldown.plant)
    if (drilldown.incoterm) parts.push(drilldown.incoterm)
    if (drilldown.company) parts.push(drilldown.company)
    return parts
  }, [
    period,
    dateFrom,
    dateTo,
    selectedPlants,
    selectedSources,
    selectedIncoterms,
    selectedProducts,
    drilldown,
  ])

  const denomAmount = Math.abs(summary.amountAfterTax) > 0 ? Math.abs(summary.amountAfterTax) : 1
  const periodOptions = useMemo(() => buildPerformancePeriodOptions(), [])

  const renderTreeCard = (
    node: ClaimSusutTreeNode,
    level: ClaimSusutDrilldownLevel,
    selected: boolean,
  ) => {
    const style = CLAIM_SUSUT_DRILLDOWN_LEVEL_STYLES[level]
    const pct = Math.max(1, Math.round((Math.abs(node.amountAfterTax) / denomAmount) * 100))
    const itemClass = `w-full text-left rounded-lg border px-3 py-2 hover:bg-gray-50 focus:outline-none ${
      selected ? `bg-white border-2 ${style.selectedBorder}` : 'bg-white border-gray-200'
    }`
    return (
      <button key={node.key} type="button" className={itemClass} onClick={() => applyDrilldown(level, node.key)}>
        <div className="text-sm font-semibold text-gray-900 truncate" title={node.label}>
          {node.label}
        </div>
        <div className="mt-1 h-1 rounded bg-gray-100 overflow-hidden">
          <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-tight">
          <span className="text-gray-600 shrink-0">
            Qty:{' '}
            <span className="font-semibold text-gray-900 tabular-nums">{formatQtyMtFromKg(node.qtyClaim)}</span>
          </span>
          <span className="font-semibold tabular-nums text-gray-900 shrink-0">
            {formatClaimSusutIdr(node.amountAfterTax)}
          </span>
        </div>
      </button>
    )
  }

  const isSelectedAtLevel = (level: ClaimSusutDrilldownLevel, key: string) => {
    if (level === 'product') return drilldown.product === key
    if (level === 'plant') return drilldown.plant === key
    if (level === 'incoterm') return drilldown.incoterm === key
    return drilldown.company === key
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-end gap-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              id="claim-susut-excel-upload-input"
              onChange={handleClaimSusutFileChange}
              disabled={uploading}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHistoryOpen(true)}
              disabled={uploading}
            >
              <History className="h-4 w-4 mr-2" />
              Import History
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-indigo-600 text-indigo-700 hover:bg-indigo-50"
              onClick={() => document.getElementById('claim-susut-excel-upload-input')?.click()}
              disabled={uploading}
              title="Upload Claim Susut Excel (.xlsx)"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Import Claim Susut Excel
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <div className="flex items-end gap-6 flex-wrap">
          <PerformanceContractDateControl
            period={period}
            options={periodOptions}
            dateFrom={dateFrom}
            dateTo={dateTo}
            dateLabel="CR Date"
            onPeriodChange={setPeriod}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            resolvePeriodRange={resolvePerformancePeriodDateRange}
          />
          <div className="w-48">
            <SearchableMultiSelect
              label="Region/Plant"
              options={plantOptions}
              selected={selectedPlants}
              onChange={setSelectedPlants}
              placeholder="All region/plants"
              emptyMessage="No region/plant values"
              uppercaseOptionLabels
              pinSelectedToTop
            />
          </div>
          <div className="w-48">
            <SearchableMultiSelect
              label="Source"
              options={sourceOptions}
              selected={selectedSources}
              onChange={setSelectedSources}
              placeholder="All sources"
              emptyMessage="No sources"
              uppercaseOptionLabels
              pinSelectedToTop
            />
          </div>
          <div className="w-48">
            <SearchableMultiSelect
              label="Incoterm"
              options={incotermOptions}
              selected={selectedIncoterms}
              onChange={setSelectedIncoterms}
              placeholder="All incoterms"
              emptyMessage="No incoterms"
              uppercaseOptionLabels
              pinSelectedToTop
            />
          </div>
          <div className="w-48">
            <SearchableMultiSelect
              label="Product"
              options={productOptions}
              selected={selectedProducts}
              onChange={setSelectedProducts}
              placeholder="All products"
              emptyMessage="No products"
              uppercaseOptionLabels
              pinSelectedToTop
            />
          </div>
          <button type="button" onClick={resetFilters} className="text-sm text-blue-700 hover:underline shrink-0 pb-2.5">
            Reset
          </button>
        </div>

        <div className={`transition-opacity duration-200 ${summaryLoading ? 'opacity-65' : 'opacity-100'}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <PerformanceSection1CardShell
              variant="open"
              title="Outstanding Claim Susut"
              selected
              onClick={() => undefined}
            >
              <div className="text-sm text-gray-500 mb-1">Qty Klaim</div>
              <div className="text-xl font-bold text-gray-900 mb-3">{formatQtyMtFromKg(summary.qtyClaim)}</div>
              <div className="text-xs text-gray-500">
                Amount:{' '}
                <span className="font-semibold text-gray-900 tabular-nums">{formatClaimSusutIdr(summary.amountAfterTax)}</span>
              </div>
            </PerformanceSection1CardShell>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span>Claim Susut Drilldown</span>
              {treeLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden /> : null}
            </CardTitle>
            <PerformanceDrilldownScopeLine segments={drilldownScopeSegments} />
          </CardHeader>
          <CardContent className="pt-2">
            {!selectedImportId ? (
              <div className="text-sm text-gray-500">Upload or select an import to see the drilldown.</div>
            ) : tree.length === 0 && !treeLoading ? (
              <div className="text-sm text-gray-500">No Claim Susut rows for the current filters.</div>
            ) : (
              <div className={`grid grid-cols-1 lg:grid-cols-4 gap-3 ${treeLoading ? 'opacity-65' : 'opacity-100'}`}>
                {CLAIM_SUSUT_DRILLDOWN_CATEGORIES.map(({ level, title }) => {
                  const style = CLAIM_SUSUT_DRILLDOWN_LEVEL_STYLES[level]
                  const subtitle = claimSusutDrilldownColumnSubtitle(level, drilldown)
                  const nodes = claimSusutTreeNodesForLevel(tree, drilldown, level)
                  let body: ReactNode
                  if (level === 'plant' && !drilldown.product) {
                    body = <div className="text-sm text-gray-500">Select a product to see plants.</div>
                  } else if (level === 'incoterm' && !drilldown.plant) {
                    body = <div className="text-sm text-gray-500">Select a plant to see incoterms.</div>
                  } else if (level === 'company' && !drilldown.incoterm) {
                    body = <div className="text-sm text-gray-500">Select an incoterm to see companies.</div>
                  } else {
                    body = (
                      <div className="space-y-2">
                        {nodes.slice(0, 30).map((node) => renderTreeCard(node, level, isSelectedAtLevel(level, node.key)))}
                      </div>
                    )
                  }
                  return (
                    <div key={level} className={`rounded-lg border ${style.border} overflow-hidden`}>
                      <div className={`${style.headerBg} px-3 py-2 border-b ${style.border}`}>
                        <div className="text-sm font-semibold text-gray-800">{title}</div>
                        <div className="text-[11px] text-gray-500">{subtitle}</div>
                      </div>
                      <div className="p-2 max-h-80 overflow-y-auto">{body}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Group of Transport{' '}
              <span className="text-xs font-normal text-gray-500">
                {groupTransportLoading ? 'Loading…' : `${groupTransportRows.length.toLocaleString()} groups`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              {groupTransportLoading ? (
                <div className="text-center py-10 text-gray-500">Loading…</div>
              ) : groupTransportRows.length === 0 ? (
                <div className="text-center py-10 text-gray-500">No data for this import</div>
              ) : (
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Group of Transport</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Qty Klaim</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 0-30 Days</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 31-60 Days</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Aging 61-90 Days</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Aging &gt; 90 Days</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-800">Grand Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {groupTransportRows.map((g) => {
                      const selected = selectedGroup === g.group_of_transport
                      return (
                        <tr
                          key={g.group_of_transport}
                          className={`cursor-pointer ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                          onClick={() =>
                            setSelectedGroup((prev) => (prev === g.group_of_transport ? null : g.group_of_transport))
                          }
                        >
                          <td className="px-3 py-2 font-medium">{g.group_of_transport}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatQtyMtFromKg(g.qty_claim)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatClaimSusutIdr(g.a_0_30)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatClaimSusutIdr(g.a_31_60)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatClaimSusutIdr(g.a_61_90)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatClaimSusutIdr(g.a_gt_90)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {formatClaimSusutIdr(g.grand_total)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">
              View Table{' '}
              <span className="text-xs font-normal text-gray-500">
                {loading ? 'Loading…' : `${totalCount.toLocaleString()} total`}
              </span>
            </CardTitle>
            <div className="relative" ref={columnsRef}>
              <Button type="button" variant="outline" size="sm" onClick={() => setColumnsOpen((o) => !o)}>
                Columns
              </Button>
              {columnsOpen && (
                <div className="absolute right-0 mt-2 w-[280px] rounded-md border bg-white shadow-lg z-50">
                  <div className="p-2 border-b text-xs text-gray-600">Toggle columns</div>
                  <div className="max-h-64 overflow-auto p-2 space-y-1">
                    {columns.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={visibleColumnIds.has(c.id)}
                          onChange={() =>
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
                    ))}
                  </div>
                  <div className="p-2 border-t flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setVisibleColumnIds(new Set(CLAIM_SUSUT_DEFAULT_VISIBLE_IDS))}
                    >
                      Reset
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setColumnsOpen(false)}>
                      Close
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="text-center py-10 text-gray-500">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-center py-10 text-gray-500">No rows</div>
              ) : (
                <table className="w-full min-w-[1400px] text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {visibleColumns.map((c) => (
                        <th
                          key={c.id}
                          className={`px-3 py-2 font-medium text-gray-600 cursor-move ${c.align === 'right' ? 'text-right' : 'text-left'} ${dragColId === c.id ? 'opacity-60' : ''}`}
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
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 hover:underline ${c.align === 'right' ? 'justify-end w-full' : ''}`}
                            onClick={() => toggleSort(c.sortKey)}
                          >
                            {c.label} <SortIcon active={sortKey === c.sortKey} dir={sortDir} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        {visibleColumns.map((c) => {
                          const val = (() => {
                            switch (c.id) {
                              case 'cr_date':
                                return formatDate(r.cr_date)
                              case 'os_days':
                                return r.os_days ?? '-'
                              case 'vendor_name':
                                return formatSapDisplayValue(r.company || r.vendor_name)
                              case 'commodity':
                                return formatSapDisplayValue(r.product || r.commodity)
                              case 'qty_claim':
                                return Number(r.qty_claim || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })
                              case 'amount_before_tax_idr':
                              case 'amount_after_tax_idr':
                              case 'a_0_30':
                              case 'a_31_60':
                              case 'a_61_90':
                              case 'a_gt_90':
                                return r[c.id] ? formatClaimSusutIdr(r[c.id] as number) : '-'
                              case 'tax':
                                return r.tax ?? '-'
                              default:
                                return formatSapDisplayValue((r as Record<string, unknown>)[c.id])
                            }
                          })()
                          return (
                            <td
                              key={c.id}
                              className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                            >
                              {val}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {!loading && totalCount > pageSize && (
              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-gray-600">
                  Page {page} of {Math.max(1, Math.ceil(totalCount / pageSize))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= Math.ceil(totalCount / pageSize)}
                    onClick={() => setPage((p) => Math.min(Math.ceil(totalCount / pageSize), p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <ClaimSusutUploadResultDialog
          open={uploadResultOpen}
          onOpenChange={setUploadResultOpen}
          result={uploadSummary}
        />
        <ClaimSusutImportHistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          imports={imports}
          onSelectImport={(id) => {
            setSelectedImportId(id)
            setPage(1)
          }}
        />
      </div>
    </Layout>
  )
}
