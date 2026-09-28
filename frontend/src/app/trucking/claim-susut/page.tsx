'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import Layout from '@/components/Layout'
import { StitchFields } from '@/components/shared/stitchField'
import { usePageHeaderBusy } from '@/components/PageHeaderBusyContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Upload, Loader2, History, SlidersHorizontal, GripVertical, X } from 'lucide-react'
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
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  selectionChips,
} from '@/components/shared/ListFilterPanel'
import { periodRangeMatchesDates } from '@/components/performance/PerformanceContractDateControl'
import { HeaderFilterSlot } from '@/components/HeaderFilterSlot'
import {
  formatContractDateScopeLabel,
  PerformanceContractDateControl,
} from '@/components/performance/PerformanceContractDateControl'
import {
  ClaimSusutSection1Dashboard,
  type ClaimSusutRealized,
} from '@/components/claim-susut/ClaimSusutSection1Dashboard'
import {
  ClaimSusutUploadResultDialog,
  type ClaimSusutUploadResult,
} from '@/components/claim-susut/ClaimSusutUploadResultDialog'
import { ClaimSusutImportHistoryModal } from '@/components/claim-susut/ClaimSusutImportHistoryModal'
import {
  appendClaimSusutFilterParams,
  buildClaimSusutPeriodOptions,
  CLAIM_SUSUT_COLUMN_ORDER_KEY,
  CLAIM_SUSUT_COLUMNS,
  CLAIM_SUSUT_DEFAULT_VISIBLE_IDS,
  CLAIM_SUSUT_NUMERIC_SORT_KEYS,
  CLAIM_SUSUT_VIEW_PREF_KEY,
  EMPTY_CLAIM_SUSUT_DRILLDOWN,
  formatClaimSusutIdr,
  looksLikeLegacyAllVisibleClaimSusutColumns,
  resolveClaimSusutPeriodRange,
  type ClaimSusutApiFilters,
  type ClaimSusutColumnDef,
  type ClaimSusutPeriodKey,
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
  const [realizedLoading, setRealizedLoading] = useState(false)
  const [groupTransportLoading, setGroupTransportLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadSummary, setUploadSummary] = useState<ClaimSusutUploadResult | null>(null)
  const [uploadResultOpen, setUploadResultOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const [period, setPeriod] = useState<ClaimSusutPeriodKey>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedPlants, setSelectedPlants] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [selectedGroupsOfTransport, setSelectedGroupsOfTransport] = useState<string[]>([])
  const [plantOptions, setPlantOptions] = useState<string[]>([])
  const [sourceOptions, setSourceOptions] = useState<string[]>([])
  const [incotermOptions, setIncotermOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [transportOptions, setTransportOptions] = useState<string[]>([])
  const [realized, setRealized] = useState<ClaimSusutRealized | null>(null)
  const [summary, setSummary] = useState({ qtyClaim: 0, amountAfterTax: 0, rowCount: 0 })
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
  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)

  const scopeFilters: ClaimSusutApiFilters = useMemo(
    () => ({
      importId: selectedImportId || undefined,
      dateFrom,
      dateTo,
      plants: selectedPlants,
      sources: selectedSources,
      incoterms: selectedIncoterms,
      products: selectedProducts,
      groupsOfTransport: selectedGroupsOfTransport,
      drilldown: EMPTY_CLAIM_SUSUT_DRILLDOWN,
    }),
    [
      selectedImportId,
      dateFrom,
      dateTo,
      selectedPlants,
      selectedSources,
      selectedIncoterms,
      selectedProducts,
      selectedGroupsOfTransport,
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
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : columns.map((c) => c.id)).filter((id) =>
      byId.has(id),
    )
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
      setTransportOptions([])
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
    params.delete('groupOfTransport')
    params.delete('groupsOfTransport')
    const res = await api.get(`/claim-susut/filter-options?${params.toString()}`)
    const data = res.data?.data || {}
    setPlantOptions((data.plants || []).map(String))
    setSourceOptions((data.sources || []).map(String))
    setIncotermOptions((data.incoterms || []).map(String))
    setProductOptions((data.products || []).map(String))
    setTransportOptions((data.groupsOfTransport || []).map(String))
  }, [])

  const loadSummary = useCallback(async (filters: ClaimSusutApiFilters) => {
    if (!filters.importId) {
      setSummary({ qtyClaim: 0, amountAfterTax: 0, rowCount: 0 })
      return
    }
    const params = appendClaimSusutFilterParams(new URLSearchParams(), filters, {
      includeDrilldown: false,
      includeGroup: true,
    })
    setSummaryLoading(true)
    try {
      const summaryRes = await api.get(`/claim-susut/summary?${params.toString()}`)
      setSummary({
        qtyClaim: Number(summaryRes.data?.data?.qtyClaim) || 0,
        amountAfterTax: Number(summaryRes.data?.data?.amountAfterTax) || 0,
        rowCount: Number(summaryRes.data?.data?.rowCount) || 0,
      })
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  /** The REAL_CLAIM half of Section 1: one list per import, not narrowed by the page filters. */
  const loadRealized = useCallback(async (importId: string) => {
    if (!importId) {
      setRealized(null)
      return
    }
    setRealizedLoading(true)
    try {
      const res = await api.get(`/claim-susut/realized?importId=${encodeURIComponent(importId)}`)
      setRealized((res.data?.data ?? null) as ClaimSusutRealized | null)
    } finally {
      setRealizedLoading(false)
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
    setSelectedGroupsOfTransport([])
  }, [selectedImportId])

  useEffect(() => {
    loadRealized(selectedImportId).catch((e) =>
      setError(apiErrorMessage(e, 'Failed to load Claim Susut realisation')),
    )
  }, [selectedImportId, loadRealized])

  useEffect(() => {
    if (!selectedImportId) return
    setPage(1)
  }, [dateFrom, dateTo, selectedPlants, selectedSources, selectedIncoterms, selectedProducts, selectedGroupsOfTransport, sortKey, sortDir])

  useEffect(() => {
    if (!selectedImportId) return
    setError(null)
    loadFilterOptions(scopeFilters).catch((e) => setError(apiErrorMessage(e, 'Failed to load Claim Susut filters')))
  }, [selectedImportId, dateFrom, dateTo, loadFilterOptions, scopeFilters])

  useEffect(() => {
    if (!selectedImportId) return
    loadSummary(scopeFilters).catch((e) => setError(apiErrorMessage(e, 'Failed to load Claim Susut summary')))
  }, [
    selectedImportId,
    dateFrom,
    dateTo,
    selectedPlants,
    selectedSources,
    selectedIncoterms,
    selectedProducts,
    selectedGroupsOfTransport,
    loadSummary,
    scopeFilters,
  ])

  useEffect(() => {
    if (!selectedImportId) {
      setGroupTransportRows([])
      return
    }
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
    selectedGroupsOfTransport,
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

  const busy =
    loading ||
    summaryLoading ||
    realizedLoading ||
    uploading ||
    groupTransportLoading
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
      const d = res.data?.data ?? {}
      const errors = (d.errors || []) as { rowIndex: number; message: string; sheet?: string }[]
      const failedRows = Number(d.failedRows) || Math.max(0, totalRows - insertedRows)
      setUploadSummary({
        totalRows,
        insertedRows,
        failedRows,
        errors,
        sheetName: d.sheetName ?? null,
        periodLabel: d.periodLabel ?? null,
        realSheetName: d.realSheetName ?? null,
        realPeriodLabel: d.realPeriodLabel ?? null,
        realTotalRows: Number(d.realTotalRows) || 0,
        realInsertedRows: Number(d.realInsertedRows) || 0,
        realWarning: d.realWarning ?? null,
      })
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
    setPeriod('ALL')
    setDateFrom('')
    setDateTo('')
    setSelectedPlants([])
    setSelectedSources([])
    setSelectedIncoterms([])
    setSelectedProducts([])
    setSelectedGroupsOfTransport([])
    setPage(1)
  }

  const periodOptions = useMemo(() => buildClaimSusutPeriodOptions(), [])

  return (
    <Layout>
      <StitchFields>
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
          />
          <SearchableMultiSelect
            label="Region/Plant"
            hideLabel
            portalMenu
            buttonClassName="flex h-9 w-44 items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            options={plantOptions}
            selected={selectedPlants}
            onChange={setSelectedPlants}
            placeholder="Region/Plant"
            emptyMessage="No region/plant values"
            uppercaseOptionLabels
            pinSelectedToTop
          />
        </HeaderFilterSlot>
        <ListFilterPanel
          onReset={resetFilters}
          showReset={
            period !== 'ALL' ||
            !periodRangeMatchesDates(resolveClaimSusutPeriodRange('ALL'), dateFrom, dateTo) ||
            selectedPlants.length > 0 ||
            selectedSources.length > 0 ||
            selectedIncoterms.length > 0 ||
            selectedProducts.length > 0 ||
            selectedGroupsOfTransport.length > 0
          }
          chips={[
            ...(period !== 'ALL' ||
            !periodRangeMatchesDates(resolveClaimSusutPeriodRange('ALL'), dateFrom, dateTo)
              ? [
                  {
                    id: 'cr-date',
                    label: formatContractDateScopeLabel(
                      period,
                      dateFrom,
                      dateTo,
                      (p) => resolveClaimSusutPeriodRange(p as ClaimSusutPeriodKey),
                      { prefix: true },
                    ).replace(/^Contract date:/, 'CR date:'),
                    onRemove: () => {
                      setPeriod('ALL')
                      setDateFrom('')
                      setDateTo('')
                      setPage(1)
                    },
                  },
                ]
              : []),
            ...selectionChips('Region/Plant', selectedPlants, setSelectedPlants),
            ...selectionChips('Source', selectedSources, setSelectedSources),
            ...selectionChips('Incoterm', selectedIncoterms, setSelectedIncoterms),
            ...selectionChips('Product', selectedProducts, setSelectedProducts),
            ...selectionChips('Transport', selectedGroupsOfTransport, setSelectedGroupsOfTransport),
          ]}
        >
          <div className="flex flex-nowrap items-end gap-2 overflow-x-auto px-0.5 pb-1.5 pt-0.5">
            <SearchableMultiSelect
              label="Source"
              className="min-w-[7.5rem] flex-1"
              labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
              options={sourceOptions}
              selected={selectedSources}
              onChange={setSelectedSources}
              placeholder="All"
              emptyMessage="No sources"
              uppercaseOptionLabels
              pinSelectedToTop
            />
            <SearchableMultiSelect
              label="Incoterm"
              className="min-w-[7.5rem] flex-1"
              labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
              options={incotermOptions}
              selected={selectedIncoterms}
              onChange={setSelectedIncoterms}
              placeholder="All"
              emptyMessage="No incoterms"
              uppercaseOptionLabels
              pinSelectedToTop
            />
            <SearchableMultiSelect
              label="Product"
              className="min-w-[7.5rem] flex-1"
              labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
              options={productOptions}
              selected={selectedProducts}
              onChange={setSelectedProducts}
              placeholder="All"
              emptyMessage="No products"
              uppercaseOptionLabels
              pinSelectedToTop
            />
            <SearchableMultiSelect
              label="Filter by Transport"
              className="min-w-[7.5rem] flex-1"
              labelClassName={LIST_FILTER_FIELD_LABEL_CLASS}
              options={transportOptions}
              selected={selectedGroupsOfTransport}
              onChange={setSelectedGroupsOfTransport}
              placeholder="All"
              emptyMessage="No transport groups"
              uppercaseOptionLabels
              pinSelectedToTop
            />
          </div>
        </ListFilterPanel>

        <ClaimSusutSection1Dashboard
          summary={summary}
          summaryLoading={summaryLoading}
          groupRows={groupTransportRows}
          groupLoading={groupTransportLoading}
          realized={realized}
          realizedLoading={realizedLoading}
          selectedGroups={selectedGroupsOfTransport}
          hasImport={Boolean(selectedImportId)}
          onToggleGroup={(group) =>
            setSelectedGroupsOfTransport((prev) => (prev.length === 1 && prev[0] === group ? [] : [group]))
          }
        />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>All Claim Susut</span>
                  {loading ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                  ) : null}
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{totalCount.toLocaleString('en-US')}</span> rows
                  </span>
                  <span className="text-gray-400" aria-hidden>·</span>
                  <span className="whitespace-nowrap font-medium text-gray-600">
                    {period !== 'ALL' ||
                    selectedPlants.length > 0 ||
                    selectedSources.length > 0 ||
                    selectedIncoterms.length > 0 ||
                    selectedProducts.length > 0 ||
                    selectedGroupsOfTransport.length > 0
                      ? 'Global · Filtered'
                      : 'Global · All'}
                  </span>
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
                    variant="outline"
                    size="sm"
                    onClick={() => setColumnsOpen((o) => !o)}
                    disabled={loading}
                  >
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Columns
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(columns.map((c) => c.id)))}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set())}
                        >
                          Unselect All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(CLAIM_SUSUT_DEFAULT_VISIBLE_IDS))}
                        >
                          Reset
                        </Button>
                      </div>
                      <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                        {[
                          ...visibleColumns,
                          ...columns
                            .filter((c) => !visibleColumnIds.has(c.id))
                            .sort((a, b) => a.label.localeCompare(b.label)),
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
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                    <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number
                        if (totalPages <= 5) pageNum = i + 1
                        else if (page <= 3) pageNum = i + 1
                        else if (page >= totalPages - 2) pageNum = totalPages - 4 + i
                        else pageNum = page - 2 + i
                        return (
                          <Button
                            key={pageNum}
                            variant={page === pageNum ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setPage(pageNum)}
                            disabled={loading}
                            className="min-w-[40px]"
                          >
                            {pageNum}
                          </Button>
                        )
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages || loading}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
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
                <table
                  className={cn(
                    COMPACT_OPERATIONAL_TABLE_CLASS,
                    COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
                    'klip-compact-table--perf-narrow-cols',
                  )}
                >
                  <colgroup>
                    {visibleColumns.map((c) => (
                      <col
                        key={c.id}
                        style={{
                          width: compactTableColWidthCss(
                            compactTableHeaderMinWidthPx(c.label, { hasSort: true }),
                          ),
                        }}
                      />
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
                  <tbody className="divide-y divide-gray-200">
                    {loading ? (
                      <tr className="bg-white">
                        <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-gray-500">
                          Loading…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr className="bg-white">
                        <td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-gray-500">
                          No rows
                        </td>
                      </tr>
                    ) : rows.map((r, idx) => {
                      const stripeClass = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      return (
                      <tr key={r.id} className={stripeClass}>
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
                          const layout = c.align === 'right' ? 'short' : 'truncate'
                          return (
                            <td
                              key={c.id}
                              className={`${COMPACT_OPERATIONAL_TABLE_CELL_CLASS} ${operationalTableColumnClass(layout)} align-middle ${CONTRACT_PERF_TABLE_CELL_PAD} ${stripeClass} ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                            >
                              <div className={cn(COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS, 'text-sm')}>{val}</div>
                            </td>
                          )
                        })}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
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
      </StitchFields>
    </Layout>
  )
}
