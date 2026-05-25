'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowDown, ArrowUp, ChevronRight, Database, Filter, GripVertical, Search, SlidersHorizontal, X } from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import {
  contextPerformanceClass,
  formatAvgDays,
  formatSignedCycleDays,
  formatSignedDeltaDays,
  signedCycleDaysClass,
} from '@/lib/cycleDaysDisplay'

interface ShippingPerformanceRow {
  id: string
  shipment_id: string
  po_number?: string | null
  contract_ext_no?: string | null
  contract_number: string
  sto_number?: string | null
  contract_date?: string | null
  incoterm?: string | null
  product?: string | null
  status?: string | null
  plant_site?: string | null
  vessel_name: string | null
  group_name: string | null
  loading_delta_eta_etr_days: number | null
  loading_delta_eta_etb_days: number | null
  loading_delta_etb_etc_days: number | null
  discharge_delta_eta_etb_days: number | null
  discharge_delta_etb_etc_days: number | null
  total_delta_days: number | null
  sto_qty?: number | null
  received_qty?: number | null
  outstanding_qty?: number | null
  shipment_count?: number | null
  cargo_readiness_date?: string | null
  loading_eta_arrival?: string | null
  loading_eta_berthed?: string | null
  loading_eta_completed?: string | null
  discharge_eta_arrival?: string | null
  discharge_eta_berthed?: string | null
  discharge_eta_completed?: string | null
  loading_ata_arrival?: string | null
  loading_ata_berthed?: string | null
  loading_ata_completed?: string | null
  discharge_ata_arrival?: string | null
  discharge_ata_berthed?: string | null
  discharge_ata_completed?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  remark?: string | null
  ata_loading_delta_eta_etr_days?: number | null
  ata_loading_delta_eta_etb_days?: number | null
  ata_loading_delta_etb_etc_days?: number | null
  ata_discharge_delta_eta_etb_days?: number | null
  ata_discharge_delta_etb_etc_days?: number | null
  ata_total_delta_days?: number | null
}

type TableViewMode = 'all' | 'by_vessel'
type PerfDashMode = 'eta' | 'ata'
type TableStatusFilter = 'All' | 'Open' | 'Closed'

type TableColumnKey = keyof ShippingPerformanceRow

/** Shipment-level columns hidden in the By Vessel summary view. */
const DETAIL_COLUMN_KEYS = new Set<string>([
  'shipment_id',
  'status',
  'po_number',
  'contract_ext_no',
  'contract_number',
  'sto_number',
  'group_name',
  'incoterm',
  'product',
  'plant_site',
  'contract_date',
  'loading_port',
  'discharge_port',
])

const ALL_SHIPMENT_REQUIRED_COLUMNS = new Set<string>(['loading_port', 'discharge_port'])

/** Hidden in the All Shipments table. */
const ALL_SHIPMENTS_HIDDEN_COLUMNS = new Set<string>(['group_name'])

/** Hidden in the By Vessel summary table. */
const BY_VESSEL_HIDDEN_COLUMNS = new Set<string>(['group_name'])

const OPEN_TABLE_STATUSES = new Set([
  'PLANNED',
  'IN_PROGRESS',
  'LOADING',
  'IN_TRANSIT',
  'ARRIVED',
  'UNLOADING',
  'UNPLANNED',
])

function avgMetric(rows: ShippingPerformanceRow[], key: TableColumnKey): number | null {
  const vals = rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length === 0) return null
  const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length
  return Math.round(avg * 10) / 10
}

function sumMetric(rows: ShippingPerformanceRow[], key: TableColumnKey): number {
  return rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0)
}

