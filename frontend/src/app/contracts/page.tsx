'use client'

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Flag, GripVertical, Pencil, Plus, Search, Filter, Eye, X, Upload, Truck, Ship, FileText, SlidersHorizontal, Download } from 'lucide-react'
import api from '@/lib/api'
import { CreateTruckingOperationModal } from '@/components/trucking/CreateTruckingOperationModal'
import { AddShipmentModal } from '@/components/shipments/AddShipmentModal'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  ContractTruckingDetailModal,
  ContractShipmentDetailModal,
} from '@/components/contracts/ContractLogisticsDetailModals'
import { Checkbox } from '@/components/ui/checkbox'
import { formatKgFromMt, formatRupiah, toKgFromMt } from '@/lib/utils'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY, toSortableTimestamp } from '@/lib/dateFormat'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Column ids sorted on the API (see GET /contracts allowedSort). */
const API_SORTABLE_COLUMN_IDS = new Set([
  'contract_date',
  'contract_id',
  'status',
  'supplier',
  'buyer',
  'product',
  'group_name',
  'company_name',
  'incoterm',
  'transport_mode',
  'delivery_start',
  'delivery_end',
  'sto_count',
  'contract_qty',
  'outstanding_qty_mt',
  'created_at',
])

/** Computed / UI-only columns — sorted client-side on the current result set. */
const CLIENT_ONLY_SORT_COLUMN_IDS = new Set([
  'log_cycle_days',
  'trade_cycle_days',
  'cash_cycle_days',
  'contract_aging',
  'delivery_status',
  'status_overall',
  'unusual_status',
  'received_qty',
  'over_under_delivery_status',
  'month_delivery_end',
  'cargo_readiness_date',
  'po_number',
  'contract_ext_no',
  'lt_spot',
  'sto_number',
])

const DATE_SORT_COLUMN_IDS = new Set([
  'contract_date',
  'delivery_start',
  'delivery_end',
  'created_at',
  'cargo_readiness_date',
])

function resolveApiSortKey(columnId: string): string | null {
  if (CLIENT_ONLY_SORT_COLUMN_IDS.has(columnId)) return null
  if (!API_SORTABLE_COLUMN_IDS.has(columnId)) return null
  return columnId
}

function compareContractSortValues(
  av: string | number,
  bv: string | number,
  columnId: string,
  dirMul: number,
): number {
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul
  if (DATE_SORT_COLUMN_IDS.has(columnId)) {
    const at = toSortableTimestamp(String(av ?? ''))
    const bt = toSortableTimestamp(String(bv ?? ''))
    if (at != null && bt != null) return (at - bt) * dirMul
    if (at == null && bt == null) return 0
    if (at == null) return 1 * dirMul
    if (bt == null) return -1 * dirMul
  }
  const as = String(av ?? '')
  const bs = String(bv ?? '')
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' }) * dirMul
}

interface Contract {
  id: string
  contract_id: string
  buyer: string
  supplier: string
  product: string
  quantity_ordered: number
  quantity_delivery?: number
  quantity_receive?: number
  unit: string
  incoterm: string
  contract_date: string
  delivery_start_date: string
  delivery_end_date: string
  contract_value: number
  currency: string
  status: string
  group_name: string
  po_number: string
  po_numbers: string
  sto_number: string
  sto_numbers: string
  sto_quantity: number
  unit_price: number
  source_type: string
  contract_type: string
  transport_mode: string
  logistics_classification: string
  po_classification: string
  created_at: string
  total_sto_quantity: number
  outstanding_quantity: number
  po_count: number
  sto_count: number
  company_code?: string
  b2b_flag?: string
  contract_reference_po?: string
  lt_spot?: string
  import_status?: string
  due_date_payment?: string
  dp_date?: string
  payoff_date?: string
  dp_date_deviation_days?: number
  payoff_date_deviation_days?: number
  trucking_count?: number
  contract_ext_no?: string
  shipment_count?: number
  document_count?: number
  cargo_readiness_date?: string
  plant_site?: string | null
  over_under_delivery_status?: string
  log_cycle_days?: number | null
  trade_cycle_days?: number | null
  cash_cycle_days?: number | null
  payment_status?: string
  company_name?: string
}

/** True when SAP B2B flag is set; do not use `contract_type || b2b_flag` (LT/SPOT lives in contract_type). */
function isContractB2b(c: Pick<Contract, 'b2b_flag' | 'contract_type'>): boolean {
  const contractType = String(c.contract_type || '').trim().toUpperCase()
  const b2bFlag = String(c.b2b_flag || '').trim().toUpperCase()
  return contractType === 'B2B' || b2bFlag === 'B2B'
}

/**
 * B2B contracts: show Buyer in Parties the same as Company Name (display-only).
 */
function partiesBuyerDisplay(
  c: Pick<Contract, 'buyer' | 'company_name' | 'b2b_flag' | 'contract_type'>,
): string {
  const isB2b = isContractB2b(c)
  if (isB2b) {
    const company = String(c.company_name || '').trim()
    const buyer = String(c.buyer || '').trim()
    return company || buyer || '-'
  }
  return String(c.buyer || '').trim() || '-'
}

interface DocumentItem {
  id: string
  document_type?: string
  file_name: string
  file_path?: string
  mime_type?: string
  file_size?: number
  contract_id?: string
  created_at?: string
}

interface StoInfoRow {
  type: 'shipment' | 'trucking'
  sto_number: string
  operation_id?: string | null
  late_indicator: string
  status: string
  sto_quantity: number
  quantity_delivered?: number
  quantity_receive?: number
  vessel_name?: string
  trucking_owner?: string
  eta_vessel_arrival_loading_port?: string | null
  eta_trucking_completion_date?: string | null
  ata_discharge_complete?: string | null
  trucking_completion_date?: string | null
}

type B2bPartyRow = {
  contract_id: string
  contract_date?: string | null
  po_numbers?: string | null
  contract_ext_no?: string | null
  company_name?: string | null
  supplier?: string | null
  incoterm?: string | null
  certification?: string | null
}

