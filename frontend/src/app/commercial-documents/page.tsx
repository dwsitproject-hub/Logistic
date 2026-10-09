'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import {
  canCreatePermission,
  canDeletePermission,
  canEditPermission,
  canViewPermission,
  isAdminRole,
  usePermissions,
} from '@/components/PermissionsContext'
import api from '@/lib/api'
import { buildCacheKey, cachedGet, invalidateClientCacheByPathPrefix } from '@/lib/clientDataCache'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FileDown,
  FileText,
  Loader2,
  Pencil,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { FilterSingleSelect } from '@/components/FilterSingleSelect'
import { HeaderFilterSlot } from '@/components/HeaderFilterSlot'
import { PerformanceContractDateControl } from '@/components/performance/PerformanceContractDateControl'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { StitchFields } from '@/components/shared/stitchField'
import { StitchSearchIcon } from '@/components/shared/stitchIcons'
import {
  buildPerformancePeriodOptions,
  resolvePerformancePeriodDateRange,
  type PerformancePeriodKey,
} from '@/lib/performancePeriodFilters'
import {
  LIST_FILTER_FIELD_LABEL_CLASS,
  ListFilterPanel,
  selectionChips,
  LIST_FILTER_FIELDS_ROW_CLASS,
} from '@/components/shared/ListFilterPanel'
import { LIST_PAGE_TABLE_HEADER_ROW_CLASS } from '@/lib/compactTableUi'
import { useUserScopeFilterDefaults } from '@/hooks/useUserScopeFilterDefaults'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { markUserScopeFiltersCleared } from '@/lib/userScopeFilters'
import { filterIncotermOptions, filterRegionSiteOptions } from '@/lib/globalScopeFilters'
import { cn } from '@/lib/utils'
import { ContractPerfTableSortHeader } from '@/components/performance/ContractPerfTableSortHeader'
import { TableInitialLoadPlaceholder } from '@/components/performance/TableInitialLoadPlaceholder'
import { CommercialDocumentsSummaryCards } from '@/components/commercial-documents/CommercialDocumentsSummaryCards'
import { DocumentCheckingModal } from '@/components/commercial-documents/DocumentCheckingModal'
import { TandaTerimaDownloadModal } from '@/components/commercial-documents/TandaTerimaDownloadModal'
import {
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  CONTRACT_PERF_TABLE_CELL_PAD,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
} from '@/lib/contractPerformanceColumns'
import {
  COMPACT_OPERATIONAL_TABLE_CELL_CLASS,
  COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
  COMPACT_OPERATIONAL_TABLE_CLASS,
  COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
  COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS,
  COMPACT_TABLE_HEADER_LABEL_CLASS,
  compactTableColWidthCss,
} from '@/lib/compactTableUi'
import { operationalTableColumnClass, getOperationalColumnLayout } from '@/lib/operationalTableLayout'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  COMMERCIAL_DOCS_TRUNCATE_TOOLTIP_COLUMN_IDS,
  operationalRowFieldTooltipText,
  shouldApplyOperationalTruncateTooltip,
} from '@/lib/operationalTableTruncateUi'
import {
  COMMERCIAL_DOCS_ACTIONS_COL_WIDTH_PX,
  COMMERCIAL_DOCS_ALL_COLUMNS,
  COMMERCIAL_DOCS_COLUMN_BY_ID,
  commercialDocsDynamicColumnWidthPx,
  commercialDocsTableColumnWidthPx,
  formatCommercialDocsDynamicCell,
  isCommercialDocsDynamicWidthColumn,
  type CommercialDocsColumnId,
  type CommercialDocsColumnMeta,
  isCommercialDocStatusColumn,
} from '@/lib/commercialDocumentsColumns'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  COMMERCIAL_DOCUMENTS_DATA_PERMISSION,
  COMMERCIAL_DOCUMENTS_PAGE_PERMISSION,
  defaultCommercialDocsYtdRange,
  type CommercialDocumentRow,
  type CommercialDocumentType,
  type CommercialDocumentsSummary,
} from '@/lib/commercialDocumentsTypes'

const VISIBLE_COLUMNS_KEY = 'commercial-documents.visibleColumns.v3'
const PAGE_SIZE = 50

