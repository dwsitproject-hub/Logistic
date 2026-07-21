'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Flag, GripVertical, HelpCircle, Loader2, Pencil, Plus, Search, Filter, Eye, X, Upload, Truck, Ship, FileText, SlidersHorizontal, Download, ClipboardCheck } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import api from '@/lib/api'
import { buildCacheKey, cachedGet, invalidateLogisticsListCaches } from '@/lib/clientDataCache'
import { CreateTruckingOperationModal } from '@/components/trucking/CreateTruckingOperationModal'
import { formatContractDeliveryStatusLabel } from '@/lib/contractDeliveryStatus'
import { AddNewShipmentModal } from '@/components/shared/AddNewShipmentModal'
import type { ShipmentPoOption } from '@/components/shared/addNewShipmentTypes'
import { fetchContractPurchaseOrderOptions } from '@/components/shared/addNewShipmentTypes'
import { submitAddNewShipmentPayload } from '@/lib/addNewShipmentSubmit'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { Checkbox } from '@/components/ui/checkbox'
import { cn, formatOutstandingQtyMtFromKg, formatQtyMtFromKg, outstandingQtyMtColorClass } from '@/lib/utils'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import {
  contextPerformanceClass,
  formatAvgDays,
  statusCardAvgDaysClass,
  formatContractAgingDays,
  formatLogCycleDays,
  formatLogCycleDaysCompact,
  formatSignedCycleDays,
  formatSignedCycleDaysCompact,
  logCycleDaysClass,
  signedCycleDaysClass,
} from '@/lib/cycleDaysDisplay'
import { formatDateDMY, toSortableTimestamp } from '@/lib/dateFormat'
import { formatOperationalTableTextDisplay, formatSapDisplayValue, formatSapOutstandingQtyMtDisplay, formatSapQtyMtDisplay, formatVesselTableDisplay } from '@/lib/sapDisplayValue'
import { PerformanceScopeFilters } from '@/components/performance/PerformanceScopeFilters'
import { ContractPerfTruncatedCell } from '@/components/performance/ContractPerfTruncatedCell'
import {
  CONTRACTS_LIST_TRUNCATE_TOOLTIP_COLUMN_IDS,
  operationalRowFieldTooltipText,
  shouldApplyOperationalTruncateTooltip,
} from '@/lib/operationalTableTruncateUi'
import {
  TableInitialLoadPlaceholder,
  TableInitialLoadPlaceholderContent,
} from '@/components/performance/TableInitialLoadPlaceholder'
import { appendToolbarMultiToColumnFilters, filterIncotermOptions } from '@/lib/globalScopeFilters'
import {
  CARGO_READINESS_UPLOAD_ACCEPT,
  triggerCargoReadinessTemplateDownload,
} from '@/lib/cargoReadinessTemplate'
import { canViewContractPerformancePage, usePermissions } from '@/components/PermissionsContext'
import {
  ContractDetailModal,
  type DocumentItem,
  handleDownloadDocument,
  partiesBuyerDisplay,
} from '@/components/contracts/ContractDetailModal'
import { useUserScopeFilterDefaults } from '@/hooks/useUserScopeFilterDefaults'
import { getInitialUserScopeFilters, markUserScopeFiltersCleared, wereUserScopeFiltersCleared } from '@/lib/userScopeFilters'
import {
  type ContractPerfColumnFilter,
  type ContractPerfDrilldownFilters,
  type ContractPerfHotspot,
  type ContractPerfProductTab,
  type LatePerfApiTreeNode,
  CONTRACT_PERF_PRODUCT_TABS,
  CONTRACT_PERF_SOURCE_TABS,
  type ContractPerfSourceFilter,
  EMPTY_CONTRACT_PERF_DRILLDOWN,
  buildContractPerfTableFetchScope,
  buildContractPerfToolbarGlobal,
  buildLatePerformanceCardSummaryApiParams,
  buildContractPerfTableListParams,
  contractPerfDrilldownSelectionsEqual,
  contractPerfDrilldownToTableColumnFilters,
  contractPerfProductQueryValue,
  contractPerfGroupPlantsQueryValue,
  stableContractPerfApiParamsKey,
  flattenLatePerfApiTreeToHotspots,
  hasContractPerfDrilldownSelection,
  isContractPerfDrilldownValueSet,
  isContractPerfSection3FilterApplied,
  matchesContractPerfProductTabFilter,
  normalizePerfGroupKey,
  normalizePerfProductGroupKey,
  resolveContractPerformanceScope,
  sumHotspotQtyKg,
} from '@/lib/contractPerformanceFilters'
import {
  findUnifiedPerfNode,
  mergeUnifiedPerfBranchTrees,
} from '@/lib/contractPerfUnifiedDrilldown'
import {
  ContractPerfUnifiedNodeCard,
  type PerfSegmentFilter,
} from '@/components/contract-performance/ContractPerfUnifiedNodeCard'
import { PerformanceSection1CardShell } from '@/components/performance/PerformanceSection1CardShell'
import {
  CONTRACT_PERF_COLUMN_LAYOUT_VERSION,
  CONTRACT_PERF_COLUMN_LAYOUT_VERSION_KEY,
  CONTRACT_PERF_DEFAULT_VISIBLE_COLUMN_IDS,
  CONTRACT_PERF_LEGACY_STORAGE_KEYS,
  CONTRACTS_COLUMN_LAYOUT_VERSION,
  CONTRACTS_COLUMN_LAYOUT_VERSION_KEY,
  CONTRACT_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS,
  buildContractPerfVisibleColumns,
  contractPerfCellTooltipText,
  contractPerfCompactColumnFallbackOrder,
  contractPerfDefaultVisibleColumnIds,
  contractPerfTableColumnWidthPx,
  migrateContractColumnLayout,
  COMPACT_TABLE_ACTIONS_CELL_CLASS,
  COMPACT_TABLE_ACTIONS_COL_WIDTH_PX,
  COMPACT_TABLE_ACTIONS_HEADER_CLASS,
  CONTRACT_PERF_TABLE_CELL_PAD,
  COMPACT_TABLE_ACTIONS_HEADER_STICKY_CLASS,
  CONTRACT_PERF_TABLE_HEADER_ROW_CLASS,
  CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS,
  CONTRACT_PERF_TABLE_HEADER_ROW_PERF_CLASS,
  CONTRACT_PERF_TABLE_ROW_MIN_H,
  getContractPerfTableColumnLayout,
  isContractPerformancePathname,
  mergeContractPerfColumnOrder,
  orderContractPerformanceColumns,
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
import {
  getOperationalColumnLayout,
  OperationalNowrapCell,
  OperationalStackedCommaCell,
  operationalTableColumnClass,
} from '@/lib/operationalTableLayout'
import { useContractPerformanceFilters } from '@/hooks/useContractPerformanceFilters'
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
  'dp_cycle_days',
  'contract_aging',
  'delivery_status',
  'status_overall',
  'unusual_status',
  'delivery_qty',
  'received_qty',
  'over_under_delivery_status',
  'month_delivery_end',
  'cargo_readiness_date',
  'vessel_name',
  'eta_vessel_completed_loading',
  'eta_vessel_complete_discharge',
  'last_planning_delivery_date',
  'po_number',
  'contract_ext_no',
  'source_type',
  'lt_spot',
  'sto_number',
])

/**
 * Temporarily hide SEA/LAND/MIX contracts-without-logistics cards.
 * Keep the implementation available for re-enable, but disable rendering and
 * every related API/list-filter path while this flag is false.
 */
const CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED = false

/**
 * Contracts Outstanding Qty display — no sign prefix.
 * Over-delivery (kept green via outstandingQtyMtColorClass) and 0 MT (gray) show
 * the plain value without a leading "+" or "-".
 */
function formatContractOutstandingQtyMtDisplay(kg: number | string | null | undefined): string {
  return formatSapOutstandingQtyMtDisplay(kg).replace(/^[+-]/, '')
}

const DATE_SORT_COLUMN_IDS = new Set([
  'contract_date',
  'delivery_start',
  'delivery_end',
  'created_at',
  'cargo_readiness_date',
  'eta_vessel_completed_loading',
  'eta_vessel_complete_discharge',
  'last_planning_delivery_date',
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
  gr_po_status?: string | null
  gr_sto_status?: string | null
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
  dp_cycle_days?: number | null
  contract_perf_on_time?: boolean | null
  contract_perf_in_tree?: boolean | null
  payment_status?: string
  company_name?: string
  vessel_name?: string | null
  eta_vessel_completed_loading?: string | null
  eta_vessel_complete_discharge?: string | null
  /** Last date from trucking daily planning deliverables (LAND). */
  last_planning_delivery_date?: string | null
}

type ContractsUnassignedCardFilter = 'sea' | 'land' | 'mix'

function contractsListTableScopeLabel(
  unassignedFilter: ContractsUnassignedCardFilter | null,
  statusFilter: string,
): { text: string; emphasized: boolean } {
  if (unassignedFilter === 'sea') {
    return { text: 'SEA · Without shipment · Open', emphasized: true }
  }
  if (unassignedFilter === 'land') {
    return { text: 'LAND · Without trucking · Open', emphasized: true }
  }
  if (unassignedFilter === 'mix') {
    return { text: 'MIX · Without logistics · Open', emphasized: true }
  }
  if (statusFilter !== 'All Status') {
    return { text: `Table · ${statusFilter}`, emphasized: false }
  }
  return { text: 'Table · All status', emphasized: false }
}

function contractCountGt0(v: unknown): boolean {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) && n > 0
}

/** True when a Klip `shipments` row exists — matches SEA-without-shipment filter on the backend. */
function contractHasKlipShipment(contract: { shipment_count?: unknown }): boolean {
  return contractCountGt0(contract.shipment_count)
}

function getStatusColor(status: string) {
  switch (status) {
    case 'Close':
    case 'CLOSE':
    case 'CLOSED':
    case 'Completed':
    case 'COMPLETED':
      return 'bg-red-100 text-red-800 hover:bg-red-100'
    case 'Open':
    case 'OPEN':
    case 'ACTIVE':
      return 'bg-green-100 text-green-800 hover:bg-green-100'
    case 'Cancelled':
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 hover:bg-red-100'
    default:
      return 'bg-gray-100 text-gray-800 hover:bg-gray-100'
  }
}

function resolveContractStatusDisplay(c: {
  import_status?: string
  status?: string
  payment_status?: string
}): string {
  const delivery = String(c.import_status || c.status || '').toUpperCase()
  const paid = String(c.payment_status || '').toUpperCase() === 'PAID'
  if (delivery === 'CLOSE' && paid) return 'Close'
  return formatContractDeliveryStatusLabel(c.import_status || c.status)
}

function contractStatusBadgeClass(c: {
  import_status?: string
  status?: string
  payment_status?: string
}): string {
  const delivery = String(c.import_status || c.status || '').trim().toUpperCase()
  if (delivery === 'OPEN' || delivery === 'ACTIVE') {
    return getStatusColor('OPEN')
  }
  if (delivery === 'CLOSE' || delivery === 'CLOSED' || delivery === 'COMPLETED') {
    return getStatusColor('CLOSE')
  }
  return getStatusColor(resolveContractStatusDisplay(c))
}

/** Hidden from the Contracts table and Visible Columns picker; retained for Contract Performance. */
const CONTRACTS_HIDDEN_COLUMN_IDS = new Set([
  'cash_cycle_days',
  'log_cycle_days',
  'trade_cycle_days',
  'contract_aging',
])

/** Default left-to-right order on `/contracts` when no saved column order (Supplier & Buyer after PO Number). */
const CONTRACTS_DEFAULT_COLUMN_ORDER: string[] = [
  'contract_date',
  'contract_id',
  'contract_ext_no',
  'po_number',
  'product',
  'incoterm',
  'supplier',
  'company_name',
  'contract_qty',
  'delivery_qty',
  'outstanding_qty_mt',
]

/** Contract Performance page-only product tabs (Section 1–3) — tab list lives in contractPerformanceFilters. */

/** Staff default product tab — sync on first render so Section 1 API matches toolbar scope. */
function resolveStaffContractPerfProductTab(): (typeof CONTRACT_PERF_PRODUCT_TABS)[number] {
  if (typeof window === 'undefined') return 'All'
  if (wereUserScopeFiltersCleared('contracts')) return 'All'
  const { products } = getInitialUserScopeFilters()
  if (products.length !== 1) return 'All'
  const match = CONTRACT_PERF_PRODUCT_TABS.find(
    (tab) =>
      tab !== 'All' &&
      normalizePerfProductGroupKey(tab) === normalizePerfProductGroupKey(products[0]),
  )
  return match ?? 'All'
}

/** Contract Performance first load — Open selected so Section 1, drilldown, and table stay in sync.
 * Must use Next `pathname` (not `window`) so SSR + hydration agree; otherwise hard refresh
 * often leaves Open unselected while client navigations look correct.
 */
function resolveContractPerfInitialSummaryCardStatus(
  pathname: string | null | undefined,
): 'All' | 'Open' | 'Close' {
  return isContractPerformancePathname(pathname) ? 'Open' : 'All'
}

/** Contracts list — All Status; Contract Performance — Open (matches Section 1 default). */
function resolveContractsListInitialStatusFilter(pathname: string | null | undefined): string {
  return isContractPerformancePathname(pathname) ? 'Open' : 'All Status'
}

type ContractPerfDrilldownRow = {
  contract_id: string
  incoterm: string
  product: string
  plant_site: string
  supplier: string
  totalDays: number
  maxDays: number
  totalQtyDelivery: number
}

type ContractPerfBranchNode = {
  id: string
  label: string
  level: 'total' | 'incoterm' | 'product' | 'plant' | 'supplier'
  count: number
  totalDays: number
  maxDays: number
  totalQtyDelivery: number
  children: ContractPerfBranchNode[]
}

/** Contract Performance — display-only outstanding qty (kg input, whole-number MT output). */
function formatContractPerfOutstandingMt(kg: number): string {
  return `${(kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} MT`
}

function formatContractPerfAppliedDrilldownLabel(d: ContractPerfDrilldownFilters): string {
  const parts: string[] = []
  if (isContractPerfDrilldownValueSet(d.product)) parts.push(d.product!)
  if (isContractPerfDrilldownValueSet(d.plant)) parts.push(d.plant!)
  if (isContractPerfDrilldownValueSet(d.incoterm)) parts.push(d.incoterm!)
  if (isContractPerfDrilldownValueSet(d.supplier)) parts.push(d.supplier!)
  return parts.join(' · ')
}

/** Section 2 column header — preserves parent path when drilling deeper (presentation only). */
function contractPerfDrilldownColumnSubtitle(
  level: 'product' | 'plant' | 'incoterm' | 'supplier',
  d: ContractPerfDrilldownFilters,
): string {
  switch (level) {
    case 'product':
      return isContractPerfDrilldownValueSet(d.product) ? `Selected: ${d.product}` : 'Pick one'
    case 'plant':
      if (!isContractPerfDrilldownValueSet(d.product)) return 'Pick product first'
      return isContractPerfDrilldownValueSet(d.plant)
        ? `${d.product} › ${d.plant}`
        : `Under ${d.product}`
    case 'incoterm':
      if (!isContractPerfDrilldownValueSet(d.product) || !isContractPerfDrilldownValueSet(d.plant)) {
        return 'Pick plant first'
      }
      return isContractPerfDrilldownValueSet(d.incoterm)
        ? `${d.product} › ${d.plant} › ${d.incoterm}`
        : `Under ${d.product} › ${d.plant}`
    case 'supplier': {
      if (!isContractPerfDrilldownValueSet(d.incoterm)) return 'Pick incoterm first'
      const base = [d.product, d.plant, d.incoterm].filter(isContractPerfDrilldownValueSet).join(' › ')
      return isContractPerfDrilldownValueSet(d.supplier) ? `${base} › ${d.supplier}` : `Under ${base}`
    }
  }
}

function buildNextContractPerfDrilldownSelection(
  prev: ContractPerfDrilldownFilters,
  level: 'product' | 'plant' | 'incoterm' | 'supplier',
  label: string,
): ContractPerfDrilldownFilters {
  if (level === 'product') {
    return { product: label, plant: null, incoterm: null, supplier: null }
  }
  if (level === 'plant') {
    return { ...prev, plant: label, incoterm: null, supplier: null }
  }
  if (level === 'incoterm') {
    return { ...prev, incoterm: label, supplier: null }
  }
  return { ...prev, supplier: label }
}

