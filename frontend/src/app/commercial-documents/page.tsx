'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import {
  canCreatePermission,
  canEditPermission,
  canViewPermission,
  usePermissions,
} from '@/components/PermissionsContext'
import api from '@/lib/api'
import { buildCacheKey, cachedGet } from '@/lib/clientDataCache'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FileCheck,
  FileText,
  Loader2,
  Pencil,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { useUserScopeFilterDefaults } from '@/hooks/useUserScopeFilterDefaults'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { markUserScopeFiltersCleared } from '@/lib/userScopeFilters'
import { cn } from '@/lib/utils'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { TableInitialLoadPlaceholder } from '@/components/performance/TableInitialLoadPlaceholder'
import { DocumentCheckingModal } from '@/components/commercial-documents/DocumentCheckingModal'
import { CommercialDocumentsSummaryCards } from '@/components/commercial-documents/CommercialDocumentsSummaryCards'
import {
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
} from '@/lib/contractPerformanceColumns'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  COMPACT_TABLE_HEADER_LABEL_CLASS,
} from '@/lib/compactTableUi'
import { operationalTableColumnClass, getOperationalColumnLayout } from '@/lib/operationalTableLayout'
import {
  COMMERCIAL_DOCS_ALL_COLUMNS,
  COMMERCIAL_DOCS_COLUMN_BY_ID,
  type CommercialDocsColumnId,
  type CommercialDocsColumnMeta,
  isCommercialDocStatusColumn,
} from '@/lib/commercialDocumentsColumns'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  COMMERCIAL_DOCUMENTS_PAGE_PERMISSION,
  defaultCommercialDocsYtdRange,
  type CommercialDocumentRow,
  type CommercialDocumentType,
  type CommercialDocumentsSummary,
} from '@/lib/commercialDocumentsTypes'

const VISIBLE_COLUMNS_KEY = 'commercial-documents.visibleColumns.v1'
const PAGE_SIZE = 50

type DocumentStatusFilter = '' | 'checked' | 'unchecked'

export default function CommercialDocumentsPage() {
  return (
    <Layout>
      <CommercialDocumentsPageContent />
    </Layout>
  )
}