type DocumentStatusFilter = '' | 'checked' | 'unchecked'

function formatContractTotalLabel(count: number): string {
  const formatted = count.toLocaleString('en-US')
  return count === 1 ? `${formatted} contract` : `${formatted} contracts`
}

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
    canEditPermission(perms, COMMERCIAL_DOCUMENTS_PAGE_PERMISSION) ||
    canCreatePermission(perms, COMMERCIAL_DOCUMENTS_DATA_PERMISSION) ||
    canEditPermission(perms, COMMERCIAL_DOCUMENTS_DATA_PERMISSION)
  // Same rule the API enforces: ADMIN, or can_delete on data.commercial_documents for the user's role and level.
  const canDeleteDocuments =
    isAdminRole(perms.userRole) || canDeletePermission(perms, COMMERCIAL_DOCUMENTS_DATA_PERMISSION)

  useEffect(() => {
    if (perms.loaded && !canViewPage) {
      router.replace('/contracts')
    }
  }, [canViewPage, perms.loaded, router])

  const ytdDefault = useMemo(() => defaultCommercialDocsYtdRange(), [])
  const [docPeriod, setDocPeriod] = useState<PerformancePeriodKey>('YTD')
  const [rows, setRows] = useState<CommercialDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [totalRows, setTotalRows] = useState(0)
  const [summary, setSummary] = useState<CommercialDocumentsSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
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
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([])
  const [availablePlants, setAvailablePlants] = useState<string[]>([])
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([])

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
  const [selectedContractExtNos, setSelectedContractExtNos] = useState<Set<string>>(() => new Set())
  const [tandaTerimaModalOpen, setTandaTerimaModalOpen] = useState(false)

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
    alignGroupPlantsToOptions,
  } = useUserScopeFilterDefaults('contracts')

  /**
   * The user's scoped Region/Plant arrives spelled as `master_plants` spells it (`Bontang`) while
   * the dropdown options are SAP Discharge Destination (`BONTANG`). Re-spell the selection as the
   * options do once they load, or the box shows "1 selected (OR)" with nothing ticked.
   *
   * This page also sets `uppercaseOptionLabels`, which restyles the label but not the value - so
   * the mismatch was invisible in the list and visible only as the unticked box.
   */
  useEffect(() => {
    alignGroupPlantsToOptions(availablePlants)
  }, [availablePlants, alignGroupPlantsToOptions])

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

  const dynamicColumnWidthById = useMemo(() => {
    const out: Partial<Record<CommercialDocsColumnId, number>> = {}
    for (const col of visibleColumns) {
      if (!isCommercialDocsDynamicWidthColumn(col.id)) continue
      out[col.id] = commercialDocsDynamicColumnWidthPx(
        col.id,
        col.label,
        rows.map((row) => formatCommercialDocsDynamicCell(col.id, row)),
        { hasFormulaHelp: Boolean(col.formulaHelp) },
      )
    }
    return out
  }, [visibleColumns, rows])

  const resolveColumnWidthPx = (col: CommercialDocsColumnMeta): number =>
    dynamicColumnWidthById[col.id] ??
    commercialDocsTableColumnWidthPx(col.id, col.label, {
      hasFormulaHelp: Boolean(col.formulaHelp),
    })

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
      params.set('sortKey', sortKey)
      params.set('sortDir', sortDir)
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (documentTypeFilter) params.set('documentType', documentTypeFilter)
      if (documentStatusFilter) params.set('documentStatus', documentStatusFilter)
      if (selectedIncoterms.length === 1) params.set('incoterm', selectedIncoterms[0])
      if (selectedProducts.length === 1) params.set('product', selectedProducts[0])
      if (selectedSuppliers.length === 1) params.set('supplier', selectedSuppliers[0])
      selectedPlants.forEach((p) => params.append('plant', p))

      const url = `/commercial-documents?${params.toString()}`
      const cacheKey = buildCacheKey('GET', url)
      const { data } = await cachedGet(cacheKey, (signal) => api.get(url, { signal }).then((r) => r.data))
      const payload = data?.data
      setRows(payload?.rows || [])
      setTotalRows(payload?.pagination?.total ?? 0)
      setTotalPages(payload?.pagination?.totalPages ?? 1)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [
    currentPage,
    sortKey,
    sortDir,
    dateFrom,
    dateTo,
    debouncedSearch,
    documentTypeFilter,
    documentStatusFilter,
    selectedIncoterms,
    selectedProducts,
    selectedSuppliers,
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
        selectedSuppliers,
        selectedPlants,
        dateFrom,
        dateTo,
        sortKey,
        sortDir,
      }),
    [
      debouncedSearch,
      documentTypeFilter,
      documentStatusFilter,
      selectedIncoterms,
      selectedProducts,
      selectedSuppliers,
      selectedPlants,
      dateFrom,
      dateTo,
      sortKey,
      sortDir,
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

  /**
   * The cards count every document type for the contracts in scope, so they follow the scope filters
   * (date, search, incoterm, product, supplier, region/plant) but not the document type/status
   * selection, the page number or the sort - clicking a card must not change its own number.
   */
  const summaryScopeSignature = useMemo(
    () =>
      JSON.stringify({
        dateFrom,
        dateTo,
        debouncedSearch,
        selectedIncoterms,
        selectedProducts,
        selectedSuppliers,
        selectedPlants,
      }),
    [dateFrom, dateTo, debouncedSearch, selectedIncoterms, selectedProducts, selectedSuppliers, selectedPlants],
  )

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (selectedIncoterms.length === 1) params.set('incoterm', selectedIncoterms[0])
      if (selectedProducts.length === 1) params.set('product', selectedProducts[0])
      if (selectedSuppliers.length === 1) params.set('supplier', selectedSuppliers[0])
      selectedPlants.forEach((p) => params.append('plant', p))

      const url = `/commercial-documents/summary?${params.toString()}`
      const cacheKey = buildCacheKey('GET', url)
      const { data } = await cachedGet(cacheKey, (signal) => api.get(url, { signal }).then((r) => r.data))
      setSummary((data?.data?.summary as CommercialDocumentsSummary | undefined) ?? null)
    } catch {
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryScopeSignature])

  useEffect(() => {
    if (!perms.loaded || !canViewPage) return
    void fetchSummary()
  }, [fetchSummary, perms.loaded, canViewPage])

  const onSummaryCardSelect = (type: CommercialDocumentType) => {
    if (documentTypeFilter === type && documentStatusFilter === 'checked') {
      setDocumentTypeFilter('')
      setDocumentStatusFilter('')
    } else {
      setDocumentTypeFilter(type)
      setDocumentStatusFilter('checked')
    }
    setCurrentPage(1)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/contracts/filter-options/group-plants'),
      api.get('/contracts/filter-options/incoterms'),
      api.get('/dashboard/filter-options/products'),
      api.get('/dashboard/filter-options/suppliers'),
    ])
      .then(([plantRes, incRes, productRes, supplierRes]) => {
        if (cancelled) return
        const plants = (plantRes.data?.data?.groupPlants || []) as string[]
        const incs = (incRes.data?.data?.incoterms || []) as string[]
        const productPayload = productRes.data?.data
        const products = (Array.isArray(productPayload)
          ? productPayload
          : productPayload && typeof productPayload === 'object' && 'products' in productPayload
            ? (productPayload as { products?: string[] }).products
            : []) as string[]
        const supplierPayload = supplierRes.data?.data
        const suppliers = (Array.isArray(supplierPayload) ? supplierPayload : []) as string[]
        setAvailablePlants(filterRegionSiteOptions(Array.isArray(plants) ? plants : []))
        setAvailableIncoterms(filterIncotermOptions(Array.isArray(incs) ? incs : []))
        setAvailableProducts(Array.isArray(products) ? products : [])
        setAvailableSuppliers(Array.isArray(suppliers) ? suppliers : [])
      })
      .catch(() => {
        if (cancelled) return
        setAvailablePlants([])
        setAvailableIncoterms([])
        setAvailableProducts([])
        setAvailableSuppliers([])
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
  }, [visibleColumns, rows.length, dynamicColumnWidthById])

  const sortedRows = rows

  const hasActiveFilters =
    search.trim().length > 0 ||
    debouncedSearch.length > 0 ||
    documentTypeFilter !== '' ||
    documentStatusFilter !== '' ||
    selectedIncoterms.length > 0 ||
    selectedProducts.length > 0 ||
    selectedSuppliers.length > 0 ||
    selectedPlants.length > 0 ||
    dateFrom !== ytdDefault.dateFrom ||
    dateTo !== ytdDefault.dateTo

  const clearFilters = () => {
    markUserScopeFiltersCleared('contracts')
    setSearch('')
    setDocumentTypeFilter('')
    setDocumentStatusFilter('')
    setSelectedIncoterms([])
    setSelectedSuppliers([])
    resetUserScopeFilters()
    setDocPeriod('YTD')
    setDateFrom(ytdDefault.dateFrom)
    setDateTo(ytdDefault.dateTo)
    setCurrentPage(1)
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

  const selectedCount = selectedContractExtNos.size
  const selectedExtNoList = useMemo(
    () => [...selectedContractExtNos],
    [selectedContractExtNos],
  )

  const allPageRowsSelected =
    sortedRows.length > 0 &&
    sortedRows.every((row) => selectedContractExtNos.has(row.contract_ext_no))
  const somePageRowsSelected =
    sortedRows.some((row) => selectedContractExtNos.has(row.contract_ext_no)) && !allPageRowsSelected

  const toggleRowSelected = (row: CommercialDocumentRow, checked: boolean) => {
    setSelectedContractExtNos((prev) => {
      const next = new Set(prev)
      if (checked) next.add(row.contract_ext_no)
      else next.delete(row.contract_ext_no)
      return next
    })
  }

  const toggleAllPageRows = (checked: boolean) => {
    setSelectedContractExtNos((prev) => {
      const next = new Set(prev)
      if (checked) {
        sortedRows.forEach((row) => next.add(row.contract_ext_no))
      } else {
        sortedRows.forEach((row) => next.delete(row.contract_ext_no))
      }
      return next
    })
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
    <StitchFields>
    <div className="space-y-6">
      <HeaderFilterSlot>
        <PerformanceContractDateControl
          header
          period={docPeriod}
          options={buildPerformancePeriodOptions()}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onPeriodChange={(value) => {
            setDocPeriod(value)
            const range = resolvePerformancePeriodDateRange(value)
            setDateFrom(range.dateFrom)
            setDateTo(range.dateTo)
            setCurrentPage(1)
          }}
          onDateFromChange={(iso) => {
            setDateFrom(iso)
            setCurrentPage(1)
          }}
          onDateToChange={(iso) => {
            setDateTo(iso)
            setCurrentPage(1)
          }}
          resolvePeriodRange={resolvePerformancePeriodDateRange}
        />
        <SearchableMultiSelect
          label="Region/Plant"
          hideLabel
          portalMenu
          buttonClassName="flex h-9 w-44 items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          options={availablePlants}
          selected={selectedPlants}
          onChange={handleGroupPlantsChange}
          placeholder="Region/Plant"
          emptyMessage="No region/plant values"
          uppercaseOptionLabels
        />
      </HeaderFilterSlot>
      <p className="text-sm text-gray-600">Document completeness checking for commercial contracts</p>

      <ListFilterPanel
        onReset={clearFilters}
        showReset={hasActiveFilters}
        chips={[
          ...(search.trim()
            ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => setSearch('') }]
            : []),
          ...(documentTypeFilter
            ? [{
                id: 'document-type',
                label: `Document type: ${COMMERCIAL_DOCUMENT_LABELS[documentTypeFilter]}`,
                onRemove: () => setDocumentTypeFilter(''),
              }]
            : []),
          ...(documentStatusFilter
            ? [{
                id: 'document-status',
                label: `Document status: ${documentStatusFilter === 'checked' ? 'Checked' : 'Unchecked'}`,
                onRemove: () => setDocumentStatusFilter(''),
              }]
            : []),
          ...selectionChips('Incoterm', selectedIncoterms, setSelectedIncoterms),
          ...selectionChips('Product', selectedProducts, handleProductsChange),
          ...selectionChips('Supplier', selectedSuppliers, setSelectedSuppliers),
          ...selectionChips('Region/Plant', selectedPlants, handleGroupPlantsChange),
          ...(dateFrom !== ytdDefault.dateFrom || dateTo !== ytdDefault.dateTo
            ? [{
                id: 'contract-date',
                label: `Contract date: ${dateFrom || '…'} to ${dateTo || '…'}`,
                onRemove: () => {
                  setDocPeriod('YTD')
                  setDateFrom(ytdDefault.dateFrom)
                  setDateTo(ytdDefault.dateTo)
                },
              }]
            : []),
        ]}
      >
        <div className={LIST_FILTER_FIELDS_ROW_CLASS}>
          <div className="min-w-[12rem] flex-[1.4]">
            <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Search</label>
            <div className="relative">
              <StitchSearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Contract Ext No, PO, Supplier"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-lg border-slate-200 pl-10 text-slate-700 placeholder:text-slate-400 focus-visible:ring-blue-600"
              />
            </div>
          </div>
          <div className="min-w-[7.5rem] flex-1">
            <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Document Type</label>
            <FilterSingleSelect
              value={documentTypeFilter}
              onChange={(value) => setDocumentTypeFilter(value as CommercialDocumentType | '')}
              options={[
                { value: '', label: 'All' },
                ...COMMERCIAL_DOCUMENT_TYPES.map((type) => ({
                  value: type,
                  label: COMMERCIAL_DOCUMENT_LABELS[type],
                })),
              ]}
              ariaLabel="Document type filter"
              className="w-full min-w-0"
            />
          </div>
          <div className="min-w-[7.5rem] flex-1">
            <label className={LIST_FILTER_FIELD_LABEL_CLASS}>Document Status</label>
            <FilterSingleSelect
              value={documentStatusFilter}
              onChange={(value) => setDocumentStatusFilter(value as DocumentStatusFilter)}
              options={[
                { value: '', label: 'All' },
                { value: 'checked', label: 'Checked' },
                { value: 'unchecked', label: 'Unchecked' },
              ]}
              ariaLabel="Document status filter"
              className="w-full min-w-0"
            />
          </div>
          <PerformanceScopeFilters
            inlineRow
            microLabels
            hideGroupPlantFilter
            incotermOptions={availableIncoterms}
            selectedIncoterms={selectedIncoterms}
            onIncotermsChange={setSelectedIncoterms}
            showProductFilter
            productOptions={availableProducts}
            selectedProducts={selectedProducts}
            onProductsChange={handleProductsChange}
            showSupplierFilter
            supplierOptions={availableSuppliers}
            selectedSuppliers={selectedSuppliers}
            onSuppliersChange={setSelectedSuppliers}
            groupPlantOptions={availablePlants}
            uppercaseGroupPlantLabels
            selectedGroupPlants={selectedPlants}
            onGroupPlantsChange={handleGroupPlantsChange}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            showDateRange={false}
            incotermPlaceholder="All"
            productPlaceholder="All"
            supplierPlaceholder="All"
            incotermEmptyMessage="Loading incoterms..."
            productEmptyMessage="Loading products..."
            supplierEmptyMessage="Loading suppliers..."
            groupPlantPlaceholder="All"
            groupPlantEmptyMessage="No region/plant values"
          />
        </div>
      </ListFilterPanel>

      <CommercialDocumentsSummaryCards
        summary={summary}
        loading={summaryLoading}
        activeType={documentStatusFilter === 'checked' ? documentTypeFilter : ''}
        onSelect={onSummaryCardSelect}
      />

      {/* Section 3 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>All Contracts</span>
                  {fetching && rows.length > 0 ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                  ) : null}
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                  <span className="whitespace-nowrap tabular-nums text-gray-700">
                    <span className="font-semibold">{formatContractTotalLabel(totalRows)}</span>
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
              <Button
                variant="outline"
                size="sm"
                disabled={selectedCount === 0 || fetching || section3TableLoading}
                onClick={() => setTandaTerimaModalOpen(true)}
              >
                <FileDown className="h-4 w-4 mr-2" />
                Download Tanda Terima
                {selectedCount > 0 ? ` (${selectedCount})` : ''}
              </Button>
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
              <table className={`${COMPACT_OPERATIONAL_TABLE_CLASS} ${COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS} klip-compact-table--commercial-docs klip-compact-table--perf-narrow-cols`}>
                <colgroup>
                  {visibleColumns.map((col) => (
                    <col
                      key={col.id}
                      style={{
                        width: compactTableColWidthCss(resolveColumnWidthPx(col)),
                      }}
                    />
                  ))}
                  <col style={{ width: COMMERCIAL_DOCS_ACTIONS_COL_WIDTH_PX }} />
                </colgroup>
                <thead>
                  <tr className={LIST_PAGE_TABLE_HEADER_ROW_CLASS}>
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
                            isCommercialDocsDynamicWidthColumn(col.id) && 'klip-op-col--dynamic-fit',
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
                      <div className="klip-commercial-docs-actions-inner">
                        <Checkbox
                          checked={allPageRowsSelected ? true : somePageRowsSelected ? 'indeterminate' : false}
                          onCheckedChange={(v) => toggleAllPageRows(v === true)}
                          disabled={sortedRows.length === 0 || section3TableLoading}
                          aria-label="Select all contracts on this page"
                        />
                        <span className={cn(COMPACT_TABLE_HEADER_LABEL_CLASS, 'whitespace-nowrap')}>Actions</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {section3TableLoading ? (
                    <TableInitialLoadPlaceholder colSpan={visibleColumns.length + 1} icon={FileText} />
                  ) : sortedRows.length === 0 ? (
                    <tr className="bg-white">
                      <td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-gray-500">
                        <p>No contracts found</p>
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
                            const useTruncateTooltip =
                              !centerCell &&
                              shouldApplyOperationalTruncateTooltip(
                                col.id,
                                columnLayout,
                                COMMERCIAL_DOCS_TRUNCATE_TOOLTIP_COLUMN_IDS,
                              )
                            const truncateTooltip = useTruncateTooltip
                              ? operationalRowFieldTooltipText(
                                  col.id,
                                  row as unknown as Record<string, unknown>,
                                )
                              : null
                            const rendered = col.render(row)
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
                                  isCommercialDocsDynamicWidthColumn(col.id) && 'klip-op-col--dynamic-fit',
                                )}
                              >
                                <div
                                  className={cn(
                                    centerCell
                                      ? 'flex w-full items-center justify-center min-h-[32px]'
                                      : cn(
                                          COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS,
                                          CONTRACT_PERF_TABLE_ROW_MIN_H,
                                        ),
                                  )}
                                >
                                  {useTruncateTooltip ? (
                                    <ContractPerfTruncatedCell tooltip={truncateTooltip} className="w-full">
                                      {rendered}
                                    </ContractPerfTruncatedCell>
                                  ) : (
                                    rendered
                                  )}
                                </div>
                              </td>
                            )
                          })}
                          <td className={cn(COMPACT_TABLE_ACTIONS_CELL_CLASS, stripe)}>
                            <div className="klip-commercial-docs-actions-inner">
                              <Checkbox
                                checked={selectedContractExtNos.has(row.contract_ext_no)}
                                onCheckedChange={(v) => toggleRowSelected(row, v === true)}
                                aria-label={`Select contract ${row.contract_ext_no}`}
                              />
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
                                      : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                                }
                              >
                                {canModifyDocuments ? (
                                  hasUploads ? (
                                    <Pencil className="h-4 w-4" />
                                  ) : (
                                    <Upload className="h-4 w-4" />
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

      <TandaTerimaDownloadModal
        open={tandaTerimaModalOpen}
        selectedCount={selectedCount}
        contractExtNos={selectedExtNoList}
        onClose={() => setTandaTerimaModalOpen(false)}
      />

      <DocumentCheckingModal
        row={modalRow}
        canModifyDocuments={canModifyDocuments}
        canDeleteDocuments={canDeleteDocuments}
        onClose={() => setModalRow(null)}
        onSaved={() => {
          // Uploads change both the rows and the card counts; drop the cached responses first.
          invalidateClientCacheByPathPrefix('/commercial-documents')
          void fetchData()
          void fetchSummary()
        }}
      />
    </div>
    </StitchFields>
  )
}