function aggregateByVessel(rows: ShippingPerformanceRow[]): ShippingPerformanceRow[] {
  const groups = new Map<string, ShippingPerformanceRow[]>()
  for (const row of rows) {
    const key = normalizeVesselKey(row.vessel_name)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  return [...groups.entries()].map(([vesselKey, vesselRows]) => ({
    id: `vessel-group:${vesselKey}`,
    shipment_id: '',
    contract_number: '',
    group_name: null,
    vessel_name: vesselKey,
    po_number: null,
    contract_ext_no: null,
    sto_number: null,
    contract_date: null,
    incoterm: null,
    product: null,
    status: null,
    plant_site: null,
    shipment_count: vesselRows.length,
    sto_qty: sumMetric(vesselRows, 'sto_qty'),
    received_qty: sumMetric(vesselRows, 'received_qty'),
    outstanding_qty: sumMetric(vesselRows, 'outstanding_qty'),
    loading_delta_eta_etr_days: avgMetric(vesselRows, 'loading_delta_eta_etr_days'),
    loading_delta_eta_etb_days: avgMetric(vesselRows, 'loading_delta_eta_etb_days'),
    loading_delta_etb_etc_days: avgMetric(vesselRows, 'loading_delta_etb_etc_days'),
    discharge_delta_eta_etb_days: avgMetric(vesselRows, 'discharge_delta_eta_etb_days'),
    discharge_delta_etb_etc_days: avgMetric(vesselRows, 'discharge_delta_etb_etc_days'),
    total_delta_days: avgMetric(vesselRows, 'total_delta_days'),
    cargo_readiness_date: null,
    loading_eta_arrival: null,
    loading_eta_berthed: null,
    loading_eta_completed: null,
    discharge_eta_arrival: null,
    discharge_eta_berthed: null,
    discharge_eta_completed: null,
  }))
}

type LatePerfNode = {
  key: string
  count: number
  vesselCount: number
  children: LatePerfNode[]
}

type PerVesselPerfSummary = {
  vesselCount: number
  shipmentCount: number
  totalQty: number
  avgLoadingEtaEtr: number
  avgLoadingEtaEtb: number
  avgLoadingEtbEtc: number
  avgDischargeEtaEtb: number
  avgDischargeEtbEtc: number
  avgTotalDelta: number
}

const EMPTY_PER_VESSEL_SUMMARY: PerVesselPerfSummary = {
  vesselCount: 0,
  shipmentCount: 0,
  totalQty: 0,
  avgLoadingEtaEtr: 0,
  avgLoadingEtaEtb: 0,
  avgLoadingEtbEtc: 0,
  avgDischargeEtaEtb: 0,
  avgDischargeEtbEtc: 0,
  avgTotalDelta: 0,
}

const ETA_DATE_FIELDS: Array<keyof ShippingPerformanceRow> = [
  'loading_eta_arrival',
  'loading_eta_berthed',
  'loading_eta_completed',
  'discharge_eta_arrival',
  'discharge_eta_berthed',
  'discharge_eta_completed',
]

const ATA_DATE_FIELDS: Array<keyof ShippingPerformanceRow> = [
  'loading_ata_arrival',
  'loading_ata_berthed',
  'loading_ata_completed',
  'discharge_ata_arrival',
  'discharge_ata_berthed',
  'discharge_ata_completed',
]

function hasPresentDate(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function rowHasEta(row: ShippingPerformanceRow): boolean {
  return ETA_DATE_FIELDS.some((key) => hasPresentDate(row[key]))
}

function rowHasAta(row: ShippingPerformanceRow): boolean {
  return ATA_DATE_FIELDS.some((key) => hasPresentDate(row[key]))
}

function normalizeGroupKey(value: unknown, fallback = 'Blank'): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

function normalizeVesselKey(value: unknown): string {
  return normalizeGroupKey(value, 'Unknown')
}

function countUniqueVessels(rows: ShippingPerformanceRow[]): number {
  return new Set(rows.map((row) => normalizeVesselKey(row.vessel_name))).size
}

function sumRootTreeCounts(tree: LatePerfNode[]): { shipments: number; vesselCountSum: number } {
  return {
    shipments: tree.reduce((sum, node) => sum + node.count, 0),
    vesselCountSum: tree.reduce((sum, node) => sum + node.vesselCount, 0),
  }
}

function displayGroupLabel(key: string): string {
  return key === 'Blank' ? 'Uncategorized' : key
}

function rowMatchesGroupSelection(rowValue: unknown, selectedKey: string): boolean {
  return normalizeGroupKey(rowValue) === selectedKey
}

type DrilldownFilters = {
  product: string | null
  plant: string | null
  incoterm: string | null
  vessel: string | null
}

const EMPTY_DRILLDOWN_FILTERS: DrilldownFilters = {
  product: null,
  plant: null,
  incoterm: null,
  vessel: null,
}

function applyPerfModeFilter(rows: ShippingPerformanceRow[], mode: PerfDashMode): ShippingPerformanceRow[] {
  if (mode === 'eta') return rows.filter((row) => rowHasEta(row) && !rowHasAta(row))
  return rows.filter((row) => rowHasAta(row))
}

function applyDrilldownFiltersToRows(
  sourceRows: ShippingPerformanceRow[],
  filters: DrilldownFilters,
): ShippingPerformanceRow[] {
  return sourceRows.filter((row) => {
    if (filters.vessel && normalizeVesselKey(row.vessel_name) !== filters.vessel) return false
    if (filters.incoterm && !rowMatchesGroupSelection(row.incoterm, filters.incoterm)) return false
    if (filters.product && !rowMatchesGroupSelection(row.product, filters.product)) return false
    if (filters.plant && !rowMatchesGroupSelection(row.plant_site, filters.plant)) return false
    return true
  })
}

function distinctFieldValues(
  rows: ShippingPerformanceRow[],
  field: 'incoterm' | 'plant_site',
): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    values.add(normalizeGroupKey(row[field]))
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

function applyGlobalFiltersToRows(
  sourceRows: ShippingPerformanceRow[],
  filters: {
    selectedIncoterms: string[]
    selectedPlantSites: string[]
    dateFrom: string
    dateTo: string
  },
): ShippingPerformanceRow[] {
  return sourceRows.filter((row) => {
    const inc = normalizeGroupKey(row.incoterm)
    if (filters.selectedIncoterms.length > 0 && !filters.selectedIncoterms.includes(inc)) return false
    const plant = normalizeGroupKey(row.plant_site)
    if (filters.selectedPlantSites.length > 0 && !filters.selectedPlantSites.includes(plant)) return false
    const cDate = String(row.contract_date || '').slice(0, 10)
    if (filters.dateFrom && cDate && cDate < filters.dateFrom) return false
    if (filters.dateTo && cDate && cDate > filters.dateTo) return false
    return true
  })
}

type PerfDatasetBundle = {
  rows: ShippingPerformanceRow[]
  tree: LatePerfNode[]
  summary: PerVesselPerfSummary
}

function buildPerfDatasetBundle(rows: ShippingPerformanceRow[], mode: PerfDashMode): PerfDatasetBundle {
  const tree = buildPerfTree(rows)
  const rootTotals = sumRootTreeCounts(tree)
  const metrics = buildCardSummary(rows, mode)
  const shipmentCount = rows.length
  const vesselCount = countUniqueVessels(rows)

  return {
    rows,
    tree,
    summary: {
      ...metrics,
      shipmentCount: shipmentCount || rootTotals.shipments,
      vesselCount,
    },
  }
}

function buildCardSummary(rows: ShippingPerformanceRow[], mode: PerfDashMode): PerVesselPerfSummary {
  const vessels = new Set<string>()
  let shipmentCount = 0
  let totalQty = 0
  let sumLoadingEtr = 0
  let sumLoadingEtb = 0
  let sumLoadingEtbEtc = 0
  let sumDischargeEtb = 0
  let sumDischargeEtbEtc = 0
  let sumTotalDelta = 0

  for (const row of rows) {
    shipmentCount += 1
    vessels.add(normalizeVesselKey(row.vessel_name))
    totalQty += Number(row.outstanding_qty ?? 0)

    if (mode === 'eta') {
      sumLoadingEtr += Number(row.loading_delta_eta_etr_days ?? 0)
      sumLoadingEtb += Number(row.loading_delta_eta_etb_days ?? 0)
      sumLoadingEtbEtc += Number(row.loading_delta_etb_etc_days ?? 0)
      sumDischargeEtb += Number(row.discharge_delta_eta_etb_days ?? 0)
      sumDischargeEtbEtc += Number(row.discharge_delta_etb_etc_days ?? 0)
      sumTotalDelta += Number(row.total_delta_days ?? 0)
    } else {
      sumLoadingEtr += Number(row.ata_loading_delta_eta_etr_days ?? 0)
      sumLoadingEtb += Number(row.ata_loading_delta_eta_etb_days ?? 0)
      sumLoadingEtbEtc += Number(row.ata_loading_delta_etb_etc_days ?? 0)
      sumDischargeEtb += Number(row.ata_discharge_delta_eta_etb_days ?? 0)
      sumDischargeEtbEtc += Number(row.ata_discharge_delta_etb_etc_days ?? 0)
      sumTotalDelta += Number(row.ata_total_delta_days ?? 0)
    }
  }

  if (shipmentCount === 0) return { ...EMPTY_PER_VESSEL_SUMMARY }

  return {
    vesselCount: vessels.size,
    shipmentCount,
    totalQty,
    avgLoadingEtaEtr: sumLoadingEtr / shipmentCount,
    avgLoadingEtaEtb: sumLoadingEtb / shipmentCount,
    avgLoadingEtbEtc: sumLoadingEtbEtc / shipmentCount,
    avgDischargeEtaEtb: sumDischargeEtb / shipmentCount,
    avgDischargeEtbEtc: sumDischargeEtbEtc / shipmentCount,
    avgTotalDelta: sumTotalDelta / shipmentCount,
  }
}

function buildVesselPrimaryProductMap(rows: ShippingPerformanceRow[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const prod = normalizeGroupKey(row.product)
    const ves = normalizeVesselKey(row.vessel_name)
    if (!counts.has(ves)) counts.set(ves, new Map())
    const prodMap = counts.get(ves)!
    prodMap.set(prod, (prodMap.get(prod) || 0) + 1)
  }

  const primary = new Map<string, string>()
  for (const [ves, prodMap] of counts) {
    let bestProd = 'Blank'
    let bestCount = -1
    for (const [prod, count] of prodMap) {
      if (count > bestCount || (count === bestCount && prod.localeCompare(bestProd) < 0)) {
        bestCount = count
        bestProd = prod
      }
    }
    primary.set(ves, bestProd)
  }
  return primary
}

function buildPerfTree(rows: ShippingPerformanceRow[]): LatePerfNode[] {
  type VesAcc = { count: number; vessels: Set<string> }
  type VesMap = Map<string, VesAcc>
  type IncAcc = { count: number; vessels: Set<string>; vesselsMap: VesMap }
  type IncMap = Map<string, IncAcc>
  type PlantAcc = { count: number; vessels: Set<string>; incoterms: IncMap }
  type PlantMap = Map<string, PlantAcc>
  type ProdAcc = { count: number; vessels: Set<string>; plants: PlantMap }
  type ProdMap = Map<string, ProdAcc>
  const root: ProdMap = new Map()
  const vesselPrimaryProduct = buildVesselPrimaryProductMap(rows)

  for (const row of rows) {
    const prod = normalizeGroupKey(row.product)
    const plant = normalizeGroupKey(row.plant_site)
    const inc = normalizeGroupKey(row.incoterm)
    const ves = normalizeVesselKey(row.vessel_name)

    if (!root.has(prod)) root.set(prod, { count: 0, vessels: new Set(), plants: new Map() })
    const pN = root.get(prod)!
    pN.count += 1
    if (vesselPrimaryProduct.get(ves) === prod) pN.vessels.add(ves)
    if (!pN.plants.has(plant)) pN.plants.set(plant, { count: 0, vessels: new Set(), incoterms: new Map() })
    const plN = pN.plants.get(plant)!
    plN.count += 1
    plN.vessels.add(ves)
    if (!plN.incoterms.has(inc)) plN.incoterms.set(inc, { count: 0, vessels: new Set(), vesselsMap: new Map() })
    const iN = plN.incoterms.get(inc)!
    iN.count += 1
    iN.vessels.add(ves)
    if (!iN.vesselsMap.has(ves)) iN.vesselsMap.set(ves, { count: 0, vessels: new Set([ves]) })
    const vN = iN.vesselsMap.get(ves)!
    vN.count += 1
  }

  const srtByVesselCount = <T,>(m: Map<string, T & { vessels: Set<string> }>) =>
    [...m.entries()].sort((a, b) => b[1].vessels.size - a[1].vessels.size)

  const srtVesselLeaves = (m: VesMap) =>
    [...m.entries()].sort((a, b) => b[1].count - a[1].count)

  return srtByVesselCount(root).map(([prod, pN]) => ({
    key: prod,
    count: pN.count,
    vesselCount: pN.vessels.size,
    children: srtByVesselCount(pN.plants).map(([plant, plN]) => ({
      key: plant,
      count: plN.count,
      vesselCount: plN.vessels.size,
      children: srtByVesselCount(plN.incoterms).map(([inc, iN]) => ({
        key: inc,
        count: iN.count,
        vesselCount: iN.vessels.size,
        children: srtVesselLeaves(iN.vesselsMap).map(([ves, vN]) => ({
          key: ves,
          count: vN.count,
          vesselCount: 1,
          children: [],
        })),
      })),
    })),
  }))
}

function matchesTableStatusFilter(status: string, filter: TableStatusFilter): boolean {
  const normalized = String(status || '').trim().toUpperCase()
  if (filter === 'All') return true
  if (filter === 'Closed') return normalized === 'COMPLETED'
  if (filter === 'Open') return OPEN_TABLE_STATUSES.has(normalized)
  return true
}

type ColumnType = 'text' | 'number'

type ColumnDef = {
  key: keyof ShippingPerformanceRow
  label: string
  type: ColumnType
  defaultVisible?: boolean
  tooltip?: string
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: 'vessel_name', label: 'Vessel', type: 'text', defaultVisible: true },
  { key: 'loading_port', label: 'Loading Port', type: 'text', defaultVisible: true },
  { key: 'discharge_port', label: 'Discharge Port', type: 'text', defaultVisible: true },
  { key: 'group_name', label: 'Supplier Group', type: 'text', defaultVisible: false },
  { key: 'shipment_count', label: 'Shipments', type: 'number', defaultVisible: false },
  { key: 'shipment_id', label: 'Shipment ID', type: 'text', defaultVisible: true },
  { key: 'status', label: 'Status', type: 'text', defaultVisible: true },
  { key: 'po_number', label: 'PO No', type: 'text', defaultVisible: false },
  { key: 'contract_ext_no', label: 'Contract Ext No', type: 'text', defaultVisible: false },
  { key: 'contract_number', label: 'Contract No', type: 'text', defaultVisible: false },
  { key: 'sto_number', label: 'STO No', type: 'text', defaultVisible: false },
  { key: 'sto_qty', label: 'STO Qty (MT)', type: 'number', defaultVisible: false },
  { key: 'received_qty', label: 'Received Qty (MT)', type: 'number', defaultVisible: false },
  { key: 'outstanding_qty', label: 'Outstanding Qty (MT)', type: 'number', defaultVisible: true, tooltip: FIELD_HELP.shipmentOutstandingQty },
  { key: 'loading_delta_eta_etr_days', label: 'Loading ETA-ETR', type: 'number', defaultVisible: true },
  { key: 'loading_delta_eta_etb_days', label: 'Loading ETA-ETB', type: 'number', defaultVisible: true },
  { key: 'loading_delta_etb_etc_days', label: 'Loading ETB-ETC', type: 'number', defaultVisible: true },
  { key: 'discharge_delta_eta_etb_days', label: 'Discharge ETA-ETB', type: 'number', defaultVisible: true },
  { key: 'discharge_delta_etb_etc_days', label: 'Discharge ETB-ETC', type: 'number', defaultVisible: true },
  { key: 'total_delta_days', label: 'Total', type: 'number', defaultVisible: true, tooltip: FIELD_HELP.shipmentTotalDelta },
]

const COLUMN_MAP = Object.fromEntries(COLUMN_DEFS.map((col) => [col.key, col])) as Record<string, ColumnDef>

function getStatusColor(status: string): string {
  switch (status) {
    case 'PLANNED':     return 'bg-blue-100 text-blue-800'
    case 'IN_PROGRESS': return 'bg-yellow-100 text-yellow-800'
    case 'LOADING':     return 'bg-orange-100 text-orange-800'
    case 'IN_TRANSIT':  return 'bg-purple-100 text-purple-800'
    case 'ARRIVED':     return 'bg-indigo-100 text-indigo-800'
    case 'UNLOADING':   return 'bg-cyan-100 text-cyan-800'
    case 'COMPLETED':   return 'bg-green-100 text-green-800'
    case 'CANCELLED':
    case 'CANCELED':    return 'bg-red-100 text-red-800'
    default:            return 'bg-gray-100 text-gray-800'
  }
}

function asDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function NumberCell({
  value,
  isDeltaDays = false,
  decimalPlaces,
}: {
  value: unknown
  isDeltaDays?: boolean
  decimalPlaces?: number
}) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400">-</span>
  const n = Number(value)
  if (Number.isNaN(n)) return <span className="text-gray-400">-</span>
  if (isDeltaDays) {
    const formatted =
      decimalPlaces != null
        ? (n === 0 ? (0).toFixed(decimalPlaces) : Math.abs(n).toFixed(decimalPlaces))
        : formatSignedDeltaDays(n)
    return <span className={`font-semibold ${signedCycleDaysClass(n)}`}>{formatted}</span>
  }
  return <span>{n}</span>
}

