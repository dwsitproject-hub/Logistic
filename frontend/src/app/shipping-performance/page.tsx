'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowDown, ArrowUp, Filter, GripVertical, Search, SlidersHorizontal, X } from 'lucide-react'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import {
  avgDaysMetricLabel,
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
}

type TableViewMode = 'all' | 'vessel_group'

type TableColumnKey = keyof ShippingPerformanceRow

/** Shipment-level columns hidden in vessel-group summary view. */
const DETAIL_COLUMN_KEYS = new Set<string>([
  'shipment_id',
  'status',
  'po_number',
  'contract_ext_no',
  'contract_number',
  'sto_number',
  'vessel_name',
  'incoterm',
  'product',
  'plant_site',
  'contract_date',
])

function vesselGroupKey(row: ShippingPerformanceRow): string {
  return String(row.group_name ?? '').trim() || 'Blank'
}

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

function aggregateByVesselGroup(rows: ShippingPerformanceRow[]): ShippingPerformanceRow[] {
  const groups = new Map<string, ShippingPerformanceRow[]>()
  for (const row of rows) {
    const key = vesselGroupKey(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  return [...groups.entries()].map(([groupKey, groupRows]) => ({
    id: `vessel-group:${groupKey}`,
    shipment_id: '',
    contract_number: '',
    group_name: groupKey,
    vessel_name: null,
    po_number: null,
    contract_ext_no: null,
    sto_number: null,
    contract_date: null,
    incoterm: null,
    product: null,
    status: null,
    plant_site: null,
    shipment_count: groupRows.length,
    sto_qty: sumMetric(groupRows, 'sto_qty'),
    received_qty: sumMetric(groupRows, 'received_qty'),
    outstanding_qty: sumMetric(groupRows, 'outstanding_qty'),
    loading_delta_eta_etr_days: avgMetric(groupRows, 'loading_delta_eta_etr_days'),
    loading_delta_eta_etb_days: avgMetric(groupRows, 'loading_delta_eta_etb_days'),
    loading_delta_etb_etc_days: avgMetric(groupRows, 'loading_delta_etb_etc_days'),
    discharge_delta_eta_etb_days: avgMetric(groupRows, 'discharge_delta_eta_etb_days'),
    discharge_delta_etb_etc_days: avgMetric(groupRows, 'discharge_delta_etb_etc_days'),
    total_delta_days: avgMetric(groupRows, 'total_delta_days'),
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
  totalQty: number
  children: LatePerfNode[]
}

function matchesPerfDrilldownRow(row: ShippingPerformanceRow, isLate: boolean): boolean {
  const delta = Number(row.total_delta_days ?? 0)
  if (isLate ? delta <= 0 : delta > 0) return false
  if (String(row.status || '').trim().toUpperCase() === 'COMPLETED') return false
  if (Number(row.outstanding_qty ?? 0) <= 0) return false
  return true
}

type ShippingPerfSummary = {
  count: number
  totalQty: number
  avgLoadingEtaEtr: number
  avgLoadingEtaEtb: number
  avgLoadingEtbEtc: number
  avgDischargeEtaEtb: number
  avgDischargeEtbEtc: number
  avgTotalDelta: number
  openOutstandingQty: number
  closeOutstandingQty: number
}

const EMPTY_SHIPPING_SUMMARY: ShippingPerfSummary = {
  count: 0,
  totalQty: 0,
  avgLoadingEtaEtr: 0,
  avgLoadingEtaEtb: 0,
  avgLoadingEtbEtc: 0,
  avgDischargeEtaEtb: 0,
  avgDischargeEtbEtc: 0,
  avgTotalDelta: 0,
  openOutstandingQty: 0,
  closeOutstandingQty: 0,
}

function buildShippingPerfSummary(rows: ShippingPerformanceRow[], isLate: boolean): ShippingPerfSummary {
  let count = 0
  let totalQty = 0
  let openOutstandingQty = 0
  let closeOutstandingQty = 0
  let sumLoadingEtaEtr = 0
  let sumLoadingEtaEtb = 0
  let sumLoadingEtbEtc = 0
  let sumDischargeEtaEtb = 0
  let sumDischargeEtbEtc = 0
  let sumTotalDelta = 0

  for (const row of rows) {
    const total = Number(row.total_delta_days ?? 0)
    if (isLate ? total <= 0 : total > 0) continue
    count++
    const qty = Number(row.outstanding_qty ?? 0)
    totalQty += qty
    const status = String(row.status || '').trim().toUpperCase()
    if (status === 'COMPLETED') closeOutstandingQty += qty
    else openOutstandingQty += qty

    sumLoadingEtaEtr += Number(row.loading_delta_eta_etr_days ?? 0)
    sumLoadingEtaEtb += Number(row.loading_delta_eta_etb_days ?? 0)
    sumLoadingEtbEtc += Number(row.loading_delta_etb_etc_days ?? 0)
    sumDischargeEtaEtb += Number(row.discharge_delta_eta_etb_days ?? 0)
    sumDischargeEtbEtc += Number(row.discharge_delta_etb_etc_days ?? 0)
    sumTotalDelta += total
  }

  if (count === 0) return EMPTY_SHIPPING_SUMMARY

  return {
    count,
    totalQty,
    openOutstandingQty,
    closeOutstandingQty,
    avgLoadingEtaEtr: sumLoadingEtaEtr / count,
    avgLoadingEtaEtb: sumLoadingEtaEtb / count,
    avgLoadingEtbEtc: sumLoadingEtbEtc / count,
    avgDischargeEtaEtb: sumDischargeEtaEtb / count,
    avgDischargeEtbEtc: sumDischargeEtbEtc / count,
    avgTotalDelta: sumTotalDelta / count,
  }
}

function matchesShipmentStatusFilter(status: string, filter: string): boolean {
  const normalized = String(status || '').trim().toUpperCase()
  if (filter === 'ALL') return true
  if (filter === 'Open') return normalized !== 'COMPLETED' && normalized !== 'CANCELLED' && normalized !== 'CANCELED'
  if (filter === 'Close') return normalized === 'COMPLETED'
  return normalized === filter.toUpperCase()
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
  { key: 'group_name', label: 'Vessel Group', type: 'text', defaultVisible: true },
  { key: 'shipment_count', label: 'Shipments', type: 'number', defaultVisible: false },
  { key: 'vessel_name', label: 'Vessel', type: 'text', defaultVisible: true },
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
  const [loading, setLoading] = useState(true)
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
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
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
  const [perfDashMode, setPerfDashMode] = useState<'late' | 'ontrack'>('ontrack')
  const [lateOnTimeFilter, setLateOnTimeFilter] = useState<'ALL' | 'LATE' | 'ON_TIME'>('ALL')
  const [lateSelVessel, setLateSelVessel] = useState<string | null>(null)
  const [lateSelIncoterm, setLateSelIncoterm] = useState<string | null>(null)
  const [lateSelProduct, setLateSelProduct] = useState<string | null>(null)
  const [lateSelPlant, setLateSelPlant] = useState<string | null>(null)
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('all')

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const res = await api.get('/shipments/performance')
        setRows(Array.isArray(res.data?.data) ? res.data.data : [])
      } catch (error) {
        console.error('Failed to load shipping performance:', error)
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

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

  const availableIncoterms = useMemo(
    () =>
      [...new Set(rows.map((r) => String(r.incoterm || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const availablePlantSites = useMemo(
    () =>
      [...new Set(rows.map((r) => String(r.plant_site || '').trim() || 'Blank'))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const summaryBaseRows = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesShipmentStatusFilter(String(row.status || ''), statusFilter)) return false
      const inc = String(row.incoterm || '').trim() || 'Blank'
      if (selectedIncoterms.length > 0 && !selectedIncoterms.includes(inc)) return false
      const plant = String(row.plant_site || '').trim() || 'Blank'
      if (selectedPlantSites.length > 0 && !selectedPlantSites.includes(plant)) return false
      const cDate = String(row.contract_date || '').slice(0, 10)
      if (dateFrom && cDate && cDate < dateFrom) return false
      if (dateTo && cDate && cDate > dateTo) return false
      return true
    })
  }, [rows, statusFilter, selectedIncoterms, selectedPlantSites, dateFrom, dateTo])

  const latePerformanceSummary = useMemo(
    () => buildShippingPerfSummary(summaryBaseRows, true),
    [summaryBaseRows],
  )

  const onTrackPerformanceSummary = useMemo(
    () => buildShippingPerfSummary(summaryBaseRows, false),
    [summaryBaseRows],
  )

  const filteredByTopFilters = useMemo(() => {
    return summaryBaseRows.filter((row) => {
      const total = Number(row.total_delta_days ?? 0)
      if (lateOnTimeFilter === 'LATE' && !(total > 0)) return false
      if (lateOnTimeFilter === 'ON_TIME' && !(total <= 0)) return false
      return true
    })
  }, [summaryBaseRows, lateOnTimeFilter])

  const buildPerfTree = (rows: typeof filteredByTopFilters, isLate: boolean): LatePerfNode[] => {
    type VesMap   = Map<string, { count: number; totalQty: number }>
    type IncMap   = Map<string, { count: number; totalQty: number; vessels: VesMap }>
    type PlantMap = Map<string, { count: number; totalQty: number; incoterms: IncMap }>
    type ProdMap  = Map<string, { count: number; totalQty: number; plants: PlantMap }>
    const root: ProdMap = new Map()
    for (const row of rows) {
      if (!matchesPerfDrilldownRow(row, isLate)) continue
      const prod  = String(row.product     || '').trim() || 'Blank'
      const plant = String(row.plant_site  || '').trim() || 'Blank'
      const inc   = String(row.incoterm    || '').trim() || 'Blank'
      const ves   = String(row.vessel_name || '').trim() || 'Unknown'
      const qty = Number(row.outstanding_qty ?? 0)
      if (!root.has(prod))  root.set(prod, { count: 0, totalQty: 0, plants: new Map() })
      const pN = root.get(prod)!; pN.count += 1; pN.totalQty += qty
      if (!pN.plants.has(plant)) pN.plants.set(plant, { count: 0, totalQty: 0, incoterms: new Map() })
      const plN = pN.plants.get(plant)!; plN.count += 1; plN.totalQty += qty
      if (!plN.incoterms.has(inc)) plN.incoterms.set(inc, { count: 0, totalQty: 0, vessels: new Map() })
      const iN = plN.incoterms.get(inc)!; iN.count += 1; iN.totalQty += qty
      if (!iN.vessels.has(ves)) iN.vessels.set(ves, { count: 0, totalQty: 0 })
      const vN = iN.vessels.get(ves)!; vN.count += 1; vN.totalQty += qty
    }
    const srt = <T,>(m: Map<string, T & { totalQty: number }>) =>
      [...m.entries()].sort((a, b) => b[1].totalQty - a[1].totalQty)
    return srt(root).map(([prod, pN]) => ({
      key: prod, count: pN.count, totalQty: pN.totalQty,
      children: srt(pN.plants).map(([plant, plN]) => ({
        key: plant, count: plN.count, totalQty: plN.totalQty,
        children: srt(plN.incoterms).map(([inc, iN]) => ({
          key: inc, count: iN.count, totalQty: iN.totalQty,
          children: srt(iN.vessels).map(([ves, vN]) => ({
            key: ves, count: vN.count, totalQty: vN.totalQty, children: [],
          })),
        })),
      })),
    }))
  }

  const lateTree = useMemo(() => buildPerfTree(filteredByTopFilters, true), [filteredByTopFilters])

  const onTrackTree = useMemo(() => buildPerfTree(filteredByTopFilters, false), [filteredByTopFilters])

  const scrollTableIntoView = useCallback(() => {
    setCurrentPage(1)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const resetPerfSelections = useCallback(() => {
    setLateSelVessel(null)
    setLateSelIncoterm(null)
    setLateSelProduct(null)
    setLateSelPlant(null)
    setLateOnTimeFilter('ALL')
    setCurrentPage(1)
  }, [])

  const applySummaryStatusFocus = useCallback(
    (mode: 'ontrack' | 'late', shipmentStatus: 'Open' | 'Close') => {
      setPerfDashMode(mode)
      setLateOnTimeFilter(mode === 'ontrack' ? 'ON_TIME' : 'LATE')
      setStatusFilter(shipmentStatus)
      setLateSelVessel(null)
      setLateSelIncoterm(null)
      setLateSelProduct(null)
      setLateSelPlant(null)
      setCurrentPage(1)
      scrollTableIntoView()
    },
    [scrollTableIntoView],
  )

  const isSummaryStatusSelected = useCallback(
    (mode: 'ontrack' | 'late', shipmentStatus: 'Open' | 'Close') =>
      !lateSelProduct &&
      !lateSelPlant &&
      !lateSelIncoterm &&
      !lateSelVessel &&
      lateOnTimeFilter === (mode === 'ontrack' ? 'ON_TIME' : 'LATE') &&
      statusFilter === shipmentStatus,
    [lateSelProduct, lateSelPlant, lateSelIncoterm, lateSelVessel, lateOnTimeFilter, statusFilter],
  )

  const summaryStatusBoxClass = useCallback(
    (mode: 'ontrack' | 'late', shipmentStatus: 'Open' | 'Close', palette: string) => {
      const selected = isSummaryStatusSelected(mode, shipmentStatus)
      const ring = mode === 'ontrack' ? 'ring-green-500' : 'ring-red-500'
      return `${palette} flex-1 rounded-lg border px-3 py-2 text-left transition-all hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${
        selected ? `ring-2 ${ring} shadow-sm` : ''
      }`
    },
    [isSummaryStatusSelected],
  )

  const renderSummaryGapMetrics = (summary: ShippingPerfSummary, isLate: boolean) => {
    const metricClass = contextPerformanceClass(isLate)
    const fmt = (days: number) => formatAvgDays(isLate ? days : Math.abs(days))
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-4">
        <span>Avg Loading ETA-ETR: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgLoadingEtaEtr)}</span></span>
        <span>Avg Loading ETA-ETB: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgLoadingEtaEtb)}</span></span>
        <span>Avg Loading ETB-ETC: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgLoadingEtbEtc)}</span></span>
        <span>Avg Discharge ETA-ETB: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgDischargeEtaEtb)}</span></span>
        <span>Avg Discharge ETB-ETC: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgDischargeEtbEtc)}</span></span>
        <span>Avg Total: <span className={`font-semibold ${metricClass}`}>{fmt(summary.avgTotalDelta)}</span></span>
      </div>
    )
  }

  const applyPerfDrilldownClick = useCallback(
    (next: {
      product?: string | null
      plant?: string | null
      incoterm?: string | null
      vessel?: string | null
    }) => {
      setLateOnTimeFilter(perfDashMode === 'ontrack' ? 'ON_TIME' : 'LATE')
      if ('product' in next) setLateSelProduct(next.product ?? null)
      if ('plant' in next) setLateSelPlant(next.plant ?? null)
      if ('incoterm' in next) setLateSelIncoterm(next.incoterm ?? null)
      if ('vessel' in next) setLateSelVessel(next.vessel ?? null)
      scrollTableIntoView()
    },
    [perfDashMode, scrollTableIntoView],
  )

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

  const hasActiveFilters =
    Boolean(searchDraft || searchTerm) ||
    statusFilter !== 'ALL' ||
    lateOnTimeFilter !== 'ALL' ||
    selectedIncoterms.length > 0 ||
    selectedPlantSites.length > 0 ||
    Boolean(dateFrom || dateTo) ||
    hasActiveColumnFilters(columnFilters) ||
    lateSelVessel !== null ||
    lateSelIncoterm !== null ||
    lateSelProduct !== null ||
    lateSelPlant !== null

  const clearAllFilters = useCallback(() => {
    setSearchDraft('')
    setSearchTerm('')
    setStatusFilter('ALL')
    setLateOnTimeFilter('ALL')
    setSelectedIncoterms([])
    setSelectedPlantSites([])
    setDateFrom('')
    setDateTo('')
    setColumnFilters({})
    setColumnFilterDrafts({})
    setLateSelVessel(null)
    setLateSelIncoterm(null)
    setLateSelProduct(null)
    setLateSelPlant(null)
    setCurrentPage(1)
  }, [])

  const isPerfDrilldownActive =
    lateSelVessel !== null || lateSelIncoterm !== null || lateSelProduct !== null || lateSelPlant !== null

  const tableScopeRows = useMemo(() => {
    if (!isPerfDrilldownActive) return filteredByTopFilters
    return filteredByTopFilters.filter((row) => matchesPerfDrilldownRow(row, perfDashMode === 'late'))
  }, [filteredByTopFilters, isPerfDrilldownActive, perfDashMode])

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    const scoped = tableScopeRows.filter((row) => {
      if (lateSelVessel  && (String(row.vessel_name || '').trim() || 'Unknown') !== lateSelVessel) return false
      if (lateSelIncoterm && (String(row.incoterm || '').trim() || 'Blank') !== lateSelIncoterm) return false
      if (lateSelProduct && (String(row.product || '').trim() || 'Blank') !== lateSelProduct) return false
      if (lateSelPlant && (String(row.plant_site || '').trim() || 'Blank') !== lateSelPlant) return false
      return true
    })

    const base = !q
      ? scoped
      : scoped.filter((row) => {
      const vessel = row.vessel_name?.toLowerCase() ?? ''
      const group = row.group_name?.toLowerCase() ?? ''
      const shipmentId = row.shipment_id?.toLowerCase() ?? ''
      const contractNumber = row.contract_number?.toLowerCase() ?? ''
      const poNo = row.po_number?.toLowerCase() ?? ''
      const extNo = row.contract_ext_no?.toLowerCase() ?? ''
      const sto = row.sto_number?.toLowerCase() ?? ''
      return (
        vessel.includes(q) ||
        group.includes(q) ||
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
  }, [tableScopeRows, lateSelVessel, lateSelIncoterm, lateSelProduct, lateSelPlant, searchTerm, columnFilters, sortBy, sortDirection])

  const tableRows = useMemo(() => {
    if (tableViewMode === 'all') return filteredRows
    return aggregateByVesselGroup(filteredRows)
  }, [filteredRows, tableViewMode])

  const tableColumnKeys = useMemo((): TableColumnKey[] => {
    const ordered = columnOrder.filter((key) => visibleColumns[String(key)] && COLUMN_MAP[String(key)])
    if (tableViewMode === 'all') {
      return ordered.filter((key) => String(key) !== 'shipment_count')
    }
    const summaryKeys: TableColumnKey[] = ['group_name', 'shipment_count']
    const metricKeys = ordered.filter(
      (key) => !DETAIL_COLUMN_KEYS.has(String(key)) && !summaryKeys.includes(key),
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
    lateOnTimeFilter,
    searchTerm,
    columnFilters,
    lateSelVessel,
    lateSelIncoterm,
    lateSelProduct,
    lateSelPlant,
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

        {/* Summary */}
        {(() => {
          const totalOsQty = (latePerformanceSummary.totalQty ?? 0) + (onTrackPerformanceSummary.totalQty ?? 0)
          const latePct = totalOsQty > 0 ? ((latePerformanceSummary.totalQty ?? 0) / totalOsQty) * 100 : 0
          const onTrackPct = totalOsQty > 0 ? ((onTrackPerformanceSummary.totalQty ?? 0) / totalOsQty) * 100 : 0
          const fmtMT = (v: number) => (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' MT'
          const onTimeAvgClass = contextPerformanceClass(false)
          const lateAvgClass = contextPerformanceClass(true)

          if (loading) {
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
                      <div className="h-5 bg-gray-200 rounded w-24 mb-4" />
                      <div className="h-8 bg-gray-200 rounded w-32 mb-3" />
                      <div className="h-6 bg-gray-100 rounded mb-3" />
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
                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-base font-semibold text-gray-800">On Time</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{onTrackPct.toFixed(1)}%</span>
                  </div>
                  <div className="text-sm text-gray-500 mb-1">Outstanding Qty</div>
                  <div className="text-xl font-bold text-gray-900 mb-3">{fmtMT(onTrackPerformanceSummary.totalQty ?? 0)}</div>
                  <div className="w-full h-6 rounded-md bg-gray-100 overflow-hidden mb-3">
                    <div className="h-full bg-green-500 flex items-center justify-end pr-2 transition-all duration-500" style={{ width: `${onTrackPct}%` }}>
                      <span className="text-xs font-bold text-white">{onTrackPct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                    <span>{avgDaysMetricLabel(false)}: <span className={`font-semibold ${onTimeAvgClass}`}>{formatAvgDays(Math.abs(onTrackPerformanceSummary.avgTotalDelta))}</span></span>
                    <span>Shipments: <span className="font-semibold text-gray-700">{onTrackPerformanceSummary.count.toLocaleString('en-US')}</span></span>
                  </div>
                  {renderSummaryGapMetrics(onTrackPerformanceSummary, false)}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      title="View On Time open shipments in the table below"
                      onClick={() => applySummaryStatusFocus('ontrack', 'Open')}
                      className={summaryStatusBoxClass('ontrack', 'Open', 'bg-blue-50 border-blue-100')}
                    >
                      <div className="text-[11px] font-medium text-blue-600 mb-1">Open</div>
                      <div className="text-sm font-semibold text-gray-800">{fmtMT(onTrackPerformanceSummary.openOutstandingQty ?? 0)}</div>
                    </button>
                    <button
                      type="button"
                      title="View On Time closed shipments in the table below"
                      onClick={() => applySummaryStatusFocus('ontrack', 'Close')}
                      className={summaryStatusBoxClass('ontrack', 'Close', 'bg-orange-50 border-orange-100')}
                    >
                      <div className="text-[11px] font-medium text-orange-600 mb-1">Close</div>
                      <div className="text-sm font-semibold text-gray-800">{fmtMT(onTrackPerformanceSummary.closeOutstandingQty ?? 0)}</div>
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-base font-semibold text-gray-800">Late</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">{latePct.toFixed(1)}%</span>
                  </div>
                  <div className="text-sm text-gray-500 mb-1">Outstanding Qty</div>
                  <div className="text-xl font-bold text-gray-900 mb-3">{fmtMT(latePerformanceSummary.totalQty ?? 0)}</div>
                  <div className="w-full h-6 rounded-md bg-gray-100 overflow-hidden mb-3">
                    <div className="h-full bg-red-500 flex items-center justify-end pr-2 transition-all duration-500" style={{ width: `${latePct}%` }}>
                      <span className="text-xs font-bold text-white">{latePct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                    <span>{avgDaysMetricLabel(true)}: <span className={`font-semibold ${lateAvgClass}`}>{formatAvgDays(latePerformanceSummary.avgTotalDelta)}</span></span>
                    <span>Shipments: <span className="font-semibold text-gray-700">{latePerformanceSummary.count.toLocaleString('en-US')}</span></span>
                  </div>
                  {renderSummaryGapMetrics(latePerformanceSummary, true)}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      title="View Late open shipments in the table below"
                      onClick={() => applySummaryStatusFocus('late', 'Open')}
                      className={summaryStatusBoxClass('late', 'Open', 'bg-blue-50 border-blue-100')}
                    >
                      <div className="text-[11px] font-medium text-blue-600 mb-1">Open</div>
                      <div className="text-sm font-semibold text-gray-800">{fmtMT(latePerformanceSummary.openOutstandingQty ?? 0)}</div>
                    </button>
                    <button
                      type="button"
                      title="View Late closed shipments in the table below"
                      onClick={() => applySummaryStatusFocus('late', 'Close')}
                      className={summaryStatusBoxClass('late', 'Close', 'bg-orange-50 border-orange-100')}
                    >
                      <div className="text-[11px] font-medium text-orange-600 mb-1">Close</div>
                      <div className="text-sm font-semibold text-gray-800">{fmtMT(latePerformanceSummary.closeOutstandingQty ?? 0)}</div>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Section 1: Performance */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="inline-flex rounded-lg border bg-white p-1 mb-2">
                  <button
                    type="button"
                    onClick={() => { setPerfDashMode('ontrack'); setLateOnTimeFilter('ON_TIME'); setLateSelVessel(null); setLateSelIncoterm(null); setLateSelProduct(null); setLateSelPlant(null) }}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${perfDashMode === 'ontrack' ? 'bg-green-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                  >
                    On Time
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPerfDashMode('late'); setLateOnTimeFilter('LATE'); setLateSelVessel(null); setLateSelIncoterm(null); setLateSelProduct(null); setLateSelPlant(null) }}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${perfDashMode === 'late' ? 'bg-red-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                  >
                    Late
                  </button>
                </div>
                <CardTitle className="text-base">
                  {perfDashMode === 'late' ? 'Late Performance (YTD)' : 'On Time Performance (YTD)'}
                </CardTitle>
                <div className="text-sm text-gray-600 mt-1">
                  {perfDashMode === 'late'
                    ? <>Management view of late shipping where <span className="font-medium">Total delta &gt; 0</span>. Use drilldown to filter the table below.</>
                    : <>Management view of on-time shipping where <span className="font-medium">Total delta ≤ 0</span>. Use drilldown to filter the table below.</>
                  }
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {(perfDashMode === 'late' ? lateTree : onTrackTree).length === 0 ? (
              <div className="text-sm text-gray-500">{perfDashMode === 'late' ? 'No late shipments found.' : 'No on-time shipments found.'}</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  Navigate as a tree: <span className="font-medium">Product → Plant → Incoterm → Vessel</span>. Click a node to filter the table below.
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div className="text-sm font-semibold text-gray-900">{perfDashMode === 'late' ? 'Late' : 'On Time'} Performance drilldown</div>
                    <button
                      type="button"
                      onClick={() => {
                        resetPerfSelections()
                      }}
                      className="text-sm text-blue-700 hover:underline"
                    >
                      Reset selection
                    </button>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                    {([
                      { title: 'Product',  subtitle: 'Pick one',                                                                       level: 'product'  as const },
                      { title: 'Plant',    subtitle: lateSelProduct  ? `Under ${lateSelProduct}`  : 'Pick product first',              level: 'plant'    as const },
                      { title: 'Incoterm', subtitle: lateSelPlant    ? `Under ${lateSelPlant}`    : 'Pick plant first',                level: 'incoterm' as const },
                      { title: 'Vessel',   subtitle: lateSelIncoterm ? `Under ${lateSelIncoterm}` : 'Pick incoterm first',             level: 'vessel'   as const },
                    ] as const).map((col) => {
                      const activeTree = perfDashMode === 'ontrack' ? onTrackTree : lateTree
                      const totalQty   = activeTree.reduce((s, n) => s + n.totalQty, 0)
                      const denom = totalQty || 1
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
                        const pct = Math.max(1, Math.round((node.totalQty / denom) * 100))
                        return (
                          <button key={node.key} type="button" className={itemClass(selected)} onClick={onClick}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 text-left">
                                <div className="text-sm font-semibold text-gray-900 truncate">{node.key}</div>
                                <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden">
                                  <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="mt-1 text-xs text-gray-700 flex items-center justify-between gap-2">
                                  <span className="font-semibold">{node.count.toLocaleString('en-US')}</span>
                                  <span className="text-gray-500">shipments</span>
                                  <span className="ml-auto font-semibold whitespace-nowrap">{(node.totalQty / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT</span>
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

                      const productNode  = activeTree.find((n) => n.key === lateSelProduct)
                      const plantNode    = productNode?.children.find((n) => n.key === lateSelPlant)
                      const incotermNode = plantNode?.children.find((n) => n.key === lateSelIncoterm)

                      const body = (() => {
                        if (col.level === 'product') {
                          return (
                            <div className="space-y-2">
                              {activeTree.map((n) => renderNode(n, lateSelProduct === n.key, () => {
                                applyPerfDrilldownClick({ product: n.key, plant: null, incoterm: null, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (col.level === 'plant') {
                          if (!lateSelProduct) return <div className="text-sm text-gray-500">Select a product to see plants.</div>
                          return (
                            <div className="space-y-2">
                              {(productNode?.children || []).map((n) => renderNode(n, lateSelPlant === n.key, () => {
                                applyPerfDrilldownClick({ plant: n.key, incoterm: null, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (col.level === 'incoterm') {
                          if (!lateSelPlant) return <div className="text-sm text-gray-500">Select a plant to see incoterms.</div>
                          return (
                            <div className="space-y-2">
                              {(plantNode?.children || []).map((n) => renderNode(n, lateSelIncoterm === n.key, () => {
                                applyPerfDrilldownClick({ incoterm: n.key, vessel: null })
                              }))}
                            </div>
                          )
                        }
                        if (!lateSelIncoterm) return <div className="text-sm text-gray-500">Select an incoterm to see vessels.</div>
                        return (
                          <div className="space-y-2">
                            {(incotermNode?.children || []).map((n) => renderNode(n, lateSelVessel === n.key, () => {
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                  <Input
                    placeholder="Search vessel, group, shipment ID, or contract..."
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
                  className="rounded-lg border px-4 py-2"
                >
                  <option value="ALL">All Status</option>
                  <option value="Open">Open</option>
                  <option value="Close">Close</option>
                  <option value="PLANNED">PLANNED</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="LOADING">LOADING</option>
                  <option value="IN_TRANSIT">IN_TRANSIT</option>
                  <option value="ARRIVED">ARRIVED</option>
                  <option value="UNLOADING">UNLOADING</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
                <select
                  value={lateOnTimeFilter}
                  onChange={(e) => setLateOnTimeFilter(e.target.value as 'ALL' | 'LATE' | 'ON_TIME')}
                  className="rounded-lg border px-4 py-2"
                  title="Late: Total delta > 0. On Time: Total delta ≤ 0."
                >
                  <option value="ALL">Late/On Time: All</option>
                  <option value="LATE">Late</option>
                  <option value="ON_TIME">On Time</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SearchableMultiSelect
                  label="Incoterm"
                  options={availableIncoterms}
                  selected={selectedIncoterms}
                  onChange={setSelectedIncoterms}
                  placeholder="Select incoterm(s)"
                  emptyMessage="No incoterms"
                />
                <SearchableMultiSelect
                  label="Plant/Site"
                  options={availablePlantSites}
                  selected={selectedPlantSites}
                  onChange={setSelectedPlantSites}
                  placeholder="Select plant/site(s)"
                  emptyMessage="No plants"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={setDateFrom} className="w-40" />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={setDateTo} className="w-40" />
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
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Table */}
        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>{tableViewMode === 'all' ? 'All Shipments' : 'By Vessel Group'}</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                {tableViewMode === 'all'
                  ? `${tableRows.length} total shipments | Showing ${paginatedRows.length} on this page`
                  : `${tableRows.length} vessel group${tableRows.length === 1 ? '' : 's'} | Showing ${paginatedRows.length} on this page`}
              </p>
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
                  onClick={() => { setTableViewMode('vessel_group'); setCurrentPage(1) }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tableViewMode === 'vessel_group' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  By Vessel Group
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div ref={columnsMenuRef} className="relative">
                <Button variant="outline" size="sm" onClick={() => setShowColumnManager((v) => !v)}>
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
              {totalPages > 1 && (
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
                    {loading ? (
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
                                      decimalPlaces={tableViewMode === 'vessel_group' && String(key).includes('delta') ? 1 : undefined}
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
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}