function CommercialDocumentsPageContent() {
  const router = useRouter()
  const perms = usePermissions()
  const canViewPage = canViewPermission(perms, COMMERCIAL_DOCUMENTS_PAGE_PERMISSION)
  const canModifyDocuments =
    canCreatePermission(perms, COMMERCIAL_DOCUMENTS_PAGE_PERMISSION) ||
    canEditPermission(perms, COMMERCIAL_DOCUMENTS_PAGE_PERMISSION)

  useEffect(() => {
    if (perms.loaded && !canViewPage) {
      router.replace('/contracts')
    }
  }, [canViewPage, perms.loaded, router])

  const ytdDefault = useMemo(() => defaultCommercialDocsYtdRange(), [])
  const [rows, setRows] = useState<CommercialDocumentRow[]>([])
  const [summary, setSummary] = useState<CommercialDocumentsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [totalRows, setTotalRows] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 400)
  const [documentTypeFilter, setDocumentTypeFilter] = useState<CommercialDocumentType | ''>('')
  const [documentStatusFilter, setDocumentStatusFilter] = useState<DocumentStatusFilter>('')
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(ytdDefault.dateFrom)
  const [dateTo, setDateTo] = useState(ytdDefault.dateTo)

  const [availableIncoterms, setAvailableIncoterms] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [availablePlants, setAvailablePlants] = useState<string[]>([])

  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [visibleColumnIds, setVisibleColumnIds] = useState<CommercialDocsColumnId[]>(() => {
    if (typeof window === 'undefined') {
      return COMMERCIAL_DOCS_ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id)
    }
    try {
      const raw = localStorage.getItem(VISIBLE_COLUMNS_KEY)
      if (raw) return JSON.parse(raw) as CommercialDocsColumnId[]
    } catch {
      /* ignore */
    }
    return COMMERCIAL_DOCS_ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id)
  })

  const [sortKey, setSortKey] = useState<CommercialDocsColumnId>('contract_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [modalRow, setModalRow] = useState<CommercialDocumentRow | null>(null)

  const topScrollRef = useRef<HTMLDivElement>(null)
  const bottomScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)

  const {
    selectedProducts,
    selectedGroupPlants: selectedPlants,
    handleProductsChange,
    handleGroupPlantsChange,
    resetUserScopeFilters,
  } = useUserScopeFilterDefaults('contracts')

  const rowsLengthRef = useRef(0)
  rowsLengthRef.current = rows.length

  const defaultVisibleColumnIds = useMemo(
    () => COMMERCIAL_DOCS_ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id),
    [],
  )

  const visibleColumns = useMemo(
    () =>
      visibleColumnIds
        .map((id) => COMMERCIAL_DOCS_COLUMN_BY_ID[id])
        .filter(Boolean) as CommercialDocsColumnMeta[],
    [visibleColumnIds],
  )

  const columnsMenuItems = useMemo(() => {
    const byId = new Map(COMMERCIAL_DOCS_ALL_COLUMNS.map((c) => [c.id, c]))
    const visibleSet = new Set(visibleColumnIds)
    const visibleInMenu = visibleColumnIds
      .map((id) => byId.get(id))
      .filter(Boolean) as CommercialDocsColumnMeta[]
    const hiddenCols = COMMERCIAL_DOCS_ALL_COLUMNS.filter((c) => !visibleSet.has(c.id)).sort((a, b) =>
      a.label.localeCompare(b.label),
    )
    return [...visibleInMenu, ...hiddenCols]
  }, [visibleColumnIds])

  const fetchData = useCallback(async () => {
    setFetching(true)
    if (rowsLengthRef.current === 0) setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(currentPage))
      params.set('limit', String(PAGE_SIZE))
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (documentTypeFilter) params.set('documentType', documentTypeFilter)
      if (documentStatusFilter) params.set('documentStatus', documentStatusFilter)
      if (selectedIncoterms.length === 1) params.set('incoterm', selectedIncoterms[0])
      if (selectedProducts.length === 1) params.set('product', selectedProducts[0])
      if (selectedPlants.length === 1) params.set('plant', selectedPlants[0])

      const url = `/commercial-documents?${params.toString()}`
      const cacheKey = buildCacheKey('GET', url)
      const { data } = await cachedGet(cacheKey, () => api.get(url).then((r) => r.data))
      const payload = data?.data
      setRows(payload?.rows || [])
      setSummary(payload?.summary || null)
      setTotalRows(payload?.pagination?.total ?? 0)
      setTotalPages(payload?.pagination?.totalPages ?? 1)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [
    currentPage,
    dateFrom,
    dateTo,
    debouncedSearch,
    documentTypeFilter,
    documentStatusFilter,
    selectedIncoterms,
    selectedProducts,
    selectedPlants,
  ])

  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        debouncedSearch,
        documentTypeFilter,
        documentStatusFilter,
        selectedIncoterms,
        selectedProducts,
        selectedPlants,
        dateFrom,
        dateTo,
      }),
    [
      debouncedSearch,
      documentTypeFilter,
      documentStatusFilter,
      selectedIncoterms,
      selectedProducts,
      selectedPlants,
      dateFrom,
      dateTo,
    ],
  )

  const prevFilterSignatureRef = useRef(filterSignature)

  useEffect(() => {
    if (!perms.loaded || !canViewPage) return

    const filtersChanged = prevFilterSignatureRef.current !== filterSignature
    if (filtersChanged) {
      prevFilterSignatureRef.current = filterSignature
      if (currentPage !== 1) {
        setCurrentPage(1)
        return
      }
    }

    void fetchData()
  }, [filterSignature, currentPage, fetchData, perms.loaded, canViewPage])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/contracts/filter-options/group-plants'),
      api.get('/contracts/filter-options/incoterms'),
      api.get('/dashboard/filter-options/products'),
    ])
      .then(([plantRes, incRes, productRes]) => {
        if (cancelled) return
        const plants = (plantRes.data?.data?.groupPlants || []) as string[]
        const incs = (incRes.data?.data?.incoterms || []) as string[]
        const productPayload = productRes.data?.data
        const products = (Array.isArray(productPayload)
          ? productPayload
          : productPayload && typeof productPayload === 'object' && 'products' in productPayload
            ? (productPayload as { products?: string[] }).products
            : []) as string[]
        setAvailablePlants(Array.isArray(plants) ? plants : [])
        setAvailableIncoterms(Array.isArray(incs) ? incs : [])
        setAvailableProducts(Array.isArray(products) ? products : [])
      })
      .catch(() => {
        if (cancelled) return
        setAvailablePlants([])
        setAvailableIncoterms([])
        setAvailableProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumnIds))
  }, [visibleColumnIds])

  useEffect(() => {
    const calc = () => {
      const el = bottomScrollRef.current
      if (el) setTableScrollWidth(el.scrollWidth)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [visibleColumns, rows.length])

  const sortedRows = useMemo(() => {
    const col = COMMERCIAL_DOCS_COLUMN_BY_ID[sortKey]
    if (!col?.getSortValue) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = col.getSortValue!(a)
      const bv = col.getSortValue!(b)
      if (av === bv) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  const hasActiveFilters =
    search.trim().length > 0 ||
    debouncedSearch.length > 0 ||
    documentTypeFilter !== '' ||
    documentStatusFilter !== '' ||
    selectedIncoterms.length > 0 ||
    selectedProducts.length > 0 ||
    selectedPlants.length > 0 ||
    dateFrom !== ytdDefault.dateFrom ||
    dateTo !== ytdDefault.dateTo

  const clearFilters = () => {
    markUserScopeFiltersCleared('contracts')
    setSearch('')
    setDocumentTypeFilter('')
    setDocumentStatusFilter('')
    setSelectedIncoterms([])
    resetUserScopeFilters()
    setDateFrom(ytdDefault.dateFrom)
    setDateTo(ytdDefault.dateTo)
    setCurrentPage(1)
  }

  const applySummaryFilter = (type: CommercialDocumentType, status: 'checked' | 'unchecked') => {
    setDocumentTypeFilter(type)
    setDocumentStatusFilter(status)
  }

  const toggleColumn = (colId: CommercialDocsColumnId) => {
    setVisibleColumnIds((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId],
    )
  }

  const resetCompactColumnView = () => {
    setVisibleColumnIds(defaultVisibleColumnIds)
  }

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const section3TableLoading = loading && rows.length === 0

  const onHeaderSort = (colId: CommercialDocsColumnId) => {
    if (sortKey === colId) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(colId)
      setSortDir('asc')
    }
  }

  if (!perms.loaded) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
    )
  }

  if (!canViewPage) {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Commercial Documents</h1>
        <p className="text-sm text-gray-600 mt-1">Document completeness checking for commercial contracts</p>
      </div>

      {/* Section 1 */}
      <CommercialDocumentsSummaryCards
        summary={summary}
        documentTypeFilter={documentTypeFilter}
        documentStatusFilter={documentStatusFilter}
        onFilter={applySummaryFilter}
      />

      {/* Section 2 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="Search Contract Ext No, PO, Supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={documentTypeFilter}
              onChange={(e) => setDocumentTypeFilter(e.target.value as CommercialDocumentType | '')}
            >
              <option value="">All document types</option>
              {COMMERCIAL_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMMERCIAL_DOCUMENT_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={documentStatusFilter}
              onChange={(e) => setDocumentStatusFilter(e.target.value as DocumentStatusFilter)}
            >
              <option value="">All document statuses</option>
              <option value="checked">Checked</option>
              <option value="unchecked">Unchecked</option>
            </select>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <SearchableMultiSelect
              label="Incoterm"
              placeholder="All incoterms"
              options={availableIncoterms}
              selected={selectedIncoterms}
              onChange={setSelectedIncoterms}
            />
            <SearchableMultiSelect
              label="Product"
              placeholder="All products"
              options={availableProducts}
              selected={selectedProducts}
              onChange={handleProductsChange}
            />
            <SearchableMultiSelect
              label="Group Plant"
              placeholder="All group plants"
              options={availablePlants}
              selected={selectedPlants}
              onChange={handleGroupPlantsChange}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Contract Date:</label>
              <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={setDateFrom} className="w-40" />
              <span className="text-gray-500">to</span>
              <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={setDateTo} className="w-40" />
              {hasActiveFilters && (
                <Button
                  type="button"
                  onClick={clearFilters}
                  variant="ghost"
                  size="sm"
                  className="text-gray-500"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span>All Documents</span>
                  {fetching && rows.length > 0 ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                  ) : null}
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{totalRows.toLocaleString('en-US')}</span> documents
                  </span>
                  <span className="text-gray-400" aria-hidden>
                    ·
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    Page {currentPage}/{totalPages} · {sortedRows.length} rows
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowColumnsMenu((v) => !v)}
                  disabled={fetching || section3TableLoading}
                >
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Columns
                </Button>
                {showColumnsMenu && (
                  <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setShowColumnsMenu(false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 mb-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumnIds(COMMERCIAL_DOCS_ALL_COLUMNS.map((c) => c.id))}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumnIds([])}
                      >
                        Unselect All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={resetCompactColumnView}
                      >
                        Reset
                      </Button>
                    </div>
                    <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                      {columnsMenuItems.map((col) => (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-0.5 hover:bg-gray-50"
                        >
                          <Checkbox
                            checked={visibleColumnIds.includes(col.id)}
                            onCheckedChange={() => toggleColumn(col.id)}
                          />
                          <span className="truncate">{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || fetching || section3TableLoading}
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number
                      if (totalPages <= 5) {
                        pageNum = i + 1
                      } else if (currentPage <= 3) {
                        pageNum = i + 1
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i
                      } else {
                        pageNum = currentPage - 2 + i
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={currentPage === pageNum ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handlePageChange(pageNum)}
                          disabled={fetching || section3TableLoading}
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
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || fetching || section3TableLoading}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className={section3TableLoading ? 'min-h-[480px]' : undefined}>
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
                requestAnimationFrame(() => { isSyncingScroll.current = false })
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
                requestAnimationFrame(() => { isSyncingScroll.current = false })
              }}
            >
              <table className={COMPACT_OPERATIONAL_TABLE_CLASS}>
                <thead>
                  <tr className={CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS}>
                    {visibleColumns.map((col) => {
                      const columnLayout = getOperationalColumnLayout('commercial_documents', col.id)
                      const opColClass = operationalTableColumnClass(columnLayout)
                      const centerHeader = col.centerCell || isCommercialDocStatusColumn(col.id)
                      return (
                        <th
                          key={col.id}
                          scope="col"
                          className={cn(
                            'relative font-semibold align-top sticky top-0 z-20 bg-gray-50',
                            centerHeader ? 'text-center' : 'text-left',
                            CONTRACT_PERF_TABLE_CELL_PAD,
                            opColClass,
                          )}
                        >
                          {centerHeader ? (
                            <div className="flex justify-center">
                              <ContractPerfTableSortHeader
                                label={col.label}
                                formulaHelp={col.formulaHelp}
                                sortable={col.sortable !== false}
                                activeSort={sortKey === col.id}
                                sortDir={sortDir}
                                onSortClick={() => onHeaderSort(col.id)}
                              />
                            </div>
                          ) : (
                            <ContractPerfTableSortHeader
                              label={col.label}
                              formulaHelp={col.formulaHelp}
                              sortable={col.sortable !== false}
                              activeSort={sortKey === col.id}
                              sortDir={sortDir}
                              onSortClick={() => onHeaderSort(col.id)}
                            />
                          )}
                        </th>
                      )
                    })}
                    <th
                      scope="col"
                      className={cn(COMPACT_TABLE_ACTIONS_HEADER_CLASS, CONTRACT_PERF_TABLE_CELL_PAD)}
                    >
                      <span className={COMPACT_TABLE_HEADER_LABEL_CLASS}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {section3TableLoading ? (
                    <TableInitialLoadPlaceholder colSpan={visibleColumns.length + 1} icon={FileText} />
                  ) : sortedRows.length === 0 ? (
                    <tr className="bg-white">
                      <td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-gray-500">
                        <p>No documents found</p>
                        {debouncedSearch ? (
                          <p className="text-sm mt-2">Try adjusting your search filters</p>
                        ) : null}
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row, idx) => {
                      const stripe = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      const hasUploads = Number(row.uploaded_count) > 0
                      return (
                        <tr key={row.id} className={stripe}>
                          {visibleColumns.map((col) => {
                            const columnLayout = getOperationalColumnLayout('commercial_documents', col.id)
                            const opColClass = operationalTableColumnClass(columnLayout)
                            const centerCell = col.centerCell || isCommercialDocStatusColumn(col.id)
                            return (
                              <td
                                key={col.id}
                                className={cn(
                                  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
                                  opColClass,
                                  'align-middle',
                                  CONTRACT_PERF_TABLE_CELL_PAD,
                                  centerCell && 'text-center',
                                  stripe,
                                )}
                              >
                                <div
                                  className={cn(
                                    COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
                                    CONTRACT_PERF_TABLE_ROW_MIN_H,
                                    centerCell && 'justify-center',
                                  )}
                                >
                                  {col.render(row)}
                                </div>
                              </td>
                            )
                          })}
                          <td className={cn(COMPACT_TABLE_ACTIONS_CELL_CLASS, stripe)}>
                            <div className="flex items-center justify-center">
                              <Button
                                variant="outline"
                                size="icon"
                                title={
                                  canModifyDocuments
                                    ? hasUploads
                                      ? 'Edit documents'
                                      : 'Add documents'
                                    : 'View documents'
                                }
                                onClick={() => setModalRow(row)}
                                className={
                                  canModifyDocuments
                                    ? hasUploads
                                      ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                                      : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                                }
                              >
                                {canModifyDocuments ? (
                                  hasUploads ? (
                                    <Pencil className="h-4 w-4" />
                                  ) : (
                                    <FileCheck className="h-4 w-4" />
                                  )
                                ) : (
                                  <FileText className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <DocumentCheckingModal
        row={modalRow}
        canModifyDocuments={canModifyDocuments}
        onClose={() => setModalRow(null)}
        onSaved={() => void fetchData()}
      />
    </div>
  )
}