/** Matches compact grid `minmax(Npx, …)` — used for <col /> widths with table-fixed */
function compactGridTrackMinPx(track: string): string {
  const m = track.match(/minmax\((\d+)px/)
  return m ? `${m[1]}px` : '96px'
}

/** Default left-to-right order on `/contracts` when no saved column order (Supplier & Buyer after PO Number). */
const CONTRACTS_DEFAULT_COLUMN_ORDER: string[] = [
  'contract_date',
  'contract_id',
  'contract_ext_no',
  'po_number',
  'supplier',
  'company_name',
  'contract_qty',
  'outstanding_qty_mt',
]

/** Merge preferred Contracts order with any extra compact column ids (append unknown). Contract Performance: keep schema order. */
function compactColumnFallbackOrder(isContractPerformance: boolean, allIds: string[]): string[] {
  if (isContractPerformance) return [...allIds]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of CONTRACTS_DEFAULT_COLUMN_ORDER) {
    if (allIds.includes(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of allIds) {
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

/** App defaults when no saved column prefs (routes use separate localStorage keys). */
function defaultCompactVisibleColumnIds(isContractPerformance: boolean): string[] {
  if (isContractPerformance) {
    return [
      'contract_date',
      'contract_id',
      'group_name',
      'supplier',
      'outstanding_qty_mt',
      'trade_cycle_days',
      'cash_cycle_days',
      'log_cycle_days',
      'month_delivery_end',
    ]
  }
  return [...CONTRACTS_DEFAULT_COLUMN_ORDER]
}

function ContractsPageContent() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const isContractPerformance = pathname === '/contract-performance'
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [authReady, setAuthReady] = useState(false)
  // Search should apply only on Enter / Apply (not per keystroke)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  // Default view: compact (1 line per contract)
  const [expandedContractIds, setExpandedContractIds] = useState<Set<string>>(() => new Set())
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('contract_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const contractsTableRef = useRef<HTMLDivElement | null>(null)

  // Desktop table horizontal scroll sync (top + bottom)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)
  // Contracts page: default Open so the list and SEA/LAND "without shipment/trucking" cards show actionable open contracts only.
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    pathname === '/contract-performance' ? 'All Status' : 'Open'
  )
  const [b2bFlagFilter, setB2bFlagFilter] = useState<string>('ALL')
  /** Default YTD on first load so GET /contracts stays bounded (same as Contract Performance). */
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  })
  const [availableB2bFlags, setAvailableB2bFlags] = useState<string[]>([])
  const [productFilter, setProductFilter] = useState<string>('ALL')
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [transportModeFilter, setTransportModeFilter] = useState<string>('ALL')
  const [perfTransportMode, setPerfTransportMode] = useState<'ALL' | 'SEA' | 'LAND'>('ALL')
  const [lateOnTimeFilter, setLateOnTimeFilter] = useState<'ALL' | 'LATE' | 'ON_TIME'>('ALL')
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [availableIncoterms, setAvailableIncoterms] = useState<string[]>([])
  const [selectedPlantSites, setSelectedPlantSites] = useState<string[]>([])
  const [availablePlantSites, setAvailablePlantSites] = useState<string[]>([])
  const [uploadingId, setUploadingId] = useState<string>('')
  const [csvCargoUploading, setCsvCargoUploading] = useState(false)
  const [csvCargoResult, setCsvCargoResult] = useState<{ updated: number; notFound: number; errors: { po_number: string; reason: string }[] } | null>(null)
  const [docsLoading, setDocsLoading] = useState<boolean>(false)
  const [selectedContractDocs, setSelectedContractDocs] = useState<DocumentItem[]>([])
  const [docsModalContract, setDocsModalContract] = useState<Contract | null>(null)
  const [docsModalDocs, setDocsModalDocs] = useState<DocumentItem[]>([])
  const [docsModalLoading, setDocsModalLoading] = useState(false)
  const [stoInfoLoading, setStoInfoLoading] = useState<boolean>(false)
  const [stoInfo, setStoInfo] = useState<StoInfoRow[]>([])
  const [stoDetailRow, setStoDetailRow] = useState<StoInfoRow | null>(null)
  const [stoDetailData, setStoDetailData] = useState<any>(null)
  const [stoDetailLoading, setStoDetailLoading] = useState<boolean>(false)
  const [contractPayments, setContractPayments] = useState<Array<{ payment_status: string }>>([])
  const [contractPaymentsLoading, setContractPaymentsLoading] = useState(false)
  const [activityLog, setActivityLog] = useState<Array<{ id: string; username: string; full_name?: string; action: string; entity_type: string; timestamp: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null }>>([])
  const [activityLogLoading, setActivityLogLoading] = useState(false)
  const [detailLogTab, setDetailLogTab] = useState<'activity' | 'comments'>('activity')
  const [contractRemarks, setContractRemarks] = useState<Array<{ id: string; text: string; category?: string | null; created_at: string; updated_at: string; username?: string; full_name?: string }>>([])
  const [contractRemarksLoading, setContractRemarksLoading] = useState(false)
  const [newRemarkText, setNewRemarkText] = useState<string>('')
  const [newRemarkSaving, setNewRemarkSaving] = useState(false)
  const [b2bParties, setB2bParties] = useState<B2bPartyRow[]>([])
  const [b2bPartiesLoading, setB2bPartiesLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalContracts, setTotalContracts] = useState(0)
  const contractsPerPage = 20
  const [unassignedSeaContracts, setUnassignedSeaContracts] = useState(0)
  const [unassignedLandContracts, setUnassignedLandContracts] = useState(0)
  const [unassignedMixContracts, setUnassignedMixContracts] = useState(0)
  const [unassignedFilter, setUnassignedFilter] = useState<'sea' | 'land' | 'mix' | null>(null)
  const [updatingContractId, setUpdatingContractId] = useState<string | null>(null)

  type LatePerfNode = { key: string; count: number; totalDays: number; maxDays: number; totalQtyDelivery?: number; children: LatePerfNode[] }
  type TradeCycleBucket = { count: number; qty: number }
  type TradeCycleDist = {
    noData: TradeCycleBucket
    onTime: TradeCycleBucket
    d1_7:   TradeCycleBucket
    d8_14:  TradeCycleBucket
    d15_30: TradeCycleBucket
    d31_60: TradeCycleBucket
    d61plus: TradeCycleBucket
  }
  const [perfDashMode, setPerfDashMode] = useState<'late' | 'ontrack'>('late')
  const [latePerformanceTree, setLatePerformanceTree] = useState<LatePerfNode[]>([])
  const [latePerformanceSummary, setLatePerformanceSummary] = useState<{ count: number; totalDays: number; avgDays: number; maxDays: number; totalQtyDelivery?: number }>({
    count: 0,
    totalDays: 0,
    avgDays: 0,
    maxDays: 0,
    totalQtyDelivery: 0,
  })
  const [onTrackPerformanceTree, setOnTrackPerformanceTree] = useState<LatePerfNode[]>([])
  const [onTrackPerformanceSummary, setOnTrackPerformanceSummary] = useState<{ count: number; totalDays: number; avgDays: number; maxDays: number; totalQtyDelivery?: number }>({
    count: 0, totalDays: 0, avgDays: 0, maxDays: 0, totalQtyDelivery: 0,
  })
  const [tradeCycleDist, setTradeCycleDist] = useState<TradeCycleDist | null>(null)
  const [latePerfLoading, setLatePerfLoading] = useState(false)
  type LatePerfHotspot = {
    incoterm: string
    product: string
    plant_site: string
    group_name: string
    supplier: string
    count: number
    totalDays: number
    maxDays: number
    totalQtyDelivery: number
  }

  const latePerfAllHotspots = useMemo((): LatePerfHotspot[] => {
    const activeTree = perfDashMode === 'ontrack' ? onTrackPerformanceTree : latePerformanceTree
    const out: LatePerfHotspot[] = []
    for (const inc of activeTree) {
      for (const plant of inc.children || []) {
        for (const prod of plant.children || []) {
          for (const gn of prod.children || []) {
            for (const sup of gn.children || []) {
              out.push({
                incoterm: inc.key,
                product: prod.key,
                plant_site: plant.key,
                group_name: gn.key,
                supplier: sup.key,
                count: sup.count,
                totalDays: sup.totalDays,
                maxDays: sup.maxDays,
                totalQtyDelivery: sup.totalQtyDelivery || 0,
              })
            }
          }
        }
      }
    }
    return out
  }, [perfDashMode, latePerformanceTree, onTrackPerformanceTree])

  type LatePerfBranchNode = {
    id: string
    label: string
    level: 'total' | 'incoterm' | 'product' | 'plant' | 'supplier'
    count: number
    totalDays: number
    maxDays: number
    totalQtyDelivery: number
    children: LatePerfBranchNode[]
  }

  const latePerfBranchTree = useMemo((): LatePerfBranchNode => {
    const norm = (v: unknown) => {
      const s = String(v ?? '').trim()
      return s ? s : 'Blank'
    }
    type Agg = { count: number; totalDays: number; maxDays: number; totalQtyDelivery: number; children: Map<string, Agg> }
    const mk = (): Agg => ({ count: 0, totalDays: 0, maxDays: 0, totalQtyDelivery: 0, children: new Map() })
    const root = mk()

    for (const h of latePerfAllHotspots) {
      const inc = norm(h.incoterm)
      const prod = norm(h.product)
      const plant = norm(h.plant_site)
      const days = Number(h.totalDays) || 0
      const cnt = Number(h.count) || 0
      const maxd = Number(h.maxDays) || 0
      const qty = Number(h.totalQtyDelivery) || 0
      const sup = norm(h.supplier)

      const nInc = root.children.get(inc) ?? mk()
      root.children.set(inc, nInc)
      const nProd = nInc.children.get(prod) ?? mk()
      nInc.children.set(prod, nProd)
      const nPlant = nProd.children.get(plant) ?? mk()
      nProd.children.set(plant, nPlant)
      const nSup = nPlant.children.get(sup) ?? mk()
      nPlant.children.set(sup, nSup)

      for (const n of [root, nInc, nProd, nPlant, nSup]) {
        n.count += cnt
        n.totalDays += days
        n.maxDays = Math.max(n.maxDays, maxd)
        n.totalQtyDelivery += qty
      }
    }

    const toNodes = (m: Map<string, Agg>, parentId: string, level: LatePerfBranchNode['level']): LatePerfBranchNode[] => {
      const nodes: LatePerfBranchNode[] = []
      for (const [k, a] of m.entries()) {
        const id = `${parentId}__${k}`
        const nextLevel: LatePerfBranchNode['level'] =
          level === 'incoterm' ? 'product' : level === 'product' ? 'plant' : level === 'plant' ? 'supplier' : 'supplier'
        const children =
          level === 'supplier'
            ? []
            : toNodes(a.children, id, nextLevel)
        nodes.push({
          id,
          label: k,
          level,
          count: a.count,
          totalDays: a.totalDays,
          maxDays: a.maxDays,
          totalQtyDelivery: a.totalQtyDelivery,
          children,
        })
      }
      nodes.sort((a, b) => b.totalQtyDelivery - a.totalQtyDelivery || b.count - a.count || a.label.localeCompare(b.label))
      return nodes
    }

    return {
      id: 'total',
      label: 'Total',
      level: 'total',
      count: root.count,
      totalDays: root.totalDays,
      maxDays: root.maxDays,
      totalQtyDelivery: root.totalQtyDelivery,
      children: toNodes(root.children, 'total', 'incoterm'),
    }
  }, [latePerfAllHotspots])

  const [latePerfSelIncoterm, setLatePerfSelIncoterm] = useState<string | null>(null)
  const [latePerfSelProduct, setLatePerfSelProduct] = useState<string | null>(null)
  const [latePerfSelPlant, setLatePerfSelPlant] = useState<string | null>(null)
  const [latePerfSelSupplier, setLatePerfSelSupplier] = useState<string | null>(null)

  const resetLatePerfSelections = useCallback(() => {
    setLatePerfSelIncoterm(null)
    setLatePerfSelProduct(null)
    setLatePerfSelPlant(null)
    setLatePerfSelSupplier(null)
    setLateOnTimeFilter('ALL')
    setPerfTransportMode('ALL')
    setSelectedIncoterms([])
    setSelectedPlantSites([])
    setColumnFilters(prev => {
      const next = { ...prev }
      delete next.product
      delete next.supplier
      return next
    })
    setCurrentPage(1)
  }, [])

  const findChild = useCallback((nodes: LatePerfBranchNode[], label: string | null) => {
    if (!label) return null
    return nodes.find((n) => n.label === label) ?? null
  }, [])

  const latePerfIncotermNodes = latePerfBranchTree.children
  const latePerfSelectedIncNode = findChild(latePerfIncotermNodes, latePerfSelIncoterm)
  const latePerfProductNodes = latePerfSelectedIncNode?.children ?? []
  const latePerfSelectedProdNode = findChild(latePerfProductNodes, latePerfSelProduct)
  const latePerfPlantNodes = latePerfSelectedProdNode?.children ?? []
  const latePerfSelectedPlantNode = findChild(latePerfPlantNodes, latePerfSelPlant)
  const latePerfSupplierNodes = latePerfSelectedPlantNode?.children ?? []

  type ContractLogisticsUi =
    | { kind: 'truck-create'; contract: Contract }
    | { kind: 'ship-create'; contractId: string }
    | { kind: 'truck-detail'; contractId: string }
    | { kind: 'ship-detail'; contractId: string }
    | null
  const [contractLogisticsUi, setContractLogisticsUi] = useState<ContractLogisticsUi>(null)

  type ColumnFilter =
    | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'multi'; values: string[]; includeBlank?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }

  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)

  /** Column IDs handled by GET /contracts?columnFilters= (server); others stay client-only */
  const SERVER_COLUMN_FILTER_IDS = useMemo(
    () =>
      new Set<string>([
        'contract_id',
        'contract_ext_no',
        'product',
        'supplier',
        'buyer',
        'group_name',
        'transport_mode',
        'incoterm',
        'company_name',
        'lt_spot',
        'po_number',
        'sto_number',
        'b2b_flag',
        'contract_date',
        'delivery_start',
        'delivery_end',
        'cargo_readiness_date',
        'created_at',
        'contract_qty',
        'outstanding_qty',
        'delivery_status',
      ]),
    []
  )

  const clientOnlyColumnFilters = useMemo(() => {
    const out: Record<string, ColumnFilter> = {}
    for (const [k, v] of Object.entries(columnFilters)) {
      if (!SERVER_COLUMN_FILTER_IDS.has(k)) out[k] = v
    }
    return out
  }, [columnFilters, SERVER_COLUMN_FILTER_IDS])

  /** True if any server-side column filter popover has a real constraint (section 1 is not "clean"). */
  const hasActiveSectionOneColumnFilters = useCallback((filters: Record<string, ColumnFilter>): boolean => {
    for (const f of Object.values(filters)) {
      if (f.emptyOnly || f.notBlankOnly) return true
      if (f.type === 'text' && (f.value || '').trim().length > 0) return true
      if (f.type === 'number') {
        if ((f.min !== undefined && String(f.min).trim() !== '') || (f.max !== undefined && String(f.max).trim() !== '')) {
          return true
        }
      }
      if (f.type === 'date' && ((f.from && String(f.from).trim()) || (f.to && String(f.to).trim()))) return true
      if (f.type === 'multi') {
        if (f.values && f.values.length > 0) return true
        if (f.includeBlank) return true
      }
    }
    return false
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onMouseDown = (e: MouseEvent) => {
      if (!openHeaderFilterId) return
      const el = headerFilterPopoverRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setOpenHeaderFilterId(null)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [openHeaderFilterId])

  // This page mounts even while <Layout> is still checking localStorage.
  // Avoid firing API calls until a token exists.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hasToken = () => Boolean(localStorage.getItem('token'))
    if (hasToken()) {
      setAuthReady(true)
      return
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (hasToken()) {
        window.clearInterval(interval)
        setAuthReady(true)
      } else if (Date.now() - startedAt > 3000) {
        window.clearInterval(interval)
      }
    }, 150)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!authReady) return
    // Read URL parameters
    const statusParam = searchParams.get('status')
    if (statusParam) {
      setStatusFilter(statusParam)
    }
    // Reset to page 1 when filters change
    setCurrentPage(1)
    fetchContracts(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authReady,
    searchParams,
    statusFilter,
    b2bFlagFilter,
    productFilter,
    dateFrom,
    dateTo,
    transportModeFilter,
    perfTransportMode,
    lateOnTimeFilter,
    unassignedFilter,
    selectedIncoterms,
    selectedPlantSites,
    columnFilters,
    sortKey,
    sortDir,
  ])

  // Debounced refetch: global search runs on the server (full dataset), not only the current page
  const applySearch = useCallback(() => {
    setCurrentPage(1)
    setSearchTerm(searchDraft)
    fetchContracts(1, searchDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  // Column header filters apply only when user presses Enter inside the filter popover.
  
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
      fetchContracts(newPage)
      // Scroll to top when page changes
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedContractIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const collapseAll = () => setExpandedContractIds(new Set())

  const columnStorageKey = isContractPerformance
    ? 'contract-performance.compact.visibleColumns.v10'
    : 'contracts.compact.visibleColumns.v8'
  const columnOrderStorageKey = isContractPerformance
    ? 'contract-performance.compact.columnOrder.v7'
    : 'contracts.compact.columnOrder.v9'
  // v4: default column order puts Contract Date first (ignore stale v3 saved order).
  // Bumped so saved "created_at" default does not fight API order (newest contract_date first).
  const sortStorageKey = isContractPerformance ? 'contract-performance.compact.sort' : 'contracts.compact.sort.v2'

  const fetchContracts = async (page: number = currentPage, searchOverride?: string, sortKeyOverride?: string, sortDirOverride?: 'asc' | 'desc') => {
    try {
      if (!authReady) return
      setLoading(true)
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', contractsPerPage.toString())
      const searchTrim = (searchOverride ?? searchTerm).trim()
      if (searchTrim.length >= 2) {
        params.append('search', searchTrim)
      }
      const mergedColumnFilters: Record<string, any> = { ...columnFilters }
      if (isContractPerformance) {
        if (selectedIncoterms.length > 0) {
          const includeBlank = selectedIncoterms.includes('Blank')
          const values = selectedIncoterms.filter((v) => v !== 'Blank')
          mergedColumnFilters.incoterm = { type: 'multi', values, includeBlank }
        }
      }
      const cfKeys = Object.keys(mergedColumnFilters)
      if (cfKeys.length > 0) {
        params.append('columnFilters', JSON.stringify(mergedColumnFilters))
      }

      // Status: only send when a specific value is chosen. "All Status" omits the param so counts and list include every status.
      if (statusFilter && statusFilter !== 'All Status') {
        params.append('status', statusFilter)
      }
      if (!isContractPerformance) {
        if (b2bFlagFilter && b2bFlagFilter !== 'ALL') {
          params.append('b2bFlag', b2bFlagFilter)
        }
        if (productFilter && productFilter !== 'ALL') {
          params.append('product', productFilter)
        }
        if (transportModeFilter && transportModeFilter !== 'ALL') {
          params.append('transportMode', transportModeFilter)
        }
      } else {
        if (perfTransportMode !== 'ALL') {
          params.append('transportMode', perfTransportMode)
        }
      }
      if (dateFrom) {
        params.append('dateFrom', dateFrom)
      }
      if (dateTo) {
        params.append('dateTo', dateTo)
      }
      
      // Check for outstanding parameter from URL
      const outstandingParam = searchParams.get('outstanding')
      if (outstandingParam === 'true') {
        params.append('outstanding', 'true')
      }
      if (unassignedFilter) {
        params.append('unassigned', unassignedFilter)
      }
      if (isContractPerformance && selectedPlantSites.length > 0) {
        selectedPlantSites.forEach((p) => params.append('plant', p))
      }
      if (isContractPerformance && lateOnTimeFilter !== 'ALL') {
        params.append('lateOnTimeFilter', lateOnTimeFilter)
      }
      const activeSortCol = sortKeyOverride || sortKey
      const activeSortDir = sortDirOverride || sortDir
      const apiSortKey = resolveApiSortKey(activeSortCol)
      if (apiSortKey) {
        params.append('sortKey', apiSortKey)
        params.append('sortDir', activeSortDir)
      }

      const response = await api.get(`/contracts?${params.toString()}`)
      const loadedContracts: Contract[] = response.data?.data?.contracts || []
      console.log('Contracts loaded:', loadedContracts.length)
      console.log('Pagination:', response.data?.data?.pagination)
      // Debug: payment dates from API (in Network tab filter by "contracts" to see this request)
      const sample = loadedContracts.find(c => c.contract_id === '1004020799') || loadedContracts[0]
      if (sample) {
        console.log('Payment fields from API (sample):', {
          contract_id: sample.contract_id,
          due_date_payment: sample.due_date_payment,
          dp_date: sample.dp_date,
          payoff_date: sample.payoff_date,
          dp_date_deviation_days: sample.dp_date_deviation_days,
          payoff_date_deviation_days: sample.payoff_date_deviation_days,
        })
      }
      setContracts(loadedContracts)
      
      // Update pagination state
      if (response.data.data.pagination) {
        setTotalContracts(response.data.data.pagination.total)
        setTotalPages(response.data.data.pagination.totalPages)
        setCurrentPage(response.data.data.pagination.page)
      }
      
      // Extract unique B2B flags from contracts
      // Use fresh response data; state updates are async.
      const b2bFlags = [...new Set(loadedContracts.map(c => c.b2b_flag).filter((v): v is string => typeof v === 'string' && v.length > 0))].sort()
      if (b2bFlags.length > 0) setAvailableB2bFlags(prev => [...new Set([...prev, ...b2bFlags])].sort())
      const products = [...new Set(loadedContracts.map(c => c.product).filter((v): v is string => typeof v === 'string' && v.length > 0))].sort()
      if (products.length > 0) setAvailableProducts(prev => [...new Set([...prev, ...products])].sort())
    } catch (error) {
      console.error('Failed to fetch contracts:', error)
      const status = (error as any)?.response?.status
      // 401 is handled by axios interceptor (redirects to /login)
      if (status === 401 || status === 403) return
      alert('Failed to load contracts. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fetchLatePerformance = useCallback(async () => {
    if (!authReady || !isContractPerformance) return
    try {
      setLatePerfLoading(true)
      const params = new URLSearchParams()
      params.append('scope', 'ytd')
      params.append('_ts', String(Date.now()))

      if (transportModeFilter && transportModeFilter !== 'ALL') params.append('transportMode', transportModeFilter)
      if (productFilter && productFilter !== 'ALL') params.append('product', productFilter)
      if (b2bFlagFilter && b2bFlagFilter !== 'ALL') params.append('b2bFlag', b2bFlagFilter)

      const resp = await api.get(`/contracts/late-performance?${params.toString()}`)
      const data = resp.data?.data
      setLatePerformanceSummary(data?.summary ?? { count: 0, totalDays: 0, avgDays: 0, maxDays: 0, totalQtyDelivery: 0 })
      setLatePerformanceTree(Array.isArray(data?.tree) ? data.tree : [])
      setOnTrackPerformanceSummary(data?.onTrackSummary ?? { count: 0, totalDays: 0, avgDays: 0, maxDays: 0, totalQtyDelivery: 0 })
      setOnTrackPerformanceTree(Array.isArray(data?.onTrackTree) ? data.onTrackTree : [])
      setTradeCycleDist(data?.distribution ?? null)
    } catch (e) {
      console.error('Failed to load late performance dashboard:', e)
      setLatePerformanceSummary({ count: 0, totalDays: 0, avgDays: 0, maxDays: 0 })
      setLatePerformanceTree([])
      setOnTrackPerformanceSummary({ count: 0, totalDays: 0, avgDays: 0, maxDays: 0 })
      setOnTrackPerformanceTree([])
      setTradeCycleDist(null)
    } finally {
      setLatePerfLoading(false)
    }
  }, [
    authReady,
    isContractPerformance,
    transportModeFilter,
    productFilter,
    b2bFlagFilter,
  ])

  useEffect(() => {
    void fetchLatePerformance()
  }, [fetchLatePerformance])

  const applyLatePerformanceFocus = useCallback(
    (incotermKey: string, productKey: string, plantKey: string, supplierKey?: string) => {
      if (!isContractPerformance) return

      setLateOnTimeFilter(perfDashMode === 'ontrack' ? 'ON_TIME' : 'LATE')
      setPerfTransportMode('ALL')

      setSelectedIncoterms([incotermKey])
      setSelectedPlantSites([plantKey])

      setColumnFilters((prev) => ({
        ...prev,
        product: { type: 'text', value: productKey === 'Blank' ? '' : productKey, exact: true },
        ...(supplierKey && supplierKey !== 'Blank'
          ? { supplier: { type: 'text', value: supplierKey, exact: true } }
          : {}),
      }))

      setCurrentPage(1)
      collapseAll()
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [collapseAll, isContractPerformance],
  )
  
  // Fetch filter options on mount
  useEffect(() => {
    if (!authReady) return
    const fetchFilterOptions = async () => {
      try {
        // Fetch all contracts to get unique values (with a higher limit)
        const response = await api.get('/contracts?limit=10000')
        const allContracts: Contract[] = response.data.data.contracts || []
        
        const b2bFlags = [...new Set(allContracts.map((c) => c.b2b_flag).filter((v): v is string => typeof v === 'string' && v.length > 0))].sort()
        setAvailableB2bFlags(b2bFlags)
      } catch (error) {
        console.error('Failed to fetch filter options:', error)
      }
    }
    fetchFilterOptions()
  }, [authReady])

  // Contract Performance: filter options (Incoterm + Plant/Site) use the same sources as Dashboard
  useEffect(() => {
    if (!authReady || !isContractPerformance) return
    let cancelled = false
    Promise.all([
      api.get('/contracts/filter-options/incoterms'),
      api.get('/dashboard/filter-options/plants'),
    ])
      .then(([incRes, plantRes]) => {
        if (cancelled) return
        const incs = (incRes.data?.data?.incoterms || []) as string[]
        // Dashboard API returns { data: string[] } (array of plant names), not data.plants
        const plantPayload = plantRes.data?.data
        const plants = (Array.isArray(plantPayload)
          ? plantPayload
          : plantPayload && typeof plantPayload === 'object' && 'plants' in plantPayload
            ? (plantPayload as { plants?: string[] }).plants
            : []) as string[]
        setAvailableIncoterms(Array.isArray(incs) ? incs : [])
        setAvailablePlantSites(Array.isArray(plants) ? plants : [])
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Failed to fetch Contract Performance filter options:', e)
        setAvailableIncoterms([])
        setAvailablePlantSites([])
      })
    return () => {
      cancelled = true
    }
  }, [authReady, isContractPerformance])

  // Dashboard cards: SEA without shipments, LAND without trucking — reflect active filters
  const fetchUnassignedCounts = useCallback(async () => {
    if (!authReady) return
    try {
      const params = new URLSearchParams()
      if (searchTerm.trim().length >= 2) params.append('search', searchTerm.trim())
      if (b2bFlagFilter && b2bFlagFilter !== 'ALL') params.append('b2bFlag', b2bFlagFilter)
      if (productFilter && productFilter !== 'ALL') params.append('product', productFilter)
      if (transportModeFilter && transportModeFilter !== 'ALL') params.append('transportMode', transportModeFilter)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (statusFilter && statusFilter !== 'All Status') {
        params.append('status', statusFilter)
      }
      const res = await api.get<{
        success: boolean
        data: { seaWithoutShipments: number; landWithoutTrucking: number; mixWithoutLogistics: number }
      }>(`/contracts/unassigned-counts?${params.toString()}`)
      if (res.data?.success && res.data?.data) {
        setUnassignedSeaContracts(res.data.data.seaWithoutShipments ?? 0)
        setUnassignedLandContracts(res.data.data.landWithoutTrucking ?? 0)
        setUnassignedMixContracts(res.data.data.mixWithoutLogistics ?? 0)
      }
    } catch (err) {
      console.error('Failed to fetch unassigned counts:', err)
    }
  }, [
    authReady,
    searchTerm,
    b2bFlagFilter,
    productFilter,
    transportModeFilter,
    dateFrom,
    dateTo,
    statusFilter,
  ])

  useEffect(() => {
    fetchUnassignedCounts()
  }, [fetchUnassignedCounts])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Close':
      case 'CLOSE':
      case 'Completed':
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800'
      case 'Open':
      case 'OPEN':
      case 'ACTIVE': // backward compatibility
        return 'bg-green-100 text-green-800'
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800'
      case 'Cancelled':
      case 'CANCELLED':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }
  const countGt0 = (v: unknown) => {
    const n = typeof v === 'string' ? parseFloat(v) : Number(v)
    return Number.isFinite(n) && n > 0
  }

  const getShippingIconColor = (c: Contract) => {
    const hasShipping =
      countGt0(c.shipment_count) || countGt0(c.sto_count)
    if (!hasShipping) return 'text-gray-400'
    const statusRaw = getContractStatusRaw(c)
    const isCompleted = ['COMPLETED', 'CLOSE', 'CLOSED'].includes(statusRaw)
    return isCompleted ? 'text-blue-600' : 'text-green-600'
  }
  const getTruckingIconColor = (c: Contract) => {
    const hasTrucking = countGt0(c.trucking_count)
    if (!hasTrucking) return 'text-gray-400'
    const statusRaw = getContractStatusRaw(c)
    const isCompleted = ['COMPLETED', 'CLOSE', 'CLOSED'].includes(statusRaw)
    return isCompleted ? 'text-blue-600' : 'text-green-600'
  }

  const transportIsLand = (c: Contract) => String(c.transport_mode || '').toUpperCase() === 'LAND'
  const transportIsSea = (c: Contract) => String(c.transport_mode || '').toUpperCase() === 'SEA'
  const transportIsMix = (c: Contract) => String(c.transport_mode || '').toUpperCase() === 'MIX'

  const showUrgentFlag = (c: Contract): boolean => {
    if (!c.delivery_start_date) return false
    const daysUntilDelivery = Math.floor(
      (new Date(c.delivery_start_date).getTime() - Date.now()) / 86400000
    )
    if (daysUntilDelivery > 14) return false
    const noShipment = !countGt0(c.shipment_count) && !countGt0(c.sto_count)
    const noTrucking = !countGt0(c.trucking_count)
    if (transportIsSea(c)) return noShipment
    if (transportIsLand(c)) return noTrucking
    if (transportIsMix(c)) return noShipment || noTrucking
    return noShipment && noTrucking
  }

  const handleTruckIconClick = (contract: Contract) => {
    const hasTrucking = countGt0(contract.trucking_count)
    if (!hasTrucking) {
      if (!transportIsLand(contract) && !transportIsMix(contract)) {
        alert(
          'Trucking operations apply to LAND contracts only. Open the Trucking page from the menu if you need to work across transport modes.',
        )
        return
      }
      setContractLogisticsUi({ kind: 'truck-create', contract })
      return
    }
    setContractLogisticsUi({ kind: 'truck-detail', contractId: contract.contract_id })
  }

  const handleShipIconClick = (contract: Contract) => {
    const hasShipping = countGt0(contract.shipment_count) || countGt0(contract.sto_count)
    if (!hasShipping) {
      if (!transportIsSea(contract) && !transportIsMix(contract)) {
        alert(
          'Shipments apply to SEA contracts only. Open the Shipments page from the menu if you need to work across transport modes.',
        )
        return
      }
      setContractLogisticsUi({ kind: 'ship-create', contractId: contract.contract_id })
      return
    }
    setContractLogisticsUi({ kind: 'ship-detail', contractId: contract.contract_id })
  }

  const formatDate = (dateStr: string) => formatDateDMY(dateStr)

  const formatNumber = (num: number | string) => {
    if (num === null || num === undefined || num === '') return '-'
    const number = typeof num === 'string' ? parseFloat(num) : num
    if (isNaN(number)) return '-'
    if (number === 0) return '0'
    return number.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 2,
      useGrouping: true
    })
  }

  const formatCurrency = (amount: number | string, currency: string = 'USD') => {
    if (amount === null || amount === undefined || amount === '') return '-'
    const number = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(number)) return '-'
    // Display as Rupiah everywhere in UI
    return formatRupiah(number)
  }

  const formatShortDate = (dateStr: string) => formatDateDMY(dateStr)

  const formatMonthDeliveryEnd = useCallback((dateStr: string) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return '-'
    const mon = d.toLocaleString('en-US', { month: 'short' })
    return `${mon}-${d.getFullYear()}`
  }, [])

  const getContractStatusRaw = (c: Contract) => {
    return (c.import_status || c.status || '').toUpperCase()
  }

  const getContractAgingDays = (c: Contract): number | null => {
    if (!c.delivery_end_date) return null
    const statusRaw = getContractStatusRaw(c)
    // Do not age closed/completed contracts
    if (['CLOSE', 'CLOSED', 'COMPLETED'].includes(statusRaw)) return null
    const end = new Date(c.delivery_end_date)
    if (Number.isNaN(end.getTime())) return null
    const today = new Date()
    const diffMs = today.getTime() - end.getTime()
    return Math.floor(diffMs / (1000 * 60 * 60 * 24))
  }

  const getContractAgingInfo = (c: Contract) => {
    const days = getContractAgingDays(c)
    if (days === null) return null
    return {
      days,
      isOverdue: days >= 0,
    }
  }

  const handleFilterChange = () => {
    setCurrentPage(1)
    // Single Apply: apply date range + current search draft together
    setSearchTerm(searchDraft)
    fetchContracts(1, searchDraft)
  }

  const handleUploadFileChange = async (contract: Contract, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Validate type
    const allowed = ['application/pdf', 'image/png', 'image/jpeg']
    if (!allowed.includes(file.type)) {
      alert('Only PDF, PNG, or JPEG files are allowed.')
      e.target.value = ''
      return
    }

    setUploadingId(contract.id)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', 'OTHER')
      form.append('contract_id', contract.id)

      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.data?.success) {
        alert('Document uploaded successfully!')
        // If the uploaded doc is for the currently opened contract, refresh docs list
        if (selectedContract && selectedContract.id === contract.id) {
          await fetchContractDocuments(contract.id)
        }
        if (docsModalContract && docsModalContract.id === contract.id) {
          await fetchDocumentsForModal(contract.id)
        }
      } else {
        alert(res.data?.error?.message || 'Failed to upload document')
      }
    } catch (err) {
      console.error('Upload document error:', err)
      alert('Failed to upload document. Please try again.')
    } finally {
      setUploadingId('')
      e.target.value = ''
    }
  }

  const handleUpdateContractField = async (contract: Contract, field: keyof Contract, value: string) => {
    try {
      setUpdatingContractId(contract.id)
      const payload: any = {}
      if (field === 'cargo_readiness_date') {
        payload.cargo_readiness_date = value || null
      } else {
        payload[field] = value
      }
      const res = await api.put(`/contracts/${contract.id}`, payload)
      if (res.data?.success && res.data.data) {
        setContracts(prev =>
          prev.map(c => (c.id === contract.id ? { ...c, ...res.data.data } : c))
        )
      }
    } catch (error) {
      console.error('Failed to update contract field', error)
      alert('Failed to update contract. Please try again.')
    } finally {
      setUpdatingContractId(null)
    }
  }

  const downloadCargoReadinessTemplate = () => {
    const rows = [
      'po_number,cargo_readiness_date',
      '# Example: 1001000001,05/15/2026',
      '# cargo_readiness_date format: MM/DD/YYYY (leave blank to clear)',
    ]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cargo_readiness_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCargoReadinessUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvCargoUploading(true)
    setCsvCargoResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/contracts/bulk-cargo-readiness', fd)
      setCsvCargoResult(res.data.data)
    } catch {
      alert('Upload failed. Please try again.')
    } finally {
      setCsvCargoUploading(false)
      e.target.value = ''
    }
  }

  const fetchDocumentsByContractId = async (contractInternalId: string): Promise<DocumentItem[]> => {
    const params = new URLSearchParams()
    params.append('contractId', contractInternalId)
    const res = await api.get(`/documents?${params.toString()}`)
    return res.data?.data || []
  }

  const fetchContractDocuments = async (contractInternalId: string) => {
    try {
      setDocsLoading(true)
      const docs = await fetchDocumentsByContractId(contractInternalId)
      setSelectedContractDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setSelectedContractDocs([])
    } finally {
      setDocsLoading(false)
    }
  }

  const fetchDocumentsForModal = async (contractInternalId: string) => {
    try {
      setDocsModalLoading(true)
      const docs = await fetchDocumentsByContractId(contractInternalId)
      setDocsModalDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setDocsModalDocs([])
    } finally {
      setDocsModalLoading(false)
    }
  }

  const openContractDocsModal = (contract: Contract) => {
    setDocsModalContract(contract)
    void fetchDocumentsForModal(contract.id)
  }

  const closeContractDocsModal = () => {
    setDocsModalContract(null)
    setDocsModalDocs([])
  }

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${docId}/download`, {
        responseType: 'blob'
      })
      
      // Create a blob URL and trigger download
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download document error:', err)
      alert('Failed to download document. Please try again.')
    }
  }

  useEffect(() => {
    if (selectedContract) {
      fetchContractDocuments(selectedContract.id)
    } else {
      setSelectedContractDocs([])
    }
  }, [selectedContract])

  useEffect(() => {
    if (!selectedContract?.id) {
      setStoInfo([])
      return
    }
    let cancelled = false
    setStoInfoLoading(true)
    setStoInfo([])
    api.get(`/contracts/${selectedContract.id}/sto-information`)
      .then((res) => {
        if (cancelled || !res.data?.data?.stos) return
        setStoInfo(res.data.data.stos)
      })
      .catch(() => {
        if (!cancelled) setStoInfo([])
      })
      .finally(() => {
        if (!cancelled) setStoInfoLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedContract?.id])

  useEffect(() => {
    if (!selectedContract?.contract_id) {
      setContractPayments([])
      return
    }
    let cancelled = false
    setContractPaymentsLoading(true)
    api.get('/finance/payments', { params: { contract_id: selectedContract.contract_id } })
      .then((res) => {
        if (cancelled) return
        const list = res.data?.data ?? []
        setContractPayments(Array.isArray(list) ? list : [])
      })
      .catch(() => { if (!cancelled) setContractPayments([]) })
      .finally(() => { if (!cancelled) setContractPaymentsLoading(false) })
    return () => { cancelled = true }
  }, [selectedContract?.contract_id])

  useEffect(() => {
    if (!selectedContract?.id) {
      setActivityLog([])
      return
    }
    let cancelled = false
    setActivityLogLoading(true)
    api.get(`/contracts/${selectedContract.id}/activity-log`)
      .then((res) => {
        if (cancelled) return
        setActivityLog(Array.isArray(res.data?.data) ? res.data.data : [])
      })
      .catch(() => { if (!cancelled) setActivityLog([]) })
      .finally(() => { if (!cancelled) setActivityLogLoading(false) })
    return () => { cancelled = true }
  }, [selectedContract?.id])

  useEffect(() => {
    if (!selectedContract?.id) {
      setContractRemarks([])
      setNewRemarkText('')
      return
    }
    let cancelled = false
    setContractRemarksLoading(true)
    api.get(`/contracts/${selectedContract.id}/remarks`)
      .then((res) => {
        if (cancelled) return
        setContractRemarks(Array.isArray(res.data?.data) ? res.data.data : [])
      })
      .catch(() => { if (!cancelled) setContractRemarks([]) })
      .finally(() => { if (!cancelled) setContractRemarksLoading(false) })
    return () => { cancelled = true }
  }, [selectedContract?.id])

  const saveNewRemark = useCallback(async () => {
    if (!selectedContract?.id) return
    const text = newRemarkText.trim()
    if (!text) return
    setNewRemarkSaving(true)
    try {
      await api.post(`/contracts/${selectedContract.id}/remarks`, { text })
      setNewRemarkText('')
      const res = await api.get(`/contracts/${selectedContract.id}/remarks`)
      setContractRemarks(Array.isArray(res.data?.data) ? res.data.data : [])
    } finally {
      setNewRemarkSaving(false)
    }
  }, [newRemarkText, selectedContract?.id])

  // B2B Parties (child contracts linked by Contract Reff PO Ini)
  useEffect(() => {
    if (!selectedContract?.id) {
      setB2bParties([])
      return
    }
    const isOriginB2b =
      isContractB2b(selectedContract) &&
      String(selectedContract.contract_reference_po || '').trim() === ''

    if (!isOriginB2b) {
      setB2bParties([])
      return
    }

    let cancelled = false
    setB2bPartiesLoading(true)
    api.get(`/contracts/${selectedContract.id}/b2b-parties`)
      .then((res) => {
        if (cancelled) return
        setB2bParties(Array.isArray(res.data?.data) ? res.data.data : [])
      })
      .catch(() => { if (!cancelled) setB2bParties([]) })
      .finally(() => { if (!cancelled) setB2bPartiesLoading(false) })
    return () => { cancelled = true }
  }, [selectedContract?.id, selectedContract?.contract_type, selectedContract?.b2b_flag, selectedContract?.contract_reference_po])

  const openStoDetail = useCallback((row: StoInfoRow) => {
    if (!selectedContract?.contract_id) return
    setStoDetailRow(row)
    setStoDetailData(null)
    setStoDetailLoading(true)
    if (row.type === 'shipment') {
      api.get('/shipments', { params: { sto: row.sto_number, contract: selectedContract.contract_id, limit: 1 } })
        .then((res) => {
          const list = res.data?.data?.shipments ?? res.data?.shipments ?? []
          setStoDetailData(Array.isArray(list) && list.length > 0 ? list[0] : null)
        })
        .catch(() => setStoDetailData(null))
        .finally(() => setStoDetailLoading(false))
    } else {
      api.get('/trucking', { params: { contract: selectedContract.contract_id, limit: 200 } })
        .then((res) => {
          const list =
            res.data?.data?.truckingOperations ??
            res.data?.data?.operations ??
            res.data?.truckingOperations ??
            res.data?.operations ??
            []
          const op = Array.isArray(list) && row.operation_id
            ? list.find((o: any) => String(o.operation_id || '') === String(row.operation_id))
            : (Array.isArray(list) && list.length > 0 ? list[0] : null)
          setStoDetailData(op ?? null)
        })
        .catch(() => setStoDetailData(null))
        .finally(() => setStoDetailLoading(false))
    }
  }, [selectedContract?.contract_id])

  const closeStoDetail = useCallback(() => {
    setStoDetailRow(null)
    setStoDetailData(null)
    setStoDetailLoading(false)
  }, [])

  const getFilterTypeForColumn = (colId: string): ColumnFilter['type'] => {
    if (colId === 'contract_qty' || colId === 'outstanding_qty' || colId === 'contract_aging' || colId === 'received_qty' || colId === 'outstanding_qty_mt') return 'number'
    if (colId === 'contract_date' || colId === 'delivery_start' || colId === 'delivery_end' || colId === 'created_at') return 'date'
    if (colId === 'product' || colId === 'status' || colId === 'company_name' || colId === 'lt_spot' || colId === 'group_name' || colId === 'supplier') return 'multi'
    if (colId === 'month_delivery_end') return 'text'
    return 'text'
  }

  const getColumnRawValue = (c: Contract, colId: string): string | number | null => {
    switch (colId) {
      case 'contract_id':
        return c.contract_id || ''
      case 'group_name':
        return c.group_name || ''
      case 'supplier':
        return c.supplier || ''
      case 'product':
        return c.product || ''
      case 'status':
        return (c.import_status || c.status || '')
      case 'contract_date':
        return c.contract_date || ''
      case 'company_name':
        return c.company_name || ''
      case 'lt_spot':
        return c.lt_spot || ''
      case 'po_number':
        return c.po_numbers || c.po_number || ''
      case 'sto_number':
        return c.sto_numbers || c.sto_number || ''
      case 'contract_aging': {
        const days = getContractAgingDays(c)
        return days === null ? null : days
      }
      case 'contract_qty':
        return typeof c.quantity_ordered === 'number' ? c.quantity_ordered : null
      case 'outstanding_qty':
        return typeof c.outstanding_quantity === 'number' ? c.outstanding_quantity : null
      case 'received_qty':
        return typeof c.quantity_receive === 'number' ? c.quantity_receive : null
      case 'outstanding_qty_mt':
        return typeof c.outstanding_quantity === 'number' ? c.outstanding_quantity : null
      case 'delivery_start':
        return c.delivery_start_date || ''
      case 'delivery_end':
        return c.delivery_end_date || ''
      case 'month_delivery_end':
        return formatMonthDeliveryEnd(c.delivery_end_date) || ''
      case 'created_at':
        return c.created_at || ''
      default:
        return (c as any)[colId] ?? ''
    }
  }

  const isEmptyValue = (v: unknown) => {
    if (v === null || v === undefined) return true
    const s = String(v).trim()
    return s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined'
  }

  const passesColumnFilters = (c: Contract, filters: Record<string, ColumnFilter>) => {
    for (const [colId, filter] of Object.entries(filters)) {
      const raw = getColumnRawValue(c, colId)
      if (filter.emptyOnly) {
        if (!isEmptyValue(raw)) return false
        continue
      }

      if (filter.type === 'text') {
        const needle = (filter.value || '').trim().toLowerCase()
        if (!needle) continue
        const hay = String(raw ?? '').toLowerCase()
        if (filter.exact) {
          if (hay.trim() !== needle) return false
        } else {
          if (!hay.includes(needle)) return false
        }
      }

      if (filter.type === 'number') {
        const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, ''))
        if (Number.isNaN(n)) return false
        const min = filter.min !== undefined && filter.min !== '' ? Number(filter.min) : null
        const max = filter.max !== undefined && filter.max !== '' ? Number(filter.max) : null
        if (min !== null && !Number.isNaN(min) && n < min) return false
        if (max !== null && !Number.isNaN(max) && n > max) return false
      }

      if (filter.type === 'date') {
        const rawStr = String(raw ?? '').trim()
        if (!rawStr) return false
        const rawTime = Date.parse(rawStr)
        if (Number.isNaN(rawTime)) return false
        const fromTime = filter.from ? Date.parse(filter.from) : null
        const toTime = filter.to ? Date.parse(filter.to) : null
        if (fromTime !== null && !Number.isNaN(fromTime) && rawTime < fromTime) return false
        if (toTime !== null && !Number.isNaN(toTime) && rawTime > toTime + 24 * 60 * 60 * 1000 - 1) return false
      }

      if (filter.type === 'multi') {
        const rawValue = getColumnRawValue(c, colId)
        const isBlank = isEmptyValue(rawValue)
        const selectedValues = filter.values || []
        const includeBlank = Boolean(filter.includeBlank)

        if (isBlank) {
          if (!includeBlank) return false
          continue
        }

        const normalized = String(rawValue ?? '').trim()
        if (selectedValues.length > 0 && !selectedValues.includes(normalized)) {
          return false
        }
      }
    }
    return true
  }

  // Search + most column filters run on the server; only computed UI columns filter here
  const filteredContracts = useMemo(() => {
    return contracts.filter((contract) => passesColumnFilters(contract, clientOnlyColumnFilters))
  }, [contracts, clientOnlyColumnFilters])

  type CompactColumn = {
    id: string
    label: string
    /** Shown on column header hover — how the value is calculated */
    formulaHelp?: string
    defaultVisible: boolean
    sortable?: boolean
    getSortValue?: (c: Contract) => string | number
    render: (c: Contract) => React.ReactNode
    className?: string
    headerClassName?: string
  }

  const compactColumns: CompactColumn[] = useMemo(() => {
    const poNumberColumn: CompactColumn = {
      id: 'po_number',
      label: 'PO Number',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.po_numbers || c.po_number || '',
      render: (c) => (
        <span className="text-sm truncate block" title={c.po_numbers || c.po_number || ''}>
          {c.po_numbers || c.po_number || '-'}
        </span>
      ),
    }
    return [
    {
      id: 'contract_date',
      label: 'Contract Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c: Contract) => c.contract_date || '',
      render: (c: Contract) => <span className="text-sm">{formatShortDate(c.contract_date)}</span>
    },
    ...([
          {
            id: 'contract_id',
            label: 'Contract',
            defaultVisible: true,
            sortable: true,
            formulaHelp: isContractPerformance ? undefined : FIELD_HELP.contractUrgentFlag,
            getSortValue: (c: Contract) => c.contract_id || '',
            render: (c: Contract) => (
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-sm truncate">{c.contract_id}</span>
                {showUrgentFlag(c) && !isContractPerformance && (
                  <span title="Urgent: delivery window ≤14 days and missing shipment/STO or trucking per transport mode (see column help)" className="shrink-0 inline-flex">
                    <Flag className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                  </span>
                )}
              </div>
            ),
          },
          poNumberColumn,
        ] as CompactColumn[]),
    {
      id: 'contract_aging',
      label: 'Contract Aging',
      formulaHelp: FIELD_HELP.contractAging,
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => getContractAgingDays(c) ?? 0,
      render: (c) => {
        const info = getContractAgingInfo(c)
        if (!info) {
          return <span className="text-xs text-gray-500">-</span>
        }
        const absDays = Math.abs(info.days)
        const daysLabel = `${absDays} day${absDays === 1 ? '' : 's'}`
        const text =
          info.days === 0
            ? 'Due today'
            : info.isOverdue
              ? `${daysLabel} overdue`
              : `${daysLabel} left`
        return (
          <span
            className={`text-xs font-semibold ${
              info.isOverdue ? 'text-red-600' : 'text-green-600'
            }`}
          >
            {text}
          </span>
        )
      },
      className: 'whitespace-nowrap'
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.contract_ext_no || '',
      render: (c) => (
        <span className="text-sm break-words whitespace-normal" title={c.contract_ext_no || ''}>
          {c.contract_ext_no || '-'}
        </span>
      )
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.product || '',
      render: (c) => <span className="text-sm truncate">{c.product || '-'}</span>
    },
    {
      id: 'delivery_status',
      label: 'Delivery Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => (c.import_status || c.status || ''),
      render: (c) => (
        <Badge className={getStatusColor(c.import_status || c.status)}>
          {c.import_status || c.status}
        </Badge>
      )
    },
    {
      id: 'status_overall',
      label: 'Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => {
        const delivery = String(c.import_status || c.status || '').toUpperCase()
        const paid = String(c.payment_status || '').toUpperCase() === 'PAID'
        return delivery === 'CLOSE' && paid ? 'Close' : (c.import_status || c.status || '')
      },
      render: (c) => {
        const delivery = String(c.import_status || c.status || '').toUpperCase()
        const paid = String(c.payment_status || '').toUpperCase() === 'PAID'
        const overall = delivery === 'CLOSE' && paid ? 'Close' : (c.import_status || c.status || '-')
        return <span className="text-sm font-medium">{overall}</span>
      }
    },
    {
      id: 'unusual_status',
      label: 'Unusual Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => {
        const isUnusual =
          (c.log_cycle_days != null && c.log_cycle_days >= 35) ||
          (c.trade_cycle_days != null && c.trade_cycle_days >= 35) ||
          (c.cash_cycle_days != null && c.cash_cycle_days >= 35)
        return isUnusual ? 1 : 0
      },
      render: (c) => {
        const isUnusual =
          (c.log_cycle_days != null && c.log_cycle_days >= 35) ||
          (c.trade_cycle_days != null && c.trade_cycle_days >= 35) ||
          (c.cash_cycle_days != null && c.cash_cycle_days >= 35)
        return isUnusual ? (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Unusual</Badge>
        ) : (
          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">Normal</Badge>
        )
      },
      className: 'whitespace-nowrap'
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty (MT)',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => typeof c.quantity_ordered === 'number' ? c.quantity_ordered : 0,
      render: (c) => (
        <span className="text-sm truncate">
          {((Number(c.quantity_ordered) || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT
        </span>
      )
    },
    {
      id: 'received_qty',
      label: 'Received Qty (MT)',
      formulaHelp: FIELD_HELP.receivedQty,
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => typeof c.quantity_receive === 'number' ? c.quantity_receive : 0,
      render: (c) => (
        <span className="text-sm truncate">
          {((Number(c.quantity_receive) || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT
        </span>
      )
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c: Contract) => c.group_name || '',
      render: (c: Contract) => <span className="text-sm truncate block">{c.group_name || '-'}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.supplier || '',
      render: (c) => <span className="text-sm">{c.supplier || '-'}</span>,
    },
    {
      id: 'outstanding_qty_mt',
      label: 'Outstanding Qty (MT)',
      formulaHelp: FIELD_HELP.outstandingQtyMt,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => typeof c.outstanding_quantity === 'number' ? c.outstanding_quantity : 0,
      render: (c) => (
        <span className={`text-sm truncate ${c.outstanding_quantity < 0 ? 'text-red-600' : ''}`}>
          {((Number(c.outstanding_quantity) || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT
        </span>
      )
    },
    {
      id: 'trade_cycle_days',
      label: 'Trade Cycle',
      formulaHelp: FIELD_HELP.tradeCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.trade_cycle_days ?? 0,
      render: (c) => {
        if (c.trade_cycle_days == null) return <span className="text-xs">-</span>
        const abs = Math.abs(c.trade_cycle_days)
        const unit = abs === 1 ? 'day' : 'days'
        const isOver = c.trade_cycle_days > 0
        const isZero = c.trade_cycle_days === 0
        return (
          <span className={`text-xs font-semibold ${isZero ? 'text-gray-500' : isOver ? 'text-red-600' : 'text-green-600'}`}>
            {isZero ? '0 days' : isOver ? `${abs} ${unit} overdue` : `${abs} ${unit} left`}
          </span>
        )
      },
      className: 'whitespace-nowrap'
    },
    {
      id: 'cash_cycle_days',
      label: 'Cash Cycle',
      formulaHelp: FIELD_HELP.cashCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.cash_cycle_days ?? 0,
      render: (c) => {
        if (c.cash_cycle_days == null) return <span className="text-xs">-</span>
        const abs = Math.abs(c.cash_cycle_days)
        const unit = abs === 1 ? 'day' : 'days'
        const isOver = c.cash_cycle_days > 0
        const isZero = c.cash_cycle_days === 0
        return (
          <span className={`text-xs font-semibold ${isZero ? 'text-gray-500' : isOver ? 'text-red-600' : 'text-green-600'}`}>
            {isZero ? '0 days' : isOver ? `${abs} ${unit} overdue` : `${abs} ${unit} left`}
          </span>
        )
      },
      className: 'whitespace-nowrap'
    },
    {
      id: 'log_cycle_days',
      label: 'Log Cycle',
      formulaHelp: FIELD_HELP.logCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.log_cycle_days ?? 0,
      render: (c) => (
        <span className="text-xs font-semibold">
          {c.log_cycle_days != null ? `${c.log_cycle_days} days` : '-'}
        </span>
      ),
      className: 'whitespace-nowrap'
    },
    {
      id: 'over_under_delivery_status',
      label: 'Over/Under Delivery Status',
      formulaHelp: FIELD_HELP.overUnderDelivery,
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.over_under_delivery_status || '',
      render: (c) => (
        <span className="text-xs font-semibold">
          {c.over_under_delivery_status || '-'}
        </span>
      ),
      className: 'whitespace-nowrap'
    },
    {
      id: 'company_name',
      label: 'Buyer',
      formulaHelp: FIELD_HELP.companyName,
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.company_name || '',
      render: (c) => <span className="text-sm truncate block">{c.company_name || '-'}</span>
    },
    {
      id: 'lt_spot',
      label: 'LT/SPOT',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.lt_spot || '',
      render: (c) => <span className="text-sm">{c.lt_spot || '-'}</span>
    },
    {
      id: 'sto_number',
      label: 'STO Number',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.sto_numbers || c.sto_number || '',
      render: (c) => (
        <span className="text-sm truncate block" title={c.sto_numbers || c.sto_number || ''}>
          {c.sto_numbers || c.sto_number || '-'}
        </span>
      )
    },
    {
      id: 'delivery_start',
      label: 'Due Date Delivery Start',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.delivery_start_date || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.delivery_start_date)}</span>
    },
    {
      id: 'delivery_end',
      label: 'Due Date Delivery End',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.delivery_end_date || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.delivery_end_date)}</span>
    },
    ...(isContractPerformance
      ? ([
          {
            id: 'month_delivery_end',
            label: 'Month Delivery End',
            defaultVisible: false,
            sortable: true,
            getSortValue: (c: Contract) => (c.delivery_end_date ? String(c.delivery_end_date).slice(0, 7) : ''),
            render: (c: Contract) => <span className="text-sm">{formatMonthDeliveryEnd(c.delivery_end_date)}</span>,
            className: 'whitespace-nowrap',
          },
        ] as CompactColumn[])
      : []),
    {
      id: 'cargo_readiness_date',
      label: 'Cargo Readiness Date',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.cargo_readiness_date || '',
      render: (c) => {
        const saving = updatingContractId === c.id
        const value = c.cargo_readiness_date ? String(c.cargo_readiness_date).substring(0, 10) : ''
        return (
          <div className="flex items-center gap-1 w-full">
            <input
              type="date"
              className="text-sm border rounded px-1 py-0.5 flex-1 min-w-[130px]"
              value={value}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.value
                setContracts(prev =>
                  prev.map(row => (row.id === c.id ? { ...row, cargo_readiness_date: next } : row))
                )
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              className="px-2 py-0 h-7 text-xs shrink-0"
              onClick={() => handleUpdateContractField(c, 'cargo_readiness_date', value)}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )
      }
    },
    {
      id: 'created_at',
      label: 'Created',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.created_at || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.created_at)}</span>
    },
    ]
  }, [getStatusColor, isContractPerformance, formatMonthDeliveryEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Same arrays as {@link defaultCompactVisibleColumnIds}; kept for reset + deps.
   */
  const defaultVisibleColumnIds = useMemo(
    () => defaultCompactVisibleColumnIds(isContractPerformance),
    [isContractPerformance],
  )

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() =>
    new Set(defaultCompactVisibleColumnIds(pathname === '/contract-performance')),
  )
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(() => [])
  const [dragColId, setDragColId] = useState<string | null>(null)
  const userViewPrefKey = isContractPerformance ? 'contract_performance.compact.view.v6' : 'contracts.compact.view.v9'
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Reset visible columns + column order to app defaults, persist locally and on server (so async prefs cannot wipe it). */
  const resetCompactColumnView = useCallback(() => {
    const vis = new Set(defaultVisibleColumnIds)
    const order = compactColumnFallbackOrder(isContractPerformance, compactColumns.map((c) => c.id))
    setVisibleColumnIds(vis)
    setColumnOrderIds(order)
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(vis)))
        localStorage.setItem(columnOrderStorageKey, JSON.stringify(order))
      } catch {
        // ignore
      }
    }
    if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    void api
      .post('/user-preferences/me', {
        key: userViewPrefKey,
        value: { visibleColumnIds: Array.from(vis), columnOrderIds: order },
      })
      .catch(() => {
        /* localStorage already updated */
      })
  }, [
    columnOrderStorageKey,
    columnStorageKey,
    compactColumns,
    defaultVisibleColumnIds,
    isContractPerformance,
    userViewPrefKey,
  ])

  // Load persisted columns/sort (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hadSavedVisibleAtOpen = (() => {
      try {
        const raw = localStorage.getItem(columnStorageKey)
        if (!raw) return false
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) && parsed.length > 0
      } catch {
        return Boolean(localStorage.getItem(columnStorageKey))
      }
    })()
    const hadSavedOrderAtOpen = (() => {
      try {
        const raw = localStorage.getItem(columnOrderStorageKey)
        if (!raw) return false
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) && parsed.length > 0
      } catch {
        return Boolean(localStorage.getItem(columnOrderStorageKey))
      }
    })()
    try {
      const raw = localStorage.getItem(columnStorageKey)
      if (raw) {
        const ids = JSON.parse(raw) as string[]
        if (Array.isArray(ids) && ids.length > 0) setVisibleColumnIds(new Set(ids))
      }
      const rawOrder = localStorage.getItem(columnOrderStorageKey)
      if (rawOrder) {
        const ids = JSON.parse(rawOrder) as string[]
        if (Array.isArray(ids) && ids.length > 0) setColumnOrderIds(ids.map(String))
      }
      const rawSort = localStorage.getItem(sortStorageKey)
      if (rawSort) {
        const s = JSON.parse(rawSort) as { key?: string; dir?: 'asc' | 'desc' }
        if (s?.key) setSortKey(s.key)
        if (s?.dir) setSortDir(s.dir)
      } else if (isContractPerformance) {
        setSortKey('outstanding_qty_mt')
        setSortDir('desc')
      }
    } catch {
      // ignore
    }

    // Apply server view only if there was no saved column prefs before this load (local wins after first paint persist).
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(userViewPrefKey)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const cols = Array.isArray(value?.visibleColumnIds) ? value.visibleColumnIds : Array.isArray(value?.visible) ? value.visible : null
        const order = Array.isArray(value?.columnOrderIds) ? value.columnOrderIds : Array.isArray(value?.order) ? value.order : null
        if (Array.isArray(cols) && cols.length > 0 && !hadSavedVisibleAtOpen) {
          setVisibleColumnIds(new Set(cols.map((x: any) => String(x))))
        }
        if (Array.isArray(order) && order.length > 0 && !hadSavedOrderAtOpen) {
          setColumnOrderIds(order.map((x: any) => String(x)))
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist columns/sort
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(visibleColumnIds)))
      if (columnOrderIds.length > 0) localStorage.setItem(columnOrderStorageKey, JSON.stringify(columnOrderIds))
      localStorage.setItem(sortStorageKey, JSON.stringify({ key: sortKey, dir: sortDir }))
    } catch {
      // ignore
    }
  }, [columnOrderIds, columnStorageKey, columnOrderStorageKey, sortKey, sortDir, sortStorageKey, visibleColumnIds])

  // Persist per-user view (debounced, best-effort): visible columns + column order.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    saveViewTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: userViewPrefKey,
          value: { visibleColumnIds: Array.from(visibleColumnIds), columnOrderIds },
        })
        .catch(() => {
          /* keep localStorage fallback */
        })
    }, 600)
    return () => {
      if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    }
  }, [columnOrderIds, userViewPrefKey, visibleColumnIds])

  // (scroll width effect is defined after visibleColumns/sortedContracts)

  const visibleColumns = useMemo(() => {
    const byId = new Map(compactColumns.map((c) => [c.id, c] as const))
    const allIds = compactColumns.map((c) => c.id)
    const fallbackOrder = compactColumnFallbackOrder(isContractPerformance, allIds)
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : fallbackOrder).filter((id) => byId.has(id))
    const orderedAll = orderedIds.map((id) => byId.get(id)!).filter(Boolean)
    const visible = orderedAll.filter((c) => visibleColumnIds.has(c.id))
    // Ensure required columns are always visible (Contracts page only).
    // Always keep Contract column if toggled off by mistake; status is optional (default view does not include it).
    const mustHave = isContractPerformance ? [] : ['contract_id']
    const visibleIds = new Set(visible.map((c) => c.id))
    const missing = mustHave
      .map((id) => byId.get(id))
      .filter((c): c is CompactColumn => Boolean(c) && !visibleIds.has((c as CompactColumn).id))
    return [...visible, ...missing]
  }, [columnOrderIds, compactColumns, isContractPerformance, visibleColumnIds])

  const compactColumnIdsKey = useMemo(() => compactColumns.map((c) => c.id).join('|'), [compactColumns])

  useEffect(() => {
    // Initialize / heal column order with any missing ids.
    const allIds = compactColumns.map((c) => c.id)
    setColumnOrderIds((prev) => {
      const base = prev.length > 0 ? prev : compactColumnFallbackOrder(isContractPerformance, allIds)
      const deduped = Array.from(new Set(base))
      const missing = allIds.filter((id) => !deduped.includes(id))
      const next = [...deduped, ...missing].filter((id) => allIds.includes(id))
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactColumnIdsKey, isContractPerformance])

  const reorderColumnByDrag = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setColumnOrderIds((prev) => {
      const allIds = compactColumns.map((c) => c.id)
      const ids = prev.length > 0 ? [...prev] : compactColumnFallbackOrder(isContractPerformance, allIds)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(dropId)
      if (from < 0 || to < 0) return ids
      ids.splice(from, 1)
      ids.splice(to, 0, dragId)
      return ids
    })
  }

  const toggleColumn = (id: string) => {
    if (id === 'contract_id' || id === 'status') return
    setVisibleColumnIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        // Insert the newly-visible column right after the last currently-visible column in columnOrderIds
        setColumnOrderIds(order => {
          const base = order.length > 0 ? [...order] : compactColumns.map(c => c.id)
          const currentVisibleIds = new Set(prev) // prev = before adding id
          // Find the last position in base that is currently visible
          let insertAfter = -1
          for (let i = 0; i < base.length; i++) {
            if (currentVisibleIds.has(base[i])) insertAfter = i
          }
          // Remove id from its current position, then insert after insertAfter
          const without = base.filter(x => x !== id)
          const insertIdx = insertAfter < 0 ? 0 : without.findIndex(x => x === base[insertAfter]) + 1
          without.splice(insertIdx, 0, id)
          return without
        })
      }
      return next
    })
  }

  const onSortHeaderClick = (col: CompactColumn) => {
    if (!col.sortable) return
    const nextDir: 'asc' | 'desc' = sortKey === col.id ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortDir(nextDir)
    setSortKey(col.id)
    setCurrentPage(1)
  }

  const sortedContracts = useMemo(() => {
    const col = compactColumns.find((c) => c.id === sortKey)
    if (!col?.sortable || !col.getSortValue) return filteredContracts
    if (resolveApiSortKey(sortKey)) return filteredContracts
    const dirMul = sortDir === 'asc' ? 1 : -1
    const copy = [...filteredContracts]
    copy.sort((a, b) => {
      const av = col.getSortValue!(a)
      const bv = col.getSortValue!(b)
      return compareContractSortValues(av, bv, sortKey, dirMul)
    })
    return copy
  }, [compactColumns, filteredContracts, sortDir, sortKey])

  /** Grid column widths sized from header labels + longest cell text on the current page (fixed px tracks, no loose fr). */
  const compactGridColumnTracks = useMemo(() => {
    const fmtQtyMt = (kg: unknown) =>
      `${((Number(kg) || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT`

    const H = {
      contract_date: 'Contract Date',
      contract_id: 'Contract',
      supplier: 'Supplier',
      group_name: 'Group',
      contract_aging: 'Contract Aging',
      contract_ext_no: 'Contract Ext No',
      product: 'Product',
      delivery_status: 'Delivery Status',
      status_overall: 'Status',
      unusual_status: 'Unusual Status',
      log_cycle_days: 'Log Cycle',
      contract_qty: 'Contract Qty (MT)',
      received_qty: 'Received Qty (MT)',
      outstanding_qty: 'Outstanding Qty',
      outstanding_qty_mt: 'Outstanding Qty (MT)',
      trade_cycle_days: 'Trade Cycle',
      cash_cycle_days: 'Cash Cycle',
      over_under_delivery_status: 'Over/Under Delivery Status',
      company_name: 'Buyer',
      lt_spot: 'LT/SPOT',
      po_number: 'PO Number',
      sto_number: 'STO Number',
      delivery_start: 'Due Date Delivery Start',
      delivery_end: 'Due Date Delivery End',
      month_delivery_end: 'Month Delivery End',
      cargo_readiness_date: 'Cargo Readiness Date',
      created_at: 'Created',
      company_code: 'Co.',
      status: 'Status',
    }

    const track = (header: string, contentChars: number, minPx: number, maxPx: number, charPx = 7.2, pad = 52) => {
      const n = Math.max(header.length, contentChars)
      const px = Math.min(maxPx, Math.max(minPx, Math.round(n * charPx + pad)))
      return `minmax(${px}px, ${px}px)`
    }

    let contractIdLen = H.contract_id.length
    let contractDateLen = H.contract_date.length
    let supplierLen = H.supplier.length
    let groupLen = H.group_name.length
    let agingContentLen = H.contract_aging.length
    let extNoLen = H.contract_ext_no.length
    let productLen = H.product.length
    let deliveryStatusLen = H.delivery_status.length
    let statusOverallLen = H.status_overall.length
    let poLen = H.po_number.length
    let stoLen = H.sto_number.length
    let buyerLen = H.company_name.length
    let ltLen = H.lt_spot.length
    let qtyFmtLen = H.contract_qty.length
    let recvFmtLen = H.received_qty.length
    let outMtFmtLen = H.outstanding_qty_mt.length
    let outQtyFmtLen = H.outstanding_qty.length
    let tradeLen = H.trade_cycle_days.length
    let cashLen = H.cash_cycle_days.length
    let overUnderLen = H.over_under_delivery_status.length
    let logCycleLen = H.log_cycle_days.length
    let dsLen = H.delivery_start.length
    let deLen = H.delivery_end.length
    let monthEndLen = H.month_delivery_end.length
    let createdLen = H.created_at.length

    for (const c of sortedContracts) {
      contractIdLen = Math.max(contractIdLen, String(c.contract_id ?? '').length)
      contractDateLen = Math.max(contractDateLen, formatDateDMY(c.contract_date || '').length)
      supplierLen = Math.max(supplierLen, String(c.supplier ?? '').length)
      groupLen = Math.max(groupLen, String(c.group_name ?? '').length)
      extNoLen = Math.max(extNoLen, String(c.contract_ext_no ?? '').length)
      productLen = Math.max(productLen, String(c.product ?? '').length)
      deliveryStatusLen = Math.max(deliveryStatusLen, String(c.import_status || c.status || '').length)
      const delivery = String(c.import_status || c.status || '').toUpperCase()
      const paid = String(c.payment_status || '').toUpperCase() === 'PAID'
      const overall =
        delivery === 'CLOSE' && paid ? 'Close' : String(c.import_status || c.status || '-')
      statusOverallLen = Math.max(statusOverallLen, overall.length)
      poLen = Math.max(poLen, String(c.po_numbers || c.po_number || '').length)
      stoLen = Math.max(stoLen, String(c.sto_numbers || c.sto_number || '').length)
      buyerLen = Math.max(buyerLen, String(c.company_name ?? '').length)
      ltLen = Math.max(ltLen, String(c.lt_spot ?? '').length)
      qtyFmtLen = Math.max(qtyFmtLen, fmtQtyMt(typeof c.quantity_ordered === 'number' ? c.quantity_ordered : 0).length)
      recvFmtLen = Math.max(recvFmtLen, fmtQtyMt(typeof c.quantity_receive === 'number' ? c.quantity_receive : 0).length)
      const oq = typeof c.outstanding_quantity === 'number' ? c.outstanding_quantity : 0
      outMtFmtLen = Math.max(outMtFmtLen, fmtQtyMt(oq).length)
      outQtyFmtLen = Math.max(outQtyFmtLen, fmtQtyMt(oq).length)
      overUnderLen = Math.max(overUnderLen, String(c.over_under_delivery_status ?? '').length)

      const info = getContractAgingInfo(c)
      if (info) {
        const absDays = Math.abs(info.days)
        const daysLabel = `${absDays} day${absDays === 1 ? '' : 's'}`
        const text =
          info.days === 0 ? 'Due today' : info.isOverdue ? `${daysLabel} overdue` : `${daysLabel} left`
        agingContentLen = Math.max(agingContentLen, text.length)
      } else {
        agingContentLen = Math.max(agingContentLen, 1)
      }

      if (c.trade_cycle_days != null) {
        const abs = Math.abs(c.trade_cycle_days)
        const unit = abs === 1 ? 'day' : 'days'
        const isOver = c.trade_cycle_days > 0
        const isZero = c.trade_cycle_days === 0
        const t = isZero ? '0 days' : isOver ? `${abs} ${unit} overdue` : `${abs} ${unit} left`
        tradeLen = Math.max(tradeLen, t.length)
      }
      if (c.cash_cycle_days != null) {
        const abs = Math.abs(c.cash_cycle_days)
        const unit = abs === 1 ? 'day' : 'days'
        const isOver = c.cash_cycle_days > 0
        const isZero = c.cash_cycle_days === 0
        const t = isZero ? '0 days' : isOver ? `${abs} ${unit} overdue` : `${abs} ${unit} left`
        cashLen = Math.max(cashLen, t.length)
      }
      if (c.log_cycle_days != null) {
        logCycleLen = Math.max(logCycleLen, `${c.log_cycle_days} days`.length)
      }

      dsLen = Math.max(dsLen, formatDateDMY(c.delivery_start_date || '').length)
      deLen = Math.max(deLen, formatDateDMY(c.delivery_end_date || '').length)
      monthEndLen = Math.max(monthEndLen, formatMonthDeliveryEnd(c.delivery_end_date || '').length)
      createdLen = Math.max(createdLen, formatDateDMY(c.created_at || '').length)
    }

    const supplierTrack = track(H.supplier, supplierLen, 100, 360)
    const qtyTrack = (header: string, len: number, minPx: number, maxPx: number) =>
      track(header, len, minPx, maxPx, 7.5, 44)

    return {
      contract_id: track(H.contract_id, contractIdLen, 76, 280, 8, 52),
      contract_date: track(H.contract_date, contractDateLen, 96, 140),
      supplier: supplierTrack,
      group_name: track(H.group_name, groupLen, 96, 260),
      contract_aging: track(H.contract_aging, agingContentLen, 108, 180),
      contract_ext_no: track(H.contract_ext_no, extNoLen, 100, 320),
      product: track(H.product, productLen, 96, 280),
      delivery_status: track(H.delivery_status, deliveryStatusLen, 96, 200),
      status_overall: track(H.status_overall, statusOverallLen, 88, 180),
      unusual_status: track(H.unusual_status, 8, 96, 160),
      log_cycle_days: track(H.log_cycle_days, logCycleLen, 88, 160),
      contract_qty: qtyTrack(H.contract_qty, qtyFmtLen, 86, 200),
      received_qty: qtyTrack(H.received_qty, recvFmtLen, 96, 220),
      outstanding_qty: qtyTrack(H.outstanding_qty, outQtyFmtLen, 96, 220),
      outstanding_qty_mt: qtyTrack(H.outstanding_qty_mt, outMtFmtLen, 96, 240),
      trade_cycle_days: track(H.trade_cycle_days, tradeLen, 108, 220),
      cash_cycle_days: track(H.cash_cycle_days, cashLen, 108, 220),
      over_under_delivery_status: track(H.over_under_delivery_status, overUnderLen, 120, 260),
      company_name: track(H.company_name, buyerLen, 100, 380),
      lt_spot: track(H.lt_spot, ltLen, 72, 140),
      po_number: track(H.po_number, poLen, 88, 340),
      sto_number: track(H.sto_number, stoLen, 88, 340),
      delivery_start: track(H.delivery_start, dsLen, 108, 280),
      delivery_end: track(H.delivery_end, deLen, 108, 280),
      month_delivery_end: track(H.month_delivery_end, monthEndLen, 96, 200),
      cargo_readiness_date: track(H.cargo_readiness_date, 24, 220, 320),
      created_at: track(H.created_at, createdLen, 96, 140),
      company_code: track(H.company_code, 8, 72, 120),
      status: track(H.status, 12, 88, 160),
    } as Record<string, string>
  }, [sortedContracts, formatMonthDeliveryEnd])

  const getColumnWidth = useCallback(
    (id: string): string => compactGridColumnTracks[id] ?? 'minmax(96px, 1fr)',
    [compactGridColumnTracks]
  )

  const isColumnFilterActive = (colId: string) => {
    const f = columnFilters[colId]
    if (!f) return false
    if (f.emptyOnly) return true
    if (f.type === 'text') return Boolean(f.value && f.value.trim() !== '')
    if (f.type === 'number') return Boolean((f.min && f.min !== '') || (f.max && f.max !== ''))
    if (f.type === 'date') return Boolean((f.from && f.from !== '') || (f.to && f.to !== ''))
    if (f.type === 'multi') return Boolean((f.values && f.values.length > 0) || f.includeBlank)
    return false
  }

  const clearColumnFilter = (colId: string) => {
    setColumnFilters(prev => {
      const next = { ...prev }
      delete next[colId]
      return next
    })
  }

  const setOrClearFilter = (colId: string, next: ColumnFilter) => {
    const active =
      next.emptyOnly ||
      (next.type === 'text' && Boolean(next.value?.trim())) ||
      (next.type === 'number' && Boolean((next.min && next.min !== '') || (next.max && next.max !== ''))) ||
      (next.type === 'date' && Boolean((next.from && next.from !== '') || (next.to && next.to !== ''))) ||
      (next.type === 'multi' && Boolean((next.values && next.values.length > 0) || next.includeBlank))

    setColumnFilters(prev => {
      const copy = { ...prev }
      if (!active) {
        delete copy[colId]
      } else {
        copy[colId] = next
      }
      return copy
    })
  }

  // Update desktop table scroll width (for top scrollbar)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const calc = () => {
      const el = bottomScrollRef.current
      if (el) setTableScrollWidth(el.scrollWidth)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [visibleColumns, sortedContracts.length, compactGridColumnTracks])

  // If pagination/filtering changes, drop expansions that aren't on the current view to avoid stale set growth
  useEffect(() => {
    setExpandedContractIds(prev => {
      if (prev.size === 0) return prev
      const visible = new Set(filteredContracts.map(c => c.id))
      const next = new Set<string>()
      for (const id of prev) if (visible.has(id)) next.add(id)
      return next
    })
  }, [filteredContracts])

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        {!isContractPerformance && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium border border-gray-200 rounded px-2 py-1 bg-gray-50">
                Cargo Readiness Date
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadCargoReadinessTemplate}
                className="border-green-600 text-green-700 hover:bg-green-50"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              <input
                id="cargo-readiness-upload"
                type="file"
                accept=".csv"
                onChange={handleCargoReadinessUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={csvCargoUploading}
                onClick={() => document.getElementById('cargo-readiness-upload')?.click()}
              >
                {csvCargoUploading ? (
                  <><span className="h-4 w-4 mr-2 inline-block border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />Uploading...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Upload CSV</>
                )}
              </Button>
            </div>
          </div>
        )}

        {isContractPerformance && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Contract Performance</h1>
            </div>
          </div>
        )}

        {isContractPerformance && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  {/* Mode toggle */}
                  <div className="inline-flex rounded-lg border bg-white p-1 mb-2">
                    <button
                      type="button"
                      onClick={() => { setPerfDashMode('late'); resetLatePerfSelections(); setLateOnTimeFilter('LATE') }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${perfDashMode === 'late' ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                    >
                      Late
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPerfDashMode('ontrack'); resetLatePerfSelections(); setLateOnTimeFilter('ON_TIME') }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${perfDashMode === 'ontrack' ? 'bg-green-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                    >
                      On Track
                    </button>
                  </div>
                  <CardTitle className="text-base">
                    {perfDashMode === 'late' ? 'Late Performance (YTD)' : 'On Track Performance (YTD)'}
                  </CardTitle>
                  <div className="text-sm text-gray-600 mt-1">
                    {perfDashMode === 'late'
                      ? <>Management view of late contracts where <span className="font-medium">Trade Cycle &gt; 0</span>. Use hotspots to jump to the exact contracts list.</>
                      : <>Management view of on-track contracts where <span className="font-medium">Trade Cycle ≤ 0</span>. Use hotspots to jump to the exact contracts list.</>
                    }
                  </div>
                </div>
                {perfDashMode === 'late' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto">
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Late contracts</div>
                      <div className="text-lg font-semibold text-red-600">{latePerformanceSummary.count.toLocaleString('en-US')}</div>
                    </div>
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Total late qty</div>
                      <div className="text-lg font-semibold text-gray-900">{((latePerformanceSummary.totalQtyDelivery ?? 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</div>
                    </div>
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Avg late days</div>
                      <div className="text-lg font-semibold text-gray-900">{latePerformanceSummary.avgDays ? latePerformanceSummary.avgDays.toFixed(1) : '0.0'}</div>
                    </div>
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Max late days</div>
                      <div className="text-lg font-semibold text-gray-900">{latePerformanceSummary.maxDays.toLocaleString('en-US')}</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto">
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">On Track contracts</div>
                      <div className="text-lg font-semibold text-green-600">{onTrackPerformanceSummary.count.toLocaleString('en-US')}</div>
                    </div>
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Total on-track qty</div>
                      <div className="text-lg font-semibold text-gray-900">{((onTrackPerformanceSummary.totalQtyDelivery ?? 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</div>
                    </div>
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Avg days ahead</div>
                      <div className="text-lg font-semibold text-gray-900">{onTrackPerformanceSummary.avgDays ? onTrackPerformanceSummary.avgDays.toFixed(1) : '0.0'}</div>
                    </div>
                    <div className="rounded border bg-white px-3 py-2">
                      <div className="text-[11px] text-gray-500">Max days ahead</div>
                      <div className="text-lg font-semibold text-gray-900">{onTrackPerformanceSummary.maxDays.toLocaleString('en-US')}</div>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {latePerfLoading ? (
                <div className="text-sm text-gray-500">Loading Performance dashboard…</div>
              ) : (perfDashMode === 'late' ? latePerformanceTree : onTrackPerformanceTree).length === 0 ? (
                <div className="text-sm text-gray-500">{perfDashMode === 'late' ? 'No late contracts found in YTD.' : 'No on-track contracts found in YTD.'}</div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-gray-600">
                    Navigate as a tree: <span className="font-medium">Incoterm → Product → Plant → Supplier</span>.
                    Choosing a node updates the contracts table below to the same <span className="font-medium">YTD {perfDashMode === 'late' ? 'late' : 'on-track'}</span> scope and your selection.
                    Click a <span className="font-medium">Plant</span> node to narrow further (Group Name is viewed in the table).
                  </div>

                  <div className="rounded-xl border bg-white p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <div className="text-sm font-semibold text-gray-900">{perfDashMode === 'late' ? 'Late' : 'On Track'} Performance drilldown</div>
                      <button
                        type="button"
                        onClick={resetLatePerfSelections}
                        className="text-sm text-blue-700 hover:underline"
                      >
                        Reset selection
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                      {([
                        { title: 'Incoterm', subtitle: 'Pick one', level: 'incoterm' as const },
                        { title: 'Product', subtitle: latePerfSelIncoterm ? `Under ${latePerfSelIncoterm}` : 'Pick incoterm first', level: 'product' as const },
                        { title: 'Plant', subtitle: latePerfSelProduct ? `Under ${latePerfSelProduct}` : 'Pick product first', level: 'plant' as const },
                        { title: 'Supplier', subtitle: latePerfSelPlant ? `Under ${latePerfSelPlant}` : 'Pick plant first', level: 'supplier' as const },
                      ] as const).map((col) => {
                        const denom = latePerformanceSummary.totalDays || 1
                        const levelStyles: Record<string, { headerBg: string; badge: string; bar: string; border: string }> = {
                          incoterm: { headerBg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-800', bar: 'bg-violet-600', border: 'border-violet-200' },
                          product: { headerBg: 'bg-amber-50', badge: 'bg-amber-100 text-amber-800', bar: 'bg-amber-600', border: 'border-amber-200' },
                          plant: { headerBg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-600', border: 'border-emerald-200' },
                          supplier: { headerBg: 'bg-rose-50', badge: 'bg-rose-100 text-rose-800', bar: 'bg-rose-600', border: 'border-rose-200' },
                        }
                        const style = levelStyles[col.level] ?? levelStyles.incoterm
                        const itemClass = (selected: boolean) =>
                          `w-full text-left rounded-lg border px-3 py-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                            selected ? `bg-white ${style.border}` : 'bg-white border-gray-200'
                          }`

                        const renderItem = (node: LatePerfBranchNode, selected: boolean, onClick: () => void, rightAction?: React.ReactNode, rightStat?: React.ReactNode) => {
                          const pct = Math.max(1, Math.round((Number(node.totalDays || 0) / denom) * 100))
                          return (
                            <div key={node.id} className={itemClass(selected)}>
                              <div className="flex items-start justify-between gap-3">
                                <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="text-sm font-semibold text-gray-900 truncate">{node.label}</div>
                                    <div className="shrink-0 text-right leading-tight">
                                      <div className="text-[11px] font-bold text-gray-800 tabular-nums">{node.count > 0 ? (node.totalDays / node.count).toFixed(1) : '—'}</div>
                                      <div className="text-xs text-gray-500">{perfDashMode === 'late' ? 'avg late' : 'avg ahead'}</div>
                                    </div>
                                  </div>
                                  <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden">
                                    <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <div className="mt-1 text-xs text-gray-700 flex items-center justify-between gap-2">
                                    <span className="font-semibold">{node.count.toLocaleString('en-US')}</span>
                                    <span className="text-gray-500">contracts</span>
                                    {rightStat ?? <span className="ml-auto font-semibold whitespace-nowrap">{(node.totalQtyDelivery / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</span>}
                                  </div>
                                </button>
                                {rightAction ? <div className="shrink-0">{rightAction}</div> : null}
                              </div>
                            </div>
                          )
                        }

                        const panelHeader = (
                          <div className={`rounded-lg border px-3 py-2 ${style.headerBg} ${style.border}`}>
                            <div className="text-sm font-semibold text-gray-900">{col.title}</div>
                            <div className="text-[11px] text-gray-500">{col.subtitle}</div>
                          </div>
                        )

                        const body = (() => {
                          if (col.level === 'incoterm') {
                            return (
                              <div className="space-y-2">
                                {latePerfIncotermNodes.slice(0, 30).map((n) =>
                                  renderItem(n, latePerfSelIncoterm === n.label, () => {
                                    setLateOnTimeFilter(perfDashMode === 'ontrack' ? 'ON_TIME' : 'LATE')
                                    setPerfTransportMode('ALL')
                                    setLatePerfSelIncoterm(n.label)
                                    setLatePerfSelProduct(null)
                                    setLatePerfSelPlant(null)
                                    setLatePerfSelSupplier(null)
                                    setSelectedIncoterms([n.label])
                                    setSelectedPlantSites([])
                                    setColumnFilters((prev) => {
                                      const next = { ...prev }
                                      delete next.product
                                      delete next.supplier
                                      return next
                                    })
                                  }),
                                )}
                              </div>
                            )
                          }
                          if (col.level === 'product') {
                            if (!latePerfSelIncoterm) return <div className="text-sm text-gray-500">Select an incoterm to see products.</div>
                            return (
                              <div className="space-y-2">
                                {latePerfProductNodes.slice(0, 30).map((n) =>
                                  renderItem(n, latePerfSelProduct === n.label, () => {
                                    setLateOnTimeFilter(perfDashMode === 'ontrack' ? 'ON_TIME' : 'LATE')
                                    setPerfTransportMode('ALL')
                                    setLatePerfSelProduct(n.label)
                                    setLatePerfSelPlant(null)
                                    setLatePerfSelSupplier(null)
                                    setSelectedPlantSites([])
                                    setColumnFilters((prev) => {
                                      const next: Record<string, ColumnFilter> = { ...prev, product: { type: 'text', value: n.label === 'Blank' ? '' : n.label, exact: true } as ColumnFilter }
                                      delete next.supplier
                                      return next
                                    })
                                  }),
                                )}
                              </div>
                            )
                          }
                          // plant
                          if (!latePerfSelProduct || !latePerfSelIncoterm) return <div className="text-sm text-gray-500">Select a product to see plants.</div>
                          return (
                            <div className="space-y-2">
                              {latePerfPlantNodes.slice(0, 30).map((n) =>
                                renderItem(
                                  n,
                                  latePerfSelPlant === n.label,
                                  () => {
                                    setLateOnTimeFilter(perfDashMode === 'ontrack' ? 'ON_TIME' : 'LATE')
                                    setPerfTransportMode('ALL')
                                    setLatePerfSelPlant(n.label)
                                    setLatePerfSelSupplier(null)
                                    setSelectedPlantSites([n.label === 'Blank' ? '' : n.label])
                                    setColumnFilters((prev) => {
                                      const next = { ...prev }
                                      delete next.supplier
                                      return next
                                    })
                                  },
                                ),
                              )}
                            </div>
                          )
                          // supplier
                        })()
                        // supplier column body (resolved above via col.level check below)
                        const supplierBody = (() => {
                          if (col.level !== 'supplier') return null
                          if (!latePerfSelPlant || !latePerfSelProduct || !latePerfSelIncoterm) return <div className="text-sm text-gray-500">Select a plant to see suppliers.</div>
                          return (
                            <div className="space-y-2">
                              {latePerfSupplierNodes.slice(0, 30).map((n) =>
                                renderItem(
                                  n,
                                  latePerfSelSupplier === n.label,
                                  () => {
                                    setLatePerfSelSupplier(n.label)
                                    applyLatePerformanceFocus(latePerfSelIncoterm!, latePerfSelProduct!, latePerfSelPlant!, n.label)
                                  },
                                ),
                              )}
                            </div>
                          )
                        })()

                        return (
                          <div key={col.level} className="space-y-2">
                            {panelHeader}
                            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                              {col.level === 'supplier' ? supplierBody : body}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Trade Cycle Distribution */}
        {false && isContractPerformance && tradeCycleDist && (() => {
          const buckets = [
            { key: 'onTime',  label: 'On Time',    sublabel: '≤ 0 days',   color: '#16a34a', bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  bar: '#16a34a' },
            { key: 'd1_7',    label: '1–7 days',   sublabel: 'Watch',       color: '#ca8a04', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', bar: '#ca8a04' },
            { key: 'd8_14',   label: '8–14 days',  sublabel: 'Caution',     color: '#ea580c', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', bar: '#ea580c' },
            { key: 'd15_30',  label: '15–30 days', sublabel: 'Late',        color: '#dc2626', bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    bar: '#dc2626' },
            { key: 'd31_60',  label: '31–60 days', sublabel: 'Overdue',     color: '#9f1239', bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700',   bar: '#9f1239' },
            { key: 'd61plus', label: '61+ days',   sublabel: 'Critical',    color: '#6b21a8', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', bar: '#6b21a8' },
            { key: 'noData',  label: 'No Data',    sublabel: 'Missing dates', color: '#9ca3af', bg: 'bg-gray-50',  border: 'border-gray-200',   text: 'text-gray-500',   bar: '#9ca3af' },
          ] as const
          const total = buckets.reduce((s, b) => s + (tradeCycleDist![b.key as keyof TradeCycleDist]?.count ?? 0), 0)
          return (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-base">Trade Cycle Distribution (YTD)</CardTitle>
                    <div className="text-sm text-gray-600 mt-1">
                      Distribution of all {total.toLocaleString()} tracked contracts by trade cycle lateness.
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2 space-y-4">
                {/* Stacked bar */}
                <div className="flex rounded-full overflow-hidden h-3 w-full">
                  {buckets.map(b => {
                    const cnt = tradeCycleDist![b.key as keyof TradeCycleDist]?.count ?? 0
                    const pct = total > 0 ? (cnt / total) * 100 : 0
                    return pct > 0 ? (
                      <div key={b.key} title={`${b.label}: ${cnt} contracts (${pct.toFixed(1)}%)`}
                        style={{ width: `${pct}%`, backgroundColor: b.bar }} />
                    ) : null
                  })}
                </div>
                {/* Bucket cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {buckets.map(b => {
                    const cnt = tradeCycleDist![b.key as keyof TradeCycleDist]?.count ?? 0
                    const qty = tradeCycleDist![b.key as keyof TradeCycleDist]?.qty ?? 0
                    const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0'
                    return (
                      <div key={b.key} className={`rounded border px-3 py-2 ${b.bg} ${b.border}`}>
                        <div className={`text-[11px] font-semibold ${b.text}`}>{b.label}</div>
                        <div className={`text-xs ${b.text} opacity-70 mb-1`}>{b.sublabel}</div>
                        <div className="text-lg font-bold text-gray-900">{cnt.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-500">{pct}% of total</div>
                        {qty > 0 && <div className="text-[10px] text-gray-400 mt-0.5">{(qty / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} MT</div>}
                      </div>
                    )
                  })}
                </div>

                {/* Formula legend */}
                <div className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">How Trade Cycle is calculated</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-gray-600">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-28 font-medium text-gray-700">Closed + LAND</span>
                      <span className="text-gray-400">Trucking Last Receive</span>
                      <span className="shrink-0 text-gray-400">→</span>
                      <span className="text-gray-400">Delivery End Date</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-28 font-medium text-gray-700">Closed + SEA</span>
                      <span className="text-gray-400">ATA Vessel Discharge</span>
                      <span className="shrink-0 text-gray-400">→</span>
                      <span className="text-gray-400">Delivery End Date</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-28 font-medium text-gray-700">Open + LAND</span>
                      <span className="text-gray-400">Delivery End Date</span>
                      <span className="shrink-0 text-gray-400">→</span>
                      <span className="text-gray-400">Latest Daily Plan Date</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-28 font-medium text-gray-700">Open + SEA</span>
                      <span className="text-gray-400">Delivery End Date</span>
                      <span className="shrink-0 text-gray-400">→</span>
                      <span className="text-gray-400">ETA Vessel Discharge</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-2 pt-2 border-t border-gray-200 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-gray-600">Result ≤ 0 = On Time</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                      <span className="text-gray-600">Result &gt; 0 = Late (days overdue)</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })()}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by Contract ID, Contract Ext No, PO, Supplier, or Product..."
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        applySearch()
                      }
                    }}
                    className="pl-10"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 border rounded-lg"
                >
                  <option value="All Status">All Status</option>
                  <option value="Open">Open</option>
                  <option value="Close">Close</option>
                </select>
                {!isContractPerformance && (
                  <select
                    value={b2bFlagFilter}
                    onChange={(e) => setB2bFlagFilter(e.target.value)}
                    className="px-4 py-2 border rounded-lg"
                  >
                    <option value="ALL">All Contract Type</option>
                    {availableB2bFlags.map(flag => (
                      <option key={flag} value={flag}>{flag}</option>
                    ))}
                  </select>
                )}
                {!isContractPerformance && (
                  <select
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    className="px-4 py-2 border rounded-lg"
                  >
                    <option value="ALL">All Products</option>
                    {availableProducts.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                )}
                {!isContractPerformance && (
                  <select
                    value={transportModeFilter}
                    onChange={(e) => setTransportModeFilter(e.target.value)}
                    className="px-4 py-2 border rounded-lg"
                  >
                    <option value="ALL">All Transport</option>
                    <option value="SEA">Sea</option>
                    <option value="LAND">Land</option>
                    <option value="MIX">Mix</option>
                  </select>
                )}
                {isContractPerformance && (
                  <select
                    value={lateOnTimeFilter}
                    onChange={(e) => setLateOnTimeFilter(e.target.value as any)}
                    className="px-4 py-2 border rounded-lg"
                    title="Late: Trade Cycle > 0. On Time: Trade Cycle ≤ 0."
                  >
                    <option value="ALL">Late/On Time: All</option>
                    <option value="LATE">Late</option>
                    <option value="ON_TIME">On Time</option>
                  </select>
                )}
                {isContractPerformance && (
                  <select
                    value={perfTransportMode}
                    onChange={(e) => setPerfTransportMode(e.target.value as any)}
                    className="px-4 py-2 border rounded-lg"
                  >
                    <option value="ALL">Transport Mode: All</option>
                    <option value="SEA">SEA</option>
                    <option value="LAND">LAND</option>
                  </select>
                )}
              </div>

              {isContractPerformance && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SearchableMultiSelect
                    label="Incoterm"
                    options={availableIncoterms}
                    selected={selectedIncoterms}
                    onChange={setSelectedIncoterms}
                    placeholder="Select incoterm(s)"
                    emptyMessage="Loading incoterms..."
                  />
                  <SearchableMultiSelect
                    label="Plant/Site"
                    options={availablePlantSites}
                    selected={selectedPlantSites}
                    onChange={setSelectedPlantSites}
                    placeholder="Select plant/site(s)"
                    emptyMessage="Loading plants..."
                  />
                </div>
              )}
              
              {/* Date Range Filter */}
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy
                    valueIso={dateFrom}
                    onChangeIso={setDateFrom}
                    className="w-40"
                  />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy
                    valueIso={dateTo}
                    onChangeIso={setDateTo}
                    className="w-40"
                  />
                  {(dateFrom ||
                    dateTo ||
                    searchDraft ||
                    searchTerm ||
                    transportModeFilter !== 'ALL' ||
                    productFilter !== 'ALL' ||
                    b2bFlagFilter !== 'ALL' ||
                    statusFilter !== 'All Status' ||
                    (!isContractPerformance && unassignedFilter) ||
                    hasActiveSectionOneColumnFilters(columnFilters) ||
                    (isContractPerformance &&
                      (lateOnTimeFilter !== 'ALL' ||
                        perfTransportMode !== 'ALL' ||
                        selectedIncoterms.length > 0 ||
                        selectedPlantSites.length > 0))) && (
                    <Button
                      onClick={() => {
                        setDateFrom('')
                        setDateTo('')
                        setSearchDraft('')
                        setSearchTerm('')
                        setTransportModeFilter('ALL')
                        setProductFilter('ALL')
                        setB2bFlagFilter('ALL')
                        setStatusFilter('All Status')
                        setColumnFilters({})
                        if (!isContractPerformance) {
                          setUnassignedFilter(null)
                        } else {
                          setLateOnTimeFilter('ALL')
                          setPerfTransportMode('ALL')
                          setSelectedIncoterms([])
                          setSelectedPlantSites([])
                        }
                        setCurrentPage(1)
                        fetchContracts(1, '')
                      }}
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
            </div>
          </CardContent>
        </Card>

        {!isContractPerformance && (
          <>
            {/* Assignment summary - clickable to filter list */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card
                className={`cursor-pointer transition-all hover:shadow-md ${unassignedFilter === 'sea' ? 'ring-2 ring-blue-500 bg-blue-50/50' : ''}`}
                onClick={() => {
                  setUnassignedFilter(prev => (prev === 'sea' ? null : 'sea'))
                  if (unassignedFilter !== 'sea') setTimeout(() => contractsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                }}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-500">SEA contracts without shipments</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-1">
                        {unassignedSeaContracts}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Click to view list</div>
                    </div>
                    <Ship className="h-8 w-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>
              <Card
                className={`cursor-pointer transition-all hover:shadow-md ${unassignedFilter === 'land' ? 'ring-2 ring-amber-500 bg-amber-50/50' : ''}`}
                onClick={() => {
                  setUnassignedFilter(prev => (prev === 'land' ? null : 'land'))
                  if (unassignedFilter !== 'land') setTimeout(() => contractsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                }}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-500">LAND contracts without trucking</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-1">
                        {unassignedLandContracts}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Click to view list</div>
                    </div>
                    <Truck className="h-8 w-8 text-amber-500" />
                  </div>
                </CardContent>
              </Card>
              <Card
                className={`cursor-pointer transition-all hover:shadow-md ${unassignedFilter === 'mix' ? 'ring-2 ring-green-500 bg-green-50/50' : ''}`}
                onClick={() => {
                  setUnassignedFilter(prev => (prev === 'mix' ? null : 'mix'))
                  if (unassignedFilter !== 'mix') setTimeout(() => contractsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                }}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-500">MIX contracts without shipment or trucking</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-1">
                        {unassignedMixContracts}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Click to view list</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Ship className="h-7 w-7 text-green-500" />
                      <Truck className="h-7 w-7 text-green-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Active filter banner */}
          </>
        )}

        {/* Contracts List */}
        <Card ref={contractsTableRef}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <CardTitle>
                    {unassignedFilter === 'sea'
                      ? 'SEA Contracts Without Shipments'
                      : unassignedFilter === 'land'
                      ? 'LAND Contracts Without Trucking'
                      : unassignedFilter === 'mix'
                      ? 'MIX Contracts Without Shipment or Trucking'
                      : isContractPerformance
                      ? 'Contract Performance'
                      : 'All Contracts'}
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    {totalContracts} total contracts | Showing {filteredContracts.length} on this page
                    {totalPages > 1 && ` (Page ${currentPage} of ${totalPages})`}
                  </p>
                </div>
                {unassignedFilter && (
                  <Badge
                    className={`hidden md:inline-flex cursor-pointer ${
                      unassignedFilter === 'sea'
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : unassignedFilter === 'land'
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                    onClick={() => setUnassignedFilter(null)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear filter
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowColumnsMenu(v => !v)}
                    disabled={loading}
                  >
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    Columns
                  </Button>
                  {showColumnsMenu && (
                    <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowColumnsMenu(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 mb-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(compactColumns.map(c => c.id)))}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => setVisibleColumnIds(new Set(['contract_id', 'status']))}
                        >
                          Unselect All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs h-7"
                          onClick={() => resetCompactColumnView()}
                        >
                          Reset
                        </Button>
                      </div>
                      <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                        {(() => {
                          const excluded = new Set(['contract_id', 'status'])
                          const visibleInMenu = visibleColumns.filter(c => !excluded.has(c.id))
                          const visibleIds = new Set(visibleInMenu.map(c => c.id))
                          const byId = new Map(compactColumns.map(c => [c.id, c] as const))
                          const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : compactColumns.map(c => c.id))
                          const hiddenCols = orderedIds
                            .map(id => byId.get(id))
                            .filter((c): c is CompactColumn => !!c && !excluded.has(c.id) && !visibleIds.has(c.id))
                            .sort((a, b) => a.label.localeCompare(b.label))
                          return [...visibleInMenu, ...hiddenCols]
                        })().map(col => (
                            <div
                              key={col.id}
                              draggable
                              onDragStart={() => setDragColId(col.id)}
                              onDragEnd={() => setDragColId(null)}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => { if (dragColId && dragColId !== col.id) reorderColumnByDrag(dragColId, col.id) }}
                              className={`flex items-center gap-2 text-sm cursor-grab select-none rounded px-1 py-0.5 ${dragColId === col.id ? 'opacity-40' : 'hover:bg-gray-50'}`}
                            >
                              <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                              <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <Checkbox
                                checked={visibleColumnIds.has(col.id)}
                                onCheckedChange={() => toggleColumn(col.id)}
                              />
                              <span className="truncate">{col.label}</span>
                              </label>
                            </div>
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
                      disabled={currentPage === 1 || loading}
                    >
                      Previous
                    </Button>

                    {/* Page Numbers */}
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
                            variant={currentPage === pageNum ? "default" : "outline"}
                            size="sm"
                            onClick={() => handlePageChange(pageNum)}
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
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages || loading}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading contracts...</div>
            ) : (
              <>
                {/* Desktop compact table (Contracts + Contract Performance): semantic <table>, zebra on <tr>/<td> */}
                <div className="hidden lg:block border rounded-lg overflow-hidden">
                  {/* Top scrollbar (synced) */}
                  <div
                    ref={topScrollRef}
                    className="overflow-x-auto border-b bg-white"
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
                    className="overflow-x-auto"
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
                    <div className="min-w-[1100px]">
                      <table className="w-full min-w-[1100px] table-fixed border-collapse">
                        <colgroup>
                          {visibleColumns.map((c) => (
                            <col key={c.id} style={{ width: compactGridTrackMinPx(getColumnWidth(c.id)) }} />
                          ))}
                          <col style={{ width: isContractPerformance ? 60 : 160 }} />
                        </colgroup>
                      {/* Header */}
                      <thead>
                      <tr className="text-xs font-semibold text-gray-600 bg-gray-50 border-b sticky top-0 z-10">
                        {visibleColumns.map(col => {
                          const activeSort = sortKey === col.id
                          const filterActive = isColumnFilterActive(col.id)
                          const filterType = getFilterTypeForColumn(col.id)
                          const current = columnFilters[col.id]
                          const currentText  = current && current.type === 'text'   ? current : null
                          const currentNum   = current && current.type === 'number' ? current : null
                          const currentDate  = current && current.type === 'date'   ? current : null
                          const currentMulti = current && current.type === 'multi'  ? current : null

                          return (
                            <th
                              key={col.id}
                              scope="col"
                              className={`relative min-w-0 px-3 py-2 text-left align-bottom font-semibold cursor-move ${dragColId === col.id ? 'opacity-60' : ''}`}
                              draggable
                              onDragStart={(e) => {
                                setDragColId(col.id)
                                e.dataTransfer.setData('text/plain', col.id)
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
                                if (dragged) reorderColumnByDrag(dragged, col.id)
                                setDragColId(null)
                              }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="whitespace-normal break-words leading-tight">{col.label}</span>
                                {col.formulaHelp ? (
                                  <span className="shrink-0 inline-flex items-center">
                                    <FieldHelp text={col.formulaHelp} />
                                  </span>
                                ) : null}
                                {col.sortable && (
                                  <button
                                    type="button"
                                    className={`shrink-0 p-0.5 rounded hover:bg-gray-200 ${activeSort ? 'text-blue-600' : 'text-gray-400'}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      e.preventDefault()
                                      onSortHeaderClick(col)
                                    }}
                                    title="Sort"
                                  >
                                    {activeSort
                                      ? sortDir === 'asc'
                                        ? <ArrowUp className="h-3.5 w-3.5" />
                                        : <ArrowDown className="h-3.5 w-3.5" />
                                      : <ArrowUpDown className="h-3.5 w-3.5" />
                                    }
                                  </button>
                                )}
                              </div>

                              {false && openHeaderFilterId === col.id && (
                                <div
                                  ref={headerFilterPopoverRef}
                                  className="absolute left-0 top-full mt-2 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-xs font-semibold text-gray-700 truncate">{col.label} Filter</div>
                                    <button
                                      type="button"
                                      className="text-xs text-gray-500 hover:text-gray-800"
                                      onClick={() => setOpenHeaderFilterId(null)}
                                    >
                                      Close
                                    </button>
                                  </div>

                                  {/* Text filter */}
                                  {filterType === 'text' && (
                                    <div className="space-y-2">
                                      <Input
                                        value={currentText?.value ?? ''}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          setOrClearFilter(col.id, {
                                            type: 'text',
                                            value,
                                            exact: Boolean(currentText?.exact),
                                            emptyOnly: Boolean(currentText?.emptyOnly),
                                            notBlankOnly: Boolean(currentText?.notBlankOnly),
                                          })
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault()
                                            setCurrentPage(1)
                                            fetchContracts(1)
                                          }
                                        }}
                                        placeholder="Type to filter (contains)"
                                        className="h-8 text-sm"
                                      />
                                      <div className="flex flex-col gap-2">
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean(currentText?.exact)}
                                            onCheckedChange={(checked) => {
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value: currentText?.value ?? '',
                                                exact: Boolean(checked),
                                                emptyOnly: Boolean(currentText?.emptyOnly),
                                              })
                                            }}
                                          />
                                          Exact match
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean(currentText?.emptyOnly)}
                                            onCheckedChange={(checked) => {
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value: currentText?.value ?? '',
                                                exact: Boolean(currentText?.exact),
                                                emptyOnly: Boolean(checked),
                                                notBlankOnly: Boolean(currentText?.notBlankOnly),
                                              })
                                            }}
                                          />
                                          Only blanks
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean(currentText?.notBlankOnly)}
                                            onCheckedChange={(checked) => {
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value: currentText?.value ?? '',
                                                exact: Boolean(currentText?.exact),
                                                emptyOnly: Boolean(currentText?.emptyOnly),
                                                notBlankOnly: Boolean(checked),
                                              })
                                            }}
                                          />
                                          Only not blanks
                                        </label>
                                      </div>
                                    </div>
                                  )}

                                  {/* Number filter */}
                                  {filterType === 'number' && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                      <Input
                                          value={currentNum?.min ?? ''}
                                          onChange={(e) => {
                                            setOrClearFilter(col.id, { type: 'number', min: e.target.value, max: currentNum?.max, emptyOnly: Boolean(currentNum?.emptyOnly), notBlankOnly: Boolean(currentNum?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setCurrentPage(1)
                                              fetchContracts(1)
                                            }
                                          }}
                                          placeholder="Min"
                                          className="h-8 text-sm"
                                        />
                                      <Input
                                          value={currentNum?.max ?? ''}
                                          onChange={(e) => {
                                            setOrClearFilter(col.id, { type: 'number', min: currentNum?.min, max: e.target.value, emptyOnly: Boolean(currentNum?.emptyOnly), notBlankOnly: Boolean(currentNum?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setCurrentPage(1)
                                              fetchContracts(1)
                                            }
                                          }}
                                          placeholder="Max"
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(currentNum?.emptyOnly)}
                                          onCheckedChange={(checked) => {
                                            setOrClearFilter(col.id, { type: 'number', min: currentNum?.min, max: currentNum?.max, emptyOnly: Boolean(checked), notBlankOnly: Boolean(currentNum?.notBlankOnly) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(currentNum?.notBlankOnly)}
                                          onCheckedChange={(checked) => {
                                            setOrClearFilter(col.id, { type: 'number', min: currentNum?.min, max: currentNum?.max, emptyOnly: Boolean(currentNum?.emptyOnly), notBlankOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only not blanks
                                      </label>
                                    </div>
                                  )}

                                  {/* Date filter */}
                                  {filterType === 'date' && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                      <Input
                                          type="date"
                                          value={currentDate?.from ?? ''}
                                          onChange={(e) => {
                                            setOrClearFilter(col.id, { type: 'date', from: e.target.value, to: currentDate?.to, emptyOnly: Boolean(currentDate?.emptyOnly), notBlankOnly: Boolean(currentDate?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setCurrentPage(1)
                                              fetchContracts(1)
                                            }
                                          }}
                                          className="h-8 text-sm"
                                        />
                                      <Input
                                          type="date"
                                          value={currentDate?.to ?? ''}
                                          onChange={(e) => {
                                            setOrClearFilter(col.id, { type: 'date', from: currentDate?.from, to: e.target.value, emptyOnly: Boolean(currentDate?.emptyOnly), notBlankOnly: Boolean(currentDate?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setCurrentPage(1)
                                              fetchContracts(1)
                                            }
                                          }}
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(currentDate?.emptyOnly)}
                                          onCheckedChange={(checked) => {
                                            setOrClearFilter(col.id, { type: 'date', from: currentDate?.from, to: currentDate?.to, emptyOnly: Boolean(checked), notBlankOnly: Boolean(currentDate?.notBlankOnly) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(currentDate?.notBlankOnly)}
                                          onCheckedChange={(checked) => {
                                            setOrClearFilter(col.id, { type: 'date', from: currentDate?.from, to: currentDate?.to, emptyOnly: Boolean(currentDate?.emptyOnly), notBlankOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only not blanks
                                      </label>
                                    </div>
                                  )}

                                  {/* Multi-select filter */}
                                  {filterType === 'multi' && (
                                    <div className="space-y-2 max-h-60 overflow-auto pr-1">
                                      {(() => {
                                        const rawValues = contracts.map(c => getColumnRawValue(c, col.id))
                                        const nonBlankSet = new Set<string>()
                                        let hasBlank = false
                                        for (const v of rawValues) {
                                          if (isEmptyValue(v)) {
                                            hasBlank = true
                                          } else {
                                            nonBlankSet.add(String(v).trim())
                                          }
                                        }
                                        const options = Array.from(nonBlankSet).sort((a, b) =>
                                          a.localeCompare(b, undefined, { sensitivity: 'base' })
                                        )
                                        const selectedValues = currentMulti?.values || []
                                        const includeBlank = currentMulti?.includeBlank ?? false

                                        return (
                                          <>
                                            {options.map(value => (
                                              <label
                                                key={value}
                                                className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none"
                                              >
                                                <Checkbox
                                                  checked={selectedValues.includes(value)}
                                                  onCheckedChange={(checked) => {
                                                    const nextValues = new Set(selectedValues)
                                                    if (checked) nextValues.add(value)
                                                    else nextValues.delete(value)
                                                    setOrClearFilter(col.id, {
                                                      type: 'multi',
                                                      values: Array.from(nextValues),
                                                      includeBlank,
                                                    })
                                                  }}
                                                />
                                                <span className="truncate">{value}</span>
                                              </label>
                                            ))}
                                            {hasBlank && (
                                              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
                                                <Checkbox
                                                  checked={includeBlank}
                                                  onCheckedChange={(checked) => {
                                                    setOrClearFilter(col.id, {
                                                      type: 'multi',
                                                      values: selectedValues,
                                                      includeBlank: Boolean(checked),
                                                    })
                                                  }}
                                                />
                                                <span>(Blank)</span>
                                              </label>
                                            )}
                                          </>
                                        )
                                      })()}
                                    </div>
                                  )}

                                  <div className="flex items-center justify-between mt-3 pt-2 border-t">
                                    <button
                                      type="button"
                                      className="text-xs text-gray-600 hover:text-gray-900"
                                      onClick={() => clearColumnFilter(col.id)}
                                      disabled={!filterActive}
                                    >
                                      Clear
                                    </button>
                                    <div className="text-[11px] text-gray-500">
                                      {filterActive ? 'Filtered' : 'No filter'}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </th>
                          )
                        })}
                        <th
                          scope="col"
                          className={`text-center align-bottom font-semibold sticky right-0 z-20 top-0 bg-gray-50 border-l border-gray-200 pl-3 pr-2 ${isContractPerformance ? 'min-w-[60px]' : 'min-w-[160px]'}`}
                        >
                          Actions
                        </th>
                      </tr>
                      </thead>

                      {/* Rows */}
                      <tbody className="divide-y divide-gray-200">
                        {sortedContracts.length === 0 ? (
                          <tr className="bg-white">
                            <td colSpan={visibleColumns.length + 1} className="px-4 py-10 text-center text-gray-500">
                              <p>No contracts found</p>
                              {searchTerm && <p className="text-sm mt-2">Try adjusting your search filters</p>}
                            </td>
                          </tr>
                        ) : (
                          sortedContracts.map((contract, idx) => {
                            const stripeClass = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                            return (
                          <tr key={contract.id} className={stripeClass}>
                                {visibleColumns.map(col => (
                                  <td key={col.id} className={`min-w-0 px-3 py-2 align-middle ${stripeClass}`}>
                                    <div className="flex min-h-[40px] items-center">{col.render(contract)}</div>
                                  </td>
                                ))}

                                <td
                                  className={`sticky right-0 z-10 border-l border-gray-200 px-3 py-2 align-middle ${isContractPerformance ? 'min-w-[60px]' : 'min-w-[160px]'} ${stripeClass}`}
                                >
                                  <div className="flex items-center justify-end gap-2">
                                  {!isContractPerformance && (transportIsLand(contract) || transportIsMix(contract)) && (() => {
                                    const hasData = countGt0(contract.trucking_count)
                                    return (
                                      <Button variant="outline" size="icon" onClick={() => handleTruckIconClick(contract)}
                                        title={hasData ? 'Edit trucking' : 'Add trucking'}
                                        className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100">
                                        {hasData ? <Pencil className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                                      </Button>
                                    )
                                  })()}
                                  {!isContractPerformance && (transportIsSea(contract) || transportIsMix(contract)) && (() => {
                                    const hasData = countGt0(contract.shipment_count) || countGt0(contract.sto_count)
                                    return (
                                      <Button variant="outline" size="icon" onClick={() => handleShipIconClick(contract)}
                                        title={hasData ? 'Edit' : 'Add'}
                                        className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100">
                                        {hasData ? <Pencil className="h-4 w-4" /> : <Ship className="h-4 w-4" />}
                                      </Button>
                                    )
                                  })()}
                                  <Button variant="outline" size="icon" onClick={() => setSelectedContract(contract)} title="View" className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                                    <Eye className="h-4 w-4" />
                                  </Button>

                                  {!isContractPerformance && (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => openContractDocsModal(contract)}
                                        title="Docs"
                                        className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                                      >
                                        <FileText className="h-4 w-4" />
                                      </Button>
                                      <input
                                        id={`contract-file-${contract.id}`}
                                        type="file"
                                        accept="application/pdf,image/png,image/jpeg"
                                        className="hidden"
                                        onChange={(e) => handleUploadFileChange(contract, e)}
                                      />
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => document.getElementById(`contract-file-${contract.id}`)?.click()}
                                        disabled={uploadingId === contract.id}
                                        title="Upload"
                                        className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                      >
                                        {uploadingId === contract.id ? (
                                          <span className="h-4 w-4 inline-block border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                          <Upload className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </>
                                  )}
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

                {/* Mobile/tablet cards */}
                <div className="lg:hidden space-y-2">
                  {sortedContracts.map((contract) => (
                    <div
                      key={contract.id}
                      className="border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="p-4">
                      {/* Compact Row (default) - table style on desktop */}
                      <div className="lg:hidden flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(contract.id)}
                            className="p-1 text-gray-500 hover:text-gray-800"
                            title={expandedContractIds.has(contract.id) ? 'Collapse' : 'Expand'}
                          >
                            {expandedContractIds.has(contract.id) ? (
                              <ChevronDown className="h-5 w-5" />
                            ) : (
                              <ChevronRight className="h-5 w-5" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold truncate">{contract.contract_id}</span>
                              <Badge className={getStatusColor(contract.import_status || contract.status)}>
                                {contract.import_status || contract.status}
                              </Badge>
                              {contract.transport_mode && (
                                <Badge variant="secondary" className="hidden sm:inline-flex">
                                  {contract.transport_mode}
                                </Badge>
                              )}
                              {contract.lt_spot && (
                                <Badge variant="outline" className="hidden md:inline-flex">
                                  {contract.lt_spot}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-gray-600 truncate">
                              <span className="font-medium">{contract.supplier || '-'}</span>
                              {' • '}
                              {contract.product || '-'}
                              {' • '}
                              <span className="text-gray-500">Outstanding:</span>{' '}
                              <span className={contract.outstanding_quantity < 0 ? 'text-red-600' : 'text-gray-800'}>
                                {formatNumber(contract.outstanding_quantity)} {contract.unit}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* Icons: Trucking, Shipping, Documents */}
                          {!isContractPerformance && (transportIsLand(contract) || transportIsMix(contract)) && (() => {
                            const hasData = countGt0(contract.trucking_count)
                            return (
                              <Button variant="outline" size="sm" onClick={() => handleTruckIconClick(contract)}
                                className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100">
                                {hasData ? <><Pencil className="h-4 w-4 mr-2" />Edit</> : <><Truck className="h-4 w-4 mr-2" />Add</>}
                              </Button>
                            )
                          })()}
                          {!isContractPerformance && (transportIsSea(contract) || transportIsMix(contract)) && (() => {
                            const hasData = countGt0(contract.shipment_count) || countGt0(contract.sto_count)
                            return (
                              <Button variant="outline" size="sm" onClick={() => handleShipIconClick(contract)}
                                className={hasData ? '' : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'}>
                                {hasData ? <><Pencil className="h-4 w-4 mr-2" />Edit</> : <><Plus className="h-4 w-4 mr-2" />Add</>}
                              </Button>
                            )
                          })()}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedContract(contract)}
                            className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hidden md:inline-flex"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>

                          {!isContractPerformance && (
                            <>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => openContractDocsModal(contract)}
                                title="Docs"
                                className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100 md:hidden"
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openContractDocsModal(contract)}
                                title="Docs"
                                className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100 hidden md:inline-flex"
                              >
                                <FileText className="h-4 w-4 mr-2" />
                                Docs
                              </Button>
                              {/* Upload supporting document */}
                              <input
                                id={`contract-file-${contract.id}`}
                                type="file"
                                accept="application/pdf,image/png,image/jpeg"
                                className="hidden"
                                onChange={(e) => handleUploadFileChange(contract, e)}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => document.getElementById(`contract-file-${contract.id}`)?.click()}
                                disabled={uploadingId === contract.id}
                                className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100 hidden md:inline-flex"
                              >
                                {uploadingId === contract.id ? (
                                  <>
                                    <span className="h-4 w-4 mr-2 inline-block border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                                    Uploading...
                                  </>
                                ) : (
                                  <>
                                    <Upload className="h-4 w-4 mr-2" />
                                    Upload
                                  </>
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expanded Details (optional) */}
                      {expandedContractIds.has(contract.id) && (
                        <div className="mt-4">
                          {/* Main Info Grid */}
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <div className="text-gray-500">Source</div>
                              <div className="font-medium">{contract.source_type || '-'}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Group Name</div>
                              <div className="font-medium">{contract.group_name || '-'}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">B2B Flag</div>
                              <div className="font-medium">{contract.b2b_flag || '-'}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Buyer</div>
                              <div className="font-medium">{partiesBuyerDisplay(contract)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Transport Mode</div>
                              <div className="font-medium">{contract.transport_mode || '-'}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Incoterm</div>
                              <div className="font-medium">{contract.incoterm || '-'}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t pt-4">
                <div className="text-sm text-gray-700">
                  Showing page {currentPage} of {totalPages} ({totalContracts} total contracts)
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || loading}
                  >
                    Previous
                  </Button>
                  
                  {/* Page Numbers */}
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
                          variant={currentPage === pageNum ? "default" : "outline"}
                          size="sm"
                          onClick={() => handlePageChange(pageNum)}
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
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contract documents modal (from Actions > Docs) */}
        {docsModalContract && (
          <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[80vh] flex flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
                <div>
                  <h3 className="text-xl font-semibold">Documents</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Contract {docsModalContract.contract_id}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={closeContractDocsModal}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                {docsModalLoading ? (
                  <div className="text-sm text-gray-500 py-8 text-center">Loading documents...</div>
                ) : docsModalDocs.length === 0 ? (
                  <div className="text-sm text-gray-500 py-8 text-center">
                    No documents uploaded for this contract. Use the Upload action to add files.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {docsModalDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between px-4 py-3 border rounded hover:bg-gray-50"
                      >
                        <div>
                          <div className="text-sm font-medium">{doc.file_name}</div>
                          <div className="text-xs text-gray-500">
                            {(doc.document_type || 'FILE')}
                            {doc.created_at ? ` • ${new Date(doc.created_at).toLocaleString()}` : ''}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownloadDocument(doc.id, doc.file_name)}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Contract Details Modal */}
        {selectedContract && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              <CardHeader className="shrink-0 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Contract Details</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label="Close"
                    onClick={() => setSelectedContract(null)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-6">
                  {/* Highlight — key identifiers at a glance */}
                  <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/80 p-4 shadow-sm">
                    <h3 className="text-base font-semibold text-amber-900 mb-3 tracking-tight">Highlight Information</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Contract</div>
                        <div className="font-semibold text-gray-900 mt-0.5 truncate" title={selectedContract.contract_id || ''}>
                          {selectedContract.contract_id || '-'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Contract Ext No</div>
                        <div className="font-semibold text-gray-900 mt-0.5 break-words whitespace-normal">
                          {selectedContract.contract_ext_no || '-'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">
                          PO Number{selectedContract.po_count && selectedContract.po_count > 1 ? ` (${selectedContract.po_count})` : ''}
                        </div>
                        <div className="font-semibold text-gray-900 mt-0.5 text-xs leading-snug break-words">
                          {selectedContract.po_numbers || selectedContract.po_number || '-'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Contract Qty</div>
                        <div className="font-semibold text-gray-900 mt-0.5">
                          {((Number(selectedContract.quantity_ordered) || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Incoterm</div>
                        <div className="font-semibold text-gray-900 mt-0.5">{selectedContract.incoterm || '-'}</div>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Product</div>
                        <div className="font-semibold text-gray-900 mt-0.5 break-words">{selectedContract.product || '-'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Basic Information */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Basic Information</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Status</div>
                        <div className="font-medium mt-1">
                          {(() => {
                            const delivery = String(selectedContract.import_status || selectedContract.status || '').toUpperCase()
                            const paid = String(selectedContract.payment_status || '').toUpperCase() === 'PAID'
                            return delivery === 'CLOSE' && paid ? 'Close' : (selectedContract.import_status || selectedContract.status || '-')
                          })()}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Unusual Flag</div>
                        <div className="mt-1">
                          {(() => {
                            const isUnusual =
                              (selectedContract.log_cycle_days != null && selectedContract.log_cycle_days >= 35) ||
                              (selectedContract.trade_cycle_days != null && selectedContract.trade_cycle_days >= 35) ||
                              (selectedContract.cash_cycle_days != null && selectedContract.cash_cycle_days >= 35)
                            return isUnusual ? (
                              <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Unusual</Badge>
                            ) : (
                              <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">Normal</Badge>
                            )
                          })()}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Delivery Status</div>
                        <div className="mt-1">
                          <Badge className={getStatusColor(selectedContract.import_status || selectedContract.status)}>
                            {selectedContract.import_status || selectedContract.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Contract Ext No</div>
                        <div className="font-medium mt-1 break-words whitespace-normal">
                          {selectedContract.contract_ext_no || '-'}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Source Type</div>
                        <div className="font-medium mt-1">{selectedContract.source_type || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Contract Type</div>
                        <div className="font-medium mt-1">{selectedContract.contract_type || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Group Name</div>
                        <div className="font-medium mt-1">{selectedContract.group_name || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500 flex items-center gap-1">
                          Company Name
                          <FieldHelp text={FIELD_HELP.companyName} />
                        </div>
                        <div className="font-medium mt-1">{selectedContract.company_name || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">B2B Flag</div>
                        <div className="font-medium mt-1">{selectedContract.b2b_flag || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">LT/SPOT</div>
                        <div className="font-medium mt-1">{selectedContract.lt_spot || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500 flex items-center gap-1">
                          Log Cycle
                          <FieldHelp text={FIELD_HELP.logCycle} />
                        </div>
                        <div className="font-medium mt-1">
                          {selectedContract.log_cycle_days != null ? `${selectedContract.log_cycle_days} days` : '-'}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500 flex items-center gap-1">
                          Trade Cycle
                          <FieldHelp text={FIELD_HELP.tradeCycle} />
                        </div>
                        <div className={`font-medium mt-1 ${
                          typeof selectedContract.trade_cycle_days === 'number'
                            ? selectedContract.trade_cycle_days === 0
                              ? 'text-gray-500'
                              : selectedContract.trade_cycle_days > 0
                                ? 'text-red-600'
                                : 'text-green-600'
                            : ''
                        }`}>
                          {selectedContract.trade_cycle_days != null
                            ? selectedContract.trade_cycle_days === 0
                              ? '0 days'
                              : selectedContract.trade_cycle_days > 0
                                ? `${selectedContract.trade_cycle_days} days overdue`
                                : `${Math.abs(selectedContract.trade_cycle_days)} days left`
                            : '-'}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500 flex items-center gap-1">
                          Cash Cycle
                          <FieldHelp text={FIELD_HELP.cashCycle} />
                        </div>
                        <div className={`font-medium mt-1 ${
                          typeof selectedContract.cash_cycle_days === 'number'
                            ? selectedContract.cash_cycle_days === 0
                              ? 'text-gray-500'
                              : selectedContract.cash_cycle_days > 0
                                ? 'text-red-600'
                                : 'text-green-600'
                            : ''
                        }`}>
                          {selectedContract.cash_cycle_days != null
                            ? selectedContract.cash_cycle_days === 0
                              ? '0 days'
                              : selectedContract.cash_cycle_days > 0
                                ? `${selectedContract.cash_cycle_days} days overdue`
                                : `${Math.abs(selectedContract.cash_cycle_days)} days left`
                            : '-'}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded col-span-2">
                        <div className="text-gray-500">
                          PO Number{selectedContract.po_count > 1 ? `s (${selectedContract.po_count} total)` : ''}
                        </div>
                        <div className="font-medium mt-1 text-xs">
                          {selectedContract.po_numbers || selectedContract.po_number || '-'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Parties */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Parties</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Buyer</div>
                        <div className="font-medium mt-1">{partiesBuyerDisplay(selectedContract)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Supplier</div>
                        <div className="font-medium mt-1">{selectedContract.supplier}</div>
                      </div>
                    </div>
                  </div>

                  {/* B2B Parties */}
                  {(isContractB2b(selectedContract) &&
                    String(selectedContract.contract_reference_po || '').trim() === '') && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        B2B Parties
                        <FieldHelp text={FIELD_HELP.b2bParties} />
                      </h3>
                      {b2bPartiesLoading ? (
                        <div className="text-sm text-gray-500">Loading B2B parties...</div>
                      ) : b2bParties.length === 0 ? (
                        <div className="text-sm text-gray-500">No B2B contracts linked to this origin contract.</div>
                      ) : (
                        <div className="overflow-x-auto border rounded">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-100 border-b">
                                <th className="text-left p-2 font-medium">PO Number</th>
                                <th className="text-left p-2 font-medium">Contract Ext No</th>
                                <th className="text-left p-2 font-medium">Company Name</th>
                                <th className="text-left p-2 font-medium">Supplier</th>
                                <th className="text-left p-2 font-medium">Incoterm</th>
                                <th className="text-left p-2 font-medium">Certification</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b2bParties.map((r) => (
                                <tr key={r.contract_id} className="border-b last:border-0">
                                  <td className="p-2">{r.po_numbers || '-'}</td>
                                  <td className="p-2">{r.contract_ext_no || '-'}</td>
                                  <td className="p-2">{r.company_name || '-'}</td>
                                  <td className="p-2">{r.supplier || '-'}</td>
                                  <td className="p-2">{r.incoterm || '-'}</td>
                                  <td className="p-2">{r.certification || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Product & Quantity */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Product & Quantity</h3>
                    {(() => {
                      const inc = String(selectedContract.incoterm || '').trim().toUpperCase()
                      const basis =
                        inc === 'FRC' || inc === 'CIF' || inc === 'CFR'
                          ? { label: 'Quantity Receive', hint: 'Incoterm FRC/CIF/CFR' }
                          : inc === 'LCO' || inc === 'FOB'
                            ? { label: 'Quantity Delivery', hint: 'Incoterm LCO/FOB' }
                            : { label: 'STO Quantity', hint: 'Fallback (other incoterms)' }
                      return (
                        <div className="text-xs text-gray-600 mb-2">
                          Outstanding Quantity basis: <span className="font-medium text-gray-800">{basis.label}</span>{' '}
                          <span className="text-gray-500">({basis.hint})</span>
                        </div>
                      )
                    })()}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Product</div>
                        <div className="font-medium mt-1">{selectedContract.product}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Contract Quantity</div>
                        <div className="font-medium mt-1 text-base">{((Number(selectedContract.quantity_ordered) || 0) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Quantity Delivery</div>
                        <div className="font-medium mt-1 text-base">{formatNumber(selectedContract.quantity_delivery ?? 0)} Kg</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Quantity Receive</div>
                        <div className="font-medium mt-1 text-base">{formatNumber(selectedContract.quantity_receive ?? 0)} Kg</div>
                      </div>
                      <div className="p-3 bg-blue-50 rounded border-2 border-blue-200">
                        <div className="text-gray-500">Total STO Quantity ({selectedContract.sto_count || 0} STO{selectedContract.sto_count > 1 ? 's' : ''})</div>
                        <div className="font-medium mt-1 text-base">{formatNumber(selectedContract.total_sto_quantity)} Kg</div>
                      </div>
                      <div className={`p-3 rounded border-2 ${selectedContract.outstanding_quantity < 0 ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                        <div className={`font-semibold flex items-center gap-1 ${selectedContract.outstanding_quantity < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                          Outstanding Quantity
                          <FieldHelp text={FIELD_HELP.outstandingQty} />
                        </div>
                        <div className={`font-bold text-xl mt-1 ${selectedContract.outstanding_quantity < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {formatNumber(selectedContract.outstanding_quantity)} Kg
                        </div>
                        {selectedContract.outstanding_quantity < 0 && (
                          <div className="text-xs text-red-500 mt-1">Overshipped</div>
                        )}
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500 flex items-center gap-1">
                          Over/Under Delivery Status
                          <FieldHelp text={FIELD_HELP.overUnderDelivery} />
                        </div>
                        <div className="font-semibold mt-1">
                          {selectedContract.over_under_delivery_status || '-'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Logistic Information */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Logistic Information</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Transport Mode</div>
                        <div className="font-medium mt-1">{selectedContract.transport_mode || '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Incoterm</div>
                        <div className="font-medium mt-1">{selectedContract.incoterm || '-'}</div>
                      </div>
                    </div>
                    {stoInfoLoading ? (
                      <div className="text-sm text-gray-500">Loading STO information...</div>
                    ) : stoInfo.length === 0 ? (
                      <div className="text-sm text-gray-500">No STO information for this contract.</div>
                    ) : (
                      <div className="overflow-x-auto border rounded">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-100 border-b">
                              <th className="text-left p-2 font-medium">STO No</th>
                              <th className="text-left p-2 font-medium">Operation ID</th>
                              <th className="text-left p-2 font-medium">Type</th>
                              <th className="text-left p-2 font-medium">Late Indicator</th>
                              <th className="text-left p-2 font-medium">Status</th>
                              <th className="text-left p-2 font-medium">STO Quantity</th>
                              <th className="text-left p-2 font-medium">Quantity Delivered (Kg)</th>
                              <th className="text-left p-2 font-medium">Quantity Received (Kg)</th>
                              <th className="text-left p-2 font-medium">Vessel Name / Trucking Owner</th>
                              <th className="text-left p-2 font-medium">ETA Vessel Arrival at Loading Port / ETA Trucking Completion Date</th>
                              <th className="text-left p-2 font-medium">ATA Vessel Complete Discharge / Trucking Last Receive Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stoInfo.map((row, idx) => (
                              <tr key={`${row.type}-${row.sto_number}-${idx}`} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="p-2">
                                  <button
                                    type="button"
                                    onClick={() => openStoDetail(row)}
                                    className="text-left text-blue-600 hover:underline font-medium cursor-pointer"
                                  >
                                    {row.sto_number || '-'}
                                  </button>
                                </td>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    onClick={() => openStoDetail(row)}
                                    className="text-left text-blue-600 hover:underline font-medium cursor-pointer"
                                  >
                                    {row.operation_id ?? '-'}
                                  </button>
                                </td>
                                <td className="p-2">
                                  <Badge variant="outline" className={row.type === 'shipment' ? 'border-blue-300 text-blue-700' : 'border-amber-300 text-amber-700'}>
                                    {row.type === 'shipment' ? 'Shipment' : 'Trucking'}
                                  </Badge>
                                </td>
                                <td className="p-2">
                                  <Badge className={row.late_indicator === 'Late' ? 'bg-red-500' : row.late_indicator === 'On Time' ? 'bg-green-500' : 'bg-gray-400'}>
                                    {row.late_indicator}
                                  </Badge>
                                </td>
                                <td className="p-2">{row.status}</td>
                                <td className="p-2">{formatNumber(row.sto_quantity)}</td>
                                <td className="p-2">
                                  {formatNumber(row.quantity_delivered ?? 0)}
                                </td>
                                <td className="p-2">
                                  {formatNumber(row.quantity_receive ?? 0)}
                                </td>
                                <td className="p-2">
                                  {row.type === 'shipment' ? (row.vessel_name ?? '-') : (row.trucking_owner ?? '-')}
                                </td>
                                <td className="p-2">
                                  {row.type === 'shipment'
                                    ? (row.eta_vessel_arrival_loading_port ? formatDate(row.eta_vessel_arrival_loading_port) : '-')
                                    : (row.eta_trucking_completion_date ? formatDate(row.eta_trucking_completion_date) : '-')}
                                </td>
                                <td className="p-2">
                                  {row.type === 'shipment'
                                    ? (row.ata_discharge_complete ? formatDate(row.ata_discharge_complete) : '-')
                                    : (row.trucking_completion_date ? formatDate(row.trucking_completion_date) : '-')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Dates */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Important Dates</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Contract Date</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.contract_date)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Due Date Delivery Start</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.delivery_start_date)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Due Date Delivery End</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.delivery_end_date)}</div>
                      </div>
                      {isContractPerformance && (
                        <div className="p-3 bg-gray-50 rounded">
                          <div className="text-gray-500">Month Delivery End</div>
                          <div className="font-medium mt-1">{formatMonthDeliveryEnd(selectedContract.delivery_end_date)}</div>
                        </div>
                      )}
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Cargo Readiness Date</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.cargo_readiness_date as any)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Payment Dates */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Payment Information</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Unit Price</div>
                        <div className="font-medium mt-1">{formatCurrency(selectedContract.unit_price, selectedContract.currency)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Contract Value</div>
                        <div className="font-medium mt-1">{formatCurrency(selectedContract.contract_value, selectedContract.currency)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Due Date Payment</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.due_date_payment as any)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">DP Date</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.dp_date as any)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Payoff Date</div>
                        <div className="font-medium mt-1">{formatDate(selectedContract.payoff_date as any)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">DP Date Deviation (Days)</div>
                        <div className="font-medium mt-1">{selectedContract.dp_date_deviation_days ?? '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Payoff Date Deviation (Days)</div>
                        <div className="font-medium mt-1">{selectedContract.payoff_date_deviation_days ?? '-'}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Payment Status</div>
                        <div className="font-medium mt-1">
                          {contractPaymentsLoading ? (
                            <span className="text-gray-400">Loading...</span>
                          ) : contractPayments.length === 0 ? (
                            '-'
                          ) : (
                            contractPayments.map((p) => p.payment_status).filter(Boolean).join(', ') || '-'
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Documents */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Documents</h3>
                    {docsLoading ? (
                      <div className="text-sm text-gray-500">Loading documents...</div>
                    ) : selectedContractDocs.length === 0 ? (
                      <div className="text-sm text-gray-500">No documents uploaded for this contract.</div>
                    ) : (
                      <div className="space-y-2">
                        {selectedContractDocs.map((doc) => {
                          return (
                            <div key={doc.id} className="flex items-center justify-between px-3 py-2 border rounded">
                              <div>
                                <div className="text-sm font-medium">{doc.file_name}</div>
                                <div className="text-xs text-gray-500">
                                  {(doc.document_type || 'FILE')} • {doc.created_at ? new Date(doc.created_at).toLocaleString() : ''}
                                </div>
                              </div>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleDownloadDocument(doc.id, doc.file_name)}
                              >
                                View
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Activity Log / Comments */}
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="text-lg font-semibold">Activity</h3>
                      <div className="inline-flex rounded-md border overflow-hidden">
                        <button
                          type="button"
                          className={`px-3 py-1.5 text-sm ${detailLogTab === 'activity' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                          onClick={() => setDetailLogTab('activity')}
                        >
                          Activity Log
                        </button>
                        <button
                          type="button"
                          className={`px-3 py-1.5 text-sm ${detailLogTab === 'comments' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                          onClick={() => setDetailLogTab('comments')}
                        >
                          Comments
                        </button>
                      </div>
                    </div>

                    {detailLogTab === 'activity' ? (
                      activityLogLoading ? (
                        <p className="text-sm text-gray-500 py-4">Loading activity...</p>
                      ) : activityLog.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4">No activity recorded for this contract.</p>
                      ) : (
                        <div className="overflow-x-auto rounded border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b">
                                <th className="text-left p-2 font-medium">User</th>
                                <th className="text-left p-2 font-medium">Date &amp; Time</th>
                                <th className="text-left p-2 font-medium">Action</th>
                                <th className="text-left p-2 font-medium">Area</th>
                                <th className="text-left p-2 font-medium">Field</th>
                                <th className="text-left p-2 font-medium">Old value</th>
                                <th className="text-left p-2 font-medium">New value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activityLog.flatMap((log) => {
                                const before = log.before_data && typeof log.before_data === 'object' ? log.before_data as Record<string, unknown> : {}
                                const after = log.after_data && typeof log.after_data === 'object' ? log.after_data as Record<string, unknown> : {}
                                const toStr = (v: unknown): string => {
                                  if (v == null) return ''
                                  if (typeof v === 'object') return JSON.stringify(v)
                                  return String(v)
                                }
                                const keys = new Set([...Object.keys(before), ...Object.keys(after)])
                                const rows = Array.from(keys)
                                  .filter((k) => toStr(before[k]) !== toStr(after[k]))
                                  .map((k) => ({
                                    key: k,
                                    old: before[k] != null ? (typeof before[k] === 'object' ? JSON.stringify(before[k]) : String(before[k])) : '—',
                                    new: after[k] != null ? (typeof after[k] === 'object' ? JSON.stringify(after[k]) : String(after[k])) : '—',
                                  }))
                                const entityLabel = log.entity_type.replace(/_/g, ' ')
                                const userLabel = log.username || log.full_name || '—'
                                const timeLabel = log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'

                                if (rows.length === 0) return []

                                return rows.map((row, i) => (
                                  <tr key={`${log.id}-${row.key}-${i}`} className="border-b last:border-0">
                                    {i === 0 ? (
                                      <>
                                        <td className="p-2 align-top" rowSpan={rows.length}>{userLabel}</td>
                                        <td className="p-2 align-top whitespace-nowrap" rowSpan={rows.length}>{timeLabel}</td>
                                        <td className="p-2 align-top" rowSpan={rows.length}>{log.action}</td>
                                        <td className="p-2 align-top" rowSpan={rows.length}>{entityLabel}</td>
                                      </>
                                    ) : null}
                                    <td className="p-2 align-top text-gray-700 whitespace-nowrap">{row.key}</td>
                                    <td className="p-2 align-top text-gray-600 max-w-[260px] truncate" title={row.old}>{row.old}</td>
                                    <td className="p-2 align-top max-w-[260px] truncate" title={row.new}>{row.new}</td>
                                  </tr>
                                ))
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    ) : (
                      <div className="rounded border p-3">
                        <div className="flex items-start gap-2">
                          <textarea
                            className="w-full min-h-[80px] border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                            placeholder="Write a comment for this contract..."
                            value={newRemarkText}
                            onChange={(e) => setNewRemarkText(e.target.value)}
                          />
                          <Button
                            type="button"
                            onClick={saveNewRemark}
                            disabled={newRemarkSaving || !newRemarkText.trim()}
                          >
                            {newRemarkSaving ? 'Saving...' : 'Post'}
                          </Button>
                        </div>

                        <div className="mt-4">
                          {contractRemarksLoading ? (
                            <div className="text-sm text-gray-500 py-4">Loading comments...</div>
                          ) : contractRemarks.length === 0 ? (
                            <div className="text-sm text-gray-500 py-4">No comments yet.</div>
                          ) : (
                            <div className="space-y-3">
                              {contractRemarks.map((r) => (
                                <div key={r.id} className="border rounded p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium">
                                      {r.full_name || r.username || '—'}
                                    </div>
                                    <div className="text-xs text-gray-500 whitespace-nowrap">
                                      {r.created_at ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                    </div>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words">{r.text}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* STO / Operation detail modal */}
        {stoDetailRow && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <Card className="max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              <CardHeader className="shrink-0 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {stoDetailRow.type === 'shipment' ? 'Shipment' : 'Trucking'} details
                    {stoDetailRow.sto_number && stoDetailRow.sto_number !== '-' && ` · STO ${stoDetailRow.sto_number}`}
                    {stoDetailRow.operation_id && ` · ${stoDetailRow.operation_id}`}
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={closeStoDetail}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto">
                {stoDetailLoading ? (
                  <div className="text-sm text-gray-500 py-8">Loading details...</div>
                ) : !stoDetailData ? (
                  <div className="text-sm text-gray-500 py-8">No details found for this STO / Operation.</div>
                ) : stoDetailRow.type === 'shipment' ? (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">STO No</span><div className="font-medium mt-1">{stoDetailData.sto_number ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Operation ID</span><div className="font-medium mt-1">{stoDetailData.operation_id ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Status</span><div className="font-medium mt-1">{stoDetailData.status ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Vessel Name</span><div className="font-medium mt-1">{stoDetailData.vessel_name ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Contract(s)</span><div className="font-medium mt-1">{stoDetailData.contract_numbers ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Port of Loading</span><div className="font-medium mt-1">{stoDetailData.port_of_loading ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Port of Discharge</span><div className="font-medium mt-1">{stoDetailData.port_of_discharge ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">STO Quantity</span><div className="font-medium mt-1">{formatNumber(stoDetailData.sto_quantity ?? 0)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Quantity Delivered</span><div className="font-medium mt-1">{formatNumber(stoDetailData.quantity_delivered ?? 0)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Due Date Delivery Start</span><div className="font-medium mt-1">{formatDate(stoDetailData.delivery_start_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Due Date Delivery End</span><div className="font-medium mt-1">{formatDate(stoDetailData.delivery_end_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">ATA Vessel Completed Loading</span><div className="font-medium mt-1">{formatDate(stoDetailData.ata_vessel_completed_loading)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">ATA Vessel Complete Discharge</span><div className="font-medium mt-1">{formatDate(stoDetailData.ata_vessel_complete_discharge)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">ETA Vessel Complete Discharge</span><div className="font-medium mt-1">{formatDate(stoDetailData.eta_vessel_complete_discharge)}</div></div>
                    <div className="p-3 bg-gray-50 rounded col-span-2"><span className="text-gray-500">Product</span><div className="font-medium mt-1">{stoDetailData.product ?? '-'}</div></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">STO No</span><div className="font-medium mt-1">{stoDetailData.sto_number ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Operation ID</span><div className="font-medium mt-1">{stoDetailData.operation_id ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Status</span><div className="font-medium mt-1">{stoDetailData.status ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Trucking Owner</span><div className="font-medium mt-1">{stoDetailData.trucking_owner ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Contract</span><div className="font-medium mt-1">{stoDetailData.contract_number ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Loading Location</span><div className="font-medium mt-1">{stoDetailData.loading_location ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Unloading Location</span><div className="font-medium mt-1">{stoDetailData.unloading_location ?? '-'}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Contract Qty</span><div className="font-medium mt-1">{formatNumber(stoDetailData.contract_qty ?? stoDetailData.sto_quantity ?? 0)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Quantity Receive (Kg)</span><div className="font-medium mt-1">{formatNumber(toKgFromMt(stoDetailData.quantity_delivered ?? 0))}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Due Date Delivery Start</span><div className="font-medium mt-1">{formatDate(stoDetailData.delivery_start_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Due Date Delivery End</span><div className="font-medium mt-1">{formatDate(stoDetailData.delivery_end_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Trucking Start Receive Date</span><div className="font-medium mt-1">{formatDate(stoDetailData.trucking_start_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">Trucking Last Receive Date</span><div className="font-medium mt-1">{formatDate(stoDetailData.trucking_completion_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">ETA Trucking Start Receive Date</span><div className="font-medium mt-1">{formatDate(stoDetailData.eta_trucking_start_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded"><span className="text-gray-500">ETA Trucking Completion Date</span><div className="font-medium mt-1">{formatDate(stoDetailData.eta_trucking_completion_date)}</div></div>
                    <div className="p-3 bg-gray-50 rounded col-span-2"><span className="text-gray-500">Product</span><div className="font-medium mt-1">{stoDetailData.product ?? '-'}</div></div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <CreateTruckingOperationModal
          open={contractLogisticsUi?.kind === 'truck-create'}
          onClose={() => setContractLogisticsUi(null)}
          onCreated={() => {
            setContractLogisticsUi(null)
            void fetchContracts(currentPage)
            void fetchUnassignedCounts()
          }}
          initialContractExtNo={
            contractLogisticsUi?.kind === 'truck-create'
              ? contractLogisticsUi.contract.contract_ext_no || contractLogisticsUi.contract.contract_id
              : null
          }
        />
        <AddShipmentModal
          open={contractLogisticsUi?.kind === 'ship-create'}
          onClose={() => setContractLogisticsUi(null)}
          onCreated={() => {
            setContractLogisticsUi(null)
            void fetchContracts(currentPage)
            void fetchUnassignedCounts()
          }}
          initialContractId={contractLogisticsUi?.kind === 'ship-create' ? contractLogisticsUi.contractId : null}
        />
        <ContractTruckingDetailModal
          open={contractLogisticsUi?.kind === 'truck-detail'}
          contractId={contractLogisticsUi?.kind === 'truck-detail' ? contractLogisticsUi.contractId : null}
          onClose={() => setContractLogisticsUi(null)}
        />
        <ContractShipmentDetailModal
          open={contractLogisticsUi?.kind === 'ship-detail'}
          contractId={contractLogisticsUi?.kind === 'ship-detail' ? contractLogisticsUi.contractId : null}
          onClose={() => setContractLogisticsUi(null)}
        />

        <Dialog open={!!csvCargoResult} onOpenChange={(open) => { if (!open) setCsvCargoResult(null) }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Cargo Readiness Upload Result</DialogTitle>
            </DialogHeader>
            {csvCargoResult && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Updated</div>
                    <div className="text-lg font-semibold tabular-nums text-green-700">{csvCargoResult.updated}</div>
                  </div>
                  <div className="rounded-md border bg-yellow-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Not Found</div>
                    <div className="text-lg font-semibold tabular-nums text-yellow-700">{csvCargoResult.notFound}</div>
                  </div>
                  <div className="rounded-md border bg-red-50 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Errors</div>
                    <div className="text-lg font-semibold tabular-nums text-red-700">{csvCargoResult.errors.length}</div>
                  </div>
                </div>
                {csvCargoResult.errors.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-900 mb-2">Failed rows</div>
                    <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                      {csvCargoResult.errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-mono font-semibold">{e.po_number}</span>: {e.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}

export default function ContractsPage() {
  return (
    <Suspense fallback={<Layout><div className="flex items-center justify-center p-8"><div className="text-gray-500">Loading...</div></div></Layout>}>
      <ContractsPageContent />
    </Suspense>
  )
}