function defaultContractPerfYtdDateRange(): { dateFrom: string; dateTo: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-${m}-${day}` }
}

function contractPerfTradeCycleDaysForAgg(tradeCycle: number | null | undefined): number {
  if (tradeCycle == null || Number.isNaN(tradeCycle)) return 0
  return Math.abs(tradeCycle)
}

/** On Time / Late share for Contract Performance Open & Close summary cards (Trade Cycle ≤ 0 vs > 0). */
function contractPerfOnTimeLatePercents(
  onTimeCount: number,
  lateCount: number,
): { onTimeLabel: string; lateLabel: string } {
  const total = onTimeCount + lateCount
  if (total <= 0) return { onTimeLabel: 'N/A', lateLabel: 'N/A' }
  return {
    onTimeLabel: `${Math.round((onTimeCount / total) * 100)}%`,
    lateLabel: `${Math.round((lateCount / total) * 100)}%`,
  }
}

function ContractPerfStatusPctBadges({ onTimeCount, lateCount }: { onTimeCount: number; lateCount: number }) {
  const { onTimeLabel, lateLabel } = contractPerfOnTimeLatePercents(onTimeCount, lateCount)
  return (
    <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-0 font-normal text-xs">
        On Time: {onTimeLabel}
      </Badge>
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-0 font-normal text-xs">
        Late: {lateLabel}
      </Badge>
    </div>
  )
}

const CONTRACT_PERF_OPEN_STATUS_CARD_METRIC_HELP = {
  avgTrade: 'ETA vs Due Date Delivery End',
  avgDp: 'ETA Completion vs DP Date',
  avgLog: 'ETA Completion vs Cargo Readiness Date',
} as const

const CONTRACT_PERF_CLOSE_STATUS_CARD_METRIC_HELP = {
  avgTrade: 'ATA Completion vs Due Date Delivery End',
  avgDp: 'ATA Completion vs DP Date',
  avgLog: 'ATA Completion vs Cargo Readiness Date',
} as const

/** Hover help on Open/Close summary metric labels (Contract Performance only). */
function ContractPerfStatusCardMetricLabel({
  label,
  help,
}: {
  label: string
  help: string
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className="cursor-help border-b border-dotted border-gray-400"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs leading-relaxed max-w-xs">
        {help}
      </TooltipContent>
    </Tooltip>
  )
}

function contractToDrilldownRow(contract: Contract): ContractPerfDrilldownRow {
  const tradeCycleDays = contract.trade_cycle_days
  const days = contractPerfTradeCycleDaysForAgg(tradeCycleDays)
  const qty =
    Number(contract.outstanding_quantity ?? contract.quantity_delivery ?? contract.quantity_ordered ?? 0) || 0
  return {
    contract_id: contract.contract_id,
    incoterm: normalizePerfGroupKey(contract.incoterm),
    product: normalizePerfProductGroupKey(contract.product),
    plant_site: normalizePerfGroupKey(contract.plant_site),
    supplier: normalizePerfGroupKey(contract.supplier),
    totalDays: days,
    maxDays: days,
    totalQtyDelivery: qty,
  }
}

function dedupeContractPerfDrilldownRows(rows: ContractPerfDrilldownRow[]): ContractPerfDrilldownRow[] {
  const byContractId = new Map<string, ContractPerfDrilldownRow>()
  for (const row of rows) {
    const contractId = String(row.contract_id || '').trim()
    if (!contractId || byContractId.has(contractId)) continue
    byContractId.set(contractId, row)
  }
  return [...byContractId.values()]
}

/** Build drilldown tree with unique contract_id counts at every node (Set-based aggregation). */
function buildLatePerfBranchTreeFromDrilldownRows(rows: ContractPerfDrilldownRow[]): ContractPerfBranchNode {
  type Agg = {
    contractIds: Set<string>
    totalDays: number
    maxDays: number
    totalQtyDelivery: number
    children: Map<string, Agg>
  }
  const mk = (): Agg => ({
    contractIds: new Set(),
    totalDays: 0,
    maxDays: 0,
    totalQtyDelivery: 0,
    children: new Map(),
  })

  const addRowToAgg = (agg: Agg, row: ContractPerfDrilldownRow) => {
    const isNewContract = !agg.contractIds.has(row.contract_id)
    agg.totalQtyDelivery += row.totalQtyDelivery
    if (isNewContract) {
      agg.contractIds.add(row.contract_id)
      agg.totalDays += row.totalDays
      agg.maxDays = Math.max(agg.maxDays, row.maxDays)
    }
  }

  const root = mk()
  for (const row of rows) {
    const prod = row.product
    const plant = row.plant_site
    const inc = row.incoterm
    const sup = row.supplier

    const nProd = root.children.get(prod) ?? mk()
    root.children.set(prod, nProd)
    const nPlant = nProd.children.get(plant) ?? mk()
    nProd.children.set(plant, nPlant)
    const nInc = nPlant.children.get(inc) ?? mk()
    nPlant.children.set(inc, nInc)
    const nSup = nInc.children.get(sup) ?? mk()
    nInc.children.set(sup, nSup)

    for (const n of [root, nProd, nPlant, nInc, nSup]) {
      addRowToAgg(n, row)
    }
  }

  const toNodes = (m: Map<string, Agg>, parentId: string, level: ContractPerfBranchNode['level']): ContractPerfBranchNode[] => {
    const nodes: ContractPerfBranchNode[] = []
    for (const [k, a] of m.entries()) {
      const id = `${parentId}__${k}`
      const nextLevel: ContractPerfBranchNode['level'] =
        level === 'product' ? 'plant' : level === 'plant' ? 'incoterm' : level === 'incoterm' ? 'supplier' : 'supplier'
      const children = level === 'supplier' ? [] : toNodes(a.children, id, nextLevel)
      nodes.push({
        id,
        label: k,
        level,
        count: a.contractIds.size,
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
    count: root.contractIds.size,
    totalDays: root.totalDays,
    maxDays: root.maxDays,
    totalQtyDelivery: root.totalQtyDelivery,
    children: toNodes(root.children, 'total', 'product'),
  }
}

/** Sum outstanding kg at product nodes across one or more API trees (for Section 1 vs 2 reconciliation). */
function sumProductOutstandingKgFromPerfTrees(trees: LatePerfApiTreeNode[][], productLabel: string): number {
  let total = 0
  for (const tree of trees) {
    for (const inc of tree) {
      for (const plant of inc.children || []) {
        for (const prod of plant.children || []) {
          if (matchesContractPerfProductTabFilter(prod.key, productLabel)) {
            total += Number(prod.totalQtyDelivery) || 0
          }
        }
      }
    }
  }
  return total
}

function buildLatePerfBranchTreeFromHotspots(hotspots: ContractPerfHotspot[]): ContractPerfBranchNode {
  const rows: ContractPerfDrilldownRow[] = []
  for (const h of hotspots) {
    const contractId = String(h.contract_id || '').trim()
    if (!contractId) continue
    rows.push({
      contract_id: contractId,
      incoterm: normalizePerfGroupKey(h.incoterm),
      product: normalizePerfProductGroupKey(h.product),
      plant_site: normalizePerfGroupKey(h.plant_site),
      supplier: normalizePerfGroupKey(h.supplier),
      totalDays: Number(h.totalDays) || 0,
      maxDays: Number(h.maxDays) || 0,
      totalQtyDelivery: Number(h.totalQtyDelivery) || 0,
    })
  }
  if (rows.length > 0) {
    return buildLatePerfBranchTreeFromDrilldownRows(rows)
  }

  // Fallback when contract_id is unavailable (legacy API tree leaves).
  type Agg = { count: number; totalDays: number; maxDays: number; totalQtyDelivery: number; children: Map<string, Agg> }
  const mk = (): Agg => ({ count: 0, totalDays: 0, maxDays: 0, totalQtyDelivery: 0, children: new Map() })
  const root = mk()

  for (const h of hotspots) {
    const inc = normalizePerfGroupKey(h.incoterm)
    const prod = normalizePerfProductGroupKey(h.product)
    const plant = normalizePerfGroupKey(h.plant_site)
    const days = Number(h.totalDays) || 0
    const cnt = Number(h.count) || 0
    const maxd = Number(h.maxDays) || 0
    const qty = Number(h.totalQtyDelivery) || 0
    const sup = normalizePerfGroupKey(h.supplier)

    const nProd = root.children.get(prod) ?? mk()
    root.children.set(prod, nProd)
    const nPlant = nProd.children.get(plant) ?? mk()
    nProd.children.set(plant, nPlant)
    const nInc = nPlant.children.get(inc) ?? mk()
    nPlant.children.set(inc, nInc)
    const nSup = nInc.children.get(sup) ?? mk()
    nInc.children.set(sup, nSup)

    for (const n of [root, nProd, nPlant, nInc, nSup]) {
      n.count += cnt
      n.totalDays += days
      n.maxDays = Math.max(n.maxDays, maxd)
      n.totalQtyDelivery += qty
    }
  }

  const toNodes = (m: Map<string, Agg>, parentId: string, level: ContractPerfBranchNode['level']): ContractPerfBranchNode[] => {
    const nodes: ContractPerfBranchNode[] = []
    for (const [k, a] of m.entries()) {
      const id = `${parentId}__${k}`
      const nextLevel: ContractPerfBranchNode['level'] =
        level === 'product' ? 'plant' : level === 'plant' ? 'incoterm' : level === 'incoterm' ? 'supplier' : 'supplier'
      const children = level === 'supplier' ? [] : toNodes(a.children, id, nextLevel)
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
    children: toNodes(root.children, 'total', 'product'),
  }
}

/** Merge preferred Contracts order with any extra compact column ids (append unknown). Contract Performance: keep schema order. */
function compactColumnFallbackOrder(isContractPerformance: boolean, allIds: string[]): string[] {
  if (isContractPerformance) return contractPerfCompactColumnFallbackOrder(allIds)
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
    return [...CONTRACT_PERF_DEFAULT_VISIBLE_COLUMN_IDS]
  }
  return [...CONTRACTS_DEFAULT_COLUMN_ORDER]
}

/** Isolated cell so updatingContractId changes don't rebuild the entire compactColumns array.
 * `updatingRef` is a stable ref so this component still re-renders when saving state changes
 * via the `savingId` prop, which is the only reactive value that matters here. */
const CargoReadinessCell = memo(function CargoReadinessCell({
  internalId,
  value,
  savingId,
  onChange,
  onSave,
}: {
  internalId: string
  value: string
  savingId: string | null
  onChange: (internalId: string, nextDate: string) => void
  onSave: (internalId: string, value: string) => void
}) {
  const saving = savingId === internalId
  return (
    <div className="flex items-center gap-1 w-full">
      <input
        type="date"
        className="text-sm border rounded px-1 py-0.5 flex-1 min-w-[130px]"
        value={value}
        disabled={saving}
        onChange={(e) => onChange(internalId, e.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={saving}
        className="px-2 py-0 h-7 text-xs shrink-0"
        onClick={() => onSave(internalId, value)}
      >
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </div>
  )
})

type ContractPerfQtyReconciliation = {
  status: 'All' | 'Open' | 'Close'
  productKey: string
  section1Kg: number
  drilldownTotalKg: number
  gapKg: number
  onTimeKg: number
  lateKg: number
  unscheduledKg: number
  openOutstandingKg?: number
  closeContractKg?: number
}

function ReconciliationTooltipRow({
  label,
  value,
  valueClassName = 'text-slate-900',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 items-baseline py-0.5">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold tabular-nums text-right whitespace-nowrap ${valueClassName}`}>
        {value}
      </span>
    </div>
  )
}