export default function ShippingPerformancePage() {
  const [rows, setRows] = useState<ShippingPerformanceRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [shippingTableEnabled, setShippingTableEnabled] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [columnOrder, setColumnOrder] = useState<Array<keyof ShippingPerformanceRow>>(
    COLUMN_DEFS.map((c) => c.key)
  )
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible !== false]))
  )
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [columnFilterDrafts, setColumnFilterDrafts] = useState<Record<string, string>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<keyof ShippingPerformanceRow>('total_delta_days')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)
  const [statusFilter, setStatusFilter] = useState<TableStatusFilter>('All')
  const [selectedIncoterms, setSelectedIncoterms] = useState<string[]>([])
  const [selectedPlantSites, setSelectedPlantSites] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  })
  const [perfDashMode, setPerfDashMode] = useState<PerfDashMode>('eta')
  const [drilldownFilters, setDrilldownFilters] = useState<DrilldownFilters>(EMPTY_DRILLDOWN_FILTERS)
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('all')

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

  const buildShippingPerfFetchParams = useCallback(() => {
    const params = new URLSearchParams()
    params.append('scope', 'ytd')
    params.append('_ts', String(Date.now()))
    return params
  }, [])

  const fetchShippingPerformanceDashboard = useCallback(async () => {
    if (!authReady) return
    const params = buildShippingPerfFetchParams().toString()
    try {
      setSummaryLoading(true)
      const rowsResp = await api.get(`/shipments/performance?${params}`)
      setRows(Array.isArray(rowsResp.data?.data) ? rowsResp.data.data : [])
    } catch (error) {
      console.error('Failed to load shipping performance dashboard:', error)
      setRows([])
    } finally {
      setSummaryLoading(false)
    }
  }, [authReady, buildShippingPerfFetchParams])

  const loadShippingTableData = useCallback(() => {
    setShippingTableEnabled(true)
    setCurrentPage(1)
  }, [])

  const revealTableView = useCallback(() => {
    setShippingTableEnabled(true)
  }, [])

  useEffect(() => {
    if (!authReady) return
    void fetchShippingPerformanceDashboard()
  }, [authReady, fetchShippingPerformanceDashboard])

  // Data is fetched on mount — reveal the table as soon as the dashboard finishes loading.
  useEffect(() => {
    if (!summaryLoading) setShippingTableEnabled(true)
  }, [summaryLoading])

  const availableIncoterms = useMemo(() => distinctFieldValues(rows, 'incoterm'), [rows])
  const availablePlantSites = useMemo(() => distinctFieldValues(rows, 'plant_site'), [rows])

  // Step B: apply global filters (incoterm, plant, contract date)
  const globallyFilteredRows = useMemo(
    () =>
      applyGlobalFiltersToRows(rows, {
        selectedIncoterms,
        selectedPlantSites,
        dateFrom,
        dateTo,
      }),
    [rows, selectedIncoterms, selectedPlantSites, dateFrom, dateTo],
  )

  const etaFilteredData = useMemo(
    () => applyPerfModeFilter(globallyFilteredRows, 'eta'),
    [globallyFilteredRows],
  )

  const ataFilteredData = useMemo(
    () => applyPerfModeFilter(globallyFilteredRows, 'ata'),
    [globallyFilteredRows],
  )

  const perfModeFilteredRows = useMemo(
    () => applyPerfModeFilter(globallyFilteredRows, perfDashMode),
    [globallyFilteredRows, perfDashMode],
  )

  // Step C: apply drilldown node selection (product → plant → incoterm → vessel)
  const drilldownFilteredRows = useMemo(
    () => applyDrilldownFiltersToRows(perfModeFilteredRows, drilldownFilters),
    [perfModeFilteredRows, drilldownFilters],
  )

  // Step D: apply Section 3 status filter (All / Open / Closed)
  const statusFilteredRows = useMemo(
    () =>
      drilldownFilteredRows.filter((row) =>
        matchesTableStatusFilter(String(row.status || ''), statusFilter),
      ),
    [drilldownFilteredRows, statusFilter],
  )

  const etaDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(etaFilteredData, 'eta'),
    [etaFilteredData],
  )

  const ataDatasetBundle = useMemo(
    () => buildPerfDatasetBundle(ataFilteredData, 'ata'),
    [ataFilteredData],
  )

  const activeDatasetBundle = useMemo(
    () => (perfDashMode === 'eta' ? etaDatasetBundle : ataDatasetBundle),
    [perfDashMode, etaDatasetBundle, ataDatasetBundle],
  )

  const perfTree = activeDatasetBundle.tree

  const etaPerformanceSummary = etaDatasetBundle.summary
  const ataPerformanceSummary = ataDatasetBundle.summary

  useEffect(() => {
    setDrilldownFilters(EMPTY_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [perfDashMode, selectedIncoterms, selectedPlantSites, dateFrom, dateTo])

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (showColumnManager && columnsMenuRef.current && !columnsMenuRef.current.contains(t)) {
        setShowColumnManager(false)
      }
      if (openHeaderFilterId && headerFilterPopoverRef.current && !headerFilterPopoverRef.current.contains(t)) {
        setOpenHeaderFilterId(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showColumnManager, openHeaderFilterId])

  const resetPerfSelections = useCallback(() => {
    setDrilldownFilters(EMPTY_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [])

  const applyPerfDrilldownClick = useCallback((next: Partial<DrilldownFilters>) => {
    setShippingTableEnabled(true)
    setDrilldownFilters((prev) => ({
      product: 'product' in next ? (next.product ?? null) : prev.product,
      plant: 'plant' in next ? (next.plant ?? null) : prev.plant,
      incoterm: 'incoterm' in next ? (next.incoterm ?? null) : prev.incoterm,
      vessel: 'vessel' in next ? (next.vessel ?? null) : prev.vessel,
    }))
    setCurrentPage(1)
  }, [])

  const summaryCardClass = useCallback(
    (mode: PerfDashMode) => {
      const selected = perfDashMode === mode
      const ring = mode === 'eta' ? 'ring-blue-500' : 'ring-indigo-500'
      return `rounded-xl border bg-white p-5 shadow-sm text-left transition-all hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${
        selected ? `ring-2 ${ring}` : ''
      }`
    },
    [perfDashMode],
  )

  const renderSummaryGapMetrics = (summary: PerVesselPerfSummary, mode: PerfDashMode) => {
    const isAta = mode === 'ata'
    const metricClass = contextPerformanceClass(isAta ? summary.avgTotalDelta > 0 : summary.avgTotalDelta > 0)
    const fmt = (days: number) => formatAvgDays(Math.abs(days))
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
        <span>Avg Loading ETA-ETR: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgLoadingEtaEtr)}</span></span>
        <span>Avg Loading ETA-ETB: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgLoadingEtaEtb)}</span></span>
        <span>Avg Loading ETB-ETC: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgLoadingEtbEtc)}</span></span>
        <span>Avg Discharge ETA-ETB: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgDischargeEtaEtb)}</span></span>
        <span>Avg Discharge ETB-ETC: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgDischargeEtbEtc)}</span></span>
        <span>Avg Total: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgTotalDelta)}</span></span>
      </div>
    )
  }

  const applySearch = useCallback(() => {
    setSearchTerm(searchDraft)
    setCurrentPage(1)
  }, [searchDraft])

  const applyColumnFilter = useCallback((key: string) => {
    const value = (columnFilterDrafts[key] || '').trim()
    setColumnFilters((prev) => {
      const next = { ...prev }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
    setOpenHeaderFilterId(null)
    setCurrentPage(1)
  }, [columnFilterDrafts])

  const hasActiveColumnFilters = useCallback((filters: Record<string, string>): boolean => {
    return Object.values(filters).some((v) => (v || '').trim().length > 0)
  }, [])

  const hasActiveDrilldownFilters =
    drilldownFilters.vessel !== null ||
    drilldownFilters.incoterm !== null ||
    drilldownFilters.product !== null ||
    drilldownFilters.plant !== null

  const hasActiveFilters =
    Boolean(searchDraft || searchTerm) ||
    statusFilter !== 'All' ||
    selectedIncoterms.length > 0 ||
    selectedPlantSites.length > 0 ||
    Boolean(dateFrom || dateTo) ||
    hasActiveColumnFilters(columnFilters) ||
    hasActiveDrilldownFilters

  const clearAllFilters = useCallback(() => {
    setSearchDraft('')
    setSearchTerm('')
    setStatusFilter('All')
    setSelectedIncoterms([])
    setSelectedPlantSites([])
    setDateFrom('')
    setDateTo('')
    setColumnFilters({})
    setColumnFilterDrafts({})
    setDrilldownFilters(EMPTY_DRILLDOWN_FILTERS)
    setCurrentPage(1)
  }, [])

  const tableScopeDescription = useMemo(() => {
    const parts: string[] = [
      perfDashMode === 'eta' ? 'Per Vessel by ETA' : 'Per Vessel by ATA',
    ]
    if (selectedIncoterms.length > 0) {
      parts.push(`Incoterm: ${selectedIncoterms.map(displayGroupLabel).join(', ')}`)
    }
    if (selectedPlantSites.length > 0) {
      parts.push(`Plant: ${selectedPlantSites.map(displayGroupLabel).join(', ')}`)
    }
    if (dateFrom || dateTo) {
      parts.push(`Contract date: ${dateFrom || '…'} to ${dateTo || '…'}`)
    }
    if (drilldownFilters.product) parts.push(`Product: ${displayGroupLabel(drilldownFilters.product)}`)
    if (drilldownFilters.plant) parts.push(`Plant node: ${displayGroupLabel(drilldownFilters.plant)}`)
    if (drilldownFilters.incoterm) parts.push(`Incoterm node: ${displayGroupLabel(drilldownFilters.incoterm)}`)
    if (drilldownFilters.vessel) parts.push(`Vessel: ${drilldownFilters.vessel}`)
    if (statusFilter !== 'All') parts.push(`Status: ${statusFilter}`)
    return parts.join(' · ')
  }, [
    perfDashMode,
    selectedIncoterms,
    selectedPlantSites,
    dateFrom,
    dateTo,
    drilldownFilters,
    statusFilter,
  ])

  // Step E: apply Section 3 search, column filters, and sorting
  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const base = !q
      ? statusFilteredRows
      : statusFilteredRows.filter((row) => {
      const vessel = row.vessel_name?.toLowerCase() ?? ''
      const group = row.group_name?.toLowerCase() ?? ''
      const loadingPort = row.loading_port?.toLowerCase() ?? ''
      const dischargePort = row.discharge_port?.toLowerCase() ?? ''
      const shipmentId = row.shipment_id?.toLowerCase() ?? ''
      const contractNumber = row.contract_number?.toLowerCase() ?? ''
      const poNo = row.po_number?.toLowerCase() ?? ''
      const extNo = row.contract_ext_no?.toLowerCase() ?? ''
      const sto = row.sto_number?.toLowerCase() ?? ''
      return (
        vessel.includes(q) ||
        group.includes(q) ||
        loadingPort.includes(q) ||
        dischargePort.includes(q) ||
        shipmentId.includes(q) ||
        contractNumber.includes(q) ||
        poNo.includes(q) ||
        extNo.includes(q) ||
        sto.includes(q)
      )
    })

    const byColumns = base.filter((row) => {
      return COLUMN_DEFS.every((colDef) => {
        const key = colDef.key
        const filterText = (columnFilters[String(key)] || '').trim().toLowerCase()
        if (!filterText) return true
        const rowValue = row[key]
        const display = asDisplayValue(rowValue).toLowerCase()
        return display.includes(filterText)
      })
    })

    const sorted = [...byColumns].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      const colType = COLUMN_MAP[String(sortBy)]?.type ?? 'text'
      if (colType === 'number') {
        const aNum = aVal === null || aVal === undefined || aVal === '' ? Number.NEGATIVE_INFINITY : Number(aVal)
        const bNum = bVal === null || bVal === undefined || bVal === '' ? Number.NEGATIVE_INFINITY : Number(bVal)
        return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
      }
      const aStr = asDisplayValue(aVal).toLowerCase()
      const bStr = asDisplayValue(bVal).toLowerCase()
      if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1
      if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [statusFilteredRows, searchTerm, columnFilters, sortBy, sortDirection])

  const tableRows = useMemo(() => {
    if (tableViewMode === 'all') return filteredRows
    return aggregateByVessel(filteredRows)
  }, [filteredRows, tableViewMode])

  const tableColumnKeys = useMemo((): TableColumnKey[] => {
    const ordered = columnOrder.filter((key) => visibleColumns[String(key)] && COLUMN_MAP[String(key)])
    if (tableViewMode === 'all') {
      const withRequired = [...new Set<TableColumnKey>([
        ...ordered.filter(
          (key) => String(key) !== 'shipment_count' && !ALL_SHIPMENTS_HIDDEN_COLUMNS.has(String(key)),
        ),
        'loading_port' as TableColumnKey,
        'discharge_port' as TableColumnKey,
      ])]
      return withRequired
    }
    const summaryKeys: TableColumnKey[] = ['vessel_name', 'shipment_count']
    const metricKeys = ordered.filter(
      (key) => !DETAIL_COLUMN_KEYS.has(String(key)) && !summaryKeys.includes(key) && !ALL_SHIPMENT_REQUIRED_COLUMNS.has(String(key)),
    )
    return [...summaryKeys, ...metricKeys]
  }, [columnOrder, visibleColumns, tableViewMode])

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize))
  const paginatedRows = useMemo(
    () => tableRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [tableRows, currentPage, pageSize]
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [
    statusFilter,
    selectedIncoterms,
    selectedPlantSites,
    dateFrom,
    dateTo,
    searchTerm,
    columnFilters,
    drilldownFilters,
    tableViewMode,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const calc = () => {
      const el = bottomScrollRef.current
      if (el) setTableScrollWidth(el.scrollWidth)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [tableColumnKeys, paginatedRows.length])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const onToggleColumn = (key: keyof ShippingPerformanceRow) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [String(key)]: !prev[String(key)] }
      const visibleCount = Object.values(next).filter(Boolean).length
      if (visibleCount === 0) return prev
      return next
    })
  }

  const reorderColumnByDrag = (fromId: string, toId: string) => {
    setColumnOrder((prev) => {
      const next = [...prev]
      const fromIdx = next.indexOf(fromId as keyof ShippingPerformanceRow)
      const toIdx = next.indexOf(toId as keyof ShippingPerformanceRow)
      if (fromIdx < 0 || toIdx < 0) return prev
      next.splice(fromIdx, 1)
      next.splice(toIdx, 0, fromId as keyof ShippingPerformanceRow)
      return next
    })
  }

  const onHeaderSort = (key: keyof ShippingPerformanceRow) => {
    if (sortBy === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDirection('asc')
  }

  const moveColumn = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return
    setColumnOrder((prev) => {
      const next = [...prev]
      const fromIdx = next.findIndex((k) => String(k) === fromKey)
      const toIdx = next.findIndex((k) => String(k) === toKey)
      if (fromIdx < 0 || toIdx < 0) return prev
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Shipping Performance</h1>
          </div>
        </div>

        {/* Section 1: Summary Cards */}
        {(() => {
          if (summaryLoading) {
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={resetPerfSelections}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    Reset selection
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded-xl border bg-white p-5 shadow-sm animate-pulse">
                      <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
                      <div className="h-8 bg-gray-200 rounded w-32 mb-3" />
                      <div className="h-16 bg-gray-100 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            )
          }

          return (
            <div className="space-y-2">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={resetPerfSelections}
                  className="text-sm text-blue-700 hover:underline"
                >
                  Reset selection
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setPerfDashMode('eta')
                    revealTableView()
                  }}
                  className={summaryCardClass('eta')}
                >
                  <div className="mb-3">
                    <span className="text-base font-semibold text-gray-800">Per Vessel by ETA</span>
                  </div>
                  <div className="text-sm text-gray-500 mb-1">Total Vessels</div>
                  <div className="text-xl font-bold text-gray-900 mb-3">
                    {etaPerformanceSummary.vesselCount.toLocaleString('en-US')}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                    <span>Shipments: <span className="font-semibold text-gray-700">{etaPerformanceSummary.shipmentCount.toLocaleString('en-US')}</span></span>
                  </div>
                  {renderSummaryGapMetrics(etaPerformanceSummary, 'eta')}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPerfDashMode('ata')
                    revealTableView()
                  }}
                  className={summaryCardClass('ata')}
                >
                  <div className="mb-3">
                    <span className="text-base font-semibold text-gray-800">Per Vessel by ATA</span>
                  </div>
                  <div className="text-sm text-gray-500 mb-1">Total Vessels</div>
                  <div className="text-xl font-bold text-gray-900 mb-3">
                    {ataPerformanceSummary.vesselCount.toLocaleString('en-US')}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                    <span>Shipments: <span className="font-semibold text-gray-700">{ataPerformanceSummary.shipmentCount.toLocaleString('en-US')}</span></span>
                  </div>
                  {renderSummaryGapMetrics(ataPerformanceSummary, 'ata')}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Section 2: Drilldown */}
        <Card>
          <CardHeader className="pb-2">
            <div>
              <CardTitle className="text-base">
                {perfDashMode === 'eta' ? 'Performance Drilldown (ETA)' : 'Performance Drilldown (ATA)'}
              </CardTitle>
              <div className="text-sm text-gray-600 mt-1">
                Navigate as a tree: <span className="font-medium">Product → Plant → Incoterm → Vessel</span>.
                Click a node to filter the table below.
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {summaryLoading ? (
              <div className="rounded-xl border bg-white p-6 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-40 bg-gray-100 rounded-lg" />
                  ))}
                </div>
              </div>
            ) : perfTree.length === 0 ? (
              <div className="text-sm text-gray-500">No shipments found for the current filters.</div>
            ) : (
              <div className="rounded-xl border bg-white p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Drilldown</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {activeDatasetBundle.summary.shipmentCount.toLocaleString('en-US')} shipments ·{' '}
                      {activeDatasetBundle.summary.vesselCount.toLocaleString('en-US')} vessels
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetPerfSelections}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    Reset selection
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                  {([
                      { title: 'Product',  subtitle: drilldownFilters.product  ? `Under ${displayGroupLabel(drilldownFilters.product)}`  : 'Pick one',                          level: 'product'  as const },
                      { title: 'Plant',    subtitle: drilldownFilters.product  ? `Under ${displayGroupLabel(drilldownFilters.product)}`  : 'Pick product first',              level: 'plant'    as const },
                      { title: 'Incoterm', subtitle: drilldownFilters.plant    ? `Under ${displayGroupLabel(drilldownFilters.plant)}`    : 'Pick plant first',                level: 'incoterm' as const },
                      { title: 'Vessel',   subtitle: drilldownFilters.incoterm ? `Under ${displayGroupLabel(drilldownFilters.incoterm)}` : 'Pick incoterm first',             level: 'vessel'   as const },
                    ] as const).map((col) => {
                      const activeTree = perfTree
                      const denom = activeDatasetBundle.summary.vesselCount || 1
                      const levelStyles: Record<string, { headerBg: string; badge: string; bar: string; border: string }> = {
                        vessel:  { headerBg: 'bg-sky-50',     badge: 'bg-sky-100 text-sky-800',        bar: 'bg-sky-600',     border: 'border-sky-200' },
                        incoterm:{ headerBg: 'bg-violet-50',  badge: 'bg-violet-100 text-violet-800',  bar: 'bg-violet-600',  border: 'border-violet-200' },
                        product: { headerBg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',    bar: 'bg-amber-600',   border: 'border-amber-200' },
                        plant:   { headerBg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800',bar: 'bg-emerald-600', border: 'border-emerald-200' },
                      }
                      const style = levelStyles[col.level]
                      const itemClass = (selected: boolean) =>
                        `w-full text-left rounded-lg border px-3 py-2 hover:bg-gray-50 focus:outline-none ${
                          selected ? `bg-white ${style.border}` : 'bg-white border-gray-200'
                        }`

                      const renderNode = (node: LatePerfNode, selected: boolean, onClick: () => void, isTotal = false) => {
                        const label = col.level === 'vessel' ? node.key : displayGroupLabel(node.key)
                        const pct = Math.max(1, Math.round((node.vesselCount / denom) * 100))
                        return (
                          <button key={node.key} type="button" className={itemClass(selected)} onClick={onClick}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 text-left">
                                <div className="text-sm font-semibold text-gray-900 truncate">{label}</div>
                                <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden">
                                  <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="mt-1 text-xs text-gray-700 flex items-center justify-between gap-2">
                                  <span className="font-semibold">{node.count.toLocaleString('en-US')}</span>
                                  <span className="text-gray-500">shipments</span>
                                  <span className="ml-auto text-right whitespace-nowrap">
                                    <span className="block text-[10px] text-gray-500 leading-tight">Total Vessels</span>
                                    <span className="font-semibold">{node.vesselCount.toLocaleString('en-US')}</span>
                                  </span>
                                </div>
                              </div>
                              {isTotal && (
                                <span className={`shrink-0 px-2 py-1 rounded text-[11px] font-semibold ${style.badge}`}>Total</span>
                              )}
                            </div>
                          </button>
                        )
                      }

                      const panelHeader = (
                        <div className={`rounded-lg border px-3 py-2 ${style.headerBg} ${style.border}`}>
                          <div className="text-sm font-semibold text-gray-900">{col.title}</div>
                          <div className="text-[11px] text-gray-500">{col.subtitle}</div>
                        </div>
                      )

                      const productNode  = activeTree.find((n) => n.key === drilldownFilters.product)
                      const plantNode    = productNode?.children.find((n) => n.key === drilldownFilters.plant)
                      const incotermNode = plantNode?.children.find((n) => n.key === drilldownFilters.incoterm)

                      const body = (() => {
                        if (col.level === 'product') {
                          return (
                            <div className="space-y-2">
                              {activeTree.map((n) => renderNode(n, drilldownFilters.product === n.key, () => {
                                applyPerfDrilldownClick({ product: n.key, plant: null, incoterm: null, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (col.level === 'plant') {
                          if (!drilldownFilters.product) return <div className="text-sm text-gray-500">Select a product to see plants.</div>
                          return (
                            <div className="space-y-2">
                              {(productNode?.children || []).map((n) => renderNode(n, drilldownFilters.plant === n.key, () => {
                                applyPerfDrilldownClick({ plant: n.key, incoterm: null, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (col.level === 'incoterm') {
                          if (!drilldownFilters.plant) return <div className="text-sm text-gray-500">Select a plant to see incoterms.</div>
                          return (
                            <div className="space-y-2">
                              {(plantNode?.children || []).map((n) => renderNode(n, drilldownFilters.incoterm === n.key, () => {
                                applyPerfDrilldownClick({ incoterm: n.key, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (!drilldownFilters.incoterm) return <div className="text-sm text-gray-500">Select an incoterm to see vessels.</div>
                        return (
                          <div className="space-y-2">
                            {(incotermNode?.children || []).map((n) => renderNode(n, drilldownFilters.vessel === n.key, () => {
                              applyPerfDrilldownClick({ vessel: n.key })
                            }))}
                          </div>
                        )
                      })()

                      return (
                        <div key={col.level} className="space-y-2">
                          {panelHeader}
                          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">{body}</div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Global Filters — before View Table (matches Contract Performance layout) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filters</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Apply incoterm, plant/site, and contract date filters to the summary, drilldown, and shipment table.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SearchableMultiSelect
                  label="Incoterm"
                  options={availableIncoterms}
                  selected={selectedIncoterms}
                  onChange={(values) => {
                    setSelectedIncoterms(values)
                    revealTableView()
                  }}
                  placeholder="Select incoterm(s)"
                  emptyMessage="No incoterms"
                />
                <SearchableMultiSelect
                  label="Plant/Site"
                  options={availablePlantSites}
                  selected={selectedPlantSites}
                  onChange={(values) => {
                    setSelectedPlantSites(values)
                    revealTableView()
                  }}
                  placeholder="Select plant/site(s)"
                  emptyMessage="No plants"
                />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={(value) => { setDateFrom(value); revealTableView() }} className="w-40" />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={(value) => { setDateTo(value); revealTableView() }} className="w-40" />
                </div>
                {(selectedIncoterms.length > 0 || selectedPlantSites.length > 0 || dateFrom || dateTo) && (
                  <Button
                    type="button"
                    onClick={() => {
                      setSelectedIncoterms([])
                      setSelectedPlantSites([])
                      setDateFrom('')
                      setDateTo('')
                    }}
                    variant="ghost"
                    size="sm"
                    className="text-gray-500"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear filters
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: View Table */}
        <div>
        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>{tableViewMode === 'all' ? 'All Shipments' : 'By Vessel'}</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                {summaryLoading
                  ? 'Loading shipments…'
                  : !shippingTableEnabled
                  ? 'Click All Data to load the shipment list'
                  : tableViewMode === 'all'
                  ? `${tableRows.length} total shipments | Showing ${paginatedRows.length} on this page`
                  : `${tableRows.length} vessel${tableRows.length === 1 ? '' : 's'} | Showing ${paginatedRows.length} on this page`}
              </p>
              {shippingTableEnabled && !summaryLoading && (
                <p className="text-xs text-gray-500 mt-1">
                  Active scope: {tableScopeDescription}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border bg-white p-1">
                <button
                  type="button"
                  onClick={() => { setTableViewMode('all'); setCurrentPage(1) }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tableViewMode === 'all' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  All Shipment
                </button>
                <button
                  type="button"
                  onClick={() => { setTableViewMode('by_vessel'); setCurrentPage(1) }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tableViewMode === 'by_vessel' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  By Vessel
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                  <Input
                    placeholder="Search vessel, supplier group, shipment ID, or contract..."
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
                    setStatusFilter(e.target.value as TableStatusFilter)
                    setCurrentPage(1)
                  }}
                  className="rounded-lg border px-4 py-2"
                  title="Section 3 status filter"
                >
                  <option value="All">All</option>
                  <option value="Open">Open</option>
                  <option value="Closed">Closed</option>
                </select>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    onClick={clearAllFilters}
                    variant="ghost"
                    size="sm"
                    className="text-gray-500"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
              {!shippingTableEnabled && (
                <Button size="sm" onClick={loadShippingTableData}>
                  <Database className="h-4 w-4 mr-2" />
                  All Data
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
              <div ref={columnsMenuRef} className="relative">
                <Button variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)} disabled={!shippingTableEnabled || summaryLoading}>
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Columns
                </Button>
                {showColumnManager && (
                  <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-gray-600">Visible columns</div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowColumnManager(false)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 mb-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, true])))}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, false])))}
                      >
                        Unselect All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setVisibleColumns(Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible !== false])))}
                      >
                        Reset
                      </Button>
                    </div>
                    <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                      {columnOrder
                        .map((key) => COLUMN_DEFS.find((c) => c.key === key))
                        .filter((col): col is ColumnDef => !!col)
                        .filter((col) => {
                          const key = String(col.key)
                          if (tableViewMode === 'all' && ALL_SHIPMENTS_HIDDEN_COLUMNS.has(key)) return false
                          if (tableViewMode === 'by_vessel' && BY_VESSEL_HIDDEN_COLUMNS.has(key)) return false
                          return true
                        })
                        .map((col) => (
                          <div
                            key={String(col.key)}
                            draggable
                            onDragStart={() => setDragColId(String(col.key))}
                            onDragEnd={() => setDragColId(null)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragColId && dragColId !== String(col.key)) reorderColumnByDrag(dragColId, String(col.key)) }}
                            className={`flex items-center gap-2 text-sm cursor-grab select-none rounded px-1 py-0.5 ${dragColId === String(col.key) ? 'opacity-40' : 'hover:bg-gray-50'}`}
                          >
                            <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <Checkbox
                                checked={Boolean(visibleColumns[String(col.key)])}
                                onCheckedChange={() => onToggleColumn(col.key)}
                              />
                              <span className="truncate">{col.label}</span>
                            </label>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
              {shippingTableEnabled && totalPages > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
                    Previous
                  </Button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) { pageNum = i + 1 }
                    else if (currentPage <= 3) { pageNum = i + 1 }
                    else if (currentPage >= totalPages - 2) { pageNum = totalPages - 4 + i }
                    else { pageNum = currentPage - 2 + i }
                    return (
                      <Button key={pageNum} variant={currentPage === pageNum ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(pageNum)} className="min-w-[36px]">
                        {pageNum}
                      </Button>
                    )
                  })}
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>
                    Next
                  </Button>
                  <span className="text-sm text-gray-500 ml-1">
                    Page {currentPage} of {totalPages}
                  </span>
                </div>
              )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!shippingTableEnabled ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Database className="h-12 w-12 text-gray-300 mb-4" />
                <p className="text-gray-600 mb-1">Shipment list is not loaded yet.</p>
                <p className="text-sm text-gray-500 mb-4">Load all data to view the full table — this may take a moment.</p>
                <Button onClick={loadShippingTableData}>
                  All Data
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            ) : (
            <>
            <div className="border rounded-md">
              {/* Top scrollbar */}
              <div
                ref={topScrollRef}
                className="overflow-x-auto border-b bg-white rounded-t-md"
                onScroll={() => {
                  if (isSyncingScroll.current) return
                  const top = topScrollRef.current
                  const bottom = bottomScrollRef.current
                  if (!top || !bottom) return
                  isSyncingScroll.current = true
                  bottom.scrollLeft = top.scrollLeft
                  window.requestAnimationFrame(() => { isSyncingScroll.current = false })
                }}
              >
                <div style={{ width: tableScrollWidth || 0, height: 1 }} />
              </div>

              {/* Table */}
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
                  window.requestAnimationFrame(() => { isSyncingScroll.current = false })
                }}
              >
                <table className="min-w-[1300px] w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="border-b">
                      {tableColumnKeys.map((key) => {
                        const col = COLUMN_MAP[String(key)]
                        const isSorted = sortBy === key
                        return (
                          <th
                            key={String(key)}
                            className="relative px-3 py-2 text-left font-medium whitespace-nowrap cursor-move select-none"
                            draggable
                            onDragStart={() => setDraggingColumn(String(key))}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (draggingColumn) moveColumn(draggingColumn, String(key))
                              setDraggingColumn(null)
                            }}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center gap-1"
                              onClick={() => onHeaderSort(key)}
                              title="Click to sort, drag to reorder"
                            >
                              <span>{col.label}</span>
                              <span className="text-xs text-gray-500">
                                {isSorted ? (sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                              </span>
                            </button>
                            {col.tooltip ? (
                              <span className="shrink-0 inline-flex items-center">
                                <FieldHelp text={col.tooltip} />
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className={`ml-1 p-1 rounded hover:bg-gray-100 ${columnFilters[String(key)] ? 'text-blue-700' : 'text-gray-400'}`}
                              title="Filter"
                              onClick={(e) => {
                                e.stopPropagation()
                                const colKey = String(key)
                                setColumnFilterDrafts((prev) => ({
                                  ...prev,
                                  [colKey]: columnFilters[colKey] || '',
                                }))
                                setOpenHeaderFilterId((prev) => (prev === colKey ? null : colKey))
                              }}
                            >
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                            {openHeaderFilterId === String(key) && (
                              <div
                                ref={headerFilterPopoverRef}
                                className="absolute left-0 top-full mt-2 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30"
                                onClick={(e) => e.stopPropagation()}
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
                                <Input
                                  value={columnFilterDrafts[String(key)] ?? columnFilters[String(key)] ?? ''}
                                  onChange={(e) =>
                                    setColumnFilterDrafts((prev) => ({
                                      ...prev,
                                      [String(key)]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      applyColumnFilter(String(key))
                                    }
                                  }}
                                  placeholder={col.type === 'number' ? 'Type number (Enter to apply)' : 'Type to filter (Enter to apply)'}
                                  className="h-8 text-sm"
                                />
                                <div className="mt-2 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      const colKey = String(key)
                                      setColumnFilters((prev) => {
                                        const next = { ...prev }
                                        delete next[colKey]
                                        return next
                                      })
                                      setColumnFilterDrafts((prev) => {
                                        const next = { ...prev }
                                        delete next[colKey]
                                        return next
                                      })
                                      setOpenHeaderFilterId(null)
                                      setCurrentPage(1)
                                    }}
                                  >
                                    Clear
                                  </Button>
                                </div>
                              </div>
                            )}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryLoading ? (
                      <tr>
                        <td colSpan={tableColumnKeys.length || 1} className="px-3 py-6 text-center text-gray-500">
                          Loading shipping performance...
                        </td>
                      </tr>
                    ) : tableRows.length === 0 ? (
                      <tr>
                        <td colSpan={tableColumnKeys.length || 1} className="px-3 py-6 text-center text-gray-500">
                          No data found
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row) => (
                        <tr key={row.id} className="border-t hover:bg-gray-50">
                          {tableColumnKeys.map((key) => {
                            const col = COLUMN_MAP[String(key)]
                            const rawValue = row[key]
                            return (
                              <td key={`${row.id}-${String(key)}`} className="px-3 py-2 whitespace-nowrap">
                                {(key === 'sto_qty' || key === 'received_qty' || key === 'outstanding_qty')
                                  ? (rawValue === null || rawValue === undefined
                                      ? <span className="text-gray-400">-</span>
                                      : <span>{(Number(rawValue) / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</span>)
                                  : key === 'shipment_count'
                                  ? <span className="font-medium">{Number(rawValue ?? 0).toLocaleString('en-US')}</span>
                                  : key === 'status'
                                  ? (rawValue
                                      ? <Badge className={getStatusColor(String(rawValue))}>{String(rawValue)}</Badge>
                                      : <span className="text-gray-400">-</span>)
                                  : col.type === 'number'
                                  ? (
                                    <NumberCell
                                      value={rawValue}
                                      isDeltaDays={String(key).includes('delta')}
                                      decimalPlaces={tableViewMode === 'by_vessel' && String(key).includes('delta') ? 1 : undefined}
                                    />
                                  )
                                  : asDisplayValue(rawValue) || '-'}
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Delta unit is day difference. Records include transport mode SEA or MIX only.
            </p>
            </>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </Layout>
  )
}