/** Section 2 — qty reconciliation in a hover tooltip (ClipboardCheck); icon warns when gap ≠ 0. */
function ContractPerfQtyReconciliationTooltip({
  reconciliation,
}: {
  reconciliation: ContractPerfQtyReconciliation
}) {
  const hasGap = Math.abs(reconciliation.gapKg) > 0
  const triggerTone = hasGap
    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
  const onTimePlusLateKg = reconciliation.onTimeKg + reconciliation.lateKg
  const title =
    reconciliation.status === 'Open'
      ? 'Outstanding qty reconciliation'
      : reconciliation.status === 'Close'
        ? 'Contract qty reconciliation'
        : 'Open + Close qty reconciliation'
  const productSuffix =
    reconciliation.productKey !== 'All' ? ` — ${reconciliation.productKey}` : ' (all products)'

  const section1MatchLabel =
    reconciliation.status === 'Open'
      ? 'Open outstanding'
      : reconciliation.status === 'Close'
        ? 'Close contract qty'
        : 'Open outstanding + Close contract qty'

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="cp-qty-reconciliation-trigger"
          title="Qty reconciliation"
          className={`inline-flex shrink-0 items-center justify-center rounded-md border p-1 focus:outline-none focus:ring-2 focus:ring-primary/30 ${triggerTone}`}
          aria-label={`${title}${productSuffix}. ${hasGap ? 'Qty gap detected' : 'Qty totals match'}`}
        >
          <ClipboardCheck className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="w-[min(100vw-2rem,22rem)] p-3 text-xs"
      >
        <p className="font-semibold text-slate-900 mb-2 leading-snug">
          {title}
          <span className="font-normal text-slate-500">{productSuffix}</span>
        </p>
        <div className="space-y-0.5 border-b border-slate-200 pb-2 mb-2">
          {reconciliation.status === 'All' ? (
            <>
              <ReconciliationTooltipRow
                label="Section 1 Open:"
                value={formatContractPerfOutstandingMt(reconciliation.openOutstandingKg ?? 0)}
              />
              <ReconciliationTooltipRow
                label="Section 1 Close:"
                value={formatContractPerfOutstandingMt(reconciliation.closeContractKg ?? 0)}
              />
              <ReconciliationTooltipRow
                label="Combined:"
                value={formatContractPerfOutstandingMt(reconciliation.section1Kg)}
              />
            </>
          ) : (
            <ReconciliationTooltipRow
              label={`Section 1 ${reconciliation.status}:`}
              value={formatContractPerfOutstandingMt(reconciliation.section1Kg)}
            />
          )}
          <ReconciliationTooltipRow
            label="On Time:"
            value={formatContractPerfOutstandingMt(reconciliation.onTimeKg)}
            valueClassName="text-green-700"
          />
          <ReconciliationTooltipRow
            label="Late:"
            value={formatContractPerfOutstandingMt(reconciliation.lateKg)}
            valueClassName="text-red-700"
          />
          <ReconciliationTooltipRow
            label={reconciliation.status === 'All' ? 'All (On Time + Late + Unscheduled):' : 'On Time + Late:'}
            value={formatContractPerfOutstandingMt(
              reconciliation.status === 'All'
                ? onTimePlusLateKg + (reconciliation.unscheduledKg ?? 0)
                : onTimePlusLateKg,
            )}
          />
          <ReconciliationTooltipRow
            label="Drilldown total:"
            value={formatContractPerfOutstandingMt(reconciliation.drilldownTotalKg)}
          />
        </div>
        {hasGap ? (
          <p className="text-amber-800 leading-relaxed">
            Gap: {formatContractPerfOutstandingMt(Math.abs(reconciliation.gapKg))}
            {reconciliation.gapKg > 0
              ? ' not yet in drilldown trees'
              : ' (drilldown exceeds Section 1 — check filters)'}
          </p>
        ) : (
          <p className="text-green-700 leading-relaxed">
            Drilldown totals match Section 1 {section1MatchLabel}.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/** Section 2 header — unified ALL / On Time / Late drilldown help (presentation only). */
function ContractPerfDrilldownSectionHelp({
  summaryCardStatus,
}: {
  summaryCardStatus: 'All' | 'Open' | 'Close'
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center rounded-full text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label="Contract performance drilldown help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="text-xs leading-relaxed max-w-md space-y-2 p-3"
      >
        <p>
          Each drilldown card shows <span className="font-medium">All</span>,{' '}
          <span className="font-medium">On Time</span> (Trade Cycle ≤ 0), and{' '}
          <span className="font-medium">Late</span> (Trade Cycle &gt; 0) as qty (MT). Hover a segment for
          total contracts and avg trade days. Click a segment to filter Section 3 instantly.
        </p>
        {summaryCardStatus === 'Open' ? (
          <p className="text-gray-500">
            With <span className="font-medium">Open</span> selected: standard ETA → Trade Cycle vs due date.
            No standard ETA → On Time if today ≤ due date delivery end; Late if today &gt; due date delivery end.
          </p>
        ) : null}
        <p>
          Navigate as a tree: <span className="font-medium">Product → Plant → Incoterm → Supplier</span>. Card
          totals stay at branch level; only Section 3 narrows to your selected path and segment.
        </p>
        {summaryCardStatus === 'Open' ? (
          <p className="text-gray-500">
            Open contracts without due date delivery end are excluded from Section 1 and Section 2. Sum On Time +
            Late qty should match Section 1 Open outstanding.
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ContractsPageContent() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const isContractPerformance = isContractPerformancePathname(pathname)
  const perms = usePermissions()

  useEffect(() => {
    if (!isContractPerformance) return
    const allowed = canViewContractPerformancePage(perms)
    if (allowed === false) {
      router.replace('/contracts')
    }
  }, [isContractPerformance, perms.loaded, perms.byKey, perms.userRole, router])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [listFetching, setListFetching] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  // Search should apply only on Enter / Apply (not per keystroke)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  // Default view: compact (1 line per contract)
  const [expandedContractIds, setExpandedContractIds] = useState<Set<string>>(() => new Set())
  const collapseAll = useCallback(() => {
    setExpandedContractIds(new Set())
  }, [])
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('contract_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const contractsTableRef = useRef<HTMLDivElement | null>(null)

  // Desktop table horizontal scroll sync (top + bottom)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    resolveContractsListInitialStatusFilter(pathname),
  )
  const [b2bFlagFilter, setB2bFlagFilter] = useState<string>('ALL')
  /** Default YTD on first load so GET /contracts stays bounded (same as Contract Performance). */
  const [dateFrom, setDateFrom] = useState(() => defaultContractPerfYtdDateRange().dateFrom)
  const [dateTo, setDateTo] = useState(() => defaultContractPerfYtdDateRange().dateTo)
  const [availableB2bFlags, setAvailableB2bFlags] = useState<string[]>([])
  const {
    selectedProducts,
    setSelectedProducts,
    selectedGroupPlants,
    setSelectedGroupPlants,
    userScopeReady,
    resetUserScopeFilters,
    handleProductsChange,
    handleGroupPlantsChange,
  } = useUserScopeFilterDefaults('contracts')
  const [sourceFilter, setSourceFilter] = useState<ContractPerfSourceFilter>('All')
  const [selectedProductTab, setSelectedProductTab] = useState<(typeof CONTRACT_PERF_PRODUCT_TABS)[number]>(
    () => resolveStaffContractPerfProductTab(),
  )
  /** Contract Performance Section 1 only — isolated from /contracts list group-plant scope. */
  const [contractPerfPlantFilter, setContractPerfPlantFilter] = useState<string>('All')
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([])
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([])
  const [transportModeFilter, setTransportModeFilter] = useState<string>('ALL')
  const [perfTransportMode, setPerfTransportMode] = useState<'ALL' | 'SEA' | 'LAND'>('ALL')
  const [lateOnTimeFilter, setLateOnTimeFilter] = useState<'ALL' | 'LATE' | 'ON_TIME'>('ALL')
  const [summaryCardStatus, setSummaryCardStatus] = useState<'All' | 'Open' | 'Close'>(() =>
    resolveContractPerfInitialSummaryCardStatus(pathname),
  )

  /**
   * One-shot Open default when on Contract Performance.
   * Pathname-based useState already covers SSR; this catches hydration/soft-nav edge cases.
   * Does not re-apply after the user toggles Open off (click again → All) on the same visit.
   */
  const cpOpenDefaultAppliedRef = useRef(false)
  useLayoutEffect(() => {
    if (!isContractPerformance) {
      cpOpenDefaultAppliedRef.current = false
      return
    }
    if (cpOpenDefaultAppliedRef.current) return
    cpOpenDefaultAppliedRef.current = true
    setSummaryCardStatus('Open')
    setStatusFilter('Open')
  }, [isContractPerformance])

  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [availableIncoterms, setAvailableIncoterms] = useState<string[]>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [availableGroups, setAvailableGroups] = useState<string[]>([])
  const [availableGroupPlants, setAvailableGroupPlants] = useState<string[]>([])
  const [uploadingId, setUploadingId] = useState<string>('')
  const [csvCargoUploading, setCsvCargoUploading] = useState(false)
  const [csvCargoResult, setCsvCargoResult] = useState<{ updated: number; notFound: number; errors: { po_number: string; reason: string }[] } | null>(null)
  const [detailDocsRefreshKey, setDetailDocsRefreshKey] = useState(0)
  const [docsModalContract, setDocsModalContract] = useState<Contract | null>(null)
  const [docsModalDocs, setDocsModalDocs] = useState<DocumentItem[]>([])
  const [docsModalLoading, setDocsModalLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalContracts, setTotalContracts] = useState(0)
  const contractsPerPage = 20
  const [unassignedSeaContracts, setUnassignedSeaContracts] = useState(0)
  const [unassignedLandContracts, setUnassignedLandContracts] = useState(0)
  const [unassignedMixContracts, setUnassignedMixContracts] = useState(0)
  const [unassignedCountsFetching, setUnassignedCountsFetching] = useState(false)
  const [unassignedFilter, setUnassignedFilter] = useState<'sea' | 'land' | 'mix' | null>(null)
  const [updatingContractId, setUpdatingContractId] = useState<string | null>(null)
  const updatingContractIdRef = useRef<string | null>(null)
  /** Monotonic id — only the latest GET /contracts response may update table state. */
  const contractsFetchGenRef = useRef(0)
  const appliedContractsUrlFiltersRef = useRef(false)

  type LatePerfNode = { key: string; count: number; totalDays: number; maxDays: number; totalQtyDelivery?: number; children: LatePerfNode[] }
  type StatusCardSummary = {
    openOutstandingQty: number
    closeContractQty: number
    openOnTimeCount: number
    openLateCount: number
    closeOnTimeCount: number
    closeLateCount: number
    openAvgDays: number
    openAvgLogCycle: number | null
    openAvgDpCycle: number | null
    openAvgCashCycle: number | null
    openIsLateContext: boolean
    closeAvgDays: number
    closeAvgLogCycle: number | null
    closeAvgDpCycle: number | null
    closeAvgCashCycle: number | null
    closeIsLateContext: boolean
  }
  const EMPTY_STATUS_CARD_SUMMARY: StatusCardSummary = {
    openOutstandingQty: 0,
    closeContractQty: 0,
    openOnTimeCount: 0,
    openLateCount: 0,
    closeOnTimeCount: 0,
    closeLateCount: 0,
    openAvgDays: 0,
    openAvgLogCycle: null,
    openAvgDpCycle: null,
    openAvgCashCycle: null,
    openIsLateContext: false,
    closeAvgDays: 0,
    closeAvgLogCycle: null,
    closeAvgDpCycle: null,
    closeAvgCashCycle: null,
    closeIsLateContext: false,
  }
  const [perfDashMode, setPerfDashMode] = useState<'late' | 'ontrack'>('ontrack')
  const [latePerformanceTree, setLatePerformanceTree] = useState<LatePerfNode[]>([])
  const [onTrackPerformanceTree, setOnTrackPerformanceTree] = useState<LatePerfNode[]>([])
  const [unscheduledPerformanceTree, setUnscheduledPerformanceTree] = useState<LatePerfNode[]>([])
  const [statusCardSummary, setStatusCardSummary] = useState<StatusCardSummary>(EMPTY_STATUS_CARD_SUMMARY)
  const statusCardSummaryRef = useRef<StatusCardSummary>(EMPTY_STATUS_CARD_SUMMARY)
  const cardSummaryFetchGenRef = useRef(0)
  const treeFetchGenRef = useRef(0)
  /** Force next Section 1 summary fetch after Staff scope defaults / toolbar scope changes. */
  const cardSummaryForceNextFetchRef = useRef(true)
  const [latePerfSummaryLoading, setLatePerfSummaryLoading] = useState(false)
  const [latePerfTreeLoading, setLatePerfTreeLoading] = useState(false)
  const [isTableLoading, setIsTableLoading] = useState(false)
  const contractPerfPendingLoadsRef = useRef(0)
  type LatePerfHotspot = ContractPerfHotspot

  const contractPerfProductQuery = useMemo(
    () => contractPerfProductQueryValue(selectedProductTab),
    [selectedProductTab],
  )

  const contractPerfGroupPlantsForApi = useMemo(
    () => contractPerfGroupPlantsQueryValue(contractPerfPlantFilter),
    [contractPerfPlantFilter],
  )

  /** Section 1 card totals — toolbar only; never tied to Open/Close tab selection. */
  const contractPerfToolbarGlobal = useMemo(
    () =>
      buildContractPerfToolbarGlobal({
        dateFrom,
        dateTo,
        sourceFilter,
        selectedIncoterms,
        selectedSuppliers,
        selectedGroupPlants: contractPerfGroupPlantsForApi,
        productTabQuery: contractPerfProductQuery,
        lateOnTimeFilter,
        perfDashMode,
        perfTransportMode,
        b2bFlagFilter,
        search: searchTerm.trim(),
      }),
    [
      dateFrom,
      dateTo,
      sourceFilter,
      selectedIncoterms,
      selectedSuppliers,
      contractPerfGroupPlantsForApi,
      contractPerfProductQuery,
      lateOnTimeFilter,
      perfDashMode,
      perfTransportMode,
      b2bFlagFilter,
      searchTerm,
    ],
  )

  const cardSummaryApiParams = useMemo(
    () => buildLatePerformanceCardSummaryApiParams(contractPerfToolbarGlobal),
    [contractPerfToolbarGlobal],
  )

  const cardSummaryRequestKey = useMemo(
    () => stableContractPerfApiParamsKey(cardSummaryApiParams),
    [cardSummaryApiParams],
  )

  const [appliedDrilldownSelection, setAppliedDrilldownSelection] = useState<ContractPerfDrilldownFilters>(
    EMPTY_CONTRACT_PERF_DRILLDOWN,
  )
  const appliedDrilldownSelectionRef = useRef(appliedDrilldownSelection)
  appliedDrilldownSelectionRef.current = appliedDrilldownSelection

  type ColumnFilter = ContractPerfColumnFilter
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})

  /** Single global filter bag — every section resolves scope from this + applied drilldown. */
  const contractPerfGlobal = useMemo(
    () => ({
      dateFrom,
      dateTo,
      sourceFilter,
      selectedIncoterms,
      selectedSuppliers,
      selectedGroupPlants: contractPerfGroupPlantsForApi,
      productTabQuery: contractPerfProductQuery,
      summaryCardStatus,
      lateOnTimeFilter,
      perfDashMode,
      perfTransportMode,
      b2bFlagFilter,
      search: searchTerm.trim(),
    }),
    [
      dateFrom,
      dateTo,
      sourceFilter,
      selectedIncoterms,
      selectedSuppliers,
      contractPerfGroupPlantsForApi,
      contractPerfProductQuery,
      summaryCardStatus,
      lateOnTimeFilter,
      perfDashMode,
      perfTransportMode,
      b2bFlagFilter,
      searchTerm,
    ],
  )

  /** Unified filter pipeline — single source of truth for Sections 1, 2, and 3. */
  const contractPerfPipeline = useContractPerformanceFilters({
    global: contractPerfGlobal,
    appliedDrilldown: appliedDrilldownSelection,
    onTrackTree: onTrackPerformanceTree as LatePerfApiTreeNode[],
    lateTree: latePerformanceTree as LatePerfApiTreeNode[],
    unscheduledTree: unscheduledPerformanceTree as LatePerfApiTreeNode[],
    tableContracts: contracts,
    tableTotalFromApi: totalContracts,
    columnFilters,
  })

  const contractPerfUnifiedFilteredHotspots = contractPerfPipeline.unifiedFilteredHotspots

  /** Applied Section 2 drilldown — drives Section 3 table and scoped fetches only. */
  const contractPerfDrilldownFilters = useMemo(
    (): ContractPerfDrilldownFilters => ({ ...appliedDrilldownSelection }),
    [appliedDrilldownSelection],
  )
  const contractPerfAppliedDrilldownLabel = useMemo(
    () => formatContractPerfAppliedDrilldownLabel(appliedDrilldownSelection),
    [appliedDrilldownSelection],
  )

  /** True when user narrowed Section 3 via Source, Product, Open/Close card, or drilldown (UI labels only). */
  const contractPerfSection3FilterApplied = useMemo(
    () =>
      isContractPerfSection3FilterApplied({
        sourceFilter,
        selectedProductTab,
        summaryCardStatus,
        appliedDrilldown: appliedDrilldownSelection,
      }),
    [sourceFilter, selectedProductTab, summaryCardStatus, appliedDrilldownSelection],
  )

  /** Section 3 skeleton: API fetch (`loading`) or immediate lock from Section 1/2 (`isTableLoading`). */
  const contractPerfSection3Loading = useMemo(
    () =>
      isContractPerformance &&
      ((loading && contracts.length === 0) || isTableLoading),
    [isContractPerformance, loading, contracts.length, isTableLoading],
  )

  const section3TableLoading = useMemo(
    () =>
      isContractPerformance
        ? contractPerfSection3Loading
        : loading && contracts.length === 0,
    [isContractPerformance, contractPerfSection3Loading, loading, contracts.length],
  )

  const contractsTableScope = useMemo(
    () => contractsListTableScopeLabel(unassignedFilter, statusFilter),
    [unassignedFilter, statusFilter],
  )

  const contractPerfTableFetchScope = contractPerfPipeline.tableFetchScope
  const contractPerfSection3Scope = contractPerfPipeline.section3Scope
  const contractPerfTableColumnFilters = contractPerfTableFetchScope.columnFilters
  const contractPerfTablePlants = contractPerfTableFetchScope.plants
  const contractPerfTableProduct = contractPerfTableFetchScope.product
  const section3FilterMode = contractPerfPipeline.section3Mode
  const section2DrilldownContractCount = contractPerfPipeline.section2TreeContractCount
  const section2ActiveNodeContractCount = contractPerfPipeline.section2ActiveNodeContractCount

  const displayTotalContracts = totalContracts

  /** Section 1 logistics cards — Open unassigned counts; hidden (0) when table status is Close. */
  const contractsLogisticsSection1Active =
    CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED &&
    !isContractPerformance &&
    statusFilter !== 'Close'
  const displayUnassignedSeaCount = contractsLogisticsSection1Active ? unassignedSeaContracts : 0
  const displayUnassignedLandCount = contractsLogisticsSection1Active ? unassignedLandContracts : 0
  const displayUnassignedMixCount = contractsLogisticsSection1Active ? unassignedMixContracts : 0

  /** Debug: track Section 3 filter + pagination sync (summary card vs table). */
  useEffect(() => {
    if (isContractPerformance) return
    console.log('[Contracts] Section 3 table state', {
      unassignedFilter,
      statusFilter,
      currentPage,
      totalContracts,
      totalPages,
      contractsPerPage,
      apiRowsOnPage: contracts.length,
      fetchGeneration: contractsFetchGenRef.current,
    })
  }, [
    isContractPerformance,
    unassignedFilter,
    statusFilter,
    currentPage,
    totalContracts,
    totalPages,
    contracts.length,
  ])

  /** Top-level pipeline verification — section array lengths must align when drilldown is applied. */
  useEffect(() => {
    if (!isContractPerformance) return
    const { debug } = contractPerfPipeline
    console.log('Section 1 Data Length:', debug.section1Data.length)
    console.log('Section 2 Target Node Length:', debug.section2NodeData.length)
    console.log('Section 3 Table Rows Length:', debug.section3TableData.length)
    console.log('Contract Performance pipeline counts:', {
      section1Contracts: debug.section1ContractCount,
      section2NodeContracts: debug.section2NodeContractCount,
      section3Rows: debug.section3RowCount,
      section3ApiTotal: debug.section3ApiTotal,
      section1QtyKg: debug.section1QtyKg,
      onTimePlusLateQtyKg: debug.section2OnTimeLateQtyKg,
    })
  }, [isContractPerformance, contractPerfPipeline])

  /** Section 1 vs Section 2 qty reconciliation — unified pipeline qty vs summary API. */
  const contractPerfQtyReconciliation = useMemo(() => {
    if (!isContractPerformance) return null
    const productKey =
      selectedProductTab === 'All' ? 'All' : normalizePerfProductGroupKey(selectedProductTab)
    const onTimeKg = contractPerfPipeline.debug.onTimeQtyKg
    const lateKg = contractPerfPipeline.debug.lateQtyKg
    const unscheduledKg = contractPerfPipeline.debug.unscheduledQtyKg

    if (summaryCardStatus === 'Open' || summaryCardStatus === 'Close') {
      const section1Kg =
        summaryCardStatus === 'Open'
          ? statusCardSummary.openOutstandingQty
          : statusCardSummary.closeContractQty
      const drilldownTotalKg = contractPerfPipeline.debug.section1QtyKg
      return {
        status: summaryCardStatus,
        productKey,
        section1Kg,
        drilldownTotalKg,
        gapKg: section1Kg - drilldownTotalKg,
        onTimeKg,
        lateKg,
        unscheduledKg,
      }
    }

    if (summaryCardStatus === 'All') {
      const section1Kg =
        statusCardSummary.openOutstandingQty + statusCardSummary.closeContractQty
      const drilldownTotalKg = onTimeKg + lateKg + unscheduledKg
      return {
        status: 'All' as const,
        productKey,
        section1Kg,
        drilldownTotalKg,
        gapKg: section1Kg - drilldownTotalKg,
        onTimeKg,
        lateKg,
        unscheduledKg,
        openOutstandingKg: statusCardSummary.openOutstandingQty,
        closeContractKg: statusCardSummary.closeContractQty,
      }
    }

    return null
  }, [
    isContractPerformance,
    summaryCardStatus,
    selectedProductTab,
    statusCardSummary.openOutstandingQty,
    statusCardSummary.closeContractQty,
    contractPerfPipeline.debug.section1QtyKg,
    contractPerfPipeline.debug.onTimeQtyKg,
    contractPerfPipeline.debug.lateQtyKg,
    contractPerfPipeline.debug.unscheduledQtyKg,
  ])

  const activePerformanceHasData = useMemo(
    () =>
      (onTrackPerformanceTree as LatePerfApiTreeNode[]).length > 0 ||
      (latePerformanceTree as LatePerfApiTreeNode[]).length > 0,
    [onTrackPerformanceTree, latePerformanceTree],
  )

  const onTrackBranchTree = useMemo(
    () => buildLatePerfBranchTreeFromHotspots(contractPerfPipeline.onTrackBranchHotspotsGlobal),
    [contractPerfPipeline.onTrackBranchHotspotsGlobal],
  )

  const lateBranchTree = useMemo(
    () => buildLatePerfBranchTreeFromHotspots(contractPerfPipeline.lateBranchHotspotsGlobal),
    [contractPerfPipeline.lateBranchHotspotsGlobal],
  )

  const unscheduledBranchTree = useMemo(
    () => buildLatePerfBranchTreeFromHotspots(contractPerfPipeline.unscheduledBranchHotspotsGlobal),
    [contractPerfPipeline.unscheduledBranchHotspotsGlobal],
  )

  const unifiedProductNodes = useMemo(
    () => mergeUnifiedPerfBranchTrees(onTrackBranchTree, lateBranchTree, unscheduledBranchTree),
    [onTrackBranchTree, lateBranchTree, unscheduledBranchTree],
  )

  const unifiedSelectedProdNode = findUnifiedPerfNode(unifiedProductNodes, appliedDrilldownSelection.product)
  const unifiedPlantNodes = unifiedSelectedProdNode?.children ?? []
  const unifiedSelectedPlantNode = findUnifiedPerfNode(unifiedPlantNodes, appliedDrilldownSelection.plant)
  const unifiedIncotermNodes = unifiedSelectedPlantNode?.children ?? []
  const unifiedSelectedIncNode = findUnifiedPerfNode(unifiedIncotermNodes, appliedDrilldownSelection.incoterm)
  const unifiedSupplierNodes = unifiedSelectedIncNode?.children ?? []

  const startContractPerfTableLoad = useCallback(() => {
    if (!isContractPerformance) return
    contractPerfPendingLoadsRef.current += 1
    setIsTableLoading(true)
  }, [isContractPerformance])

  const finishContractPerfTableLoad = useCallback(() => {
    if (!isContractPerformance) return
    contractPerfPendingLoadsRef.current = Math.max(0, contractPerfPendingLoadsRef.current - 1)
    if (contractPerfPendingLoadsRef.current === 0) {
      setIsTableLoading(false)
    }
  }, [isContractPerformance])

  /** Immediate skeleton lock when Section 1/2 filters change, before async fetches begin. */
  const lockSection1FilterChange = useCallback(() => {
    if (!isContractPerformance) return
    setIsTableLoading(true)
  }, [isContractPerformance])

  /** Commits drilldown path to Section 3 fetch scope (instant — no staging step). */
  const applyDrilldownSelection = useCallback(
    (payload: ContractPerfDrilldownFilters) => {
      if (!isContractPerformance) return
      const pathUnchanged = contractPerfDrilldownSelectionsEqual(
        payload,
        appliedDrilldownSelectionRef.current,
      )
      if (!pathUnchanged) {
        setAppliedDrilldownSelection(payload)
        setCurrentPage(1)
        collapseAll()
        setColumnFilters((prev) => {
          const next = { ...prev }
          delete next.product
          delete next.incoterm
          delete next.supplier
          Object.assign(next, contractPerfDrilldownToTableColumnFilters(payload))
          return next
        })
      }
    },
    [collapseAll, isContractPerformance],
  )

  /** Clears Section 2 drilldown only (e.g. when switching On Time / Late tab). */
  const resetDrilldownSelectionOnly = useCallback(() => {
    if (!isContractPerformance) return
    applyDrilldownSelection(EMPTY_CONTRACT_PERF_DRILLDOWN)
  }, [applyDrilldownSelection, isContractPerformance])

  /** Section 1 reset — clears all Contract Performance filters (Sections 1–3).
   * Returns to All scope (Open/Close cards unselected); page-load default Open is only for first visit.
   */
  const resetContractPerformancePage = useCallback(() => {
    if (!isContractPerformance) return
    markUserScopeFiltersCleared('contracts')
    lockSection1FilterChange()
    const { dateFrom: ytdFrom, dateTo: ytdTo } = defaultContractPerfYtdDateRange()
    setSourceFilter('All')
    setSelectedProductTab('All')
    setContractPerfPlantFilter('All')
    setSummaryCardStatus('All')
    setStatusFilter('All Status')
    setSelectedIncoterms([])
    setSelectedSuppliers([])
    resetUserScopeFilters()
    setPerfTransportMode('ALL')
    setLateOnTimeFilter('ALL')
    setSearchDraft('')
    setSearchTerm('')
    setB2bFlagFilter('ALL')
    setDateFrom(ytdFrom)
    setDateTo(ytdTo)
    setCurrentPage(1)
    collapseAll()
    setAppliedDrilldownSelection(EMPTY_CONTRACT_PERF_DRILLDOWN)
    setColumnFilters({})
  }, [collapseAll, isContractPerformance, lockSection1FilterChange, resetUserScopeFilters])

  const applySummaryStatusCard = useCallback(
    (status: 'Open' | 'Close') => {
      if (!isContractPerformance) return
      lockSection1FilterChange()
      const nextStatus = summaryCardStatus === status ? 'All' : status
      setSummaryCardStatus(nextStatus)
      setStatusFilter(nextStatus === 'All' ? 'All Status' : nextStatus)
      setCurrentPage(1)
    },
    [isContractPerformance, lockSection1FilterChange, summaryCardStatus],
  )

  /** Section 2 lock: only while the global drilldown tree API refreshes (toolbar/tab). */
  const isSection2TreeLoading = latePerfTreeLoading

  type ContractLogisticsUi =
    | { kind: 'truck-create'; contract: Contract }
    | { kind: 'truck-view'; contract: Contract }
    | { kind: 'ship-create'; contract: Contract }
    | { kind: 'ship-edit'; contractId: string }
    | null
  const [contractLogisticsUi, setContractLogisticsUi] = useState<ContractLogisticsUi>(null)
  const [shipPoOptions, setShipPoOptions] = useState<ShipmentPoOption[]>([])

  useEffect(() => {
    if (contractLogisticsUi?.kind !== 'ship-create') {
      setShipPoOptions([])
      return
    }
    const contractId = contractLogisticsUi.contract.contract_id
    let cancelled = false
    void fetchContractPurchaseOrderOptions(contractId)
      .then((options) => {
        if (!cancelled) setShipPoOptions(options)
      })
      .catch(() => {
        if (!cancelled) setShipPoOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [contractLogisticsUi])

  const shipPrefilledPOs = useMemo((): ShipmentPoOption[] | null => {
    if (contractLogisticsUi?.kind !== 'ship-create') return null
    if (shipPoOptions.length === 0) return null
    const c = contractLogisticsUi.contract
    const primaryPo = String(c.po_number || '').trim()
    const match =
      (primaryPo && shipPoOptions.find((o) => o.poNumber === primaryPo)) || shipPoOptions[0]
    return match ? [match] : null
  }, [contractLogisticsUi, shipPoOptions])

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
    if (!userScopeReady || !isContractPerformance || wereUserScopeFiltersCleared('contracts')) return
    const { products } = getInitialUserScopeFilters()
    if (products.length !== 1) return
    const match = CONTRACT_PERF_PRODUCT_TABS.find(
      (tab) =>
        tab !== 'All' &&
        normalizePerfProductGroupKey(tab) === normalizePerfProductGroupKey(products[0]),
    )
    if (match && selectedProductTab !== match) setSelectedProductTab(match)
  }, [userScopeReady, isContractPerformance, selectedProductTab])

  useEffect(() => {
    if (!userScopeReady || !isContractPerformance) return
    cardSummaryForceNextFetchRef.current = true
  }, [userScopeReady, isContractPerformance, cardSummaryRequestKey])

  /** Apply URL query filters once on load (do not re-apply on every toolbar change). */
  useEffect(() => {
    if (!authReady || appliedContractsUrlFiltersRef.current) return
    appliedContractsUrlFiltersRef.current = true
    if (!isContractPerformance) {
      const statusParam = searchParams.get('status')
      if (statusParam) {
        setStatusFilter(statusParam)
      }
    }
  }, [authReady, isContractPerformance, searchParams])

  useEffect(() => {
    if (!authReady || !userScopeReady) return
    // Reset to page 1 when filters change
    setCurrentPage(1)
    if (isContractPerformance) {
      setIsTableLoading(true)
    }
    fetchContracts(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authReady,
    userScopeReady,
    searchParams,
    statusFilter,
    b2bFlagFilter,
    selectedProducts,
    selectedGroups,
    selectedSuppliers,
    selectedGroupPlants,
    selectedIncoterms,
    dateFrom,
    dateTo,
    transportModeFilter,
    perfTransportMode,
    lateOnTimeFilter,
    unassignedFilter,
    columnFilters,
    sortKey,
    sortDir,
    isContractPerformance,
    sourceFilter,
    selectedProductTab,
    contractPerfPlantFilter,
    appliedDrilldownSelection,
    searchTerm,
    summaryCardStatus,
    section3FilterMode,
    perfDashMode,
  ])

  useEffect(() => {
    if (!isContractPerformance) return
    setAppliedDrilldownSelection(EMPTY_CONTRACT_PERF_DRILLDOWN)
    setColumnFilters((prev) => {
      const next = { ...prev }
      delete next.supplier
      delete next.product
      delete next.incoterm
      return next
    })
    setCurrentPage(1)
  }, [
    sourceFilter,
    selectedProductTab,
    contractPerfPlantFilter,
    selectedIncoterms,
    dateFrom,
    dateTo,
    perfTransportMode,
    isContractPerformance,
  ])

  // Debounced refetch: global search runs on the server (full dataset), not only the current page
  const applySearch = useCallback(() => {
    setCurrentPage(1)
    setSearchTerm(searchDraft.trim())
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

  const columnStorageKey = isContractPerformance
    ? 'contract-performance.compact.visibleColumns.v16'
    : 'contracts.compact.visibleColumns.v9'
  const columnOrderStorageKey = isContractPerformance
    ? 'contract-performance.compact.columnOrder.v12'
    : 'contracts.compact.columnOrder.v10'
  // v4: default column order puts Contract Date first (ignore stale v3 saved order).
  // Bumped so saved "created_at" default does not fight API order (newest contract_date first).
  const sortStorageKey = isContractPerformance ? 'contract-performance.compact.sort' : 'contracts.compact.sort.v2'

  const fetchContracts = async (
    page: number = currentPage,
    searchOverride?: string,
    sortKeyOverride?: string,
    sortDirOverride?: 'asc' | 'desc',
    options?: { force?: boolean },
  ) => {
    const fetchGen = ++contractsFetchGenRef.current
    let trackContractPerfTableLoad = false
    const activeUnassignedFilter = CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED
      ? unassignedFilter
      : null
    try {
      if (!authReady) return
      if (isContractPerformance) {
        trackContractPerfTableLoad = true
      }
      if (trackContractPerfTableLoad) startContractPerfTableLoad()
      if (contracts.length === 0) setLoading(true)
      setListFetching(true)
      const params = new URLSearchParams()
      if (isContractPerformance) {
        const perfParams = buildContractPerfTableListParams({
          scope: contractPerfSection3Scope,
          section3Mode: section3FilterMode,
          columnFilters,
          lateOnTimeFilter,
          perfDashMode,
        })
        perfParams.forEach((value, key) => {
          params.append(key, value)
        })
        params.set('page', page.toString())
        params.set('limit', contractsPerPage.toString())
      } else {
        params.append('page', page.toString())
        params.append('limit', contractsPerPage.toString())
      }
      const searchTrim = (searchOverride ?? searchTerm).trim()
      if (!isContractPerformance && searchTrim.length >= 2) {
        params.append('search', searchTrim)
      }
      const mergedColumnFilters: Record<string, any> = isContractPerformance
        ? (contractPerfTableColumnFilters as Record<string, any>)
        : appendToolbarMultiToColumnFilters(columnFilters as Record<string, unknown>, {
        selectedIncoterms,
        selectedProducts,
        selectedGroups,
        selectedSuppliers,
      })
      if (!isContractPerformance) {
        const cfKeys = Object.keys(mergedColumnFilters)
        if (cfKeys.length > 0) {
          params.append('columnFilters', JSON.stringify(mergedColumnFilters))
        }
      }

      // Status: summary-card drilldown always Open; contracts list respects toolbar status only.
      if (!isContractPerformance && activeUnassignedFilter) {
        params.append('status', 'Open')
      } else if (!isContractPerformance && statusFilter && statusFilter !== 'All Status') {
        params.append('status', statusFilter)
      }
      if (!isContractPerformance) {
        if (b2bFlagFilter && b2bFlagFilter !== 'ALL') {
          params.append('b2bFlag', b2bFlagFilter)
        }
        if (transportModeFilter && transportModeFilter !== 'ALL') {
          params.append('transportMode', transportModeFilter)
        }
        if (selectedGroupPlants.length > 0) {
          selectedGroupPlants.forEach((p) => params.append('plant', p))
        }
      }
      if (!isContractPerformance && dateFrom) {
        params.append('dateFrom', dateFrom)
      }
      if (!isContractPerformance && dateTo) {
        params.append('dateTo', dateTo)
      }

      const outstandingParam = searchParams.get('outstanding')
      if (outstandingParam === 'true') {
        params.append('outstanding', 'true')
      }
      if (activeUnassignedFilter) {
        params.append('unassigned', activeUnassignedFilter)
      }
      const activeSortCol = sortKeyOverride || sortKey
      const activeSortDir = sortDirOverride || sortDir
      const apiSortKey = resolveApiSortKey(activeSortCol)
      if (apiSortKey) {
        params.append('sortKey', apiSortKey)
        params.append('sortDir', activeSortDir)
      }

      console.log('[Contracts] fetchContracts request', {
        fetchGen,
        page,
        unassigned: activeUnassignedFilter,
        status: params.get('status'),
        search: params.get('search'),
      })

      const listUrl = `/contracts?${params.toString()}`
      const listCacheKey = buildCacheKey('GET', listUrl)
      const applyContractsEnvelope = (envelope: {
        data?: { contracts?: Contract[]; pagination?: { total: number; totalPages: number; page: number } }
      }) => {
        const loadedContracts: Contract[] = envelope?.data?.contracts || []
        setContracts(loadedContracts)
        if (envelope?.data?.pagination) {
          setTotalContracts(envelope.data.pagination.total)
          setTotalPages(envelope.data.pagination.totalPages)
          setCurrentPage(envelope.data.pagination.page)
        }
        const b2bFlags = [...new Set(loadedContracts.map((c) => c.b2b_flag).filter((v): v is string => typeof v === 'string' && v.length > 0))].sort()
        if (b2bFlags.length > 0) setAvailableB2bFlags((prev) => [...new Set([...prev, ...b2bFlags])].sort())
        const products = [...new Set(loadedContracts.map((c) => c.product).filter((v): v is string => typeof v === 'string' && v.length > 0))].sort()
        if (products.length > 0) setAvailableProducts((prev) => [...new Set([...prev, ...products])].sort())
        return loadedContracts
      }

      const { data: responseData, revalidating } = await cachedGet(
        listCacheKey,
        () => api.get(listUrl).then((r) => r.data),
        {
          force: options?.force,
          onRevalidate: (fresh) => {
            if (fetchGen !== contractsFetchGenRef.current) return
            const loadedContracts = applyContractsEnvelope(fresh)
            console.log('[Contracts] fetchContracts revalidated', {
              fetchGen,
              page,
              rows: loadedContracts.length,
            })
            setListFetching(false)
          },
        },
      )
      if (fetchGen !== contractsFetchGenRef.current) {
        console.log('[Contracts] Ignoring stale fetch response', {
          fetchGen,
          latestGen: contractsFetchGenRef.current,
          page,
          unassigned: activeUnassignedFilter,
        })
        return
      }

      const loadedContracts = applyContractsEnvelope(responseData)

      console.log('[Contracts] fetchContracts applied', {
        fetchGen,
        page,
        unassigned: activeUnassignedFilter,
        total: responseData?.data?.pagination?.total,
        rows: loadedContracts.length,
      })
      if (!revalidating) setListFetching(false)
    } catch (error) {
      console.error('Failed to fetch contracts:', error)
      const status = (error as any)?.response?.status
      // 401 is handled by axios interceptor (redirects to /login)
      if (status === 401 || status === 403) return
      alert('Failed to load contracts. Please try again.')
      if (fetchGen === contractsFetchGenRef.current) setListFetching(false)
    } finally {
      if (trackContractPerfTableLoad) finishContractPerfTableLoad()
      if (fetchGen !== contractsFetchGenRef.current) return
      setLoading(false)
    }
  }

  /** Section 1 cards — toolbar globals only; Open/Close tab does not refetch or reshape totals. */
  const fetchLatePerformanceSummary = useCallback(async () => {
    if (!authReady || !userScopeReady || !isContractPerformance) return
    const query = buildLatePerformanceCardSummaryApiParams(contractPerfToolbarGlobal).toString()
    if (query.includes('status=')) {
      console.error('Contract Performance card summary must not include status filter:', query)
      return
    }
    const gen = ++cardSummaryFetchGenRef.current
    // Combined data endpoint (summary + tree from one SQL execution) — when the tree
    // refreshes with the same scope, the client in-flight dedupe collapses both fetches
    // into a single request. Payload is a superset; extraction below is unchanged.
    const summaryUrl = `/contracts/late-performance/data?${query}`
    const summaryCacheKey = buildCacheKey('GET', summaryUrl)
    const forceSummaryFetch = cardSummaryForceNextFetchRef.current
    cardSummaryForceNextFetchRef.current = false
    try {
      setLatePerfSummaryLoading(true)
      const { data, revalidating } = await cachedGet(
        summaryCacheKey,
        () => api.get(summaryUrl).then((r) => r.data),
        {
          force: forceSummaryFetch,
          onRevalidate: (fresh) => {
            if (gen !== cardSummaryFetchGenRef.current) return
            const next = fresh?.data?.statusCardSummary as StatusCardSummary | undefined
            if (!next) return
            statusCardSummaryRef.current = next
            setStatusCardSummary(next)
            setLatePerfSummaryLoading(false)
          },
        },
      )
      if (gen !== cardSummaryFetchGenRef.current) return
      const next = data?.data?.statusCardSummary as StatusCardSummary | undefined
      if (next) {
        statusCardSummaryRef.current = next
        setStatusCardSummary(next)
      }
      if (!revalidating) setLatePerfSummaryLoading(false)
    } catch (e) {
      if (gen !== cardSummaryFetchGenRef.current) return
      console.error('Failed to load late performance summary:', e)
      setStatusCardSummary(statusCardSummaryRef.current)
      setLatePerfSummaryLoading(false)
    }
  }, [authReady, userScopeReady, isContractPerformance, cardSummaryRequestKey, contractPerfToolbarGlobal])

  /** Section 2 drilldown tree — global scope only; node clicks do not refetch or collapse card counts.
   *  Uses the combined late-performance/data endpoint (same aggregation, single SQL run) so that
   *  when the card summary refreshes with the same scope, the client cache's in-flight dedupe
   *  collapses both into ONE request; repeat filter combos are served stale-while-revalidate. */
  const fetchLatePerformanceTree = useCallback(async () => {
    if (!authReady || !userScopeReady || !isContractPerformance) return
    const gen = ++treeFetchGenRef.current
    const treeUrl = `/contracts/late-performance/data?${contractPerfPipeline.treeApiParams.toString()}`
    const treeCacheKey = buildCacheKey('GET', treeUrl)
    const applyTreePayload = (payload: { data?: unknown }) => {
      const treeData = payload?.data as
        | { tree?: unknown; onTrackTree?: unknown; unscheduledTree?: unknown }
        | undefined
      setLatePerformanceTree(Array.isArray(treeData?.tree) ? (treeData.tree as any[]) : [])
      setOnTrackPerformanceTree(
        Array.isArray(treeData?.onTrackTree) ? (treeData.onTrackTree as any[]) : [],
      )
      setUnscheduledPerformanceTree(
        Array.isArray(treeData?.unscheduledTree) ? (treeData.unscheduledTree as any[]) : [],
      )
    }
    try {
      setLatePerfTreeLoading(true)
      const { data, revalidating } = await cachedGet(
        treeCacheKey,
        () => api.get(treeUrl).then((r) => r.data),
        {
          onRevalidate: (fresh) => {
            if (gen !== treeFetchGenRef.current) return
            applyTreePayload(fresh as { data?: unknown })
            setLatePerfTreeLoading(false)
          },
        },
      )
      if (gen !== treeFetchGenRef.current) return
      applyTreePayload(data as { data?: unknown })
      if (!revalidating) setLatePerfTreeLoading(false)
    } catch (e) {
      if (gen !== treeFetchGenRef.current) return
      console.error('Failed to load late performance tree:', e)
      setLatePerformanceTree([])
      setOnTrackPerformanceTree([])
      setUnscheduledPerformanceTree([])
      setLatePerfTreeLoading(false)
    }
  }, [authReady, userScopeReady, isContractPerformance, contractPerfPipeline.treeApiParams])

  useEffect(() => {
    void fetchLatePerformanceSummary()
  }, [fetchLatePerformanceSummary])

  useEffect(() => {
    void fetchLatePerformanceTree()
  }, [fetchLatePerformanceTree])

  /** Section 2 node click — instantly commits drilldown and refreshes Section 3. */
  const applyDrilldownNodeSelection = useCallback(
    (level: 'product' | 'plant' | 'incoterm' | 'supplier', label: string) => {
      if (!isContractPerformance) return
      const next = buildNextContractPerfDrilldownSelection(
        appliedDrilldownSelectionRef.current,
        level,
        label,
      )
      applyDrilldownSelection(next)
    },
    [applyDrilldownSelection, isContractPerformance],
  )

  /** Section 2 unified segment click — sets On Time/Late/All filter + drilldown path for Section 3. */
  const applyUnifiedDrilldownSegment = useCallback(
    (
      level: 'product' | 'plant' | 'incoterm' | 'supplier',
      label: string,
      segment: PerfSegmentFilter,
    ) => {
      if (!isContractPerformance) return
      lockSection1FilterChange()
      const next = buildNextContractPerfDrilldownSelection(
        appliedDrilldownSelectionRef.current,
        level,
        label,
      )
      setLateOnTimeFilter(segment)
      applyDrilldownSelection(next)
    },
    [applyDrilldownSelection, isContractPerformance, lockSection1FilterChange],
  )

  useEffect(() => {
    if (!authReady) return
    api.get('/contracts/filter-options/b2b-flags')
      .then((res) => {
        const flags: string[] = res.data?.data?.b2bFlags || []
        setAvailableB2bFlags(flags)
      })
      .catch((error) => {
        console.error('Failed to fetch b2b flag filter options:', error)
      })
  }, [authReady])

  // Contract Performance: Incoterm from contracts; Group Plant from master_plants (matches filter logic)
  useEffect(() => {
    if (!authReady) return
    let cancelled = false
    Promise.all([
      api.get('/contracts/filter-options/incoterms'),
      api.get('/contracts/filter-options/group-plants'),
      api.get('/dashboard/filter-options/products'),
      api.get('/dashboard/filter-options/suppliers'),
      api.get('/dashboard/filter-options/groups'),
    ])
      .then(([incRes, plantRes, productRes, supplierRes, groupRes]) => {
        if (cancelled) return
        const incs = (incRes.data?.data?.incoterms || []) as string[]
        const plants = (plantRes.data?.data?.groupPlants || []) as string[]
        const productPayload = productRes.data?.data
        const products = (Array.isArray(productPayload)
          ? productPayload
          : productPayload && typeof productPayload === 'object' && 'products' in productPayload
            ? (productPayload as { products?: string[] }).products
            : []) as string[]
        const supplierPayload = supplierRes.data?.data
        const suppliers = (Array.isArray(supplierPayload) ? supplierPayload : []) as string[]
        const groupPayload = groupRes.data?.data
        const groups = (Array.isArray(groupPayload) ? groupPayload : []) as string[]
        setAvailableIncoterms(filterIncotermOptions(Array.isArray(incs) ? incs : []))
        setAvailableGroupPlants(Array.isArray(plants) ? plants : [])
        setAvailableProducts(Array.isArray(products) ? products : [])
        setAvailableSuppliers(Array.isArray(suppliers) ? suppliers : [])
        setAvailableGroups(Array.isArray(groups) ? groups : [])
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Failed to fetch filter options:', e)
        setAvailableIncoterms([])
        setAvailableGroupPlants([])
        setAvailableProducts([])
        setAvailableSuppliers([])
        setAvailableGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [authReady])

  // Summary alert cards — always Open status; other toolbar filters sync counts to the table scope.
  const fetchUnassignedCounts = useCallback(async () => {
    if (!CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED || !authReady || !userScopeReady) return
    setUnassignedCountsFetching(true)
    try {
      const params = new URLSearchParams()
      if (searchTerm.trim().length >= 2) params.append('search', searchTerm.trim())
      if (b2bFlagFilter && b2bFlagFilter !== 'ALL') params.append('b2bFlag', b2bFlagFilter)
      const mergedColumnFilters = appendToolbarMultiToColumnFilters(columnFilters as Record<string, unknown>, {
        selectedProducts,
        selectedGroups,
        selectedSuppliers,
        selectedIncoterms,
      })
      const cfKeys = Object.keys(mergedColumnFilters)
      if (cfKeys.length > 0) {
        params.append('columnFilters', JSON.stringify(mergedColumnFilters))
      }
      if (transportModeFilter && transportModeFilter !== 'ALL') params.append('transportMode', transportModeFilter)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (selectedGroupPlants.length > 0) {
        selectedGroupPlants.forEach((p) => params.append('plant', p))
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
    } finally {
      setUnassignedCountsFetching(false)
    }
  }, [
    authReady,
    userScopeReady,
    searchTerm,
    b2bFlagFilter,
    selectedProducts,
    selectedGroups,
    selectedSuppliers,
    selectedGroupPlants,
    selectedIncoterms,
    transportModeFilter,
    dateFrom,
    dateTo,
    columnFilters,
  ])

  useEffect(() => {
    if (
      !CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED ||
      isContractPerformance ||
      !userScopeReady
    ) return
    fetchUnassignedCounts()
  }, [fetchUnassignedCounts, isContractPerformance, userScopeReady])

  const toggleContractsUnassignedFilter = useCallback((mode: ContractsUnassignedCardFilter) => {
    if (!CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED || statusFilter === 'Close') return
    setUnassignedFilter((prev) => {
      const next = prev === mode ? null : mode
      setCurrentPage(1)
      if (next) {
        window.setTimeout(
          () => contractsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          100,
        )
      }
      return next
    })
  }, [statusFilter])

  const clearContractsPageFilters = useCallback(() => {
    markUserScopeFiltersCleared('contracts')
    setDateFrom('')
    setDateTo('')
    setSearchDraft('')
    setSearchTerm('')
    setTransportModeFilter('ALL')
    resetUserScopeFilters()
    setSelectedIncoterms([])
    setSelectedGroups([])
    setSelectedSuppliers([])
    setB2bFlagFilter('ALL')
    setStatusFilter('All Status')
    setUnassignedFilter(null)
    setColumnFilters({})
    setCurrentPage(1)
  }, [resetUserScopeFilters])

  const hasActiveContractsPageFilters =
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    searchTerm.trim().length > 0 ||
    transportModeFilter !== 'ALL' ||
    selectedProducts.length > 0 ||
    selectedGroups.length > 0 ||
    selectedSuppliers.length > 0 ||
    selectedIncoterms.length > 0 ||
    selectedGroupPlants.length > 0 ||
    b2bFlagFilter !== 'ALL' ||
    statusFilter !== 'All Status' ||
    unassignedFilter !== null ||
    hasActiveSectionOneColumnFilters(columnFilters)

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
    setContractLogisticsUi({ kind: 'truck-view', contract })
  }

  const handleShipIconClick = (contract: Contract) => {
    const hasKlipShipment = contractHasKlipShipment(contract)
    if (!hasKlipShipment) {
      if (!transportIsSea(contract) && !transportIsMix(contract)) {
        alert(
          'Shipments apply to SEA contracts only. Open the Shipments page from the menu if you need to work across transport modes.',
        )
        return
      }
      setContractLogisticsUi({ kind: 'ship-create', contract })
      return
    }
    setContractLogisticsUi({ kind: 'ship-edit', contractId: contract.contract_id })
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
    // Single Apply: apply date range + current search draft together (useEffect refetches)
    setSearchTerm(searchDraft.trim())
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
          setDetailDocsRefreshKey((k) => k + 1)
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
      updatingContractIdRef.current = contract.id
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
      updatingContractIdRef.current = null
      setUpdatingContractId(null)
    }
  }

  const handleCargoReadinessCellChange = useCallback((internalId: string, nextDate: string) => {
    setContracts((prev) =>
      prev.map((row) => (row.id === internalId ? { ...row, cargo_readiness_date: nextDate } : row)),
    )
  }, [])

  const handleCargoReadinessCellSave = useCallback((internalId: string, value: string) => {
    const contract = contracts.find((c) => c.id === internalId)
    if (!contract) return
    void handleUpdateContractField(contract, 'cargo_readiness_date', value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts])

  const downloadCargoReadinessTemplate = () => {
    triggerCargoReadinessTemplateDownload()
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

  const getFilterTypeForColumn = (colId: string): ColumnFilter['type'] => {
    if (colId === 'contract_qty' || colId === 'outstanding_qty' || colId === 'contract_aging' || colId === 'delivery_qty' || colId === 'received_qty' || colId === 'outstanding_qty_mt') return 'number'
    if (colId === 'contract_date' || colId === 'delivery_start' || colId === 'delivery_end' || colId === 'created_at' || colId === 'last_planning_delivery_date') return 'date'
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
      case 'source_type':
        return c.source_type || ''
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
      case 'delivery_qty':
        return typeof c.quantity_delivery === 'number' ? c.quantity_delivery : null
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
      case 'last_planning_delivery_date':
        return c.last_planning_delivery_date || ''
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

  // Search + most column filters run on the server. Summary-card unassigned filter is server-side only (GET ?unassigned=).
  const filteredContracts = useMemo(() => {
    let rows = contracts.filter((contract) => passesColumnFilters(contract, clientOnlyColumnFilters))
    if (isContractPerformance) {
      const alignedIds = new Set(contractPerfPipeline.alignedTableContracts.map((c) => c.contract_id))
      rows = rows.filter((c) => alignedIds.has(c.contract_id))
    }
    return rows
  }, [
    contracts,
    clientOnlyColumnFilters,
    isContractPerformance,
    contractPerfPipeline.alignedTableContracts,
  ])

  useEffect(() => {
    if (isContractPerformance) return
    console.log('[Contracts] Section 3 filtered rows before render', {
      unassignedFilter,
      filteredRows: filteredContracts.length,
      displayTotalContracts,
      currentPage,
      totalPages,
    })
  }, [
    isContractPerformance,
    unassignedFilter,
    filteredContracts.length,
    displayTotalContracts,
    currentPage,
    totalPages,
  ])

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
      label: isContractPerformance ? 'PO' : 'PO Number',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.po_numbers || c.po_number || '',
      render: (c) => {
        const val = c.po_numbers || c.po_number || ''
        if (isContractPerformance) {
          return <span className="text-sm">{formatOperationalTableTextDisplay(val)}</span>
        }
        return val.includes(',') ? (
          <OperationalStackedCommaCell value={val} title={val} />
        ) : (
          <OperationalNowrapCell value={val} title={val} />
        )
      },
    }
    const columns: CompactColumn[] = [
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
            defaultVisible: !isContractPerformance,
            sortable: true,
            formulaHelp: isContractPerformance ? undefined : FIELD_HELP.contractUrgentFlag,
            getSortValue: (c: Contract) => c.contract_id || '',
            render: (c: Contract) => (
              <div className="flex items-center gap-1">
                <OperationalNowrapCell value={c.contract_id} fallback="-" />
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
          return <span className="text-sm text-gray-500">-</span>
        }
        return (
          <span className={`text-sm ${signedCycleDaysClass(info.days)}`}>
            {formatContractAgingDays(info.days)}
          </span>
        )
      },
      className: 'whitespace-nowrap'
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: !isContractPerformance,
      sortable: true,
      getSortValue: (c) => c.contract_ext_no || '',
      render: (c) =>
        isContractPerformance ? (
          <span className="text-sm">{formatOperationalTableTextDisplay(c.contract_ext_no)}</span>
        ) : (
          <OperationalStackedCommaCell value={c.contract_ext_no} title={c.contract_ext_no || ''} />
        ),
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.product || '',
      render: (c) => <span className="text-sm">{formatOperationalTableTextDisplay(c.product)}</span>
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.incoterm || '',
      render: (c) => <span className="text-sm">{formatOperationalTableTextDisplay(c.incoterm)}</span>
    },
    ...(isContractPerformance
      ? ([
          {
            id: 'vessel_name',
            label: 'Vessel',
            defaultVisible: false,
            sortable: true,
            getSortValue: (c: Contract) => c.vessel_name || '',
            render: (c: Contract) => {
              const vesselDisplay = formatVesselTableDisplay(c.vessel_name)
              return (
              <span className="text-sm truncate block" title={vesselDisplay === '-' ? '' : vesselDisplay}>
                {vesselDisplay}
              </span>
            )},
          },
          {
            id: 'eta_vessel_completed_loading',
            label: 'ETA Completed Loading',
            defaultVisible: false,
            sortable: true,
            getSortValue: (c: Contract) => c.eta_vessel_completed_loading || '',
            render: (c: Contract) => (
              <span className="text-sm whitespace-nowrap">
                {c.eta_vessel_completed_loading ? formatShortDate(c.eta_vessel_completed_loading) : '-'}
              </span>
            ),
            className: 'whitespace-nowrap',
          },
          {
            id: 'eta_vessel_complete_discharge',
            label: 'ETA Completed Discharge',
            defaultVisible: false,
            sortable: true,
            getSortValue: (c: Contract) => c.eta_vessel_complete_discharge || '',
            render: (c: Contract) => (
              <span className="text-sm whitespace-nowrap">
                {c.eta_vessel_complete_discharge ? formatShortDate(c.eta_vessel_complete_discharge) : '-'}
              </span>
            ),
            className: 'whitespace-nowrap',
          },
        ] as CompactColumn[])
      : []),
    {
      id: 'delivery_status',
      label: 'Delivery Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => (c.import_status || c.status || ''),
      render: (c) => (
        <Badge className={contractStatusBadgeClass(c)}>
          {formatContractDeliveryStatusLabel(c.import_status || c.status) || '—'}
        </Badge>
      )
    },
    {
      id: 'status_overall',
      label: isContractPerformance ? 'Status Contract' : 'Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => {
        const delivery = String(c.import_status || c.status || '').toUpperCase()
        const paid = String(c.payment_status || '').toUpperCase() === 'PAID'
        return delivery === 'CLOSE' && paid ? 'Close' : (c.import_status || c.status || '')
      },
      render: (c) => {
        const overall = resolveContractStatusDisplay(c)
        return (
          <Badge className={contractStatusBadgeClass(c)}>
            {overall || '—'}
          </Badge>
        )
      }
    },
    {
      id: 'unusual_status',
      label: 'Unusual Status',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => {
        const isUnusual =
          (c.log_cycle_days != null && Math.abs(c.log_cycle_days) >= 35) ||
          (c.trade_cycle_days != null && c.trade_cycle_days >= 35) ||
          (c.cash_cycle_days != null && c.cash_cycle_days >= 35)
        return isUnusual ? 1 : 0
      },
      render: (c) => {
        const isUnusual =
          (c.log_cycle_days != null && Math.abs(c.log_cycle_days) >= 35) ||
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
      label: 'Contract Qty',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => typeof c.quantity_ordered === 'number' ? c.quantity_ordered : 0,
      render: (c) => (
        <span className="text-sm truncate">
          {formatSapQtyMtDisplay(c.quantity_ordered)}
        </span>
      )
    },
    {
      id: 'delivery_qty',
      label: 'Delivery Qty',
      formulaHelp: FIELD_HELP.deliveryQty,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => typeof c.quantity_delivery === 'number' ? c.quantity_delivery : 0,
      render: (c) => (
        <span className="text-sm truncate">
          {formatSapQtyMtDisplay(c.quantity_delivery)}
        </span>
      )
    },
    {
      id: 'received_qty',
      label: 'Received Qty',
      formulaHelp: FIELD_HELP.receivedQty,
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => typeof c.quantity_receive === 'number' ? c.quantity_receive : 0,
      render: (c) => (
        <span className="text-sm truncate">
          {formatSapQtyMtDisplay(c.quantity_receive)}
        </span>
      )
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: !isContractPerformance,
      sortable: true,
      getSortValue: (c: Contract) => c.group_name || '',
      render: (c: Contract) => <span className="text-sm truncate block">{formatOperationalTableTextDisplay(c.group_name)}</span>,
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.supplier || '',
      render: (c) => (
        <span className="text-sm truncate block" title={c.supplier || undefined}>
          {formatOperationalTableTextDisplay(c.supplier)}
        </span>
      ),
    },
    {
      id: 'outstanding_qty_mt',
      label: 'Outstanding Qty',
      formulaHelp: isContractPerformance ? FIELD_HELP.contractPerfOutstandingQty : FIELD_HELP.outstandingQtyMt,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => typeof c.outstanding_quantity === 'number' ? c.outstanding_quantity : 0,
      render: (c) => {
        if (c.outstanding_quantity == null) {
          return <span className="text-sm truncate text-gray-500">-</span>
        }
        return (
          <span
            className={`text-sm truncate ${outstandingQtyMtColorClass(c.outstanding_quantity)}`}
          >
            {isContractPerformance
              ? formatSapOutstandingQtyMtDisplay(c.outstanding_quantity)
              : formatContractOutstandingQtyMtDisplay(c.outstanding_quantity)}
          </span>
        )
      }
    },
    {
      id: 'trade_cycle_days',
      label: 'Trade Cycle',
      formulaHelp: isContractPerformance ? FIELD_HELP.contractPerfTradeCycle : FIELD_HELP.tradeCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.trade_cycle_days ?? 0,
      render: (c) => {
        const cycleSizeClass = isContractPerformance ? 'text-sm font-normal' : 'text-xs'
        if (c.trade_cycle_days == null) return <span className={cycleSizeClass}>-</span>
        return (
          <span
            className={
              isContractPerformance
                ? `${cycleSizeClass} ${signedCycleDaysClass(c.trade_cycle_days)}`
                : `${cycleSizeClass} ${signedCycleDaysClass(c.trade_cycle_days)}`
            }
          >
            {isContractPerformance
              ? formatSignedCycleDaysCompact(c.trade_cycle_days)
              : formatSignedCycleDays(c.trade_cycle_days)}
          </span>
        )
      },
      className: 'whitespace-nowrap'
    },
    {
      id: 'cash_cycle_days',
      label: 'Cash Cycle',
      formulaHelp: isContractPerformance ? FIELD_HELP.contractPerfCashCycle : FIELD_HELP.cashCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.cash_cycle_days ?? 0,
      render: (c) => {
        const cycleSizeClass = isContractPerformance ? 'text-sm font-normal' : 'text-xs'
        if (c.cash_cycle_days == null) return <span className={cycleSizeClass}>-</span>
        return (
          <span
            className={
              isContractPerformance
                ? `${cycleSizeClass} ${signedCycleDaysClass(c.cash_cycle_days)}`
                : `${cycleSizeClass} ${signedCycleDaysClass(c.cash_cycle_days)}`
            }
          >
            {isContractPerformance
              ? formatSignedCycleDaysCompact(c.cash_cycle_days)
              : formatSignedCycleDays(c.cash_cycle_days)}
          </span>
        )
      },
      className: 'whitespace-nowrap'
    },
    ...(isContractPerformance
      ? ([
          {
            id: 'dp_cycle_days',
            label: 'DP Cycle',
            formulaHelp: FIELD_HELP.contractPerfDpCycle,
            defaultVisible: true,
            sortable: true,
            getSortValue: (c: Contract) => c.dp_cycle_days ?? 0,
            render: (c: Contract) => {
              if (c.dp_cycle_days == null) return <span className="text-sm">-</span>
              return (
                <span className={`text-sm font-normal ${signedCycleDaysClass(c.dp_cycle_days)}`}>
                  {formatSignedCycleDaysCompact(c.dp_cycle_days)}
                </span>
              )
            },
            className: 'whitespace-nowrap',
          },
        ] as CompactColumn[])
      : []),
    {
      id: 'log_cycle_days',
      label: 'Log Cycle',
      formulaHelp: isContractPerformance ? FIELD_HELP.contractPerfLogCycle : FIELD_HELP.logCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.log_cycle_days ?? 0,
      render: (c) => {
        const cycleSizeClass = isContractPerformance ? 'text-sm font-normal' : 'text-xs'
        if (c.log_cycle_days == null) return <span className={cycleSizeClass}>-</span>
        return (
          <span
            className={
              isContractPerformance
                ? `${cycleSizeClass} ${logCycleDaysClass(c.log_cycle_days, c.trade_cycle_days)}`
                : `${cycleSizeClass} ${logCycleDaysClass(c.log_cycle_days, c.trade_cycle_days)}`
            }
          >
            {isContractPerformance
              ? formatLogCycleDaysCompact(c.log_cycle_days)
              : formatLogCycleDays(c.log_cycle_days, c.trade_cycle_days)}
          </span>
        )
      },
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
        <span className="text-sm">
          {formatSapDisplayValue(c.over_under_delivery_status)}
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
      render: (c) => <span className="text-sm truncate block">{formatOperationalTableTextDisplay(c.company_name)}</span>
    },
    {
      id: 'lt_spot',
      label: 'LT/SPOT',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.lt_spot || '',
      render: (c) => <span className="text-sm">{formatSapDisplayValue(c.lt_spot)}</span>
    },
    {
      id: 'sto_number',
      label: 'STO Number',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.sto_numbers || c.sto_number || '',
      render: (c) => {
        const val = c.sto_numbers || c.sto_number || ''
        return isContractPerformance ? (
          <span className="text-sm truncate block" title={val}>
            {formatOperationalTableTextDisplay(val)}
          </span>
        ) : (
          <OperationalNowrapCell value={val} title={val} />
        )
      },
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
            id: 'last_planning_delivery_date',
            label: 'Last Planning Delivery Date',
            defaultVisible: false,
            sortable: true,
            getSortValue: (c: Contract) => c.last_planning_delivery_date || '',
            render: (c: Contract) => (
              <span className="text-sm whitespace-nowrap">
                {c.last_planning_delivery_date ? formatShortDate(c.last_planning_delivery_date) : '-'}
              </span>
            ),
            className: 'whitespace-nowrap',
          },
          {
            id: 'month_delivery_end',
            label: 'Month Delivery End',
            defaultVisible: true,
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
      render: (c) => (
        <CargoReadinessCell
          internalId={c.id}
          value={c.cargo_readiness_date ? String(c.cargo_readiness_date).substring(0, 10) : ''}
          savingId={updatingContractId}
          onChange={handleCargoReadinessCellChange}
          onSave={handleCargoReadinessCellSave}
        />
      ),
    },
    {
      id: 'created_at',
      label: 'Created',
      defaultVisible: false,
      sortable: true,
      getSortValue: (c) => c.created_at || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.created_at)}</span>
    },
    ...(isContractPerformance
      ? ([
          {
            id: 'source_type',
            label: 'Source',
            defaultVisible: true,
            sortable: true,
            getSortValue: (c: Contract) => c.source_type || '',
            render: (c: Contract) => (
              <span className="text-sm truncate block" title={c.source_type || ''}>
                {formatOperationalTableTextDisplay(c.source_type)}
              </span>
            ),
          },
        ] as CompactColumn[])
      : []),
    ]
    if (isContractPerformance) {
      return orderContractPerformanceColumns(columns)
    }
    return columns.filter((column) => !CONTRACTS_HIDDEN_COLUMN_IDS.has(column.id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContractPerformance, formatMonthDeliveryEnd, handleCargoReadinessCellChange, handleCargoReadinessCellSave])

  /**
   * Same arrays as {@link defaultCompactVisibleColumnIds}; kept for reset + deps.
   */
  const defaultVisibleColumnIds = useMemo(
    () => defaultCompactVisibleColumnIds(isContractPerformance),
    [isContractPerformance],
  )

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() =>
    new Set(defaultCompactVisibleColumnIds(isContractPerformancePathname(pathname))),
  )
  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(() => [])
  const [dragColId, setDragColId] = useState<string | null>(null)
  const userViewPrefKey = isContractPerformance ? 'contract_performance.compact.view.v9' : 'contracts.compact.view.v9'
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Reset visible columns + column order to app defaults, persist locally and on server (so async prefs cannot wipe it). */
  const resetCompactColumnView = useCallback(() => {
    const allIds = compactColumns.map((c) => c.id)
    const order = isContractPerformance
      ? contractPerfCompactColumnFallbackOrder(allIds)
      : compactColumnFallbackOrder(false, allIds)
    const vis = isContractPerformance
      ? new Set(contractPerfDefaultVisibleColumnIds(allIds))
      : new Set(defaultVisibleColumnIds)
    setVisibleColumnIds(vis)
    setColumnOrderIds(order)
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(vis)))
        localStorage.setItem(columnOrderStorageKey, JSON.stringify(order))
        if (isContractPerformance) {
          localStorage.setItem(CONTRACT_PERF_COLUMN_LAYOUT_VERSION_KEY, CONTRACT_PERF_COLUMN_LAYOUT_VERSION)
          for (const legacyKey of CONTRACT_PERF_LEGACY_STORAGE_KEYS) {
            localStorage.removeItem(legacyKey)
          }
        } else {
          localStorage.setItem(CONTRACTS_COLUMN_LAYOUT_VERSION_KEY, CONTRACTS_COLUMN_LAYOUT_VERSION)
        }
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
        if (Array.isArray(ids) && ids.length > 0) {
          const parsed = ids.map(String)
          setColumnOrderIds(
            isContractPerformance
              ? mergeContractPerfColumnOrder(parsed, compactColumns.map((c) => c.id))
              : parsed,
          )
        }
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
        const ensureVisibleIds = isContractPerformance
          ? contractPerfDefaultVisibleColumnIds(compactColumns.map((c) => c.id))
          : defaultCompactVisibleColumnIds(isContractPerformance)
        if (Array.isArray(cols) && cols.length > 0 && !hadSavedVisibleAtOpen) {
          const migrated = migrateContractColumnLayout(
            cols.map((x: unknown) => String(x)),
            Array.isArray(order) ? order.map((x: unknown) => String(x)) : [],
            ensureVisibleIds,
          )
          setVisibleColumnIds(new Set(migrated.visibleColumnIds))
          if (migrated.columnOrderIds.length > 0) {
            setColumnOrderIds(
              isContractPerformance
                ? mergeContractPerfColumnOrder(migrated.columnOrderIds, compactColumns.map((c) => c.id))
                : migrated.columnOrderIds,
            )
          }
        }
        if (Array.isArray(order) && order.length > 0 && !hadSavedOrderAtOpen && !(Array.isArray(cols) && cols.length > 0)) {
          const ids = order.map((x: any) => String(x))
          setColumnOrderIds(
            isContractPerformance
              ? mergeContractPerfColumnOrder(ids, compactColumns.map((c) => c.id))
              : ids,
          )
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
    if (isContractPerformance) {
      return buildContractPerfVisibleColumns(compactColumns, visibleColumnIds, columnOrderIds)
    }
    const byId = new Map(compactColumns.map((c) => [c.id, c] as const))
    const allIds = compactColumns.map((c) => c.id)
    const fallbackOrder = compactColumnFallbackOrder(false, allIds)
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : fallbackOrder).filter((id) =>
      byId.has(id),
    )
    const orderedAll = orderedIds.map((id) => byId.get(id)!).filter(Boolean)
    const visible = orderedAll.filter((c) => visibleColumnIds.has(c.id))
    const mustHave = ['contract_id']
    const visibleIds = new Set(visible.map((c) => c.id))
    const missing = mustHave
      .map((id) => byId.get(id))
      .filter((c): c is CompactColumn => Boolean(c) && !visibleIds.has((c as CompactColumn).id))
    return [...visible, ...missing]
  }, [columnOrderIds, compactColumns, isContractPerformance, visibleColumnIds])

  const compactColumnIdsKey = useMemo(() => compactColumns.map((c) => c.id).join('|'), [compactColumns])

  useEffect(() => {
    const allIds = compactColumns.map((c) => c.id)
    const layoutVersionKey = isContractPerformance
      ? CONTRACT_PERF_COLUMN_LAYOUT_VERSION_KEY
      : CONTRACTS_COLUMN_LAYOUT_VERSION_KEY
    const layoutVersion = isContractPerformance
      ? CONTRACT_PERF_COLUMN_LAYOUT_VERSION
      : CONTRACTS_COLUMN_LAYOUT_VERSION
    const ensureVisibleIds = isContractPerformance
      ? contractPerfDefaultVisibleColumnIds(allIds)
      : defaultVisibleColumnIds

    const applyMigratedLayout = (visible: string[], order: string[]) => {
      const migrated = migrateContractColumnLayout(visible, order, ensureVisibleIds)
      const canonical = isContractPerformance
        ? contractPerfCompactColumnFallbackOrder(allIds)
        : compactColumnFallbackOrder(false, allIds)
      const nextOrder = isContractPerformance
        ? mergeContractPerfColumnOrder(migrated.columnOrderIds, allIds)
        : (() => {
            const base = migrated.columnOrderIds.length > 0 ? migrated.columnOrderIds : canonical
            const deduped = Array.from(new Set(base))
            const missing = allIds.filter((id) => !deduped.includes(id))
            return [...deduped, ...missing].filter((id) => allIds.includes(id))
          })()
      setVisibleColumnIds(new Set(migrated.visibleColumnIds))
      setColumnOrderIds(nextOrder)
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(columnStorageKey, JSON.stringify(migrated.visibleColumnIds))
          localStorage.setItem(columnOrderStorageKey, JSON.stringify(nextOrder))
          localStorage.setItem(layoutVersionKey, layoutVersion)
          if (isContractPerformance) {
            for (const legacyKey of CONTRACT_PERF_LEGACY_STORAGE_KEYS) {
              localStorage.removeItem(legacyKey)
            }
          }
        } catch {
          // ignore
        }
      }
      void api
        .post('/user-preferences/me', {
          key: userViewPrefKey,
          value: {
            visibleColumnIds: migrated.visibleColumnIds,
            columnOrderIds: nextOrder,
          },
        })
        .catch(() => {
          /* localStorage already updated */
        })
    }

    let needsLayoutMigration = false
    if (typeof window !== 'undefined') {
      try {
        needsLayoutMigration = localStorage.getItem(layoutVersionKey) !== layoutVersion
      } catch {
        needsLayoutMigration = true
      }
    }

    if (needsLayoutMigration) {
      let savedVisible: string[] = []
      let savedOrder: string[] = []
      if (typeof window !== 'undefined') {
        try {
          const rawVis = localStorage.getItem(columnStorageKey)
          if (rawVis) {
            const parsed = JSON.parse(rawVis) as unknown
            if (Array.isArray(parsed)) savedVisible = parsed.map(String)
          }
          const rawOrder = localStorage.getItem(columnOrderStorageKey)
          if (rawOrder) {
            const parsed = JSON.parse(rawOrder) as unknown
            if (Array.isArray(parsed)) savedOrder = parsed.map(String)
          }
        } catch {
          // ignore
        }
      }
      if (savedVisible.length === 0) {
        const defaultVis = ensureVisibleIds
        const canonical = isContractPerformance
          ? contractPerfCompactColumnFallbackOrder(allIds)
          : compactColumnFallbackOrder(false, allIds)
        applyMigratedLayout(defaultVis, canonical)
      } else {
        applyMigratedLayout(savedVisible, savedOrder)
      }
      return
    }

    if (!isContractPerformance) {
      setColumnOrderIds((prev) => {
        const base = prev.length > 0 ? prev : compactColumnFallbackOrder(false, allIds)
        const deduped = Array.from(new Set(base))
        const missing = allIds.filter((id) => !deduped.includes(id))
        const next = [...deduped, ...missing].filter((id) => allIds.includes(id))
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
        return next
      })
      return
    }

    setColumnOrderIds((prev) => {
      const next = mergeContractPerfColumnOrder(prev, allIds)
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactColumnIdsKey, isContractPerformance])

  const reorderColumnByDrag = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setColumnOrderIds((prev) => {
      const allIds = compactColumns.map((c) => c.id)
      const ids =
        prev.length > 0
          ? isContractPerformance
            ? mergeContractPerfColumnOrder([...prev], allIds)
            : [...prev]
          : isContractPerformance
            ? contractPerfCompactColumnFallbackOrder(allIds)
            : compactColumnFallbackOrder(false, allIds)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(dropId)
      if (from < 0 || to < 0) return prev.length > 0 ? prev : ids
      ids.splice(from, 1)
      ids.splice(to, 0, dragId)
      return isContractPerformance ? mergeContractPerfColumnOrder(ids, allIds) : ids
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

  const contractPerfVisibleColumnIds = useMemo(
    () => visibleColumns.map((c) => c.id),
    [visibleColumns],
  )

  const contractPerfTableCellPad = CONTRACT_PERF_TABLE_CELL_PAD
  const contractPerfTableRowMinH = CONTRACT_PERF_TABLE_ROW_MIN_H

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
  }, [visibleColumns, sortedContracts.length, section3TableLoading])

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
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <span>Contracts</span>
                {unassignedCountsFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                ) : null}
              </h1>
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
                accept={CARGO_READINESS_UPLOAD_ACCEPT}
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
                  <><Upload className="h-4 w-4 mr-2" />Upload Excel</>
                )}
              </Button>
            </div>
          </div>
        )}

        {isContractPerformance && (
          <div className="space-y-3">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <span>Contract Performance</span>
              {latePerfSummaryLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
              ) : null}
            </h1>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700 shrink-0">Select Source:</span>
                  <div className="inline-flex rounded-lg border bg-white p-1 flex-wrap gap-1">
                    {CONTRACT_PERF_SOURCE_TABS.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          lockSection1FilterChange()
                          setSourceFilter(tab)
                        }}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          sourceFilter === tab
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700 shrink-0">Select Product:</span>
                  <div className="inline-flex rounded-lg border bg-white p-1 flex-wrap gap-1">
                    {CONTRACT_PERF_PRODUCT_TABS.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          lockSection1FilterChange()
                          setSelectedProductTab(tab)
                        }}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          selectedProductTab === tab
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={resetContractPerformancePage}
                className="text-sm text-blue-700 hover:underline shrink-0"
              >
                Reset selection
              </button>
            </div>
          </div>
        )}

        {isContractPerformance && (() => {
          const openSelected = summaryCardStatus === 'Open'
          const closeSelected = summaryCardStatus === 'Close'
          const openStatusContractCount =
            (statusCardSummary.openOnTimeCount ?? 0) + (statusCardSummary.openLateCount ?? 0)
          const closeStatusContractCount =
            (statusCardSummary.closeOnTimeCount ?? 0) + (statusCardSummary.closeLateCount ?? 0)
          const openTradeAvgDays =
            openStatusContractCount > 0 ? statusCardSummary.openAvgDays : null
          const closeTradeAvgDays =
            closeStatusContractCount > 0 ? statusCardSummary.closeAvgDays : null
          return (
            <div className={`transition-opacity duration-200 ${latePerfSummaryLoading ? 'opacity-65' : 'opacity-100'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PerformanceSection1CardShell
                  variant="open"
                  title="Open"
                  selected={openSelected}
                  onClick={() => applySummaryStatusCard('Open')}
                  headerEnd={
                    <ContractPerfStatusPctBadges
                      onTimeCount={statusCardSummary.openOnTimeCount ?? 0}
                      lateCount={statusCardSummary.openLateCount ?? 0}
                    />
                  }
                >
                  <div className="text-sm text-gray-500 mb-1">Outstanding Qty (MT)</div>
                  <div className="text-xl font-bold text-gray-900 mb-3">
                    {formatContractPerfOutstandingMt(statusCardSummary.openOutstandingQty)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 items-center">
                    <span>
                      <ContractPerfStatusCardMetricLabel
                        label="Avg Trade:"
                        help={CONTRACT_PERF_OPEN_STATUS_CARD_METRIC_HELP.avgTrade}
                      />{' '}
                      <span className={`font-semibold ${statusCardAvgDaysClass(openTradeAvgDays, statusCardSummary.openIsLateContext)}`}>
                        {formatAvgDays(openTradeAvgDays)}
                      </span>
                    </span>
                    <span>
                      <ContractPerfStatusCardMetricLabel
                        label="Avg DP:"
                        help={CONTRACT_PERF_OPEN_STATUS_CARD_METRIC_HELP.avgDp}
                      />{' '}
                      <span className={`font-semibold ${statusCardAvgDaysClass(statusCardSummary.openAvgDpCycle, statusCardSummary.openIsLateContext)}`}>
                        {formatAvgDays(statusCardSummary.openAvgDpCycle)}
                      </span>
                    </span>
                    <span>
                      <ContractPerfStatusCardMetricLabel
                        label="Avg Log:"
                        help={CONTRACT_PERF_OPEN_STATUS_CARD_METRIC_HELP.avgLog}
                      />{' '}
                      <span className={`font-semibold ${statusCardAvgDaysClass(statusCardSummary.openAvgLogCycle, statusCardSummary.openIsLateContext)}`}>
                        {formatAvgDays(statusCardSummary.openAvgLogCycle)}
                      </span>
                    </span>
                  </div>
                </PerformanceSection1CardShell>

                <PerformanceSection1CardShell
                  variant="close"
                  title="Close"
                  selected={closeSelected}
                  onClick={() => applySummaryStatusCard('Close')}
                  headerEnd={
                    <ContractPerfStatusPctBadges
                      onTimeCount={statusCardSummary.closeOnTimeCount ?? 0}
                      lateCount={statusCardSummary.closeLateCount ?? 0}
                    />
                  }
                >
                  <div className="text-sm text-gray-500 mb-1">Contract Qty (MT)</div>
                  <div className="text-xl font-bold text-gray-900 mb-3">
                    {formatContractPerfOutstandingMt(statusCardSummary.closeContractQty)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 items-center">
                    <span>
                      <ContractPerfStatusCardMetricLabel
                        label="Avg Trade:"
                        help={CONTRACT_PERF_CLOSE_STATUS_CARD_METRIC_HELP.avgTrade}
                      />{' '}
                      <span className={`font-semibold ${statusCardAvgDaysClass(closeTradeAvgDays, statusCardSummary.closeIsLateContext)}`}>
                        {formatAvgDays(closeTradeAvgDays)}
                      </span>
                    </span>
                    <span>
                      <ContractPerfStatusCardMetricLabel
                        label="Avg DP:"
                        help={CONTRACT_PERF_CLOSE_STATUS_CARD_METRIC_HELP.avgDp}
                      />{' '}
                      <span className={`font-semibold ${statusCardAvgDaysClass(statusCardSummary.closeAvgDpCycle, statusCardSummary.closeIsLateContext)}`}>
                        {formatAvgDays(statusCardSummary.closeAvgDpCycle)}
                      </span>
                    </span>
                    <span>
                      <ContractPerfStatusCardMetricLabel
                        label="Avg Log:"
                        help={CONTRACT_PERF_CLOSE_STATUS_CARD_METRIC_HELP.avgLog}
                      />{' '}
                      <span className={`font-semibold ${statusCardAvgDaysClass(statusCardSummary.closeAvgLogCycle, statusCardSummary.closeIsLateContext)}`}>
                        {formatAvgDays(statusCardSummary.closeAvgLogCycle)}
                      </span>
                    </span>
                  </div>
                </PerformanceSection1CardShell>
              </div>
            </div>
          )
        })()}

        {isContractPerformance && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base mb-0 flex items-center gap-2">
                      <span>Contract Performance Drilldown (YTD)</span>
                      {latePerfTreeLoading && activePerformanceHasData ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                      ) : null}
                    </CardTitle>
                    <ContractPerfDrilldownSectionHelp summaryCardStatus={summaryCardStatus} />
                    {contractPerfQtyReconciliation ? (
                      <ContractPerfQtyReconciliationTooltip
                        reconciliation={contractPerfQtyReconciliation}
                      />
                    ) : (
                      <span
                        className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-1 text-slate-400"
                        title="Qty reconciliation loading"
                        aria-hidden
                      >
                        <ClipboardCheck className="h-4 w-4 opacity-50" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {!activePerformanceHasData && !latePerfTreeLoading ? (
                <div className="text-sm text-gray-500">No schedulable contracts found in YTD.</div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border bg-white p-4 relative">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Unified performance drilldown</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {section2DrilldownContractCount.toLocaleString('en-US')} unique contracts in drilldown tree
                          {lateOnTimeFilter !== 'ALL' ? (
                            <span className="ml-1 font-medium text-gray-700">
                              · Segment: {lateOnTimeFilter === 'ON_TIME' ? 'On Time' : 'Late'}
                            </span>
                          ) : null}
                          {section3FilterMode === 'linked' ? (
                            <span className="ml-1 text-blue-700">
                              · Active path
                              {contractPerfAppliedDrilldownLabel
                                ? `: ${contractPerfAppliedDrilldownLabel}`
                                : ''}{' '}
                              — Section 3 shows{' '}
                              {section2ActiveNodeContractCount.toLocaleString('en-US')} contracts; card totals
                              stay at branch level
                            </span>
                          ) : (
                            <span className="ml-1 text-gray-600">· Section 3 uses global filters only</span>
                          )}
                          <span className="ml-1 text-gray-600">· Quantity in MT</span>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`grid grid-cols-1 lg:grid-cols-4 gap-3 transition-opacity duration-200 ${
                        isSection2TreeLoading && activePerformanceHasData
                          ? 'opacity-65 pointer-events-none cursor-not-allowed'
                          : 'opacity-100'
                      }`}
                      aria-busy={isSection2TreeLoading}
                    >
                      {([
                        { title: 'Product', level: 'product' as const, nodes: unifiedProductNodes },
                        { title: 'Plant', level: 'plant' as const, nodes: unifiedPlantNodes },
                        { title: 'Incoterm', level: 'incoterm' as const, nodes: unifiedIncotermNodes },
                        { title: 'Supplier', level: 'supplier' as const, nodes: unifiedSupplierNodes },
                      ] as const).map((col) => {
                        const subtitle = contractPerfDrilldownColumnSubtitle(col.level, appliedDrilldownSelection)
                        const levelStyles: Record<string, { headerBg: string; border: string }> = {
                          incoterm: { headerBg: 'bg-violet-50', border: 'border-violet-200' },
                          product: { headerBg: 'bg-amber-50', border: 'border-amber-200' },
                          plant: { headerBg: 'bg-emerald-50', border: 'border-emerald-200' },
                          supplier: { headerBg: 'bg-rose-50', border: 'border-rose-200' },
                        }
                        const style = levelStyles[col.level] ?? levelStyles.incoterm

                        const isSelectedAtLevel = (label: string) => {
                          if (col.level === 'product') return appliedDrilldownSelection.product === label
                          if (col.level === 'plant') return appliedDrilldownSelection.plant === label
                          if (col.level === 'incoterm') return appliedDrilldownSelection.incoterm === label
                          return appliedDrilldownSelection.supplier === label
                        }

                        const visibleNodes = col.nodes.slice(0, 30)

                        const renderUnifiedColumnBody = () => {
                          if (col.level === 'plant') {
                            if (!appliedDrilldownSelection.product) {
                              return <div className="text-sm text-gray-500">Select a product to see plants.</div>
                            }
                          } else if (col.level === 'incoterm') {
                            if (!appliedDrilldownSelection.plant || !appliedDrilldownSelection.product) {
                              return <div className="text-sm text-gray-500">Select a plant to see incoterms.</div>
                            }
                          } else if (col.level === 'supplier') {
                            if (
                              !appliedDrilldownSelection.incoterm ||
                              !appliedDrilldownSelection.plant ||
                              !appliedDrilldownSelection.product
                            ) {
                              return <div className="text-sm text-gray-500">Select an incoterm to see suppliers.</div>
                            }
                          }

                          return (
                            <div className="space-y-2">
                              {visibleNodes.map((n) => (
                                <ContractPerfUnifiedNodeCard
                                  key={n.id}
                                  node={n}
                                  level={col.level}
                                  summaryCardStatus={summaryCardStatus}
                                  selected={isSelectedAtLevel(n.label)}
                                  activeSegment={lateOnTimeFilter as PerfSegmentFilter}
                                  disabled={isSection2TreeLoading}
                                  onSegmentSelect={(segment) =>
                                    applyUnifiedDrilldownSegment(col.level, n.label, segment)
                                  }
                                />
                              ))}
                            </div>
                          )
                        }

                        return (
                          <div key={col.level} className="space-y-2">
                            <div className={`rounded-lg border px-3 py-2 ${style.headerBg} ${style.border}`}>
                              <div className="text-sm font-semibold text-gray-900">{col.title}</div>
                              <div className="text-[11px] text-gray-500">{subtitle}</div>
                            </div>
                            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                              {renderUnifiedColumnBody()}
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

        {CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED && !isContractPerformance && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className={`transition-all hover:shadow-md ${
                statusFilter === 'Close'
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer'
              } ${unassignedFilter === 'sea' ? 'ring-2 ring-blue-500 bg-blue-50/50' : ''}`}
              onClick={() => {
                if (statusFilter !== 'Close') toggleContractsUnassignedFilter('sea')
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-500">SEA contracts without shipments</div>
                    <div className="text-2xl font-semibold text-gray-900 mt-1">
                      {displayUnassignedSeaCount}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {statusFilter === 'Close'
                        ? 'Hidden while table status is Close'
                        : unassignedFilter === 'sea'
                          ? 'Click again to clear'
                          : 'Click to filter table'}
                    </div>
                  </div>
                  <Ship className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card
              className={`transition-all hover:shadow-md ${
                statusFilter === 'Close'
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer'
              } ${unassignedFilter === 'land' ? 'ring-2 ring-amber-500 bg-amber-50/50' : ''}`}
              onClick={() => {
                if (statusFilter !== 'Close') toggleContractsUnassignedFilter('land')
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-500">LAND contracts without trucking</div>
                    <div className="text-2xl font-semibold text-gray-900 mt-1">
                      {displayUnassignedLandCount}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {statusFilter === 'Close'
                        ? 'Hidden while table status is Close'
                        : unassignedFilter === 'land'
                          ? 'Click again to clear'
                          : 'Click to filter table'}
                    </div>
                  </div>
                  <Truck className="h-8 w-8 text-amber-500" />
                </div>
              </CardContent>
            </Card>
            <Card
              className={`transition-all hover:shadow-md ${
                statusFilter === 'Close'
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer'
              } ${unassignedFilter === 'mix' ? 'ring-2 ring-green-500 bg-green-50/50' : ''}`}
              onClick={() => {
                if (statusFilter !== 'Close') toggleContractsUnassignedFilter('mix')
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-500">MIX contracts without shipment or trucking</div>
                    <div className="text-2xl font-semibold text-gray-900 mt-1">
                      {displayUnassignedMixCount}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {statusFilter === 'Close'
                        ? 'Hidden while table status is Close'
                        : unassignedFilter === 'mix'
                          ? 'Click again to clear'
                          : 'Click to filter table'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Ship className="h-7 w-7 text-green-500" />
                    <Truck className="h-7 w-7 text-green-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            </div>
        )}

        {/* Filters — hidden on Contract Performance; state (dateFrom, searchTerm, etc.) still drives API */}
        {!isContractPerformance && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Global Filters</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              {CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED ? (
                <p className="text-xs text-gray-500">
                  Section 1 logistics cards always count <span className="font-medium text-gray-700">Open</span>{' '}
                  contracts. Status below controls the Section 3 table only (All / Open / Close).
                </p>
              ) : null}
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
                  onChange={(e) => {
                    const value = e.target.value
                    if (isContractPerformance) lockSection1FilterChange()
                    setStatusFilter(value)
                    if (!isContractPerformance) {
                      setCurrentPage(1)
                      if (unassignedFilter && value === 'Close') {
                        setUnassignedFilter(null)
                      }
                    }
                    if (isContractPerformance) {
                      setSummaryCardStatus(value === 'Open' || value === 'Close' ? value : 'All')
                      setCurrentPage(1)
                    }
                  }}
                  className="px-4 py-2 text-sm border rounded-lg"
                >
                  <option value="All Status">All Status</option>
                  <option value="Open">Open</option>
                  <option value="Close">Close</option>
                </select>
                {!isContractPerformance && (
                  <select
                    value={b2bFlagFilter}
                    onChange={(e) => setB2bFlagFilter(e.target.value)}
                    className="px-4 py-2 text-sm border rounded-lg"
                  >
                    <option value="ALL">All Contract Type</option>
                    {availableB2bFlags.map(flag => (
                      <option key={flag} value={flag}>{flag}</option>
                    ))}
                  </select>
                )}
                {!isContractPerformance && (
                  <select
                    value={transportModeFilter}
                    onChange={(e) => setTransportModeFilter(e.target.value)}
                    className="px-4 py-2 text-sm border rounded-lg"
                  >
                    <option value="ALL">All Transport</option>
                    <option value="SEA">Sea</option>
                    <option value="LAND">Land</option>
                    <option value="MIX">Mix</option>
                  </select>
                )}
                {!isContractPerformance && (
                  <select
                    value={selectedIncoterms[0] ?? 'ALL'}
                    onChange={(e) => {
                      const value = e.target.value
                      setSelectedIncoterms(value === 'ALL' ? [] : [value])
                      setCurrentPage(1)
                    }}
                    className="px-4 py-2 text-sm border rounded-lg"
                  >
                    <option value="ALL">All Incoterm</option>
                    {availableIncoterms.map((inc) => (
                      <option key={inc} value={inc}>
                        {inc}
                      </option>
                    ))}
                  </select>
                )}
                {isContractPerformance && (
                  <select
                    value={lateOnTimeFilter}
                    onChange={(e) => {
                      const value = e.target.value as 'ALL' | 'LATE' | 'ON_TIME'
                      lockSection1FilterChange()
                      setLateOnTimeFilter(value)
                      if (value === 'ON_TIME') setPerfDashMode('ontrack')
                      else if (value === 'LATE') setPerfDashMode('late')
                      setCurrentPage(1)
                    }}
                    className="px-4 py-2 text-sm border rounded-lg"
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
                    onChange={(e) => {
                      if (isContractPerformance) lockSection1FilterChange()
                      setPerfTransportMode(e.target.value as 'ALL' | 'SEA' | 'LAND')
                    }}
                    className="px-4 py-2 text-sm border rounded-lg"
                  >
                    <option value="ALL">Transport Mode: All</option>
                    <option value="SEA">SEA</option>
                    <option value="LAND">LAND</option>
                  </select>
                )}
              </div>

              {isContractPerformance ? (
                <PerformanceScopeFilters
                  hideGroupPlantFilter
                  incotermOptions={availableIncoterms}
                  selectedIncoterms={selectedIncoterms}
                  onIncotermsChange={(selected) => {
                    lockSection1FilterChange()
                    setSelectedIncoterms(selected)
                  }}
                  showSupplierFilter
                  supplierOptions={availableSuppliers}
                  selectedSuppliers={selectedSuppliers}
                  onSuppliersChange={(selected) => {
                    lockSection1FilterChange()
                    setSelectedSuppliers(selected)
                  }}
                  groupPlantOptions={availableGroupPlants}
                  selectedGroupPlants={selectedGroupPlants}
                  onGroupPlantsChange={(selected) => {
                    lockSection1FilterChange()
                    handleGroupPlantsChange(selected)
                  }}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={(iso) => {
                    lockSection1FilterChange()
                    setDateFrom(iso)
                  }}
                  onDateToChange={(iso) => {
                    lockSection1FilterChange()
                    setDateTo(iso)
                  }}
                  showDateRange={false}
                  incotermEmptyMessage="Loading incoterms..."
                  supplierEmptyMessage="Loading suppliers..."
                  groupPlantPlaceholder="Select group plant(s)"
                  groupPlantEmptyMessage="No group plants"
                />
              ) : (
                <PerformanceScopeFilters
                  hideGroupPlantFilter={false}
                  uppercaseGroupPlantLabels
                  showIncoterm={false}
                  incotermOptions={availableIncoterms}
                  selectedIncoterms={selectedIncoterms}
                  onIncotermsChange={setSelectedIncoterms}
                  showProductFilter
                  productOptions={availableProducts}
                  selectedProducts={selectedProducts}
                  onProductsChange={handleProductsChange}
                  showGroupFilter
                  groupOptions={availableGroups}
                  selectedGroups={selectedGroups}
                  onGroupsChange={setSelectedGroups}
                  showSupplierFilter
                  supplierOptions={availableSuppliers}
                  selectedSuppliers={selectedSuppliers}
                  onSuppliersChange={setSelectedSuppliers}
                  groupPlantOptions={availableGroupPlants}
                  selectedGroupPlants={selectedGroupPlants}
                  onGroupPlantsChange={handleGroupPlantsChange}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                  showDateRange={false}
                  productEmptyMessage="Loading products..."
                  groupEmptyMessage="Loading groups..."
                  supplierEmptyMessage="Loading suppliers..."
                  groupPlantPlaceholder="Select group plant(s)"
                  groupPlantEmptyMessage="No group plants"
                />
              )}
              
              {/* Date Range Filter */}
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy
                    valueIso={dateFrom}
                    onChangeIso={(iso) => {
                      lockSection1FilterChange()
                      setDateFrom(iso)
                    }}
                    className="w-40"
                  />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy
                    valueIso={dateTo}
                    onChangeIso={(iso) => {
                      lockSection1FilterChange()
                      setDateTo(iso)
                    }}
                    className="w-40"
                  />
                  {(dateFrom ||
                    dateTo ||
                    searchDraft ||
                    searchTerm ||
                    transportModeFilter !== 'ALL' ||
                    selectedProducts.length > 0 ||
                    selectedGroups.length > 0 ||
                    selectedIncoterms.length > 0 ||
                    selectedGroupPlants.length > 0 ||
                    b2bFlagFilter !== 'ALL' ||
                    statusFilter !== 'All Status' ||
                    summaryCardStatus !== 'All' ||
                    (!isContractPerformance && hasActiveContractsPageFilters) ||
                    hasActiveSectionOneColumnFilters(columnFilters) ||
                    (isContractPerformance &&
                      (lateOnTimeFilter !== 'ALL' ||
                        perfTransportMode !== 'ALL' ||
                        selectedProductTab !== 'All' ||
                        contractPerfPlantFilter !== 'All' ||
                        selectedIncoterms.length > 0 ||
                        selectedSuppliers.length > 0 ||
                        Boolean(
                          hasContractPerfDrilldownSelection(appliedDrilldownSelection),
                        )))) && (
                    <Button
                      onClick={() => {
                        if (!isContractPerformance) {
                          clearContractsPageFilters()
                        } else {
                          resetContractPerformancePage()
                        }
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
        )}

        {/* Contracts List */}
        <Card ref={contractsTableRef}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span>
                      {unassignedFilter === 'sea'
                        ? 'SEA Contracts Without Shipments'
                        : unassignedFilter === 'land'
                        ? 'LAND Contracts Without Trucking'
                        : unassignedFilter === 'mix'
                        ? 'MIX Contracts Without Shipment or Trucking'
                        : isContractPerformance
                        ? 'Contract Performance'
                        : 'All Contracts'}
                    </span>
                    {listFetching ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
                    ) : null}
                  </CardTitle>
                  {isContractPerformance ? (
                    <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                      <span className="whitespace-nowrap tabular-nums text-gray-700">
                        <span className="font-semibold">
                          {displayTotalContracts.toLocaleString('en-US')}
                        </span>{' '}
                        contracts
                      </span>
                      <span className="text-gray-400" aria-hidden>
                        ·
                      </span>
                      {section3FilterMode === 'linked' ? (
                        <span className="whitespace-nowrap text-blue-700 font-medium">
                          Linked
                          {contractPerfAppliedDrilldownLabel
                            ? ` · ${contractPerfAppliedDrilldownLabel}`
                            : ''}
                        </span>
                      ) : summaryCardStatus !== 'All' ? (
                        <span className="whitespace-nowrap text-gray-600 font-medium">
                          Global · {summaryCardStatus}
                        </span>
                      ) : contractPerfSection3FilterApplied ? (
                        <span className="whitespace-nowrap text-gray-600 font-medium">Global · Filtered</span>
                      ) : (
                        <span className="whitespace-nowrap text-gray-600 font-medium">Global · All</span>
                      )}
                      <span className="text-gray-400" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        Page {currentPage}/{totalPages} · {filteredContracts.length} rows
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0 max-w-full">
                      <span className="whitespace-nowrap tabular-nums text-gray-700">
                        <span className="font-semibold">
                          {displayTotalContracts.toLocaleString('en-US')}
                        </span>{' '}
                        contracts
                      </span>
                      <span className="text-gray-400" aria-hidden>
                        ·
                      </span>
                      <span
                        className={cn(
                          'whitespace-nowrap font-medium',
                          contractsTableScope.emphasized ? 'text-blue-700' : 'text-gray-600',
                        )}
                      >
                        {contractsTableScope.text}
                      </span>
                      <span className="text-gray-400" aria-hidden>
                        ·
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        Page {currentPage}/{totalPages} · {filteredContracts.length} rows
                      </span>
                    </p>
                  )}
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
                    onClick={() => toggleContractsUnassignedFilter(unassignedFilter)}
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
                    disabled={listFetching || section3TableLoading}
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
                          const byId = new Map(compactColumns.map(c => [c.id, c] as const))
                          const allMenuIds = compactColumns.map((c) => c.id)
                          const orderedIds =
                            columnOrderIds.length > 0
                              ? isContractPerformance
                                ? mergeContractPerfColumnOrder(columnOrderIds, allMenuIds)
                                : columnOrderIds
                              : isContractPerformance
                                ? contractPerfCompactColumnFallbackOrder(allMenuIds)
                                : compactColumnFallbackOrder(false, allMenuIds)
                          const menuCols = orderedIds
                            .map((id) => byId.get(id))
                            .filter((c): c is CompactColumn => !!c && !excluded.has(c.id))
                          if (!isContractPerformance) {
                            const visibleIds = new Set(
                              visibleColumns.filter((c) => !excluded.has(c.id)).map((c) => c.id),
                            )
                            const visibleInMenu = menuCols.filter((c) => visibleIds.has(c.id))
                            const hiddenCols = menuCols
                              .filter((c) => !visibleIds.has(c.id))
                              .sort((a, b) => a.label.localeCompare(b.label))
                            return [...visibleInMenu, ...hiddenCols]
                          }
                          const visibleIds = new Set(visibleColumnIds)
                          const visibleInMenu = menuCols.filter((c) => visibleIds.has(c.id))
                          const hiddenCols = menuCols
                            .filter((c) => !visibleIds.has(c.id))
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
                      disabled={currentPage === 1 || listFetching || section3TableLoading}
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
                            disabled={listFetching || section3TableLoading}
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
                      disabled={currentPage === totalPages || listFetching || section3TableLoading}
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
              <>
                {/* Desktop compact table (Contracts + Contract Performance): semantic <table>, zebra on <tr>/<td> */}
                <div className="hidden lg:block border rounded-lg overflow-hidden">
                  {/* Top scrollbar (synced) */}
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
                    <div className="min-w-0">
                      <table
                        className={cn(
                          COMPACT_OPERATIONAL_TABLE_CLASS,
                          COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS,
                          'klip-compact-table--perf-narrow-cols',
                        )}
                      >
                      <colgroup>
                        {visibleColumns.map((col) => (
                          <col
                            key={col.id}
                            style={{
                              width: compactTableColWidthCss(
                                contractPerfTableColumnWidthPx(col.id, col.label, {
                                  hasFormulaHelp: Boolean(col.formulaHelp),
                                }),
                              ),
                            }}
                          />
                        ))}
                        <col style={{ width: COMPACT_TABLE_ACTIONS_COL_WIDTH_PX }} />
                      </colgroup>
                      {/* Header */}
                      <thead>
                      <tr
                        className={
                          isContractPerformance
                            ? CONTRACT_PERF_TABLE_HEADER_ROW_PERF_CLASS
                            : CONTRACT_PERF_TABLE_HEADER_ROW_OPERATIONAL_CLASS
                        }
                      >
                        {visibleColumns.map(col => {
                          const activeSort = sortKey === col.id
                          const filterActive = isColumnFilterActive(col.id)
                          const filterType = getFilterTypeForColumn(col.id)
                          const current = columnFilters[col.id]
                          const currentText  = current && current.type === 'text'   ? current : null
                          const currentNum   = current && current.type === 'number' ? current : null
                          const currentDate  = current && current.type === 'date'   ? current : null
                          const currentMulti = current && current.type === 'multi'  ? current : null
                          const columnLayout = isContractPerformance
                            ? getContractPerfTableColumnLayout(col.id)
                            : getOperationalColumnLayout('contracts', col.id)
                          const opColClass = operationalTableColumnClass(columnLayout)

                          return (
                            <th
                              key={col.id}
                              scope="col"
                              className={cn(
                                'relative text-left font-semibold cursor-move align-top',
                                contractPerfTableCellPad,
                                opColClass,
                                'sticky top-0 z-20 bg-gray-50',
                                dragColId === col.id && 'opacity-60',
                              )}
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
                              <div className="flex gap-1 min-w-0 items-start">
                                <span className={COMPACT_TABLE_HEADER_LABEL_CLASS}>
                                  {col.label}
                                </span>
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
                          className={cn(
                            isContractPerformance
                              ? COMPACT_TABLE_ACTIONS_HEADER_CLASS
                              : cn(
                                  COMPACT_TABLE_ACTIONS_HEADER_STICKY_CLASS,
                                  'text-center align-top font-semibold border-l border-gray-200 min-w-[160px]',
                                  contractPerfTableCellPad,
                                ),
                          )}
                        >
                          Actions
                        </th>
                      </tr>
                      </thead>

                      {/* Rows */}
                      <tbody
                        className={`divide-y divide-gray-200 transition-opacity duration-200 ${
                          (listFetching || (isContractPerformance && contractPerfSection3Loading)) &&
                          contracts.length > 0
                            ? 'opacity-65'
                            : 'opacity-100'
                        }`}
                      >
                        {(listFetching ||
                          (isContractPerformance && contractPerfSection3Loading)) &&
                        contracts.length === 0 ? (
                          <TableInitialLoadPlaceholder
                            colSpan={visibleColumns.length + 1}
                            icon={FileText}
                          />
                        ) : !(listFetching ||
                            (isContractPerformance && contractPerfSection3Loading)) &&
                          sortedContracts.length === 0 ? (
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
                                {visibleColumns.map(col => {
                                  const layout = isContractPerformance
                                    ? getContractPerfTableColumnLayout(col.id)
                                    : getOperationalColumnLayout('contracts', col.id)
                                  const truncateAllowlist = isContractPerformance
                                    ? CONTRACT_PERF_TRUNCATE_TOOLTIP_COLUMN_IDS
                                    : CONTRACTS_LIST_TRUNCATE_TOOLTIP_COLUMN_IDS
                                  const useTruncateTooltip = shouldApplyOperationalTruncateTooltip(
                                    col.id,
                                    layout,
                                    truncateAllowlist,
                                  )
                                  const tooltip = useTruncateTooltip
                                    ? isContractPerformance
                                      ? contractPerfCellTooltipText(col.id, contract)
                                      : operationalRowFieldTooltipText(
                                          col.id,
                                          contract as unknown as Record<string, unknown>,
                                        ) ?? contractPerfCellTooltipText(col.id, contract)
                                    : null
                                  const rendered = col.render(contract)
                                  const opColClass = operationalTableColumnClass(layout)

                                  return (
                                    <td
                                      key={col.id}
                                      className={`${COMPACT_OPERATIONAL_TABLE_CELL_CLASS} ${opColClass} align-middle ${contractPerfTableCellPad} ${stripeClass}`}
                                    >
                                      <div className={`${COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS} ${contractPerfTableRowMinH}`}>
                                        {useTruncateTooltip ? (
                                          <ContractPerfTruncatedCell tooltip={tooltip} className="w-full">
                                            {rendered}
                                          </ContractPerfTruncatedCell>
                                        ) : (
                                          rendered
                                        )}
                                      </div>
                                    </td>
                                  )
                                })}

                                <td
                                  className={cn(
                                    isContractPerformance
                                      ? cn(COMPACT_TABLE_ACTIONS_CELL_CLASS, stripeClass)
                                      : 'sticky right-0 z-10 border-l border-gray-200 align-middle',
                                    !isContractPerformance && contractPerfTableCellPad,
                                    !isContractPerformance && 'min-w-[160px]',
                                    !isContractPerformance && stripeClass,
                                  )}
                                >
                                  <div
                                    className={cn(
                                      'flex items-center gap-2',
                                      isContractPerformance ? 'justify-center' : 'justify-end',
                                    )}
                                  >
                                  {!isContractPerformance && (transportIsLand(contract) || transportIsMix(contract)) && (() => {
                                    const hasData = countGt0(contract.trucking_count)
                                    return (
                                      <Button variant="outline" size="icon" onClick={() => handleTruckIconClick(contract)}
                                        title={hasData ? 'View trucking' : 'Add trucking'}
                                        className="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100">
                                        <Truck className="h-4 w-4" />
                                      </Button>
                                    )
                                  })()}
                                  {!isContractPerformance && (transportIsSea(contract) || transportIsMix(contract)) && (() => {
                                    const hasData = contractHasKlipShipment(contract)
                                    return (
                                      <Button variant="outline" size="icon" onClick={() => handleShipIconClick(contract)}
                                        title={hasData ? 'Edit shipment' : 'Add shipment'}
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
                  {(listFetching ||
                    (isContractPerformance && contractPerfSection3Loading)) &&
                  contracts.length === 0 ? (
                    <div className="rounded-lg border bg-white">
                      <TableInitialLoadPlaceholderContent icon={FileText} />
                    </div>
                  ) : !(listFetching ||
                      (isContractPerformance && contractPerfSection3Loading)) &&
                    sortedContracts.length === 0 ? (
                    <div className="rounded-lg border bg-white px-4 py-10 text-center text-sm text-gray-500">
                      No contracts found
                    </div>
                  ) : (
                  sortedContracts.map((contract) => (
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
                              <Badge className={contractStatusBadgeClass(contract)}>
                                {formatContractDeliveryStatusLabel(contract.import_status || contract.status) || '—'}
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
                              <span className="font-medium">{formatSapDisplayValue(contract.supplier)}</span>
                              {' • '}
                              {formatSapDisplayValue(contract.product)}
                              {' • '}
                              <span className="text-gray-500">Outstanding:</span>{' '}
                              {contract.outstanding_quantity == null ? (
                                <span className="text-gray-800">-</span>
                              ) : (
                                <span className={`font-medium ${outstandingQtyMtColorClass(contract.outstanding_quantity)}`}>
                                  {formatContractOutstandingQtyMtDisplay(contract.outstanding_quantity)}
                                </span>
                              )}
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
                                {hasData ? <><Truck className="h-4 w-4 mr-2" />View</> : <><Truck className="h-4 w-4 mr-2" />Add</>}
                              </Button>
                            )
                          })()}
                          {!isContractPerformance && (transportIsSea(contract) || transportIsMix(contract)) && (() => {
                            const hasData = contractHasKlipShipment(contract)
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
                              <div className="font-medium">{formatSapDisplayValue(contract.source_type)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Group Name</div>
                              <div className="font-medium">{formatSapDisplayValue(contract.group_name)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">B2B Flag</div>
                              <div className="font-medium">{formatSapDisplayValue(contract.b2b_flag)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Buyer</div>
                              <div className="font-medium">{partiesBuyerDisplay(contract)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Transport Mode</div>
                              <div className="font-medium">{formatSapDisplayValue(contract.transport_mode)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Incoterm</div>
                              <div className="font-medium">{formatSapDisplayValue(contract.incoterm)}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  ))
                  )}
                </div>
              </>
              </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t pt-4">
                <div className="text-xs text-gray-500 tabular-nums">
                  Page {currentPage}/{totalPages} · {displayTotalContracts.toLocaleString('en-US')} contracts
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || listFetching || section3TableLoading}
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
                          disabled={listFetching || section3TableLoading}
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
                    disabled={currentPage === totalPages || listFetching || section3TableLoading}
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

        <ContractDetailModal
          contract={selectedContract}
          onClose={() => setSelectedContract(null)}
          showMonthDeliveryEnd={isContractPerformance}
          documentsRefreshKey={detailDocsRefreshKey}
        />

        <CreateTruckingOperationModal
          open={
            contractLogisticsUi?.kind === 'truck-create' || contractLogisticsUi?.kind === 'truck-view'
          }
          mode={contractLogisticsUi?.kind === 'truck-view' ? 'edit' : 'add'}
          readOnly={contractLogisticsUi?.kind === 'truck-view'}
          onClose={() => setContractLogisticsUi(null)}
          onCreated={() => {
            const ui = contractLogisticsUi
            setContractLogisticsUi(null)
            invalidateLogisticsListCaches()
            if (ui?.kind === 'truck-create') {
              const contractId = ui.contract.contract_id
              setContracts((prev) =>
                prev.map((c) =>
                  c.contract_id === contractId
                    ? { ...c, trucking_count: Math.max(1, Number(c.trucking_count || 0)) }
                    : c,
                ),
              )
            }
            void fetchContracts(currentPage, undefined, undefined, undefined, { force: true })
            if (CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED) {
              void fetchUnassignedCounts()
            }
          }}
          initialContractId={
            contractLogisticsUi?.kind === 'truck-create' || contractLogisticsUi?.kind === 'truck-view'
              ? contractLogisticsUi.contract.contract_id
              : null
          }
          initialPoNumber={
            contractLogisticsUi?.kind === 'truck-create' || contractLogisticsUi?.kind === 'truck-view'
              ? (() => {
                  const raw =
                    contractLogisticsUi.contract.po_numbers || contractLogisticsUi.contract.po_number
                  return String(raw ?? '').split(',')[0]?.trim() || null
                })()
              : null
          }
        />
        <AddNewShipmentModal
          open={
            contractLogisticsUi?.kind === 'ship-create' || contractLogisticsUi?.kind === 'ship-edit'
          }
          mode={contractLogisticsUi?.kind === 'ship-edit' ? 'edit' : 'add'}
          onClose={() => setContractLogisticsUi(null)}
          prefilledPOs={shipPrefilledPOs}
          availablePOs={
            contractLogisticsUi?.kind === 'ship-create' ? shipPoOptions : null
          }
          editContractId={
            contractLogisticsUi?.kind === 'ship-edit'
              ? contractLogisticsUi.contractId
              : null
          }
          onSubmit={async (payload) => {
            await submitAddNewShipmentPayload(payload)
            const ui = contractLogisticsUi
            setContractLogisticsUi(null)
            invalidateLogisticsListCaches()
            if (ui?.kind === 'ship-create') {
              const contractId = ui.contract.contract_id
              setContracts((prev) =>
                prev.map((c) =>
                  c.contract_id === contractId
                    ? {
                        ...c,
                        shipment_count: Math.max(1, Number(c.shipment_count || 0)),
                        sto_count: Math.max(1, Number(c.sto_count || 0)),
                      }
                    : c,
                ),
              )
            }
            void fetchContracts(currentPage, undefined, undefined, undefined, { force: true })
            if (CONTRACTS_UNASSIGNED_LOGISTICS_CARDS_ENABLED) {
              void fetchUnassignedCounts()
            }
          }}
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
