'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { 
  TrendingUp, 
  Package, 
  DollarSign, 
  AlertTriangle, 
  Truck,
  Eye,
  Users,
  Ship,
  BarChart3,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Clock,
  CheckCircle,
  XCircle,
  Layers,
  MapPin,
  Filter,
  ChevronDown,
  Sparkles
} from 'lucide-react'
import api from '@/lib/api'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { durationCycleDaysClass } from '@/lib/cycleDaysDisplay'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatSapDisplayValue, formatSapGroupDisplayLabel } from '@/lib/sapDisplayValue'

interface DashboardStats {
  contracts: {
    total: number
    active: number
    closed: number
    completed: number
    cancelled: number
    outstanding: number
    openOutstandingLogistics: number
    openOutstandingPayment: number
    totalQuantity: number
    deliveredQuantity: number
    outstandingQuantity: number
    deliveredPaidQuantity: number
    deliveredPendingQuantity: number
    outstandingPaidQuantity: number
    outstandingPendingQuantity: number
    outstandingPendingAmount: number
    outstandingClaimMutuQty: number
    outstandingClaimSusutQty: number
    outstandingClaimMutuAmount: number
    outstandingClaimSusutAmount: number
  }
  shipments: {
    total: number
    planned: number
    inProgress: number
    loading: number
    inTransit: number
    arrived: number
    unloading: number
    completed: number
    cancelled: number
    late: number
  }
  trucking: {
    total: number
    planned: number
    inProgress: number
    loading: number
    inTransit: number
    unloading: number
    completed: number
    cancelled: number
    late: number
  }
  finance: {
    total: number
    pending: number
    paid: number
    overdue: number
    totalAmount: number
    pendingAmount: number
    paidAmount: number
    overdueAmount: number
    revenue: number
  }
}

interface TopPerformer {
  supplier?: string
  trucking_owner?: string
  vessel_name?: string
  total_quantity: number
  contract_count?: number
  operation_count?: number
  shipment_count?: number
  avg_unit_price?: number
  total_contract_value?: number
  total_quantity_sent?: number
  total_quantity_delivered?: number
  avg_gain_loss_percentage?: number
  total_oa_actual?: number
  delayed_count?: number
}

interface ProductQuantity {
  product: string
  contract_count: number
  total_quantity: number
  completed_quantity: number
  outstanding_quantity: number
  outstanding_payment_quantity: number
  outstanding_claim_mutu_qty?: number
  outstanding_claim_susut_qty?: number
  avg_unit_price: number
  total_contract_value: number
  supplier_count: number
}

interface ProductIncotermRow {
  product: string
  incoterm: string
  contract_count: number
  total_quantity: number
  completed_quantity: number
  outstanding_quantity: number
  outstanding_payment_quantity: number
  avg_unit_price: number
  total_contract_value: number
  supplier_count: number
  outstanding_claim_mutu_qty?: number
  outstanding_claim_susut_qty?: number
}

interface ProductIncotermPlantSourceRow extends ProductIncotermRow {
  plant_site: string
  source_type: string
  lt_spot: string
}

/** Sort management breakdown rows: Incoterm → Plant/Site → Source Type → LT/SPOT (case-insensitive). */
function compareProductBreakdownRows(a: ProductIncotermPlantSourceRow, b: ProductIncotermPlantSourceRow): number {
  const norm = (v: string | undefined) => (v || 'Blank').trim() || 'Blank'
  const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true })
  let d = cmp(norm(a.incoterm), norm(b.incoterm))
  if (d !== 0) return d
  d = cmp(norm(a.plant_site), norm(b.plant_site))
  if (d !== 0) return d
  d = cmp(norm(a.source_type), norm(b.source_type))
  if (d !== 0) return d
  return cmp(norm(a.lt_spot), norm(b.lt_spot))
}

interface PlantQuantity {
  plant_location: string
  contract_count: number
  total_quantity: number
  total_quantity_shipped: number
  total_quantity_delivered: number
  avg_unit_price: number
  total_contract_value: number
  supplier_count: number
}

interface PlantIncotermRow {
  plant_location: string
  incoterm: string
  contract_count: number
  total_quantity: number
  completed_quantity: number
  outstanding_quantity: number
  outstanding_payment_quantity: number
  supplier_count: number
  outstanding_claim_mutu_qty?: number
  outstanding_claim_susut_qty?: number
}

interface PlantContractDetail {
  contract_id: string
  sto_number: string
  supplier: string
  product: string
  quantity_shipped: number
  quantity_delivered: number
  total_quantity: number
  status: string
}

interface DashboardAiInsight {
  summary: string
  highlights: string
  recommendations: string
}

/** If the API or cache returned raw JSON in one field, parse it so we never show JSON in the UI. */
function normalizeAiInsight(data: DashboardAiInsight | null): DashboardAiInsight | null {
  if (!data) return null
  const s = typeof data.summary === 'string' ? data.summary.trim() : ''
  if (s.startsWith('{') && s.includes('"summary"')) {
    try {
      const parsed = JSON.parse(s) as { summary?: string; highlights?: string; recommendations?: string }
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        highlights: typeof parsed.highlights === 'string' ? parsed.highlights : (Array.isArray(parsed.highlights) ? (parsed.highlights as string[]).join('\n') : ''),
        recommendations: typeof parsed.recommendations === 'string' ? parsed.recommendations : (Array.isArray(parsed.recommendations) ? (parsed.recommendations as string[]).join('\n') : ''),
      }
    } catch {
      return data
    }
  }
  return data
}

type DrilldownContractRow = {
  id: string
  contract_id: string
  contract_ext_no?: string
  buyer?: string
  supplier?: string
  group_name?: string
  product?: string
  quantity_ordered?: number
  unit?: string
  incoterm?: string
  plant_site?: string
  source_type?: string
  lt_spot?: string
  loading_site?: string
  unloading_site?: string
  contract_date?: string
  delivery_start_date?: string
  delivery_end_date?: string
  cargo_readiness_date?: string
  transport_mode?: string
  contract_value?: number
  payment_due_date?: string
  payoff_date?: string
  currency?: string
  status?: string
  delivered_quantity?: number
  outstanding_quantity?: number
  total_delay?: number | null
  cargo_readiness_issue?: number | null
  aging_os?: number | null
  delivery_issue?: number | null
  dp_date_deviation_days?: number | null
  payoff_date_deviation_days?: number | null
  log_cycle_days?: number | null
  cash_cycle_days?: number | null
}

type DrilldownShipmentRow = {
  id: string
  shipment_id?: string
  operation_id?: string
  sto_number?: string
  vessel_name?: string
  status?: string
  port_of_loading?: string
  port_of_discharge?: string
  contract_id?: string
  supplier?: string
  product?: string
  delivery_end_date?: string
  ata_discharge_complete?: string
  eta_discharge_complete?: string
  late_indicator?: string
}

type DrilldownTruckingRow = {
  id: string
  operation_id?: string
  sto_number?: string
  contract_ext_no?: string
  location?: string
  trucking_owner?: string
  status?: string
  quantity_sent?: number
  quantity_delivered?: number
  gain_loss_percentage?: number
  contract_id?: string
  supplier?: string
  product?: string
}

type DrilldownPaymentRow = {
  id: string
  contract_id?: string
  po_number?: string
  sto_number?: string
  contract_ext_no?: string
  unit_price?: number
  contract_value?: number
  group_name?: string
  plant_site?: string
  invoice_number?: string
  invoice_date?: string
  payment_amount?: number
  currency?: string
  payment_status?: string
  payment_due_date?: string
  dp_date?: string
  payoff_date?: string
  payment_date?: string
  dp_date_deviation_days?: number
  payoff_date_deviation_days?: number
}
type PaymentPlantSummaryRow = {
  plant_site: string
  contracts: number
  total_contract_value: number
}

/** 0–1 similarity for merging plant/site labels (e.g. ≥0.6 → same bucket). */
function plantSiteSimilarity(a: string, b: string): number {
  const A = a.trim().replace(/\s+/g, ' ').toUpperCase()
  const B = b.trim().replace(/\s+/g, ' ').toUpperCase()
  if (!A || !B) return A === B ? 1 : 0
  if (A === B) return 1
  const longer = A.length >= B.length ? A : B
  const shorter = A.length >= B.length ? B : A
  if (longer.includes(shorter) && shorter.length >= 4) {
    return Math.min(1, Math.max(0.62, shorter.length / longer.length))
  }
  const m = A.length
  const n = B.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = A[i - 1] === B[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  const dist = dp[n]
  return 1 - dist / Math.max(m, n)
}

function mergePlantSiteSummaryRows(
  rows: { plantSite: string; contracts: number; totalContractValue: number }[],
  threshold = 0.6
): { plantSite: string; contracts: number; totalContractValue: number }[] {
  const blankAgg = rows
    .filter((r) => !r.plantSite?.trim() || r.plantSite === 'Blank')
    .reduce(
      (acc, r) => ({
        contracts: acc.contracts + r.contracts,
        totalContractValue: acc.totalContractValue + r.totalContractValue,
      }),
      { contracts: 0, totalContractValue: 0 }
    )
  const others = rows.filter((r) => r.plantSite?.trim() && r.plantSite !== 'Blank')
  const sorted = [...others].sort((a, b) => b.totalContractValue - a.totalContractValue)
  const clusters: { label: string; contracts: number; totalContractValue: number }[] = []
  for (const r of sorted) {
    let idx = -1
    for (let i = 0; i < clusters.length; i++) {
      if (plantSiteSimilarity(r.plantSite, clusters[i].label) >= threshold) {
        idx = i
        break
      }
    }
    if (idx >= 0) {
      clusters[idx].contracts += r.contracts
      clusters[idx].totalContractValue += r.totalContractValue
      if (r.plantSite.length > clusters[idx].label.length) clusters[idx].label = r.plantSite
    } else {
      clusters.push({
        label: r.plantSite,
        contracts: r.contracts,
        totalContractValue: r.totalContractValue,
      })
    }
  }
  const merged = clusters
    .map((c) => ({
      plantSite: c.label,
      contracts: c.contracts,
      totalContractValue: c.totalContractValue,
    }))
    .sort((a, b) => b.totalContractValue - a.totalContractValue)
  if (blankAgg.contracts > 0) {
    merged.push({
      plantSite: 'Blank',
      contracts: blankAgg.contracts,
      totalContractValue: blankAgg.totalContractValue,
    })
  }
  return merged.sort((a, b) => b.totalContractValue - a.totalContractValue)
}

// Searchable multi-select dropdown (type to filter, multiple selection with OR)
function SearchableMultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
  emptyMessage = 'Loading...'
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (value: string[]) => void
  placeholder: string
  emptyMessage?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = search.trim()
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase().trim()))
    : options

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((s) => s !== value))
    else onChange([...selected, value])
  }

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const displayLabel = selected.length === 0 ? placeholder : `${selected.length} selected (OR)`

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="text-sm font-medium text-gray-700 mb-1 block">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 h-10 px-3 py-2 text-left text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <span className={selected.length === 0 ? 'text-gray-500' : 'text-gray-900'}>{displayLabel}</span>
        <ChevronDown className={`h-4 w-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <Input
              type="text"
              placeholder="Type to search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {options.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">{emptyMessage}</div>
            ) : filtered.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No matches</div>
            ) : (
              filtered.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-100 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggle(option)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="truncate">{option}</span>
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button type="button" onClick={clearSelection} className="text-xs text-blue-600 hover:underline">
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DashboardContent({ pageTitle }: { pageTitle: string }) {
  const isManagementDashboard = String(pageTitle || '')
    .toLowerCase()
    .includes('management')

  const todayIso = (() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  })()
  const yearStartIso = (() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    return `${yyyy}-01-01`
  })()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    contracts: {
      total: 0,
      active: 0,
      closed: 0,
      completed: 0,
      cancelled: 0,
      outstanding: 0,
      openOutstandingLogistics: 0,
      openOutstandingPayment: 0,
      totalQuantity: 0,
      deliveredQuantity: 0,
      outstandingQuantity: 0,
      deliveredPaidQuantity: 0,
      deliveredPendingQuantity: 0,
      outstandingPaidQuantity: 0,
      outstandingPendingQuantity: 0,
      outstandingPendingAmount: 0,
      outstandingClaimMutuQty: 0,
      outstandingClaimSusutQty: 0,
      outstandingClaimMutuAmount: 0,
      outstandingClaimSusutAmount: 0,
    },
    shipments: { total: 0, planned: 0, inProgress: 0, loading: 0, inTransit: 0, arrived: 0, unloading: 0, completed: 0, cancelled: 0, late: 0 },
    trucking: { total: 0, planned: 0, inProgress: 0, loading: 0, inTransit: 0, unloading: 0, completed: 0, cancelled: 0, late: 0 },
    finance: { total: 0, pending: 0, paid: 0, overdue: 0, totalAmount: 0, pendingAmount: 0, paidAmount: 0, overdueAmount: 0, revenue: 0 }
  })
  const [topSuppliers, setTopSuppliers] = useState<TopPerformer[]>([])
  const [topTruckingOwners, setTopTruckingOwners] = useState<TopPerformer[]>([])
  const [topVessels, setTopVessels] = useState<TopPerformer[]>([])
  const [productIncotermRows, setProductIncotermRows] = useState<ProductIncotermRow[]>([])
  const [productIncotermBreakdownRows, setProductIncotermBreakdownRows] = useState<ProductIncotermPlantSourceRow[]>([])
  const [plantQuantities, setPlantQuantities] = useState<PlantQuantity[]>([])
  const [plantIncotermRows, setPlantIncotermRows] = useState<PlantIncotermRow[]>([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [widgetsLoading, setWidgetsLoading] = useState(true)
  const [selectedPlant, setSelectedPlant] = useState<PlantQuantity | null>(null)
  const [plantDetails, setPlantDetails] = useState<PlantContractDetail[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  // Click-through modals
  const [selectedSupplierName, setSelectedSupplierName] = useState<string | null>(null)
  const [supplierContracts, setSupplierContracts] = useState<PlantContractDetail[]>([])
  const [loadingSupplierContracts, setLoadingSupplierContracts] = useState(false)
  const [selectedOwnerName, setSelectedOwnerName] = useState<string | null>(null)
  const [ownerTruckingOps, setOwnerTruckingOps] = useState<any[]>([])
  const [loadingOwnerOps, setLoadingOwnerOps] = useState(false)
  const [selectedVesselName, setSelectedVesselName] = useState<string | null>(null)
  const [vesselShipments, setVesselShipments] = useState<any[]>([])
  const [loadingVesselShipments, setLoadingVesselShipments] = useState(false)

  // Universal drilldown (contracts list) for performance cards
  const [drilldownTitle, setDrilldownTitle] = useState<string | null>(null)
  const [drilldownSubtitle, setDrilldownSubtitle] = useState<string>('')
  const [drilldownContracts, setDrilldownContracts] = useState<DrilldownContractRow[]>([])
  const [loadingDrilldown, setLoadingDrilldown] = useState(false)
  const [drilldownTotalCount, setDrilldownTotalCount] = useState<number>(0)
  const [drilldownPage, setDrilldownPage] = useState<number>(1)
  const [drilldownPageSize] = useState<number>(100)
  const [drilldownQuery, setDrilldownQuery] = useState<Record<string, string>>({})
  const [drilldownView, setDrilldownView] = useState<'details' | 'vendor-group'>('details')

  const [claimDrilldownKind, setClaimDrilldownKind] = useState<'mutu' | 'susut' | null>(null)
  const [claimDrilldownRows, setClaimDrilldownRows] = useState<Record<string, unknown>[]>([])
  const [loadingClaimDrilldown, setLoadingClaimDrilldown] = useState(false)
  const [claimDrilldownTotalCount, setClaimDrilldownTotalCount] = useState(0)
  const [claimDrilldownPage, setClaimDrilldownPage] = useState(1)
  const [claimDrilldownPageSize] = useState(100)

  // Shipments drilldown (shipment list) for Shipment Performance card
  const [shipDrilldownTitle, setShipDrilldownTitle] = useState<string | null>(null)
  const [shipDrilldownSubtitle, setShipDrilldownSubtitle] = useState<string>('')
  const [shipDrilldownRows, setShipDrilldownRows] = useState<DrilldownShipmentRow[]>([])
  const [loadingShipDrilldown, setLoadingShipDrilldown] = useState(false)
  const [shipDrilldownTotalCount, setShipDrilldownTotalCount] = useState<number>(0)
  const [shipDrilldownPage, setShipDrilldownPage] = useState<number>(1)
  const [shipDrilldownPageSize] = useState<number>(100)
  const [shipDrilldownQuery, setShipDrilldownQuery] = useState<Record<string, string>>({})

  // Trucking drilldown (trucking operations list) for Trucking Performance card
  const [truckDrilldownTitle, setTruckDrilldownTitle] = useState<string | null>(null)
  const [truckDrilldownSubtitle, setTruckDrilldownSubtitle] = useState<string>('')
  const [truckDrilldownRows, setTruckDrilldownRows] = useState<DrilldownTruckingRow[]>([])
  const [loadingTruckDrilldown, setLoadingTruckDrilldown] = useState(false)
  const [truckDrilldownTotalCount, setTruckDrilldownTotalCount] = useState<number>(0)
  const [truckDrilldownPage, setTruckDrilldownPage] = useState<number>(1)
  const [truckDrilldownPageSize] = useState<number>(100)
  const [truckDrilldownQuery, setTruckDrilldownQuery] = useState<Record<string, string>>({})

  // Payments drilldown (payments list) for Payment Performance card
  const [payDrilldownTitle, setPayDrilldownTitle] = useState<string | null>(null)
  const [payDrilldownSubtitle, setPayDrilldownSubtitle] = useState<string>('')
  const [payDrilldownRows, setPayDrilldownRows] = useState<DrilldownPaymentRow[]>([])
  const [loadingPayDrilldown, setLoadingPayDrilldown] = useState(false)
  const [payDrilldownTotalCount, setPayDrilldownTotalCount] = useState<number>(0)
  const [payDrilldownPage, setPayDrilldownPage] = useState<number>(1)
  const [payDrilldownPageSize] = useState<number>(100)
  const [payDrilldownQuery, setPayDrilldownQuery] = useState<Record<string, string>>({})
  const [payDrilldownPlantSummary, setPayDrilldownPlantSummary] = useState<PaymentPlantSummaryRow[]>([])
  const [payDrilldownView, setPayDrilldownView] = useState<'details' | 'vendor-group'>('details')
  const [paySelectedPlantSite, setPaySelectedPlantSite] = useState<string | null>(null)
  
  // Filter states
  // Default: Year-to-date to keep dashboard fast (user can Clear Filters for all-time).
  const [dateFrom, setDateFrom] = useState(yearStartIso)
  const [dateTo, setDateTo] = useState(todayIso)
  const [selectedPlantFilter, setSelectedPlantFilter] = useState<string[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<string[]>([])
  const [availablePlants, setAvailablePlants] = useState<string[]>([])
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([])
  const [selectedProductFilter, setSelectedProductFilter] = useState<string[]>([])
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [availableGroups, setAvailableGroups] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [quantityUnit, setQuantityUnit] = useState<'kg' | 'mt'>('kg')
  const [amountUnit, setAmountUnit] = useState<'rp' | 'billion-rp'>('rp')
  const [error, setError] = useState<string | null>(null)
  const [aiInsight, setAiInsight] = useState<DashboardAiInsight | null>(null)
  const [loadingAiInsight, setLoadingAiInsight] = useState(false)
  const [aiInsightError, setAiInsightError] = useState<string | null>(null)

  // In dev, React StrictMode runs effects twice; guard to prevent duplicate network bursts.
  const didInit = useRef(false)
  const lastDashboardFetchKey = useRef<string>('')
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    // AI insight is non-critical; load on-demand.
    fetchFilterOptions()
  }, [])

  useEffect(() => {
    const key = JSON.stringify({
      dateFrom,
      dateTo,
      plants: selectedPlantFilter,
      suppliers: selectedSupplier,
      products: selectedProductFilter,
      groups: selectedGroupFilter,
    })
    if (lastDashboardFetchKey.current === key) return
    lastDashboardFetchKey.current = key
    fetchDashboardData()
  }, [dateFrom, dateTo, selectedPlantFilter, selectedSupplier, selectedProductFilter, selectedGroupFilter])

  const fetchDashboardData = async () => {
    setStatsLoading(true)
    setWidgetsLoading(true)
    setError(null)

    try {
      // Build query parameters
      const params = new URLSearchParams()
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      selectedPlantFilter.forEach((p) => params.append('plant', p))
      selectedSupplier.forEach((s) => params.append('supplier', s))
      selectedProductFilter.forEach((p) => params.append('product', p))
      selectedGroupFilter.forEach((g) => params.append('groupName', g))

      const queryString = params.toString()
      const urlSuffix = queryString ? `?${queryString}` : ''

      // Management Dashboard: show only "Contract Quantity by Product (Incoterm mix)"
      if (isManagementDashboard) {
        setStatsLoading(false)
        setStats((prev) => prev) // keep current stats state untouched
        try {
          const res = await api.get(`/dashboard/overview${urlSuffix}${urlSuffix ? '&' : '?'}includeManagement=true`)
          const rows = (res.data?.data?.management?.productIncotermPlantSourceRows || []) as ProductIncotermPlantSourceRow[]
          setProductIncotermBreakdownRows(rows)
          // Build the existing incoterm-mix dataset by collapsing the extra dimensions.
          const keyToAgg = new Map<string, ProductIncotermRow>()
          for (const r of rows) {
            const k = `${r.product}||${r.incoterm}`
            const cur = keyToAgg.get(k)
            if (!cur) {
              keyToAgg.set(k, {
                product: r.product,
                incoterm: r.incoterm,
                contract_count: Number(r.contract_count) || 0,
                total_quantity: Number(r.total_quantity) || 0,
                completed_quantity: Number(r.completed_quantity) || 0,
                outstanding_quantity: Number(r.outstanding_quantity) || 0,
                outstanding_payment_quantity: Number(r.outstanding_payment_quantity) || 0,
                avg_unit_price: Number(r.avg_unit_price) || 0,
                total_contract_value: Number(r.total_contract_value) || 0,
                supplier_count: Number(r.supplier_count) || 0,
              })
            } else {
              cur.contract_count += Number(r.contract_count) || 0
              cur.total_quantity += Number(r.total_quantity) || 0
              cur.completed_quantity += Number(r.completed_quantity) || 0
              cur.outstanding_quantity += Number(r.outstanding_quantity) || 0
              cur.outstanding_payment_quantity += Number(r.outstanding_payment_quantity) || 0
              cur.total_contract_value += Number(r.total_contract_value) || 0
              cur.supplier_count += Number(r.supplier_count) || 0
              // avg_unit_price recomputed later when rendering (using total_contract_value / total_quantity)
              cur.avg_unit_price = 0
            }
          }
          setProductIncotermRows(Array.from(keyToAgg.values()))
        } catch (err: any) {
          console.error('Management dashboard widget failed:', err)
          const msg =
            err?.response?.data?.error?.message ||
            err?.message ||
            'Failed to load management dashboard data. Check that the backend is running and you are logged in.'
          setError(msg)
          setProductIncotermBreakdownRows([])
          setProductIncotermRows([])
        } finally {
          setWidgetsLoading(false)
        }
        return
      }

      // 1) Stats first — KPI row becomes interactive as soon as this returns
      const statsRes = await api.get(`/dashboard/stats${urlSuffix}`)
      setStats(statsRes.data.data)
      setStatsLoading(false)

      // 2) Consolidated widgets + filter options in a single call
      try {
        const overviewRes = await api.get(`/dashboard/overview${urlSuffix}`)
        const od = overviewRes.data?.data
        if (od) {
          setTopSuppliers(od.topSuppliers || [])
          setTopTruckingOwners(od.topTruckingOwners || [])
          setTopVessels(od.topVessels || [])
          setProductIncotermRows(od.productIncotermRows || [])
          setPlantIncotermRows(od.plantIncotermRows || [])
          setPlantQuantities(od.plantQuantities || [])
          if (od.filterOptions) {
            setAvailablePlants(od.filterOptions.plants || [])
            setAvailableSuppliers(od.filterOptions.suppliers || [])
            setAvailableProducts(od.filterOptions.products || [])
            setAvailableGroups(od.filterOptions.groups || [])
          }
        }
      } catch (err) {
        console.error('Failed to fetch dashboard overview:', err)
      } finally {
        setWidgetsLoading(false)
      }
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err)
      setError('Failed to load dashboard data. Please try again.')
      setStatsLoading(false)
      setWidgetsLoading(false)
    }
  }

  const fetchFilterOptions = async () => {
    try {
      // Prefer consolidated overview endpoint when available (faster, fewer requests)
      const res = await api.get('/dashboard/overview')
      const fo = res.data?.data?.filterOptions
      if (fo) {
        setAvailablePlants(fo.plants || [])
        setAvailableSuppliers(fo.suppliers || [])
        setAvailableProducts(fo.products || [])
        setAvailableGroups(fo.groups || [])
      }
    } catch (error) {
      console.error('Failed to fetch filter options:', error)
    }
  }

  const fetchAiInsight = async (forceRegenerate: boolean) => {
    try {
      setLoadingAiInsight(true)
      setAiInsightError(null)

      const params = new URLSearchParams()
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      selectedPlantFilter.forEach((p) => params.append('plant', p))
      selectedSupplier.forEach((s) => params.append('supplier', s))
      selectedProductFilter.forEach((p) => params.append('product', p))
      selectedGroupFilter.forEach((g) => params.append('groupName', g))
      const queryString = params.toString()
      const urlSuffix = queryString ? `?${queryString}` : ''

      if (forceRegenerate) {
        const res = await api.post(`/dashboard/ai-insight${urlSuffix}`, {
          dashboard: {
            stats,
            // Send only top slices to keep payload small and Gemini fast
            productIncotermTop: productIncotermRows.slice(0, 20),
            plantQuantitiesTop: plantQuantities.slice(0, 20),
          },
        })
        if (res.data?.success) {
          setAiInsight(normalizeAiInsight(res.data.data))
        }
      } else {
        const res = await api.get(`/dashboard/ai-insight${urlSuffix}`)
        if (res.data?.success) {
          setAiInsight(normalizeAiInsight(res.data.data))
        }
      }
    } catch (err: any) {
      console.error('Failed to load/generate AI insight', err)
      const msg = err?.response?.data?.error?.message || 'Failed to load AI insight'
      setAiInsightError(msg)
    } finally {
      setLoadingAiInsight(false)
    }
  }

  const clearFilters = () => {
    setDateFrom('')
    setDateTo('')
    setSelectedPlantFilter([])
    setSelectedSupplier([])
    setSelectedProductFilter([])
    setSelectedGroupFilter([])
  }

  const parseNumberLoose = (v: unknown) => {
    if (v === null || v === undefined) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = String(v).trim()
    if (!s) return null
    const cleaned = s.replace(/,/g, '').replace(/\s+/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }

  const formatNumber = (num: number | string | null | undefined) => {
    const value = parseNumberLoose(num)
    if (value === null) return '0'
    return Math.round(value).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      useGrouping: true,
    })
  }

  const formatRupiah = (v: unknown) => {
    const n = parseNumberLoose(v) ?? 0
    if (amountUnit === 'billion-rp') {
      // Whole billions only: raw Rp / 1e9, no fractional part in display
      const bio = Math.trunc(n / 1_000_000_000)
      const formatted = bio.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        useGrouping: true,
      })
      return `Rp ${formatted} bio`
    }
    return `Rp. ${formatNumber(n)}`
  }

  const formatKg = (mt: unknown) => {
    const n = parseNumberLoose(mt)
    if (n === null) return '-'
    if (quantityUnit === 'mt') return `${formatNumber(n / 1_000)} MT`
    return `${formatNumber(n)} Kg`
  }

  const formatDate = (dateStr?: string) => formatDateDMY(dateStr)

  const pct = (num: number, den: number) => {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0
    return Math.round((num / den) * 100)
  }

  const pctText = (num: number, den: number) => {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return '0%'
    const raw = (num / den) * 100
    if (!Number.isFinite(raw) || raw <= 0) return '0%'
    if (raw < 0.1) return '<0.1%'
    return `${pct(num, den)}%`
  }

  const money = (v: number) => formatRupiah(v)
  const quantityUnitLabel = quantityUnit === 'kg' ? 'Kg' : 'MT'
  const amountUnitLabel = amountUnit === 'rp' ? 'Rp' : 'Bio'

  const contractsByVendorGroup = useMemo(() => {
    const grouped = new Map<string, {
      groupName: string
      count: number
      qtyOrdered: number
      qtyDelivered: number
      qtyOutstanding: number
      weightedAvgDeliveryDays: number | null
      weightedAvgPaymentDays: number | null
      contractValue: number
      nearestPaymentDueDate: string | null
      openCount: number
      closeCount: number
      cancelledCount: number
      _deliveryWeightDen: number
      _paymentWeightDen: number
      _logWeightedSum: number
      _cashWeightedSum: number
    }>()
    drilldownContracts.forEach((c) => {
      const groupName = (c.group_name || '').trim() || 'Ungrouped'
      const key = groupName.toLowerCase()
      const prev = grouped.get(key) || {
        groupName,
        count: 0,
        qtyOrdered: 0,
        qtyDelivered: 0,
        qtyOutstanding: 0,
        weightedAvgDeliveryDays: null,
        weightedAvgPaymentDays: null,
        contractValue: 0,
        nearestPaymentDueDate: null,
        openCount: 0,
        closeCount: 0,
        cancelledCount: 0,
        _deliveryWeightDen: 0,
        _paymentWeightDen: 0,
        _logWeightedSum: 0,
        _cashWeightedSum: 0,
      }
      prev.count += 1
      prev.qtyOrdered += Number(c.quantity_ordered || 0)
      prev.qtyDelivered += Number(c.delivered_quantity || 0)
      const outQty = Number(c.outstanding_quantity || 0)
      prev.qtyOutstanding += outQty
      prev.contractValue += Number(c.contract_value || 0)
      if (outQty > 0) {
        const logDays = typeof c.log_cycle_days === 'number' ? c.log_cycle_days : null
        const cashDays = typeof c.cash_cycle_days === 'number' ? c.cash_cycle_days : null
        if (logDays != null) {
          prev._logWeightedSum += logDays * outQty
          prev._deliveryWeightDen += outQty
        }
        if (cashDays != null) {
          prev._cashWeightedSum += cashDays * outQty
          prev._paymentWeightDen += outQty
        }
      }
      if (c.payment_due_date) {
        const current = Date.parse(c.payment_due_date)
        if (!Number.isNaN(current)) {
          const nearest = prev.nearestPaymentDueDate ? Date.parse(prev.nearestPaymentDueDate) : Number.POSITIVE_INFINITY
          if (Number.isNaN(nearest) || current < nearest) {
            prev.nearestPaymentDueDate = c.payment_due_date
          }
        }
      }
      const status = (c.status || '').trim().toLowerCase()
      if (status === 'open') prev.openCount += 1
      else if (status === 'close') prev.closeCount += 1
      else if (status === 'cancelled' || status === 'canceled') prev.cancelledCount += 1
      grouped.set(key, prev)
    })
    return Array.from(grouped.values())
      .map((g) => {
        const delivery = g._deliveryWeightDen > 0 ? g._logWeightedSum / g._deliveryWeightDen : null
        const payment = g._paymentWeightDen > 0 ? g._cashWeightedSum / g._paymentWeightDen : null
        return {
          ...g,
          weightedAvgDeliveryDays: delivery != null && Number.isFinite(delivery) ? delivery : null,
          weightedAvgPaymentDays: payment != null && Number.isFinite(payment) ? payment : null,
        }
      })
      .sort((a, b) => b.count - a.count || a.groupName.localeCompare(b.groupName))
  }, [drilldownContracts])
  const showOutstandingPaymentColumns =
    drilldownQuery.outstandingPayment === 'true' ||
    /outstanding payment/i.test(drilldownTitle || '')

  const paymentPlantSiteSummary = useMemo(() => {
    const perContract = new Map<string, { contractId: string; plantSite: string; contractValue: number }>()
    payDrilldownRows.forEach((r) => {
      const contractId = String(r.contract_id || '').trim()
      if (!contractId) return
      const key = contractId.toLowerCase()
      const plantSite = (r.plant_site || '').trim() || 'Blank'
      const contractValue = Number(r.contract_value || 0)
      const prev = perContract.get(key)
      if (!prev || contractValue > prev.contractValue) {
        perContract.set(key, { contractId, plantSite, contractValue })
      }
    })

    const grouped = new Map<string, { plantSite: string; contracts: number; totalContractValue: number }>()
    perContract.forEach((c) => {
      const gKey = c.plantSite.toLowerCase()
      const prev = grouped.get(gKey) || { plantSite: c.plantSite, contracts: 0, totalContractValue: 0 }
      prev.contracts += 1
      prev.totalContractValue += c.contractValue
      grouped.set(gKey, prev)
    })
    const fromPageRows = mergePlantSiteSummaryRows(Array.from(grouped.values()), 0.6)
    if (payDrilldownPlantSummary.length === 0) return fromPageRows
    const fromBackend = mergePlantSiteSummaryRows(
      payDrilldownPlantSummary.map((r) => ({
        plantSite: r.plant_site || 'Blank',
        contracts: Number(r.contracts || 0),
        totalContractValue: Number(r.total_contract_value || 0),
      })),
      0.6
    )
    return fromBackend.length > 0 ? fromBackend : fromPageRows
  }, [payDrilldownRows, payDrilldownPlantSummary])

  const paymentByVendorGroup = useMemo(() => {
    const groups = new Map<string, {
      groupName: string
      totalContracts: number
      totalContractValue: number
      nearestDueDate: string | null
      latestDueDate: string | null
      contractSeen: Set<string>
    }>()
    payDrilldownRows.forEach((r) => {
      const groupName = (r.group_name || '').trim() || 'Ungrouped'
      const key = groupName.toLowerCase()
      const row = groups.get(key) || {
        groupName,
        totalContracts: 0,
        totalContractValue: 0,
        nearestDueDate: null,
        latestDueDate: null,
        contractSeen: new Set<string>(),
      }
      const contractId = String(r.contract_id || '').trim()
      if (contractId && !row.contractSeen.has(contractId)) {
        row.contractSeen.add(contractId)
        row.totalContracts += 1
        row.totalContractValue += Number(r.contract_value || 0)
      }
      const due = (r.payment_due_date || '').trim()
      const t = due ? Date.parse(due) : Number.NaN
      if (!Number.isNaN(t)) {
        const nearest = row.nearestDueDate ? Date.parse(row.nearestDueDate) : Number.POSITIVE_INFINITY
        const latest = row.latestDueDate ? Date.parse(row.latestDueDate) : Number.NEGATIVE_INFINITY
        if (Number.isNaN(nearest) || t < nearest) row.nearestDueDate = due
        if (Number.isNaN(latest) || t > latest) row.latestDueDate = due
      }
      groups.set(key, row)
    })
    return Array.from(groups.values())
      .map((g) => ({
        groupName: g.groupName,
        totalContracts: g.totalContracts,
        totalContractValue: g.totalContractValue,
        nearestDueDate: g.nearestDueDate,
        latestDueDate: g.latestDueDate,
      }))
      .sort((a, b) => b.totalContractValue - a.totalContractValue)
  }, [payDrilldownRows])

  const [vendorGroupSortKey, setVendorGroupSortKey] = useState<string>('count')
  const [vendorGroupSortDir, setVendorGroupSortDir] = useState<'asc' | 'desc'>('desc')

  const sortedContractsByVendorGroup = useMemo(() => {
    const rows = [...contractsByVendorGroup]
    const dir = vendorGroupSortDir === 'asc' ? 1 : -1
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
    const str = (v: unknown) => String(v ?? '').toLowerCase()
    const dateMs = (v: unknown) => {
      const s = String(v ?? '').trim()
      if (!s) return Number.NaN
      const t = Date.parse(s)
      return Number.isNaN(t) ? Number.NaN : t
    }
    rows.sort((a, b) => {
      switch (vendorGroupSortKey) {
        case 'groupName':
          return dir * a.groupName.localeCompare(b.groupName)
        case 'count':
          return dir * (num(a.count) - num(b.count)) || a.groupName.localeCompare(b.groupName)
        case 'contractValue':
          return dir * (num(a.contractValue) - num(b.contractValue)) || a.groupName.localeCompare(b.groupName)
        case 'nearestPaymentDueDate': {
          const ad = dateMs(a.nearestPaymentDueDate)
          const bd = dateMs(b.nearestPaymentDueDate)
          if (Number.isNaN(ad) && Number.isNaN(bd)) return a.groupName.localeCompare(b.groupName)
          if (Number.isNaN(ad)) return 1
          if (Number.isNaN(bd)) return -1
          return dir * (ad - bd)
        }
        case 'qtyOrdered':
          return dir * (num(a.qtyOrdered) - num(b.qtyOrdered)) || a.groupName.localeCompare(b.groupName)
        case 'qtyDelivered':
          return dir * (num(a.qtyDelivered) - num(b.qtyDelivered)) || a.groupName.localeCompare(b.groupName)
        case 'qtyOutstanding':
          return dir * (num(a.qtyOutstanding) - num(b.qtyOutstanding)) || a.groupName.localeCompare(b.groupName)
        case 'openCount':
          return dir * (num(a.openCount) - num(b.openCount)) || a.groupName.localeCompare(b.groupName)
        case 'closeCount':
          return dir * (num(a.closeCount) - num(b.closeCount)) || a.groupName.localeCompare(b.groupName)
        case 'cancelledCount':
          return dir * (num(a.cancelledCount) - num(b.cancelledCount)) || a.groupName.localeCompare(b.groupName)
        case 'weightedAvgDeliveryDays':
          return dir * (num(a.weightedAvgDeliveryDays) - num(b.weightedAvgDeliveryDays)) || a.groupName.localeCompare(b.groupName)
        case 'weightedAvgPaymentDays':
          return dir * (num(a.weightedAvgPaymentDays) - num(b.weightedAvgPaymentDays)) || a.groupName.localeCompare(b.groupName)
        default:
          return dir * (str((a as any)[vendorGroupSortKey]) as any).localeCompare(str((b as any)[vendorGroupSortKey]))
      }
    })
    return rows
  }, [contractsByVendorGroup, vendorGroupSortKey, vendorGroupSortDir])

  const onVendorGroupHeaderClick = (key: string) => {
    if (vendorGroupSortKey === key) {
      setVendorGroupSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setVendorGroupSortKey(key)
    setVendorGroupSortDir('asc')
  }

  const KpiTile = ({
    label,
    value,
    sublabel,
    tone = 'default',
    onClick,
    wrapValue = false,
    valueClassName,
  }: {
    label: string
    value: string
    sublabel?: string
    tone?: 'default' | 'good' | 'warn' | 'bad'
    onClick?: () => void
    wrapValue?: boolean
    /** When set, overrides tone-based value color (e.g. per–outstanding-type colors). */
    valueClassName?: string
  }) => {
    const toneClass =
      tone === 'good'
        ? 'text-green-700'
        : tone === 'warn'
          ? 'text-yellow-700'
          : tone === 'bad'
            ? 'text-red-700'
            : 'text-gray-900'
    const valueColorClass = valueClassName ?? toneClass

    const body = (
      <div className="rounded-xl border bg-white px-3.5 py-3 hover:bg-gray-50 transition-colors min-w-0 overflow-hidden">
        <div className="text-[11px] font-medium text-gray-600 truncate">{label}</div>
        <div
          className={[
            'mt-0.5 text-[18px] font-semibold leading-tight tabular-nums tracking-tight',
            valueColorClass,
            wrapValue ? 'whitespace-normal break-words' : 'truncate'
          ].join(' ')}
          title={value}
        >
          {value}
        </div>
        {sublabel ? (
          <div className="mt-1 text-[11px] text-gray-500 leading-snug truncate">
            {sublabel}
          </div>
        ) : null}
      </div>
    )

    if (!onClick) return body
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg"
      >
        {body}
      </button>
    )
  }

  const StackedBar = ({
    segments,
    onSegmentClick,
    legendMdCols = 4,
    formatValue,
  }: {
    segments: Array<{
      label: string
      value: number
      tone?: 'good' | 'warn' | 'bad' | 'default'
      // Optional breakdown displayed in the legend per segment (incoterm mix cards)
      breakdown?: {
        outstandingDelivery: number
        outstandingPayment: number
        outstandingClaimMutu: number
        outstandingClaimSusut: number
        completed: number
      }
    }>
    onSegmentClick?: (label: string) => void
    legendMdCols?: 3 | 4
    formatValue?: (v: number) => string
  }) => {
    const segDisplay = (label: string) => formatSapGroupDisplayLabel(label)
    const total = segments.reduce((s, x) => s + (Number.isFinite(x.value) ? x.value : 0), 0)
    const fmt = (v: number) => (formatValue ? formatValue(v) : formatNumber(v))
    const hasBreakdown = segments.some((s) => !!s.breakdown)
    const color = (tone?: 'good' | 'warn' | 'bad' | 'default') => {
      if (tone === 'good') return 'bg-green-500'
      if (tone === 'warn') return 'bg-yellow-500'
      if (tone === 'bad') return 'bg-red-500'
      return 'bg-blue-500'
    }

    return (
      <div className="space-y-2">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="flex h-full w-full">
            {segments.map((seg) => {
              const v = Number.isFinite(seg.value) ? seg.value : 0
              const w = total > 0 ? (v / total) * 100 : 0
              const clickable = !!onSegmentClick
              const breakdownSuffix = seg.breakdown
                ? ` | OutDel ${fmt(seg.breakdown.outstandingDelivery)} / OutPay ${fmt(seg.breakdown.outstandingPayment)} / ClaimMutu ${fmt(seg.breakdown.outstandingClaimMutu)} / ClaimSusut ${fmt(seg.breakdown.outstandingClaimSusut)} / Done ${fmt(seg.breakdown.completed)}`
                : ''
              const common = {
                className: `${color(seg.tone)} ${clickable ? 'cursor-pointer hover:opacity-90' : ''} border-r border-white/60 last:border-r-0`,
                style: { width: `${w}%` },
                title: `${segDisplay(seg.label)}: ${fmt(v)} (${pctText(v, total)})${breakdownSuffix}`,
              } as const
              return clickable ? (
                <button
                  key={seg.label}
                  type="button"
                  {...common}
                  onClick={() => onSegmentClick(seg.label)}
                  aria-label={`Filter: ${segDisplay(seg.label)}`}
                />
              ) : (
                <div key={seg.label} {...common} />
              )
            })}
          </div>
        </div>

        {hasBreakdown ? (
          <div className="rounded-lg border bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[minmax(160px,2fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)] gap-3 px-3 py-2 text-[10px] font-semibold text-gray-600 bg-gray-50">
                  <div>Incoterm</div>
                  <div className="text-right">Total</div>
                  <div className="text-right">Out. Delivery</div>
                  <div className="text-right">Out. Payment</div>
                  <div className="text-right">Claim Mutu</div>
                  <div className="text-right">Claim Susut</div>
                  <div className="text-right">Done</div>
                </div>
                <div className="divide-y">
                  {segments.map((seg) => {
                const v = Number.isFinite(seg.value) ? seg.value : 0
                const dot =
                  seg.tone === 'good'
                    ? 'bg-green-500'
                    : seg.tone === 'warn'
                      ? 'bg-yellow-500'
                      : seg.tone === 'bad'
                        ? 'bg-red-500'
                        : 'bg-blue-500'
                const od = seg.breakdown ? seg.breakdown.outstandingDelivery : 0
                const op = seg.breakdown ? seg.breakdown.outstandingPayment : 0
                const cm = seg.breakdown ? seg.breakdown.outstandingClaimMutu : 0
                const cs = seg.breakdown ? seg.breakdown.outstandingClaimSusut : 0
                const done = seg.breakdown ? seg.breakdown.completed : 0
                const row = (
                  <div className={`grid grid-cols-[minmax(160px,2fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)] gap-3 px-3 py-2.5 text-[11px] ${onSegmentClick ? 'hover:bg-gray-50' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full ${dot} shrink-0`} />
                      <span className="text-gray-700 font-medium truncate">{segDisplay(seg.label)}</span>
                      <span className="text-[10px] text-gray-500 tabular-nums shrink-0">({pctText(v, total)})</span>
                    </div>
                    <div className="text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap truncate" title={fmt(v)}>
                      {fmt(v)}
                    </div>
                    <div className="text-right tabular-nums text-amber-700 whitespace-nowrap truncate" title={fmt(od)}>
                      {fmt(od)}
                    </div>
                    <div className="text-right tabular-nums text-violet-700 whitespace-nowrap truncate" title={fmt(op)}>
                      {fmt(op)}
                    </div>
                    <div className="text-right tabular-nums text-orange-700 whitespace-nowrap truncate" title={fmt(cm)}>
                      {fmt(cm)}
                    </div>
                    <div className="text-right tabular-nums text-orange-700 whitespace-nowrap truncate" title={fmt(cs)}>
                      {fmt(cs)}
                    </div>
                    <div className="text-right tabular-nums text-green-700 whitespace-nowrap truncate" title={fmt(done)}>
                      {fmt(done)}
                    </div>
                  </div>
                )

                if (!onSegmentClick) return <div key={seg.label}>{row}</div>
                return (
                  <button
                    key={seg.label}
                    type="button"
                    className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={() => onSegmentClick(seg.label)}
                  >
                    {row}
                  </button>
                )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={`grid grid-cols-2 gap-2 ${legendMdCols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>
            {segments.map((seg) => {
              const v = Number.isFinite(seg.value) ? seg.value : 0
              const dot =
                seg.tone === 'good'
                  ? 'bg-green-500'
                  : seg.tone === 'warn'
                    ? 'bg-yellow-500'
                    : seg.tone === 'bad'
                      ? 'bg-red-500'
                      : 'bg-blue-500'
              const row = (
                <div className={`rounded-md border bg-white px-2 py-2 min-w-0 ${onSegmentClick ? 'hover:bg-gray-50' : ''}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full ${dot} shrink-0`} />
                    <span className="text-[11px] text-gray-600 leading-snug break-words">{segDisplay(seg.label)}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-[11px] font-semibold text-gray-900 tabular-nums whitespace-nowrap">{fmt(v)}</span>
                    <span className="text-[11px] text-gray-500 font-medium tabular-nums whitespace-nowrap">
                      ({pctText(v, total)})
                    </span>
                  </div>
                </div>
              )

              if (!onSegmentClick) return row
              return (
                <button
                  key={seg.label}
                  type="button"
                  className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-md"
                  onClick={() => onSegmentClick(seg.label)}
                >
                  {row}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const MiniBarChart = ({
    items,
    formatValue,
    onItemClick,
    baseLabel,
  }: {
    items: Array<{ key: string; label: string; value: number; tone?: 'good' | 'warn' | 'bad' | 'default' }>
    formatValue?: (v: number) => string
    onItemClick?: (key: string) => void
    baseLabel?: string
  }) => {
    const max = Math.max(...items.map((i) => (Number.isFinite(i.value) ? i.value : 0)), 1)
    const fmt = (v: number) => (formatValue ? formatValue(v) : formatNumber(v))
    const color = (tone?: 'good' | 'warn' | 'bad' | 'default') => {
      if (tone === 'good') return 'bg-green-500'
      if (tone === 'warn') return 'bg-amber-500'
      if (tone === 'bad') return 'bg-red-500'
      return 'bg-blue-500'
    }
    return (
      <div className="rounded-xl border bg-white p-3">
        {baseLabel ? <div className="text-[11px] text-gray-600 mb-2">{baseLabel}</div> : null}
        <div className="space-y-2">
          {items.map((it) => {
            const v = Number.isFinite(it.value) ? it.value : 0
            const w = Math.max(1, (v / max) * 100)
            const row = (
              <div className={`rounded-lg border bg-gray-50 px-3 py-2 ${onItemClick ? 'hover:bg-gray-100 transition-colors' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-gray-700 truncate">{it.label}</div>
                  </div>
                  <div className="text-[12px] font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                    {fmt(v)}
                  </div>
                </div>
                <div className="mt-2 h-2.5 w-full rounded-full bg-white border overflow-hidden">
                  <div className={`${color(it.tone)} h-full`} style={{ width: `${w}%` }} />
                </div>
              </div>
            )
            if (!onItemClick) return <div key={it.key}>{row}</div>
            return (
              <button
                key={it.key}
                type="button"
                className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg"
                onClick={() => onItemClick(it.key)}
              >
                {row}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const PaymentOverlapBars = ({
    paid,
    pending,
    late,
    portfolioTotal,
    loading: barsLoading,
  }: {
    paid: number
    pending: number
    late: number
    portfolioTotal: number
    loading: boolean
  }) => {
    const combined = paid + pending + late
    const portfolioDenom = !barsLoading && portfolioTotal > 0 ? portfolioTotal : Math.max(combined, 1)
    const pctLabel =
      !barsLoading && portfolioTotal > 0
        ? '% of total contract value (contracts with payments)'
        : '% of Paid + Pending + Late combined (fallback while loading)'
    const rows = [
      { key: 'paid', label: 'Paid', value: paid, color: 'bg-green-500', status: 'PAID_PAYMENT' },
      { key: 'pending', label: 'Pending payment', value: pending, color: 'bg-amber-500', status: 'PENDING_PAYMENT' },
      { key: 'late', label: 'Late payment', value: late, color: 'bg-red-500', status: 'LATE_PAYMENT' },
    ] as const

    return (
      <div className="rounded-md border bg-purple-50/40 p-3">
        <div className="text-xs font-medium text-gray-700 mb-2">
          Payment overlap breakdown (not additive)
        </div>
        <p className="text-[10px] text-gray-500 mb-2 leading-snug">
          Bar width and {pctLabel}. Categories overlap, so the three shares can add up to more than 100%.
        </p>
        <div className="space-y-2">
          {rows.map((r) => {
            const widthPct = Math.min(100, (r.value / portfolioDenom) * 100)
            return (
              <button
                key={r.key}
                type="button"
                className="w-full text-left"
                onClick={() => openPaymentsDrilldown({ title: r.label, extraParams: { status: r.status } })}
              >
                <div className="flex items-center justify-between text-[11px] text-gray-700 mb-1">
                  <span>{r.label}</span>
                  <span className="tabular-nums">
                    {money(r.value)} ({pct(r.value, portfolioDenom)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white border overflow-hidden">
                  <div className={`h-full ${r.color}`} style={{ width: `${widthPct}%` }} />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const QuantityOverlapBars = ({
    outstandingDelivery,
    outstandingPayment,
  }: {
    outstandingDelivery: number
    outstandingPayment: number
  }) => {
    const base = Math.max(outstandingDelivery, 1)
    return (
      <div className="rounded-xl border bg-blue-50/30 p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-xs font-semibold text-gray-800">Overlap (not additive)</div>
          <div className="text-[10px] text-gray-500 tabular-nums">Base: outstanding delivery</div>
        </div>
        <p className="text-[11px] text-gray-600 mb-2 leading-snug">
          Outstanding Payment can overlap with Outstanding Delivery.
        </p>
        <button
          type="button"
          className="w-full text-left"
          onClick={() =>
            openContractsDrilldown({
              title: 'Contracts with outstanding payment quantity',
              extraParams: { outstanding: 'true', outstandingPayment: 'true' }
            })
          }
        >
          <div className="flex items-center justify-between text-[11px] text-gray-700 mb-1">
            <span className="font-medium">Outstanding Payment (subset of OD)</span>
            <span className="tabular-nums">
              {formatKg(outstandingPayment)} <span className="text-gray-500">({pct(outstandingPayment, base)}% of OD)</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-white border overflow-hidden">
            <div className="h-full bg-violet-500" style={{ width: `${Math.min(100, (outstandingPayment / base) * 100)}%` }} />
          </div>
        </button>
      </div>
    )
  }

  const buildFilterQuery = () => {
    const params = new URLSearchParams()
    if (dateFrom) params.append('dateFrom', dateFrom)
    if (dateTo) params.append('dateTo', dateTo)
    selectedPlantFilter.forEach((p) => params.append('plant', p))
    selectedSupplier.forEach((s) => params.append('supplier', s))
    selectedProductFilter.forEach((p) => params.append('product', p))
    selectedGroupFilter.forEach((g) => params.append('groupName', g))
    const q = params.toString()
    return q ? `?${q}` : ''
  }

  const fetchContractsDrilldownPage = async (page: number, query: Record<string, string>) => {
    setLoadingDrilldown(true)
    setDrilldownContracts([])
    try {
      const baseSuffix = buildFilterQuery()
      const params = new URLSearchParams(baseSuffix.replace('?', ''))
      Object.entries(query).forEach(([k, v]) => {
        if (v != null && String(v).trim() !== '') params.set(k, String(v))
      })
      params.set('limit', String(drilldownPageSize))
      params.set('offset', String((page - 1) * drilldownPageSize))
      const res = await api.get(`/dashboard/contracts?${params.toString()}`)
      setDrilldownContracts(res.data.data || [])
      setDrilldownTotalCount(Number(res.data.meta?.totalCount) || 0)
    } catch (err) {
      console.error('Failed to load drilldown contracts:', err)
      alert('Failed to load details')
    } finally {
      setLoadingDrilldown(false)
    }
  }

  const openContractsDrilldown = async (opts: {
    title: string
    subtitle?: string
    extraParams?: Record<string, string>
  }) => {
    setDrilldownTitle(opts.title)
    setDrilldownSubtitle(opts.subtitle || '')
    setDrilldownView('details')
    const q: Record<string, string> = { ...(opts.extraParams || {}) }
    setDrilldownQuery(q)
    setDrilldownPage(1)
    await fetchContractsDrilldownPage(1, q)
  }

  const openVendorGroupContracts = async (opts: {
    groupName: string
    titleSuffix: string
    extraParams?: Record<string, string>
  }) => {
    const groupName = (opts.groupName || '').trim()
    const isUngrouped = groupName.toLowerCase() === 'ungrouped'
    const groupParam = isUngrouped ? '__UNGROUPED__' : groupName
    await openContractsDrilldown({
      title: `${groupName} — ${opts.titleSuffix}`,
      subtitle: 'Filtered from Dashboard → By Vendor Group',
      extraParams: {
        // Inherit the current drilldown context (e.g. delivered/outstanding/contractStatus),
        // then narrow down to the selected vendor group.
        ...(drilldownQuery || {}),
        groupName: groupParam,
        ...(opts.extraParams || {}),
      },
    })
  }

  const openVendorGroupContractsFromCurrentPage = (opts: {
    groupName: string
    titleSuffix: string
    predicate?: (c: any) => boolean
  }) => {
    const groupName = (opts.groupName || '').trim()
    const normalizedGroup = groupName.toLowerCase() === 'ungrouped' ? 'ungrouped' : groupName
    const subset = (drilldownContracts || []).filter((c: any) => {
      const cg = ((c?.group_name || '').trim() || 'Ungrouped')
      const sameGroup = cg.toLowerCase() === String(normalizedGroup).toLowerCase()
      if (!sameGroup) return false
      return opts.predicate ? !!opts.predicate(c) : true
    })

    setDrilldownTitle(`${groupName} — ${opts.titleSuffix}`)
    setDrilldownSubtitle(`From current page (Page ${drilldownPage})`)
    setDrilldownView('details')
    setLoadingDrilldown(false)
    setDrilldownContracts(subset)
    setDrilldownTotalCount(subset.length)
    setDrilldownQuery({ ...(drilldownQuery || {}) })
  }

  const fetchShipmentsDrilldownPage = async (page: number, query: Record<string, string>) => {
    setLoadingShipDrilldown(true)
    setShipDrilldownRows([])
    try {
      const baseSuffix = buildFilterQuery()
      const params = new URLSearchParams(baseSuffix.replace('?', ''))
      Object.entries(query).forEach(([k, v]) => {
        if (v != null && String(v).trim() !== '') params.set(k, String(v))
      })
      params.set('limit', String(shipDrilldownPageSize))
      params.set('offset', String((page - 1) * shipDrilldownPageSize))
      const res = await api.get(`/dashboard/shipments?${params.toString()}`)
      setShipDrilldownRows(res.data.data || [])
      setShipDrilldownTotalCount(Number(res.data.meta?.totalCount) || 0)
    } catch (err: any) {
      console.error('Failed to load drilldown shipments:', err)
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to load details'
      alert(msg)
    } finally {
      setLoadingShipDrilldown(false)
    }
  }

  const openShipmentsDrilldown = async (opts: {
    title: string
    subtitle?: string
    extraParams?: Record<string, string>
  }) => {
    setShipDrilldownTitle(opts.title)
    setShipDrilldownSubtitle(opts.subtitle || '')
    const q: Record<string, string> = { ...(opts.extraParams || {}) }
    setShipDrilldownQuery(q)
    setShipDrilldownPage(1)
    await fetchShipmentsDrilldownPage(1, q)
  }

  const closeShipmentsDrilldown = () => {
    setShipDrilldownTitle(null)
    setShipDrilldownSubtitle('')
    setShipDrilldownRows([])
    setShipDrilldownTotalCount(0)
    setShipDrilldownPage(1)
    setShipDrilldownQuery({})
  }

  const fetchTruckingDrilldownPage = async (page: number, query: Record<string, string>) => {
    setLoadingTruckDrilldown(true)
    setTruckDrilldownRows([])
    try {
      const baseSuffix = buildFilterQuery()
      const params = new URLSearchParams(baseSuffix.replace('?', ''))
      Object.entries(query).forEach(([k, v]) => {
        if (v != null && String(v).trim() !== '') params.set(k, String(v))
      })
      params.set('limit', String(truckDrilldownPageSize))
      params.set('offset', String((page - 1) * truckDrilldownPageSize))
      const res = await api.get(`/dashboard/trucking-operations?${params.toString()}`)
      setTruckDrilldownRows(res.data.data || [])
      setTruckDrilldownTotalCount(Number(res.data.meta?.totalCount) || 0)
    } catch (err: any) {
      console.error('Failed to load drilldown trucking:', err)
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to load details'
      alert(msg)
    } finally {
      setLoadingTruckDrilldown(false)
    }
  }

  const openTruckingDrilldown = async (opts: {
    title: string
    subtitle?: string
    extraParams?: Record<string, string>
  }) => {
    setTruckDrilldownTitle(opts.title)
    setTruckDrilldownSubtitle(opts.subtitle || '')
    const q: Record<string, string> = { ...(opts.extraParams || {}) }
    setTruckDrilldownQuery(q)
    setTruckDrilldownPage(1)
    await fetchTruckingDrilldownPage(1, q)
  }

  const closeTruckingDrilldown = () => {
    setTruckDrilldownTitle(null)
    setTruckDrilldownSubtitle('')
    setTruckDrilldownRows([])
    setTruckDrilldownTotalCount(0)
    setTruckDrilldownPage(1)
    setTruckDrilldownQuery({})
  }

  const fetchPaymentsDrilldownPage = async (page: number, query: Record<string, string>) => {
    setLoadingPayDrilldown(true)
    setPayDrilldownRows([])
    try {
      const baseSuffix = buildFilterQuery()
      const params = new URLSearchParams(baseSuffix.replace('?', ''))
      Object.entries(query).forEach(([k, v]) => {
        if (v != null && String(v).trim() !== '') params.set(k, String(v))
      })
      params.set('limit', String(payDrilldownPageSize))
      params.set('offset', String((page - 1) * payDrilldownPageSize))
      const res = await api.get(`/dashboard/payments?${params.toString()}`)
      setPayDrilldownRows(res.data.data || [])
      setPayDrilldownTotalCount(Number(res.data.meta?.totalCount) || 0)
      setPayDrilldownPlantSummary(Array.isArray(res.data.meta?.plantSummary) ? res.data.meta.plantSummary : [])
    } catch (err: any) {
      console.error('Failed to load drilldown payments:', err)
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to load details'
      alert(msg)
    } finally {
      setLoadingPayDrilldown(false)
    }
  }

  const openPaymentsDrilldown = async (opts: {
    title: string
    subtitle?: string
    extraParams?: Record<string, string>
  }) => {
    setPayDrilldownTitle(opts.title)
    setPayDrilldownSubtitle(opts.subtitle || '')
    const q: Record<string, string> = { ...(opts.extraParams || {}) }
    setPayDrilldownQuery(q)
    setPaySelectedPlantSite(null)
    setPayDrilldownView('details')
    setPayDrilldownPage(1)
    await fetchPaymentsDrilldownPage(1, q)
  }

  const closePaymentsDrilldown = () => {
    setPayDrilldownTitle(null)
    setPayDrilldownSubtitle('')
    setPayDrilldownRows([])
    setPayDrilldownTotalCount(0)
    setPayDrilldownPage(1)
    setPayDrilldownQuery({})
    setPayDrilldownPlantSummary([])
    setPaySelectedPlantSite(null)
    setPayDrilldownView('details')
  }

  const closeContractsDrilldown = () => {
    setDrilldownTitle(null)
    setDrilldownSubtitle('')
    setDrilldownContracts([])
    setDrilldownTotalCount(0)
    setDrilldownPage(1)
    setDrilldownQuery({})
    setDrilldownView('details')
  }

  const closeClaimDrilldown = () => {
    setClaimDrilldownKind(null)
    setClaimDrilldownRows([])
    setClaimDrilldownTotalCount(0)
    setClaimDrilldownPage(1)
  }

  const fetchClaimDrilldownPage = async (page: number, kind: 'mutu' | 'susut') => {
    setLoadingClaimDrilldown(true)
    setClaimDrilldownRows([])
    try {
      const path =
        kind === 'mutu' ? '/dashboard/claim-mutu-outstanding' : '/dashboard/claim-susut-outstanding'
      const params = new URLSearchParams()
      params.set('limit', String(claimDrilldownPageSize))
      params.set('offset', String((page - 1) * claimDrilldownPageSize))
      const res = await api.get(`${path}?${params.toString()}`)
      setClaimDrilldownRows(res.data.data || [])
      setClaimDrilldownTotalCount(Number(res.data.meta?.totalCount) || 0)
    } catch (err) {
      console.error('Failed to load claim drilldown:', err)
      alert('Failed to load details')
    } finally {
      setLoadingClaimDrilldown(false)
    }
  }

  const openClaimDrilldown = async (kind: 'mutu' | 'susut') => {
    setClaimDrilldownKind(kind)
    setClaimDrilldownPage(1)
    await fetchClaimDrilldownPage(1, kind)
  }

  const fetchPlantDetails = async (plant: PlantQuantity) => {
    setSelectedPlant(plant)
    setLoadingDetails(true)
    try {
      const base = `/dashboard/plant-details?plant=${encodeURIComponent(plant.plant_location)}`
      const filterSuffix = buildFilterQuery()
      const sep = filterSuffix ? '&' : ''
      const response = await api.get(`${base}${sep}${filterSuffix.replace('?', '')}`)
      setPlantDetails(response.data.data)
    } catch (error) {
      console.error('Failed to fetch plant details:', error)
      alert('Failed to load plant details')
    } finally {
      setLoadingDetails(false)
    }
  }

  const closeModal = () => {
    setSelectedPlant(null)
    setPlantDetails([])
  }

  const openProductContracts = (opts: {
    product: string
    title: string
    extraParams?: Record<string, string>
  }) => openContractsDrilldown({
    title: opts.title,
    extraParams: {
      product: opts.product,
      ...(opts.extraParams || {}),
    },
  })

  const openPlantContracts = (opts: {
    plant: string
    title: string
    extraParams?: Record<string, string>
  }) => openContractsDrilldown({
    title: opts.title,
    extraParams: {
      plant: opts.plant,
      ...(opts.extraParams || {}),
    },
  })

  // Incoterm-only widget removed (now integrated into Product breakdown)

  const fetchSupplierDetails = async (supplierName: string) => {
    setSelectedSupplierName(supplierName)
    setLoadingSupplierContracts(true)
    try {
      const filterSuffix = buildFilterQuery()
      const sep = filterSuffix ? '&' : ''
      const res = await api.get(`/dashboard/contracts?supplier=${encodeURIComponent(supplierName)}${sep}${filterSuffix.replace('?', '')}`)
      setSupplierContracts(res.data.data || [])
    } catch (err) {
      console.error('Failed to fetch supplier contracts:', err)
      setSupplierContracts([])
      alert('Failed to load supplier details')
    } finally {
      setLoadingSupplierContracts(false)
    }
  }

  const closeSupplierModal = () => {
    setSelectedSupplierName(null)
    setSupplierContracts([])
  }

  const fetchOwnerDetails = async (ownerName: string) => {
    setSelectedOwnerName(ownerName)
    setLoadingOwnerOps(true)
    try {
      // Load trucking operations and filter by owner client-side (backend filter not available)
      const params = new URLSearchParams()
      params.append('limit', '500')
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      const res = await api.get(`/trucking?${params.toString()}`)
      const ops = (res.data.data?.truckingOperations || []).filter((t: any) => String(t.trucking_owner || '').toLowerCase() === ownerName.toLowerCase())
      setOwnerTruckingOps(ops)
    } catch (err) {
      console.error('Failed to fetch owner ops:', err)
      setOwnerTruckingOps([])
      alert('Failed to load trucking owner details')
    } finally {
      setLoadingOwnerOps(false)
    }
  }

  const closeOwnerModal = () => {
    setSelectedOwnerName(null)
    setOwnerTruckingOps([])
  }

  const fetchVesselDetails = async (vesselName: string) => {
    setSelectedVesselName(vesselName)
    setLoadingVesselShipments(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', '200')
      params.append('vessel', vesselName)
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      const res = await api.get(`/shipments?${params.toString()}`)
      setVesselShipments(res.data.data?.shipments || [])
    } catch (err) {
      console.error('Failed to fetch vessel shipments:', err)
      setVesselShipments([])
      alert('Failed to load vessel details')
    } finally {
      setLoadingVesselShipments(false)
    }
  }

  const closeVesselModal = () => {
    setSelectedVesselName(null)
    setVesselShipments([])
  }

  const handleViewDetails = (type: string, status?: string, extraParams?: Record<string, string>) => {
    let url = ''
    const params = new URLSearchParams()
    
    if (status) {
      params.append('status', status)
    }
    
    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        params.append(key, value)
      })
    }

    // Always include current dashboard filters
    if (dateFrom) params.append('dateFrom', dateFrom)
    if (dateTo) params.append('dateTo', dateTo)
    selectedPlantFilter.forEach((p) => params.append('plant', p))
    selectedSupplier.forEach((s) => params.append('supplier', s))
    selectedProductFilter.forEach((p) => params.append('product', p))
    selectedGroupFilter.forEach((g) => params.append('groupName', g))
    
    // For now keep behavior for deep navigation buttons,
    // but performance cards themselves will call openContractsDrilldown instead.
    switch (type) {
      case 'contracts':
        url = '/contracts'
        break
      case 'shipments':
        url = '/shipments'
        break
      case 'trucking':
        url = '/trucking'
        break
      case 'finance':
        url = '/finance'
        break
    }
    
    const queryString = params.toString()
    router.push(queryString ? `${url}?${queryString}` : url)
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome Section */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{pageTitle}</h1>
            <p className="text-gray-600 mt-2">
              Welcome to KPN Logistics Intelligence Platform
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border bg-white p-1">
              <Button size="sm" variant={quantityUnit === 'kg' ? 'default' : 'ghost'} onClick={() => setQuantityUnit('kg')}>Kg</Button>
              <Button size="sm" variant={quantityUnit === 'mt' ? 'default' : 'ghost'} onClick={() => setQuantityUnit('mt')}>MT</Button>
            </div>
            <div className="flex items-center gap-1 rounded-md border bg-white p-1">
              <Button size="sm" variant={amountUnit === 'rp' ? 'default' : 'ghost'} onClick={() => setAmountUnit('rp')}>Rp</Button>
              <Button size="sm" variant={amountUnit === 'billion-rp' ? 'default' : 'ghost'} onClick={() => setAmountUnit('billion-rp')}>Bio</Button>
            </div>
            <Button
              onClick={() => setShowFilters(!showFilters)}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        {/* AI Logistics Insight */}
        <Card data-tour="tour-ai-insight">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <div>
                <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                  AI Logistics Insight
                  <FieldHelp text={FIELD_HELP.aiInsight} />
                </CardTitle>
                <CardDescription>
                  Expert insight for palm oil downstream logistics, based on current dashboard filters.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {aiInsight && !loadingAiInsight && (
                <Badge variant="outline" className="text-xs">
                  Cached for current filters
                </Badge>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fetchAiInsight(true)}
                disabled={loadingAiInsight}
              >
                {loadingAiInsight ? 'Contacting Gemini…' : aiInsight ? 'Re-generate Insight' : 'Generate Insight'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiInsightError && (
              <p className="text-sm text-red-600">
                {aiInsightError}
              </p>
            )}
            {!aiInsight && !aiInsightError && !loadingAiInsight && (
              <p className="text-sm text-gray-500">
                No AI insight yet for these filters. Click &quot;Generate Insight&quot; to ask Gemini.
              </p>
            )}
            {loadingAiInsight && (
              <p className="text-sm text-gray-500">
                Generating expert insight from Gemini based on current dashboard data…
              </p>
            )}
            {aiInsight && (() => {
              const display = normalizeAiInsight(aiInsight) ?? aiInsight
              return (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-1">Summary</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-line">
                      {display.summary}
                    </p>
                  </div>
                  {display.highlights && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800 mb-1">Highlights</h3>
                      <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                        {display.highlights.split('\n').filter(Boolean).map((line, idx) => (
                          <li key={idx}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {display.recommendations && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800 mb-1">Recommendations</h3>
                      <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
                        {display.recommendations.split('\n').filter(Boolean).map((line, idx) => (
                          <li key={idx}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* Filters Section */}
        {showFilters && (
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Contract Date From</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Contract Date To</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full"
                  />
                </div>
                <SearchableMultiSelect
                  label="Plant/Site"
                  options={availablePlants}
                  selected={selectedPlantFilter}
                  onChange={setSelectedPlantFilter}
                  placeholder="All Plants"
                />
                <SearchableMultiSelect
                  label="Supplier"
                  options={availableSuppliers}
                  selected={selectedSupplier}
                  onChange={setSelectedSupplier}
                  placeholder="All Suppliers"
                />
                <SearchableMultiSelect
                  label="Product"
                  options={availableProducts}
                  selected={selectedProductFilter}
                  onChange={setSelectedProductFilter}
                  placeholder="All Products"
                />
                <SearchableMultiSelect
                  label="Group Name"
                  options={availableGroups}
                  selected={selectedGroupFilter}
                  onChange={setSelectedGroupFilter}
                  placeholder="All Groups"
                />
              </div>
              <div className="flex justify-end mt-4">
                <Button 
                  onClick={clearFilters}
                  variant="outline"
                  className="text-gray-600"
                >
                  Clear Filters
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Hint when filters exclude all data */}
        {!isManagementDashboard && !statsLoading && stats.contracts.total === 0 && stats.shipments.total === 0 && stats.trucking.total === 0 && stats.finance.total === 0 && (dateFrom || dateTo || selectedPlantFilter.length > 0 || selectedSupplier.length > 0 || selectedProductFilter.length > 0 || selectedGroupFilter.length > 0) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800">
              No data matches your current filters. Try clearing filters to see all data.
            </p>
            <Button variant="outline" size="sm" onClick={clearFilters} className="shrink-0">
              Clear Filters
            </Button>
          </div>
        )}

        {!isManagementDashboard && (
        <>
        {/* Performance Cards (management-friendly) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-tour="tour-dashboard-kpis">
          {/* Quantity Performance (first slot — former Contract Performance) */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Quantity Performance
                    <FieldHelp text={FIELD_HELP.dashboardKpiQuantity} />
                    <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Quantities for delivery; IDR amounts (contract value share) for outstanding payment and claims
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-blue-100">
                    <BarChart3 className="h-4 w-4 text-blue-600" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleViewDetails('contracts')}>
                    View
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <KpiTile
                  label="Total quantity"
                  value={statsLoading ? '...' : formatKg(stats.contracts.totalQuantity)}
                  onClick={() => openContractsDrilldown({ title: 'All contracts (quantity basis)' })}
                  wrapValue
                />
                <KpiTile
                  label="Delivered"
                  value={statsLoading ? '...' : formatKg(stats.contracts.deliveredQuantity)}
                  tone="good"
                  onClick={() =>
                    openContractsDrilldown({
                      title: 'Contracts with delivered quantity',
                      extraParams: { delivered: 'true' }
                    })
                  }
                  wrapValue
                />
                <div className="hidden lg:block" />
                <div className="hidden lg:block" />
              </div>

              <div className="rounded-lg border bg-slate-50/60 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Outstanding</div>
                    <div className="text-xs text-slate-600">Items that still need action</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <KpiTile
                  label="Outstanding delivery"
                  value={statsLoading ? '...' : formatKg(stats.contracts.outstandingQuantity)}
                  valueClassName="text-orange-700"
                  tone="warn"
                  onClick={() =>
                    openContractsDrilldown({
                      title: 'Contracts with outstanding delivery quantity',
                      extraParams: { outstanding: 'true' }
                    })
                  }
                  wrapValue
                />
                <KpiTile
                  label="Outstanding payment"
                  value={statsLoading ? '...' : formatRupiah(stats.contracts.outstandingPendingAmount ?? 0)}
                  sublabel="IDR (share of contract value)"
                  valueClassName="text-fuchsia-700"
                  tone="warn"
                  onClick={() =>
                    openContractsDrilldown({
                      title: 'Contracts with outstanding payment quantity',
                      extraParams: { outstanding: 'true', outstandingPayment: 'true' }
                    })
                  }
                  wrapValue
                />
                <KpiTile
                  label="Outstanding Claim Mutu"
                  value={statsLoading ? '...' : formatRupiah(stats.contracts.outstandingClaimMutuAmount ?? 0)}
                  sublabel="IDR after tax (latest import)"
                  valueClassName="text-teal-700"
                  tone="warn"
                  onClick={() => openClaimDrilldown('mutu')}
                  wrapValue
                />
                <KpiTile
                  label="Outstanding Claim Susut"
                  value={statsLoading ? '...' : formatRupiah(stats.contracts.outstandingClaimSusutAmount ?? 0)}
                  sublabel="IDR after tax (latest import)"
                  valueClassName="text-rose-700"
                  tone="warn"
                  onClick={() => openClaimDrilldown('susut')}
                  wrapValue
                />
                </div>
              </div>

              {/* Comparison bars removed (per management UX request). */}
            </CardContent>
          </Card>

          {/* Shipment Performance */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Shipment Performance
                    <FieldHelp text={FIELD_HELP.dashboardKpiShipments} />
                    <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                  </CardTitle>
                  <CardDescription>Status mix and delay focus</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-green-100">
                    <Package className="h-4 w-4 text-green-600" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleViewDetails('shipments')}>
                    View
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <KpiTile
                  label="Total shipments"
                  value={statsLoading ? '...' : formatNumber(stats.shipments.total)}
                  sublabel="All shipments"
                  onClick={() => openShipmentsDrilldown({ title: 'All shipments' })}
                />
                <KpiTile
                  label="Completion rate"
                  value={statsLoading ? '...' : `${pct(stats.shipments.completed, stats.shipments.total)}%`}
                  sublabel={`${statsLoading ? '...' : formatNumber(stats.shipments.completed)} completed`}
                  tone="good"
                  onClick={() => openShipmentsDrilldown({ title: 'Completed shipments', extraParams: { status: 'COMPLETED' } })}
                />
                <KpiTile
                  label="Late / delayed rate"
                  value={statsLoading ? '...' : `${pct(stats.shipments.late, stats.shipments.total)}%`}
                  sublabel={`${statsLoading ? '...' : formatNumber(stats.shipments.late)} shipments`}
                  tone="bad"
                  onClick={() => openShipmentsDrilldown({ title: 'Late shipments', extraParams: { delayed: 'true' } })}
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Planned', value: statsLoading ? 0 : stats.shipments.planned, tone: 'default' },
                  { label: 'Loading', value: statsLoading ? 0 : stats.shipments.loading, tone: 'warn' },
                  { label: 'In transit', value: statsLoading ? 0 : stats.shipments.inTransit, tone: 'default' },
                  { label: 'Arrived', value: statsLoading ? 0 : stats.shipments.arrived, tone: 'default' },
                  { label: 'Unloading', value: statsLoading ? 0 : stats.shipments.unloading, tone: 'warn' },
                  { label: 'Completed', value: statsLoading ? 0 : stats.shipments.completed, tone: 'good' },
                  { label: 'Cancelled', value: statsLoading ? 0 : stats.shipments.cancelled, tone: 'bad' },
                ]}
                onSegmentClick={(label) => {
                  const map: Record<string, string> = {
                    Planned: 'PLANNED',
                    Loading: 'LOADING',
                    'In transit': 'IN_TRANSIT',
                    Arrived: 'ARRIVED',
                    Unloading: 'UNLOADING',
                    Completed: 'COMPLETED',
                    Cancelled: 'CANCELLED',
                  }
                  const status = map[label]
                  return openShipmentsDrilldown({ title: `${label} shipments`, extraParams: { status } })
                }}
              />
            </CardContent>
          </Card>

          {/* Trucking Performance */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Trucking Performance
                    <FieldHelp text={FIELD_HELP.dashboardKpiTrucking} />
                    <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                  </CardTitle>
                  <CardDescription>Status mix and late risk</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-orange-100">
                    <Truck className="h-4 w-4 text-orange-600" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleViewDetails('trucking')}>
                    View
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <KpiTile
                  label="Total trucking ops"
                  value={statsLoading ? '...' : formatNumber(stats.trucking.total)}
                  sublabel="All trucking operations"
                  onClick={() => openTruckingDrilldown({ title: 'All trucking operations' })}
                />
                <KpiTile
                  label="Completion rate"
                  value={statsLoading ? '...' : `${pct(stats.trucking.completed, stats.trucking.total)}%`}
                  sublabel={`${statsLoading ? '...' : formatNumber(stats.trucking.completed)} completed`}
                  tone="good"
                  onClick={() => openTruckingDrilldown({ title: 'Completed trucking operations', extraParams: { status: 'COMPLETED' } })}
                />
                <KpiTile
                  label="Late rate"
                  value={statsLoading ? '...' : `${pct(stats.trucking.late, stats.trucking.total)}%`}
                  sublabel={`${statsLoading ? '...' : formatNumber(stats.trucking.late)} ops`}
                  tone="bad"
                  onClick={() => openTruckingDrilldown({ title: 'Late trucking operations', extraParams: { status: 'LATE' } })}
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Planned', value: statsLoading ? 0 : stats.trucking.planned, tone: 'default' },
                  { label: 'Loading', value: statsLoading ? 0 : stats.trucking.loading, tone: 'warn' },
                  { label: 'In transit', value: statsLoading ? 0 : stats.trucking.inTransit, tone: 'default' },
                  { label: 'Unloading', value: statsLoading ? 0 : stats.trucking.unloading, tone: 'warn' },
                  { label: 'Completed', value: statsLoading ? 0 : stats.trucking.completed, tone: 'good' },
                  { label: 'Cancelled', value: statsLoading ? 0 : stats.trucking.cancelled, tone: 'bad' },
                ]}
                onSegmentClick={(label) => {
                  const map: Record<string, string> = {
                    Planned: 'PLANNED',
                    Loading: 'LOADING',
                    'In transit': 'IN_TRANSIT',
                    Unloading: 'UNLOADING',
                    Completed: 'COMPLETED',
                    Cancelled: 'CANCELLED',
                  }
                  const status = map[label]
                  return openTruckingDrilldown({ title: `${label} trucking operations`, extraParams: { status } })
                }}
              />
            </CardContent>
          </Card>

          {/* Finance Performance */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Payment Performance
                    <FieldHelp text={FIELD_HELP.dashboardKpiFinance} />
                    <Badge variant="outline" className="text-[10px]">Amt: {amountUnitLabel}</Badge>
                  </CardTitle>
                  <CardDescription>Cash position and risk</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-purple-100">
                    <DollarSign className="h-4 w-4 text-purple-600" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleViewDetails('finance')}>
                    View
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <KpiTile
                  label="Total payments"
                  value={statsLoading ? '...' : money(stats.finance.totalAmount)}
                  sublabel="All payments"
                  onClick={() => openPaymentsDrilldown({ title: 'All payments' })}
                />
                <KpiTile
                  label="Paid rate"
                  value={statsLoading ? '...' : money(stats.finance.paidAmount)}
                  sublabel={`${statsLoading ? '...' : pct(stats.finance.paidAmount, stats.finance.totalAmount)}% of total`}
                  tone="good"
                  onClick={() => openPaymentsDrilldown({ title: 'Paid payments', extraParams: { status: 'PAID_PAYMENT' } })}
                />
                <KpiTile
                  label="Pending payment"
                  value={statsLoading ? '...' : money(stats.finance.pendingAmount)}
                  sublabel={`${statsLoading ? '...' : formatNumber(stats.finance.pending)} contracts (payoff date blank)`}
                  tone="warn"
                  onClick={() => openPaymentsDrilldown({ title: 'Pending payment', extraParams: { status: 'PENDING_PAYMENT' } })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-2">
                <KpiTile
                  label="Late payment"
                  value={statsLoading ? '...' : money(stats.finance.overdueAmount)}
                  sublabel={`${statsLoading ? '...' : formatNumber(stats.finance.overdue)} contracts (unpaid overdue or paid late)`}
                  tone="bad"
                  onClick={() => openPaymentsDrilldown({ title: 'Late payment', extraParams: { status: 'LATE_PAYMENT' } })}
                />
              </div>

              <PaymentOverlapBars
                paid={statsLoading ? 0 : stats.finance.paidAmount}
                pending={statsLoading ? 0 : stats.finance.pendingAmount}
                late={statsLoading ? 0 : stats.finance.overdueAmount}
                portfolioTotal={statsLoading ? 0 : stats.finance.totalAmount}
                loading={statsLoading}
              />
            </CardContent>
          </Card>
        </div>
        </>
        )}

        {/* New Dashboard Widgets */}
        <div className={`grid grid-cols-1 ${isManagementDashboard ? '' : 'lg:grid-cols-2'} gap-6`}>
          {/* Contract Quantity by Product Materials */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Contract Profiling (by Quantity)
                  <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                </CardTitle>
                <CardDescription>
                  {isManagementDashboard ? (
                    <span className="block space-y-1 text-left">
                      <span className="block">Top products with incoterm distribution.</span>
                      <span className="block text-muted-foreground text-[11px] leading-snug">
                        Each product includes a full breakdown: Incoterm → Plant/Site → Source Type → LT/SPOT (same plant/site rules as the main Dashboard).
                        Total Delay, Cargo Readiness Issue, Aging O/S, Delivery Issue, and DP/Payoff deviations are per contract — open any product or click a number in the breakdown to view them in the contracts list.
                      </span>
                    </span>
                  ) : (
                    'Top products with incoterm distribution'
                  )}
                </CardDescription>
              </div>
              <Layers className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[560px] overflow-auto pr-1">
                {widgetsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : productIncotermRows.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  (() => {
                    const byProduct = new Map<string, ProductIncotermRow[]>()
                    productIncotermRows.forEach((r) => {
                      const key = r.product || 'Unknown'
                      const list = byProduct.get(key) || []
                      list.push(r)
                      byProduct.set(key, list)
                    })

                    const products = Array.from(byProduct.entries()).map(([productName, rows]) => {
                      const total_quantity = rows.reduce((s, x) => s + (Number(x.total_quantity) || 0), 0)
                      const completed_quantity = rows.reduce((s, x) => s + (Number(x.completed_quantity) || 0), 0)
                      const outstanding_quantity = rows.reduce((s, x) => s + (Number(x.outstanding_quantity) || 0), 0)
                      const outstanding_payment_quantity = rows.reduce(
                        (s, x) => s + (Number(x.outstanding_payment_quantity) || 0),
                        0
                      )
                      const outstanding_claim_mutu_qty = rows.reduce((s, x) => s + (Number(x.outstanding_claim_mutu_qty) || 0), 0)
                      const outstanding_claim_susut_qty = rows.reduce((s, x) => s + (Number(x.outstanding_claim_susut_qty) || 0), 0)
                      const contract_count = rows.reduce((s, x) => s + (Number(x.contract_count) || 0), 0)
                      const supplier_count = rows.reduce((s, x) => s + (Number(x.supplier_count) || 0), 0)
                      const total_contract_value = rows.reduce((s, x) => s + (Number(x.total_contract_value) || 0), 0)
                      return {
                        product: productName,
                        rows: rows.slice().sort((a, b) => (Number(b.total_quantity) || 0) - (Number(a.total_quantity) || 0)),
                        summary: {
                          product: productName,
                          contract_count,
                          supplier_count,
                          total_quantity,
                          completed_quantity,
                          outstanding_quantity,
                          outstanding_payment_quantity,
                          outstanding_claim_mutu_qty,
                          outstanding_claim_susut_qty,
                          avg_unit_price: total_quantity > 0 ? total_contract_value / total_quantity : 0,
                          total_contract_value
                        } satisfies ProductQuantity
                      }
                    }).sort((a, b) => b.summary.total_quantity - a.summary.total_quantity)

                    const tones: Array<'default' | 'good' | 'warn' | 'bad'> = ['default', 'good', 'warn', 'bad']

                    return products.map((p, index) => {
                      const top = p.rows.slice(0, 4)
                      const otherRows = p.rows.slice(4)
                      const otherValue = otherRows.reduce((s, x) => s + (Number(x.total_quantity) || 0), 0)
                      const otherOutstandingDelivery = otherRows.reduce(
                        (s, x) => s + (Number(x.outstanding_quantity) || 0),
                        0
                      )
                      const otherOutstandingPayment = otherRows.reduce(
                        (s, x) => s + (Number(x.outstanding_payment_quantity) || 0),
                        0
                      )
                      const otherCompleted = otherRows.reduce((s, x) => s + (Number(x.completed_quantity) || 0), 0)
                      const segments = [
                        ...top.map((r, i) => ({
                          label: r.incoterm || 'Blank',
                          value: Number(r.total_quantity) || 0,
                          tone: tones[i % tones.length],
                          breakdown: {
                            outstandingDelivery: Number(r.outstanding_quantity) || 0,
                            outstandingPayment: Number(r.outstanding_payment_quantity) || 0,
                            outstandingClaimMutu: Number(r.outstanding_claim_mutu_qty) || 0,
                            outstandingClaimSusut: Number(r.outstanding_claim_susut_qty) || 0,
                            completed: Number(r.completed_quantity) || 0
                          }
                        })),
                        ...(otherValue > 0
                          ? [
                              {
                                label: 'Other',
                                value: otherValue,
                                tone: 'default' as const,
                                breakdown: {
                                  outstandingDelivery: otherOutstandingDelivery,
                                  outstandingPayment: otherOutstandingPayment,
                                  outstandingClaimMutu: otherRows.reduce((s, x) => s + (Number(x.outstanding_claim_mutu_qty) || 0), 0),
                                  outstandingClaimSusut: otherRows.reduce((s, x) => s + (Number(x.outstanding_claim_susut_qty) || 0), 0),
                                  completed: otherCompleted
                                }
                              }
                            ]
                          : []),
                      ]

                      return (
                        <div
                          key={p.product}
                          role="button"
                          tabIndex={0}
                          className="w-full text-left p-3.5 rounded-xl border bg-white hover:bg-gray-50 transition-colors shadow-sm"
                          onClick={() => openProductContracts({ product: p.product, title: `${p.product} contracts` })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openProductContracts({ product: p.product, title: `${p.product} contracts` })
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5">
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-sm truncate text-gray-900">{formatSapGroupDisplayLabel(p.product)}</div>
                                <div className="text-[11px] text-gray-500">
                                  {p.summary.contract_count} contracts • {p.summary.supplier_count} suppliers
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[13px] font-semibold tabular-nums text-gray-900">{formatKg(p.summary.total_quantity)}</div>
                              <div className="text-[10px] text-gray-500">Total</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-2 pt-2 border-t border-gray-200">
                            <div className="text-xs">
                              <span className="text-gray-500">Total:</span>
                              <button
                                type="button"
                                className="font-semibold text-gray-900 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({ product: p.product, title: `${p.product} — Total quantity` })
                                }}
                              >
                                {formatKg(p.summary.total_quantity)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding Delivery:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({ product: p.product, title: `${p.product} — Outstanding delivery`, extraParams: { outstanding: 'true' } })
                                }}
                              >
                                {formatKg(p.summary.outstanding_quantity)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding Payment:</span>
                              <button
                                type="button"
                                className="font-semibold text-violet-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({
                                    product: p.product,
                                    title: `${p.product} — Outstanding payment quantity`,
                                    extraParams: { outstanding: 'true', outstandingPayment: 'true' },
                                  })
                                }}
                              >
                                {formatKg(p.summary.outstanding_payment_quantity)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding Claim Mutu:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push('/trucking/claim-mutu')
                                }}
                              >
                                {formatKg((p.summary as any).outstanding_claim_mutu_qty || 0)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding Claim Susut:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push('/trucking/claim-susut')
                                }}
                              >
                                {formatKg((p.summary as any).outstanding_claim_susut_qty || 0)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Completed:</span>
                              <button
                                type="button"
                                className="font-semibold text-green-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({ product: p.product, title: `${p.product} — Completed quantity`, extraParams: { delivered: 'true' } })
                                }}
                              >
                                {formatKg(p.summary.completed_quantity)}
                              </button>
                            </div>
                          </div>
                          <div className="mt-2">
                            <StackedBar
                              segments={segments}
                              onSegmentClick={(label) => {
                                if (label === 'Other') {
                                  return openProductContracts({ product: p.product, title: `${p.product} — Other incoterms` })
                                }
                                return openProductContracts({
                                  product: p.product,
                                  title: `${p.product} — ${label}`,
                                  extraParams: { incoterm: label === 'Blank' ? 'Blank' : label },
                                })
                              }}
                              legendMdCols={3}
                              formatValue={(v) => formatKg(v)}
                            />
                          </div>
                          {isManagementDashboard && productIncotermBreakdownRows.length > 0 && (
                            <div className="mt-2">
                              <div
                                className="rounded-lg border bg-gray-50 px-3 py-2"
                                onClick={(e) => e.stopPropagation()}
                                role="region"
                                aria-label="Product breakdown by incoterm, plant, source type, and LT/SPOT"
                              >
                                <div className="text-xs font-medium text-gray-700 mb-2">
                                  Breakdown: Incoterm → Plant/Site → Source Type → LT/SPOT
                                </div>
                                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                                  <table className="w-full min-w-[900px] text-xs">
                                    <thead className="text-gray-600">
                                      <tr className="border-b">
                                        <th className="py-2 pr-3 text-left font-medium">Incoterm</th>
                                        <th className="py-2 pr-3 text-left font-medium">Plant/Site</th>
                                        <th className="py-2 pr-3 text-left font-medium">Source Type</th>
                                        <th className="py-2 pr-3 text-left font-medium">LT/SPOT</th>
                                        <th className="py-2 pr-3 text-right font-medium">Contracts</th>
                                        <th className="py-2 pr-3 text-right font-medium">Qty</th>
                                        <th className="py-2 pr-3 text-right font-medium">Outstanding</th>
                                        <th className="py-2 pr-3 text-right font-medium">Outstanding Payment</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {productIncotermBreakdownRows
                                        .filter((r) => (r.product || '') === p.product)
                                        .slice()
                                        .sort(compareProductBreakdownRows)
                                        .map((r, i) => {
                                          const incoterm = (r.incoterm || 'Blank').trim() || 'Blank'
                                          const plantSite = (r.plant_site || 'Blank').trim() || 'Blank'
                                          const sourceType = (r.source_type || 'Blank').trim() || 'Blank'
                                          const ltSpot = (r.lt_spot || 'Blank').trim() || 'Blank'
                                          const open = (extra?: Record<string, string>) =>
                                            openProductContracts({
                                              product: p.product,
                                              title: `${formatSapGroupDisplayLabel(p.product)} — ${formatSapDisplayValue(incoterm)} — ${formatSapDisplayValue(plantSite)} — ${formatSapDisplayValue(sourceType)} — ${formatSapDisplayValue(ltSpot)}`,
                                              extraParams: {
                                                incoterm,
                                                plantSite,
                                                sourceType,
                                                ltSpot,
                                                ...(extra || {}),
                                              },
                                            })
                                          return (
                                          <tr key={`${r.product}-${r.incoterm}-${r.plant_site}-${r.source_type}-${r.lt_spot}-${i}`} className="hover:bg-white/60">
                                            <td className="py-2 pr-3">{formatSapDisplayValue(incoterm)}</td>
                                            <td className="py-2 pr-3">{formatSapDisplayValue(plantSite)}</td>
                                            <td className="py-2 pr-3">{formatSapDisplayValue(sourceType)}</td>
                                            <td className="py-2 pr-3">{formatSapDisplayValue(ltSpot)}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums">
                                              <button
                                                type="button"
                                                className="font-semibold text-gray-900 hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  open()
                                                }}
                                              >
                                                {formatNumber(Number(r.contract_count) || 0)}
                                              </button>
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums">
                                              <button
                                                type="button"
                                                className="font-semibold text-gray-900 hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  open()
                                                }}
                                              >
                                                {formatKg(Number(r.total_quantity) || 0)}
                                              </button>
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-orange-700">
                                              <button
                                                type="button"
                                                className="font-semibold hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  open({ outstanding: 'true' })
                                                }}
                                              >
                                                {formatKg(Number(r.outstanding_quantity) || 0)}
                                              </button>
                                            </td>
                                            <td className="py-2 pr-3 text-right tabular-nums text-violet-700">
                                              <button
                                                type="button"
                                                className="font-semibold hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  open({ outstanding: 'true', outstandingPayment: 'true' })
                                                }}
                                              >
                                                {formatKg(Number(r.outstanding_payment_quantity) || 0)}
                                              </button>
                                            </td>
                                          </tr>
                                          )
                                        })}
                                    </tbody>
                                  </table>
                                  <div className="mt-1 text-[10px] text-gray-500">
                                    Scroll to see all rows. Click any number to open the contracts list (includes delay, aging, and payment deviation columns).
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  })()
                )}
              </div>
            </CardContent>
          </Card>

          {!isManagementDashboard && (
          <>
          {/* Contract Amount by Product Materials */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Contract Profiling (by Amount)
                  <Badge variant="outline" className="text-[10px]">Amt: {amountUnitLabel}</Badge>
                </CardTitle>
                <CardDescription>Top products with incoterm distribution</CardDescription>
              </div>
              <Layers className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[560px] overflow-auto pr-1">
                {widgetsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : productIncotermRows.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  (() => {
                    const byProduct = new Map<string, ProductIncotermRow[]>()
                    productIncotermRows.forEach((r) => {
                      const key = r.product || 'Unknown'
                      const list = byProduct.get(key) || []
                      list.push(r)
                      byProduct.set(key, list)
                    })

                    const products = Array.from(byProduct.entries()).map(([productName, rows]) => {
                      const total_quantity = rows.reduce((s, x) => s + (Number(x.total_quantity) || 0), 0)
                      const completed_quantity = rows.reduce((s, x) => s + (Number(x.completed_quantity) || 0), 0)
                      const outstanding_quantity = rows.reduce((s, x) => s + (Number(x.outstanding_quantity) || 0), 0)
                      const outstanding_payment_quantity = rows.reduce(
                        (s, x) => s + (Number(x.outstanding_payment_quantity) || 0),
                        0
                      )
                      const contract_count = rows.reduce((s, x) => s + (Number(x.contract_count) || 0), 0)
                      const supplier_count = rows.reduce((s, x) => s + (Number(x.supplier_count) || 0), 0)
                      const total_contract_value = rows.reduce((s, x) => s + (Number(x.total_contract_value) || 0), 0)
                      return {
                        product: productName,
                        rows: rows
                          .slice()
                          .sort((a, b) => (Number(b.total_contract_value) || 0) - (Number(a.total_contract_value) || 0)),
                        summary: {
                          product: productName,
                          contract_count,
                          supplier_count,
                          total_quantity,
                          completed_quantity,
                          outstanding_quantity,
                          outstanding_payment_quantity,
                          avg_unit_price: total_quantity > 0 ? total_contract_value / total_quantity : 0,
                          total_contract_value
                        } satisfies ProductQuantity
                      }
                    }).sort((a, b) => b.summary.total_contract_value - a.summary.total_contract_value)

                    const tones: Array<'default' | 'good' | 'warn' | 'bad'> = ['default', 'good', 'warn', 'bad']

                    return products.map((p, index) => {
                      const top = p.rows.slice(0, 4)
                      const otherRows = p.rows.slice(4)
                      const otherValue = otherRows.reduce((s, x) => s + (Number(x.total_contract_value) || 0), 0)
                      const otherOutstandingDelivery = otherRows.reduce((s, x) => {
                        const rowTotalQty = Number(x.total_quantity) || 0
                        const rowTotalValue = Number(x.total_contract_value) || 0
                        const unitPrice = rowTotalQty > 0 ? rowTotalValue / rowTotalQty : 0
                        return s + (Number(x.outstanding_quantity) || 0) * unitPrice
                      }, 0)
                      const otherOutstandingPayment = otherRows.reduce((s, x) => {
                        const rowTotalQty = Number(x.total_quantity) || 0
                        const rowTotalValue = Number(x.total_contract_value) || 0
                        const unitPrice = rowTotalQty > 0 ? rowTotalValue / rowTotalQty : 0
                        return s + (Number(x.outstanding_payment_quantity) || 0) * unitPrice
                      }, 0)
                      const otherCompleted = otherRows.reduce((s, x) => {
                        const rowTotalQty = Number(x.total_quantity) || 0
                        const rowTotalValue = Number(x.total_contract_value) || 0
                        const unitPrice = rowTotalQty > 0 ? rowTotalValue / rowTotalQty : 0
                        return s + (Number(x.completed_quantity) || 0) * unitPrice
                      }, 0)
                      const segments = [
                        ...top.map((r, i) => {
                          const rowTotalQty = Number(r.total_quantity) || 0
                          const rowTotalValue = Number(r.total_contract_value) || 0
                          const unitPrice = rowTotalQty > 0 ? rowTotalValue / rowTotalQty : 0
                          return {
                            label: r.incoterm || 'Blank',
                            value: rowTotalValue,
                            tone: tones[i % tones.length],
                            breakdown: {
                              outstandingDelivery: (Number(r.outstanding_quantity) || 0) * unitPrice,
                              outstandingPayment: (Number(r.outstanding_payment_quantity) || 0) * unitPrice,
                              outstandingClaimMutu: 0,
                              outstandingClaimSusut: 0,
                              completed: (Number(r.completed_quantity) || 0) * unitPrice
                            }
                          }
                        }),
                        ...(otherValue > 0
                          ? [
                              {
                                label: 'Other',
                                value: otherValue,
                                tone: 'default' as const,
                                breakdown: {
                                  outstandingDelivery: otherOutstandingDelivery,
                                  outstandingPayment: otherOutstandingPayment,
                                  outstandingClaimMutu: 0,
                                  outstandingClaimSusut: 0,
                                  completed: otherCompleted
                                }
                              }
                            ]
                          : []),
                      ]

                      return (
                        <div
                          key={p.product}
                          role="button"
                          tabIndex={0}
                          className="w-full text-left p-3.5 rounded-xl border bg-white hover:bg-gray-50 transition-colors shadow-sm"
                          onClick={() => openProductContracts({ product: p.product, title: `${p.product} contracts` })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openProductContracts({ product: p.product, title: `${p.product} contracts` })
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5">
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-sm truncate text-gray-900">{formatSapGroupDisplayLabel(p.product)}</div>
                                <div className="text-[11px] text-gray-500">
                                  {p.summary.contract_count} contracts • {p.summary.supplier_count} suppliers
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[13px] font-semibold tabular-nums text-gray-900">{formatRupiah(p.summary.total_contract_value)}</div>
                              <div className="text-[10px] text-gray-500">Total</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 pt-2 border-t border-gray-200">
                            <div className="text-xs">
                              <span className="text-gray-500">Total Amount:</span>
                              <button
                                type="button"
                                className="font-semibold text-gray-900 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({ product: p.product, title: `${p.product} — Total amount` })
                                }}
                              >
                                {formatRupiah(p.summary.total_contract_value)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding Delivery Amount:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({ product: p.product, title: `${p.product} — Outstanding delivery amount`, extraParams: { outstanding: 'true' } })
                                }}
                              >
                                {formatRupiah(p.summary.outstanding_quantity * p.summary.avg_unit_price)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding Payment Amount:</span>
                              <button
                                type="button"
                                className="font-semibold text-violet-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({
                                    product: p.product,
                                    title: `${p.product} — Outstanding payment amount`,
                                    extraParams: { outstanding: 'true', outstandingPayment: 'true' },
                                  })
                                }}
                              >
                                {formatRupiah(p.summary.outstanding_payment_quantity * p.summary.avg_unit_price)}
                              </button>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Completed Amount:</span>
                              <button
                                type="button"
                                className="font-semibold text-green-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openProductContracts({ product: p.product, title: `${p.product} — Completed amount`, extraParams: { delivered: 'true' } })
                                }}
                              >
                                {formatRupiah(p.summary.completed_quantity * p.summary.avg_unit_price)}
                              </button>
                            </div>
                          </div>

                          <div className="mt-2">
                            <StackedBar
                              segments={segments}
                              onSegmentClick={(label) => {
                                if (label === 'Other') {
                                  return openProductContracts({ product: p.product, title: `${p.product} — Other incoterms` })
                                }
                                return openProductContracts({
                                  product: p.product,
                                  title: `${p.product} — ${label}`,
                                  extraParams: { incoterm: label === 'Blank' ? 'Blank' : label },
                                })
                              }}
                              legendMdCols={3}
                              formatValue={(v) => formatRupiah(v)}
                            />
                          </div>
                        </div>
                      )
                    })
                  })()
                )}
              </div>
            </CardContent>
          </Card>

          {/* Incoterm mix is now integrated into Product card */}
          </>
          )}

          {!isManagementDashboard && (
          <>
          {/* Contract Quantity by Plant/Site */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Contract Quantity by Plant/Site
                  <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                </CardTitle>
                <CardDescription>Total, outstanding delivery/payment, completed, and incoterm mix per plant/site</CardDescription>
              </div>
              <MapPin className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {widgetsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : plantQuantities.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  (() => {
                    const byPlant = new Map<string, PlantIncotermRow[]>()
                    plantIncotermRows.forEach((r) => {
                      const key = r.plant_location || 'Blank'
                      const list = byPlant.get(key) || []
                      list.push(r)
                      byPlant.set(key, list)
                    })

                    const plants = Array.from(byPlant.entries()).map(([plantName, rows]) => {
                      const total_quantity = rows.reduce((s, x) => s + (Number(x.total_quantity) || 0), 0)
                      const completed_quantity = rows.reduce((s, x) => s + (Number(x.completed_quantity) || 0), 0)
                      const outstanding_quantity = rows.reduce((s, x) => s + (Number(x.outstanding_quantity) || 0), 0)
                      const outstanding_payment_quantity = rows.reduce((s, x) => s + (Number(x.outstanding_payment_quantity) || 0), 0)
                      const outstanding_claim_mutu_qty = rows.reduce((s, x) => s + (Number(x.outstanding_claim_mutu_qty) || 0), 0)
                      const outstanding_claim_susut_qty = rows.reduce((s, x) => s + (Number(x.outstanding_claim_susut_qty) || 0), 0)
                      const contract_count = rows.reduce((s, x) => s + (Number(x.contract_count) || 0), 0)
                      return {
                        plant: plantName,
                        rows: rows.slice().sort((a, b) => (Number(b.total_quantity) || 0) - (Number(a.total_quantity) || 0)),
                        summary: {
                          total_quantity,
                          completed_quantity,
                          outstanding_quantity,
                          outstanding_payment_quantity,
                          outstanding_claim_mutu_qty,
                          outstanding_claim_susut_qty,
                          contract_count,
                        },
                      }
                    }).sort((a, b) => b.summary.total_quantity - a.summary.total_quantity)

                    return plants.map((p, index) => {
                      const top = p.rows.slice(0, 3)
                      const other = p.rows.slice(3)
                      const otherTotal = other.reduce(
                        (acc, r) => {
                          acc.total += Number(r.total_quantity) || 0
                          acc.completed += Number(r.completed_quantity) || 0
                          acc.outstanding += Number(r.outstanding_quantity) || 0
                          acc.outstandingPayment += Number(r.outstanding_payment_quantity) || 0
                          return acc
                        },
                        { total: 0, completed: 0, outstanding: 0, outstandingPayment: 0 }
                      )
                      const tones: Array<'default' | 'good' | 'warn' | 'bad'> = ['default', 'good', 'warn', 'bad']
                      const segments = top.map((r, i) => ({
                        label: (r.incoterm || 'Blank').trim() || 'Blank',
                        value: Number(r.total_quantity) || 0,
                        tone: tones[i % tones.length],
                        breakdown: {
                          outstandingDelivery: Number(r.outstanding_quantity) || 0,
                          outstandingPayment: Number(r.outstanding_payment_quantity) || 0,
                          outstandingClaimMutu: Number(r.outstanding_claim_mutu_qty) || 0,
                          outstandingClaimSusut: Number(r.outstanding_claim_susut_qty) || 0,
                          completed: Number(r.completed_quantity) || 0,
                        },
                      }))
                      if (otherTotal.total > 0) {
                        segments.push({
                          label: 'Other',
                          value: otherTotal.total,
                          tone: 'default' as const,
                          breakdown: {
                            outstandingDelivery: otherTotal.outstanding,
                            outstandingPayment: otherTotal.outstandingPayment,
                            outstandingClaimMutu: other.reduce((s, x) => s + (Number(x.outstanding_claim_mutu_qty) || 0), 0),
                            outstandingClaimSusut: other.reduce((s, x) => s + (Number(x.outstanding_claim_susut_qty) || 0), 0),
                            completed: otherTotal.completed,
                          },
                        })
                      }

                      return (
                        <div
                          key={`${p.plant}-${index}`}
                          role="button"
                          tabIndex={0}
                          className="w-full text-left p-3.5 rounded-xl border bg-white hover:bg-gray-50 transition-colors shadow-sm"
                          onClick={() => openPlantContracts({ plant: p.plant, title: `${p.plant} contracts` })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openPlantContracts({ plant: p.plant, title: `${p.plant} contracts` })
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-7 h-7 shrink-0 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5">
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900 truncate" title={formatSapGroupDisplayLabel(p.plant)}>
                                  {formatSapGroupDisplayLabel(p.plant)}
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  {formatNumber(p.summary.contract_count)} contracts
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-2 lg:grid-cols-6 gap-2">
                            <div className="text-[11px]">
                              <span className="text-gray-500">Total:</span>
                              <button
                                type="button"
                                className="font-semibold text-gray-900 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openPlantContracts({ plant: p.plant, title: `${p.plant} — Total quantity` })
                                }}
                              >
                                {formatKg(p.summary.total_quantity)}
                              </button>
                            </div>
                            <div className="text-[11px]">
                              <span className="text-gray-500">Outstanding delivery:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openPlantContracts({ plant: p.plant, title: `${p.plant} — Outstanding delivery`, extraParams: { outstanding: 'true' } })
                                }}
                              >
                                {formatKg(p.summary.outstanding_quantity)}
                              </button>
                            </div>
                            <div className="text-[11px]">
                              <span className="text-gray-500">Outstanding payment:</span>
                              <button
                                type="button"
                                className="font-semibold text-violet-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openPlantContracts({ plant: p.plant, title: `${p.plant} — Outstanding payment`, extraParams: { outstanding: 'true', outstandingPayment: 'true' } })
                                }}
                              >
                                {formatKg(p.summary.outstanding_payment_quantity)}
                              </button>
                            </div>
                            <div className="text-[11px]">
                              <span className="text-gray-500">Outstanding Claim Mutu:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push('/trucking/claim-mutu')
                                }}
                              >
                                {formatKg((p.summary as any).outstanding_claim_mutu_qty || 0)}
                              </button>
                            </div>
                            <div className="text-[11px]">
                              <span className="text-gray-500">Outstanding Claim Susut:</span>
                              <button
                                type="button"
                                className="font-semibold text-orange-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push('/trucking/claim-susut')
                                }}
                              >
                                {formatKg((p.summary as any).outstanding_claim_susut_qty || 0)}
                              </button>
                            </div>
                            <div className="text-[11px] lg:text-right">
                              <span className="text-gray-500">Completed:</span>
                              <button
                                type="button"
                                className="font-semibold text-green-700 ml-1 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openPlantContracts({ plant: p.plant, title: `${p.plant} — Completed`, extraParams: { delivered: 'true' } })
                                }}
                              >
                                {formatKg(p.summary.completed_quantity)}
                              </button>
                            </div>
                          </div>

                          <div className="mt-2">
                            <StackedBar
                              segments={segments}
                              onSegmentClick={(label) => {
                                if (label === 'Other') {
                                  return openPlantContracts({ plant: p.plant, title: `${p.plant} — Other incoterms` })
                                }
                                return openPlantContracts({
                                  plant: p.plant,
                                  title: `${p.plant} — ${label}`,
                                  extraParams: { incoterm: label === 'Blank' ? 'Blank' : label },
                                })
                              }}
                              legendMdCols={3}
                              formatValue={(v) => formatKg(v)}
                            />
                          </div>
                        </div>
                      )
                    })
                  })()
                )}
              </div>
            </CardContent>
          </Card>
          </>
          )}
        </div>

        {!isManagementDashboard && (
        <>
        {/* Top Performers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top 5 Suppliers */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Top 5 Suppliers
                  <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                </CardTitle>
                <CardDescription>By total quantity</CardDescription>
              </div>
              <Users className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {widgetsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : topSuppliers.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  topSuppliers.map((supplier, index) => (
                    <div 
                      key={supplier.supplier} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                      onClick={() => supplier.supplier && fetchSupplierDetails(supplier.supplier)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-medium text-sm">{supplier.supplier}</div>
                          <div className="text-xs text-gray-500">
                            {supplier.contract_count} contracts
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{formatKg(supplier.total_quantity)}</div>
                        <div className="text-xs text-gray-500">
                          {formatRupiah(supplier.total_contract_value || 0)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top 5 Trucking Owners */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Top 5 Trucking Owners
                  <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                </CardTitle>
                <CardDescription>By quantity sent</CardDescription>
              </div>
              <Truck className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {widgetsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : topTruckingOwners.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  topTruckingOwners.map((owner, index) => (
                    <div 
                      key={owner.trucking_owner} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                      onClick={() => owner.trucking_owner && fetchOwnerDetails(owner.trucking_owner)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-medium text-sm">{owner.trucking_owner}</div>
                          <div className="text-xs text-gray-500">
                            {owner.operation_count} operations
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{formatKg(owner.total_quantity_sent || 0)}</div>
                        <div className="text-xs text-gray-500">
                          {owner.avg_gain_loss_percentage && typeof owner.avg_gain_loss_percentage === 'number' ? `${Math.round(owner.avg_gain_loss_percentage)}% GL` : '0% GL'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top 5 Vessels */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Top 5 Vessels
                  <Badge variant="outline" className="text-[10px]">Qty: {quantityUnitLabel}</Badge>
                </CardTitle>
                <CardDescription>By quantity shipped</CardDescription>
              </div>
              <Ship className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {widgetsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : topVessels.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  topVessels.map((vessel, index) => (
                    <div 
                      key={vessel.vessel_name} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                      onClick={() => vessel.vessel_name && fetchVesselDetails(vessel.vessel_name)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-medium text-sm">{vessel.vessel_name}</div>
                          <div className="text-xs text-gray-500">
                            {vessel.shipment_count} shipments
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{formatKg(vessel.total_quantity_sent || 0)}</div>
                        <div className="text-xs text-gray-500">
                          {vessel.delayed_count || 0} delays
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        </>
        )}

        {/* Status Breakdown section removed per latest dashboard requirements */}
      </div>

      {/* Incoterm Details Modal removed (incoterm mix shown per product) */}

      {/* Plant Details Modal */}
      {selectedPlant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-white px-6 py-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold">{selectedPlant.plant_location}</h2>
                <p className="text-sm text-gray-500">{selectedPlant.contract_count} Contracts</p>
              </div>
              <Button variant="ghost" onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Quantity</div>
                <div className="text-xl font-semibold text-blue-600">
                  {formatKg(selectedPlant.total_quantity)}
                </div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Outstanding</div>
                <div className="text-xl font-semibold text-orange-600">
                  {formatNumber(
                    (selectedPlant.total_quantity || 0) - (selectedPlant.total_quantity_delivered || 0),
                  )}{' '}
                  Kg
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Completed</div>
                <div className="text-xl font-semibold text-green-600">
                  {formatKg(selectedPlant.total_quantity_delivered)}
                </div>
              </div>
            </div>

            {/* Contract Details Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold">Contract Details</h3>
              </div>
              <div className="overflow-x-auto">
                {loadingDetails ? (
                  <div className="text-center py-8 text-gray-500">Loading details...</div>
                ) : plantDetails.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No contract details available</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">STO Number</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Quantity Ordered (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Completed (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding (Kg)</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {plantDetails.map((detail, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-left">{detail.contract_id}</td>
                          <td className="px-4 py-3 text-left">{formatSapDisplayValue(detail.sto_number)}</td>
                          <td className="px-4 py-3 text-left">{formatSapDisplayValue(detail.supplier)}</td>
                          <td className="px-4 py-3 text-left">{formatSapDisplayValue(detail.product)}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatNumber(detail.total_quantity)}
                          </td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium">
                            {formatNumber(detail.quantity_delivered)}
                          </td>
                          <td className="px-4 py-3 text-right text-orange-600 font-medium">
                            {formatNumber(
                              (detail.total_quantity || 0) - (detail.quantity_delivered || 0),
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={detail.status === 'COMPLETED' ? 'default' : 'secondary'}>
                              {detail.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Details Modal */}
      {selectedSupplierName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-white px-6 py-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Supplier — {selectedSupplierName}</h2>
              </div>
              <Button variant="ghost" onClick={closeSupplierModal} className="text-gray-500 hover:text-gray-700">✕</Button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold">Contracts</h3>
              </div>
              <div className="overflow-x-auto">
                {loadingSupplierContracts ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : supplierContracts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No contracts found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left">Contract ID</th>
                        <th className="px-4 py-3 text-left">Supplier</th>
                        <th className="px-4 py-3 text-left">Product</th>
                        <th className="px-4 py-3 text-right">Total (Kg)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {supplierContracts.map((c, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{c.contract_id}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.supplier)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.product)}</td>
                          <td className="px-4 py-3 text-right">{formatNumber(c.total_quantity)}</td>
                        </tr>)
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trucking Owner Details Modal */}
      {selectedOwnerName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-5xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-white px-6 py-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Trucking Owner — {selectedOwnerName}</h2>
              </div>
              <Button variant="ghost" onClick={closeOwnerModal} className="text-gray-500 hover:text-gray-700">✕</Button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold">Operations</h3>
              </div>
              <div className="overflow-x-auto">
                {loadingOwnerOps ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : ownerTruckingOps.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No operations found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left">Operation ID</th>
                        <th className="px-4 py-3 text-left">Contract</th>
                        <th className="px-4 py-3 text-left">Supplier</th>
                        <th className="px-4 py-3 text-left">Product</th>
                        <th className="px-4 py-3 text-right">Sent (Kg)</th>
                        <th className="px-4 py-3 text-right">Delivered (Kg)</th>
                        <th className="px-4 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ownerTruckingOps.map((t, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{t.operation_id}</td>
                          <td className="px-4 py-3">{t.contract_number || t.contract_id}</td>
                          <td className="px-4 py-3">{t.supplier}</td>
                          <td className="px-4 py-3">{t.product}</td>
                          <td className="px-4 py-3 text-right">{formatNumber(t.quantity_sent)}</td>
                          <td className="px-4 py-3 text-right">{formatNumber(t.quantity_delivered)}</td>
                          <td className="px-4 py-3 text-center"><Badge>{t.status}</Badge></td>
                        </tr>)
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vessel Details Modal */}
      {selectedVesselName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-5xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-white px-6 py-4 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Vessel — {selectedVesselName}</h2>
              </div>
              <Button variant="ghost" onClick={closeVesselModal} className="text-gray-500 hover:text-gray-700">✕</Button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold">Shipments</h3>
              </div>
              <div className="overflow-x-auto">
                {loadingVesselShipments ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : vesselShipments.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No shipments found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left">STO / Shipment</th>
                        <th className="px-4 py-3 text-left">Supplier</th>
                        <th className="px-4 py-3 text-left">Product</th>
                        <th className="px-4 py-3 text-right">Shipped (Kg)</th>
                        <th className="px-4 py-3 text-right">Delivered (Kg)</th>
                        <th className="px-4 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {vesselShipments.map((s: any, idx: number) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{s.sto_number || s.shipment_id}</td>
                          <td className="px-4 py-3">{s.supplier}</td>
                          <td className="px-4 py-3">{s.product}</td>
                          <td className="px-4 py-3 text-right">{formatNumber(s.total_quantity_shipped || s.quantity_shipped)}</td>
                          <td className="px-4 py-3 text-right">{formatNumber(s.total_quantity_delivered || s.quantity_delivered)}</td>
                          <td className="px-4 py-3 text-center"><Badge>{s.status}</Badge></td>
                        </tr>)
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Universal Shipments Drilldown Modal (Shipment Performance card) */}
      {shipDrilldownTitle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold truncate">{shipDrilldownTitle}</h2>
                {shipDrilldownSubtitle ? (
                  <p className="text-sm text-gray-500 mt-1 truncate">{shipDrilldownSubtitle}</p>
                ) : null}
                <p className="text-sm text-gray-500 mt-1">
                  {loadingShipDrilldown
                    ? 'Loading...'
                    : `${shipDrilldownTotalCount.toLocaleString()} shipments • Page ${shipDrilldownPage}`}
                </p>
              </div>
              <Button variant="ghost" onClick={closeShipmentsDrilldown} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between gap-4">
                <h3 className="font-semibold">Shipment Details</h3>
                <Button variant="outline" size="sm" onClick={() => handleViewDetails('shipments')}>
                  Open in Shipments page
                </Button>
              </div>
              <div className="overflow-x-auto">
                {loadingShipDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : shipDrilldownRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No shipments found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">STO / Op / Shipment</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Vessel</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Port Loading</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Port Discharge</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Due</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Late</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shipDrilldownRows.map((s) => (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            {formatSapDisplayValue(s.sto_number || s.operation_id || s.shipment_id)}
                          </td>
                          <td className="px-4 py-3">{formatSapDisplayValue(s.vessel_name)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(s.port_of_loading)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(s.port_of_discharge)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(s.contract_id)}</td>
                          <td className="px-4 py-3">{formatDate(s.delivery_end_date)}</td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                s.late_indicator === 'Late'
                                  ? 'bg-red-100 text-red-800'
                                  : s.late_indicator === 'On Time'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {formatSapDisplayValue(s.late_indicator)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge>{formatSapDisplayValue(s.status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {!loadingShipDrilldown && shipDrilldownTotalCount > shipDrilldownPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                  <div className="text-xs text-gray-600">
                    Showing{' '}
                    <span className="font-medium text-gray-900">
                      {((shipDrilldownPage - 1) * shipDrilldownPageSize + 1).toLocaleString()}
                    </span>
                    {' '}to{' '}
                    <span className="font-medium text-gray-900">
                      {Math.min(shipDrilldownPage * shipDrilldownPageSize, shipDrilldownTotalCount).toLocaleString()}
                    </span>
                    {' '}of{' '}
                    <span className="font-medium text-gray-900">{shipDrilldownTotalCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={shipDrilldownPage <= 1}
                      onClick={() => {
                        const next = Math.max(1, shipDrilldownPage - 1)
                        setShipDrilldownPage(next)
                        fetchShipmentsDrilldownPage(next, shipDrilldownQuery)
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={shipDrilldownPage >= Math.ceil(shipDrilldownTotalCount / shipDrilldownPageSize)}
                      onClick={() => {
                        const next = Math.min(Math.ceil(shipDrilldownTotalCount / shipDrilldownPageSize), shipDrilldownPage + 1)
                        setShipDrilldownPage(next)
                        fetchShipmentsDrilldownPage(next, shipDrilldownQuery)
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Universal Trucking Drilldown Modal (Trucking Performance card) */}
      {truckDrilldownTitle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold truncate">{truckDrilldownTitle}</h2>
                {truckDrilldownSubtitle ? (
                  <p className="text-sm text-gray-500 mt-1 truncate">{truckDrilldownSubtitle}</p>
                ) : null}
                <p className="text-sm text-gray-500 mt-1">
                  {loadingTruckDrilldown
                    ? 'Loading...'
                    : `${truckDrilldownTotalCount.toLocaleString()} operations • Page ${truckDrilldownPage}`}
                </p>
              </div>
              <Button variant="ghost" onClick={closeTruckingDrilldown} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between gap-4">
                <h3 className="font-semibold">Trucking Operations</h3>
                <Button variant="outline" size="sm" onClick={() => handleViewDetails('trucking')}>
                  Open in Trucking page
                </Button>
              </div>
              <div className="overflow-x-auto">
                {loadingTruckDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : truckDrilldownRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No trucking operations found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Operation ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">STO No</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract Ext No</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Trucking Owner</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Sent (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Delivered (Kg)</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {truckDrilldownRows.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{formatSapDisplayValue(t.operation_id)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.sto_number)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.contract_ext_no)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.location)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.trucking_owner)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.contract_id)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.supplier)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(t.product)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(t.quantity_sent ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(t.quantity_delivered ?? 0)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge>{formatSapDisplayValue(t.status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!loadingTruckDrilldown && truckDrilldownTotalCount > truckDrilldownPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                  <div className="text-xs text-gray-600">
                    Showing{' '}
                    <span className="font-medium text-gray-900">
                      {((truckDrilldownPage - 1) * truckDrilldownPageSize + 1).toLocaleString()}
                    </span>
                    {' '}to{' '}
                    <span className="font-medium text-gray-900">
                      {Math.min(truckDrilldownPage * truckDrilldownPageSize, truckDrilldownTotalCount).toLocaleString()}
                    </span>
                    {' '}of{' '}
                    <span className="font-medium text-gray-900">{truckDrilldownTotalCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={truckDrilldownPage <= 1}
                      onClick={() => {
                        const next = Math.max(1, truckDrilldownPage - 1)
                        setTruckDrilldownPage(next)
                        fetchTruckingDrilldownPage(next, truckDrilldownQuery)
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={truckDrilldownPage >= Math.ceil(truckDrilldownTotalCount / truckDrilldownPageSize)}
                      onClick={() => {
                        const next = Math.min(Math.ceil(truckDrilldownTotalCount / truckDrilldownPageSize), truckDrilldownPage + 1)
                        setTruckDrilldownPage(next)
                        fetchTruckingDrilldownPage(next, truckDrilldownQuery)
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Universal Payments Drilldown Modal (Payment Performance card) */}
      {payDrilldownTitle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold truncate">{payDrilldownTitle}</h2>
                {payDrilldownSubtitle ? (
                  <p className="text-sm text-gray-500 mt-1 truncate">{payDrilldownSubtitle}</p>
                ) : null}
                {paySelectedPlantSite ? (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md inline-block px-2 py-0.5 mt-1">
                    Plant filter: {paySelectedPlantSite}
                  </p>
                ) : null}
                <p className="text-sm text-gray-500 mt-1">
                  {loadingPayDrilldown
                    ? 'Loading...'
                    : `${payDrilldownTotalCount.toLocaleString()} payments • Page ${payDrilldownPage}`}
                </p>
              </div>
              <Button variant="ghost" onClick={closePaymentsDrilldown} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={payDrilldownView === 'details' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPayDrilldownView('details')}
                  >
                    Payment Details
                  </Button>
                  <Button
                    type="button"
                    variant={payDrilldownView === 'vendor-group' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPayDrilldownView('vendor-group')}
                  >
                    By Vendor Group
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleViewDetails('finance')}>
                  Open in Finance page
                </Button>
              </div>
              {!loadingPayDrilldown && paymentPlantSiteSummary.length > 0 && (
                <div className="border-b bg-white px-4 py-3">
                  <p className="text-xs font-medium text-gray-600 mb-1">
                    Total contract value by Plant/Site
                  </p>
                  <p className="text-[10px] text-gray-500 mb-2 leading-snug">
                    LAND → truck discharge (unloading); SEA → vessel discharge port. Similar names (≥60% match) are merged.
                    Based on full filtered payment results.
                  </p>
                  <div className="mb-2 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={paySelectedPlantSite ? 'outline' : 'default'}
                      onClick={async () => {
                        const q = { ...payDrilldownQuery }
                        delete q.plantSite
                        setPaySelectedPlantSite(null)
                        setPayDrilldownQuery(q)
                        setPayDrilldownPage(1)
                        await fetchPaymentsDrilldownPage(1, q)
                      }}
                    >
                      All Plant/Site
                    </Button>
                    {paySelectedPlantSite ? (
                      <span className="text-xs text-gray-500">Filtered: {formatSapGroupDisplayLabel(paySelectedPlantSite)}</span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {paymentPlantSiteSummary.map((s) => (
                      <button
                        key={s.plantSite}
                        type="button"
                        className={`rounded-md border bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 ${paySelectedPlantSite === s.plantSite ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={async () => {
                          const q = { ...payDrilldownQuery, plantSite: s.plantSite }
                          setPaySelectedPlantSite(s.plantSite)
                          setPayDrilldownQuery(q)
                          setPayDrilldownPage(1)
                          await fetchPaymentsDrilldownPage(1, q)
                        }}
                      >
                        <div className="text-[11px] text-gray-500 truncate">{formatSapGroupDisplayLabel(s.plantSite)}</div>
                        <div className="text-sm font-semibold tabular-nums">{money(s.totalContractValue)}</div>
                        <div className="text-[11px] text-gray-500">{formatNumber(s.contracts)} contracts</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                {loadingPayDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : payDrilldownRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No payments found</div>
                ) : payDrilldownView === 'details' ? (
                  <table className="w-full min-w-[1350px] text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Plant/Site</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">STO No</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract Ext No</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Unit Price</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Contract Value</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Invoice No</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Due Date Payment</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">DP Date</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Payoff Date</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">DP Deviation (Days)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Payoff Deviation (Days)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {payDrilldownRows.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{formatSapDisplayValue(p.contract_id)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(p.plant_site)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(p.sto_number)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(p.contract_ext_no)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(p.unit_price ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(p.contract_value ?? 0)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(p.invoice_number)}</td>
                          <td className="px-4 py-3">{formatDate(p.payment_due_date)}</td>
                          <td className="px-4 py-3">{formatDate(p.dp_date)}</td>
                          <td className="px-4 py-3">{formatDate(p.payoff_date)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.dp_date_deviation_days ?? '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.payoff_date_deviation_days ?? '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {money(p.payment_amount ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge>{formatSapDisplayValue(p.payment_status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Vendor Group</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Total Contracts</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Total Contract Value</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Nearest Due Date Payment</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Latest Due Date Payment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {paymentByVendorGroup.map((g) => (
                        <tr key={g.groupName} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{g.groupName}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(g.totalContracts)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(g.totalContractValue)}</td>
                          <td className="px-4 py-3">{formatDate(g.nearestDueDate || undefined)}</td>
                          <td className="px-4 py-3">{formatDate(g.latestDueDate || undefined)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!loadingPayDrilldown && payDrilldownTotalCount > payDrilldownPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                  <div className="text-xs text-gray-600">
                    Showing{' '}
                    <span className="font-medium text-gray-900">
                      {((payDrilldownPage - 1) * payDrilldownPageSize + 1).toLocaleString()}
                    </span>
                    {' '}to{' '}
                    <span className="font-medium text-gray-900">
                      {Math.min(payDrilldownPage * payDrilldownPageSize, payDrilldownTotalCount).toLocaleString()}
                    </span>
                    {' '}of{' '}
                    <span className="font-medium text-gray-900">{payDrilldownTotalCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={payDrilldownPage <= 1}
                      onClick={() => {
                        const next = Math.max(1, payDrilldownPage - 1)
                        setPayDrilldownPage(next)
                        fetchPaymentsDrilldownPage(next, payDrilldownQuery)
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={payDrilldownPage >= Math.ceil(payDrilldownTotalCount / payDrilldownPageSize)}
                      onClick={() => {
                        const next = Math.min(Math.ceil(payDrilldownTotalCount / payDrilldownPageSize), payDrilldownPage + 1)
                        setPayDrilldownPage(next)
                        fetchPaymentsDrilldownPage(next, payDrilldownQuery)
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Universal Contracts Drilldown Modal (for performance cards) */}
      {drilldownTitle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-[96vw] max-w-[96vw] rounded-lg shadow-lg p-4 md:max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold truncate">{drilldownTitle}</h2>
                {drilldownSubtitle ? (
                  <p className="text-sm text-gray-500 mt-1 truncate">{drilldownSubtitle}</p>
                ) : null}
                <p className="text-sm text-gray-500 mt-1">
                  {loadingDrilldown
                    ? 'Loading...'
                    : `${drilldownTotalCount.toLocaleString()} contracts • Page ${drilldownPage}`}
                </p>
              </div>
              <Button variant="ghost" onClick={closeContractsDrilldown} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={drilldownView === 'details' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDrilldownView('details')}
                  >
                    Contract Details
                  </Button>
                  <Button
                    type="button"
                    variant={drilldownView === 'vendor-group' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDrilldownView('vendor-group')}
                  >
                    By Vendor Group
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleViewDetails('contracts')}>
                  Open in Contracts page
                </Button>
              </div>
              <div className="overflow-x-auto">
                {loadingDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : drilldownContracts.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No contracts found</div>
                ) : drilldownView === 'details' ? (
                  <table className={`w-full text-sm ${isManagementDashboard ? 'min-w-[2200px]' : 'min-w-[1400px]'}`}>
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract Ext No</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Vendor Group</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Incoterm</th>
                        {isManagementDashboard && (
                          <>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">Plant/Site</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">Source Type</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">LT/SPOT</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">Total Delay</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">Cargo Readiness Issue</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">Aging O/S</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">Delivery Issue</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">DP Date Deviation (Days)</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">Payoff Date Deviation (Days)</th>
                          </>
                        )}
                        {showOutstandingPaymentColumns && (
                          <>
                            <th className="px-4 py-3 text-right font-medium text-gray-600">Contract Value</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-600">Due Date Payment</th>
                          </>
                        )}
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Qty Ordered (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Delivered (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding (Kg)</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {drilldownContracts.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{c.contract_id}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.contract_ext_no)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.group_name)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.supplier)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.product)}</td>
                          <td className="px-4 py-3">{formatSapDisplayValue(c.incoterm)}</td>
                          {isManagementDashboard && (
                            <>
                              <td className="px-4 py-3">{formatSapDisplayValue(c.plant_site)}</td>
                              <td className="px-4 py-3">{formatSapDisplayValue(c.source_type)}</td>
                              <td className="px-4 py-3">{formatSapDisplayValue(c.lt_spot)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.total_delay ?? '-'}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.cargo_readiness_issue ?? '-'}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.aging_os ?? '-'}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.delivery_issue ?? '-'}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.dp_date_deviation_days ?? '-'}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.payoff_date_deviation_days ?? '-'}</td>
                            </>
                          )}
                          {showOutstandingPaymentColumns && (
                            <>
                              <td className="px-4 py-3 text-right tabular-nums">{money(c.contract_value ?? 0)}</td>
                              <td className="px-4 py-3">{formatDate(c.payment_due_date)}</td>
                            </>
                          )}
                          <td className="px-4 py-3 text-right font-medium tabular-nums">
                            {formatNumber(c.quantity_ordered ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right text-green-700 font-medium tabular-nums">
                            {formatNumber(c.delivered_quantity ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right text-orange-700 font-medium tabular-nums">
                            {formatNumber(c.outstanding_quantity ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800">
                              {formatSapDisplayValue(c.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th
                          className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('groupName')}
                        >
                          <span className="inline-flex items-center gap-1">
                            Vendor Group
                            {vendorGroupSortKey === 'groupName' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('count')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Contracts
                            {vendorGroupSortKey === 'count' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        {showOutstandingPaymentColumns && (
                          <>
                            <th
                              className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                              onClick={() => onVendorGroupHeaderClick('contractValue')}
                            >
                              <span className="inline-flex items-center gap-1 justify-end w-full">
                                Contract Value
                                {vendorGroupSortKey === 'contractValue' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                              </span>
                            </th>
                            <th
                              className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none"
                              onClick={() => onVendorGroupHeaderClick('nearestPaymentDueDate')}
                            >
                              <span className="inline-flex items-center gap-1">
                                Nearest Due Date Payment
                                {vendorGroupSortKey === 'nearestPaymentDueDate' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                              </span>
                            </th>
                          </>
                        )}
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('qtyOrdered')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Qty Ordered (Kg)
                            {vendorGroupSortKey === 'qtyOrdered' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('qtyDelivered')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Delivered (Kg)
                            {vendorGroupSortKey === 'qtyDelivered' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('qtyOutstanding')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Outstanding (Kg)
                            {vendorGroupSortKey === 'qtyOutstanding' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('weightedAvgDeliveryDays')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Weighted Avg Delivery (days)
                            {vendorGroupSortKey === 'weightedAvgDeliveryDays' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('weightedAvgPaymentDays')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Weighted Avg Payment (days)
                            {vendorGroupSortKey === 'weightedAvgPaymentDays' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('openCount')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Open
                            {vendorGroupSortKey === 'openCount' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('closeCount')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Close
                            {vendorGroupSortKey === 'closeCount' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                        <th
                          className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none"
                          onClick={() => onVendorGroupHeaderClick('cancelledCount')}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            Cancelled
                            {vendorGroupSortKey === 'cancelledCount' ? (vendorGroupSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {sortedContractsByVendorGroup.map((g) => (
                        <tr key={g.groupName} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{g.groupName}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Contracts',
                                })
                              }
                              title="Show contracts"
                            >
                              {formatNumber(g.count)}
                            </button>
                          </td>
                          {showOutstandingPaymentColumns && (
                            <>
                              <td className="px-4 py-3 text-right tabular-nums">
                                <button
                                  type="button"
                                  className="w-full text-right hover:underline underline-offset-2"
                                  onClick={() => openVendorGroupContracts({ groupName: g.groupName, titleSuffix: 'Contract Value' })}
                                  title="Show contracts"
                                >
                                  {money(g.contractValue)}
                                </button>
                              </td>
                              <td className="px-4 py-3">{formatDate(g.nearestPaymentDueDate || undefined)}</td>
                            </>
                          )}
                          <td className="px-4 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Qty Ordered (Kg)',
                                })
                              }
                              title="Show contracts"
                            >
                              {formatNumber(g.qtyOrdered)}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-green-700">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Delivered (Kg)',
                                  predicate: (c) => Number(c?.delivered_quantity || 0) > 0,
                                })
                              }
                              title="Show contracts with delivered quantity"
                            >
                              {formatNumber(g.qtyDelivered)}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-orange-700">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Outstanding (Kg)',
                                  predicate: (c) => Number(c?.outstanding_quantity || 0) > 0,
                                })
                              }
                              title="Show contracts with outstanding quantity"
                            >
                              {formatNumber(g.qtyOutstanding)}
                            </button>
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums font-semibold ${durationCycleDaysClass(g.weightedAvgDeliveryDays)}`}>
                            {g.weightedAvgDeliveryDays != null ? formatNumber(Math.round(g.weightedAvgDeliveryDays)) : '-'}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums font-semibold ${durationCycleDaysClass(g.weightedAvgPaymentDays)}`}>
                            {g.weightedAvgPaymentDays != null ? formatNumber(Math.round(g.weightedAvgPaymentDays)) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Open Contracts',
                                  predicate: (c) => String(c?.status || '').toLowerCase() === 'open',
                                })
                              }
                              title="Show open contracts"
                            >
                              {formatNumber(g.openCount)}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Close Contracts',
                                  predicate: (c) => String(c?.status || '').toLowerCase() === 'close',
                                })
                              }
                              title="Show closed contracts"
                            >
                              {formatNumber(g.closeCount)}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <button
                              type="button"
                              className="w-full text-right hover:underline underline-offset-2"
                              onClick={() =>
                                openVendorGroupContractsFromCurrentPage({
                                  groupName: g.groupName,
                                  titleSuffix: 'Cancelled Contracts',
                                  predicate: (c) => String(c?.status || '').toLowerCase() === 'cancelled',
                                })
                              }
                              title="Show cancelled contracts"
                            >
                              {formatNumber(g.cancelledCount)}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {!loadingDrilldown && drilldownTotalCount > drilldownPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                  <div className="text-xs text-gray-600">
                    Showing{' '}
                    <span className="font-medium text-gray-900">
                      {((drilldownPage - 1) * drilldownPageSize + 1).toLocaleString()}
                    </span>
                    {' '}to{' '}
                    <span className="font-medium text-gray-900">
                      {Math.min(drilldownPage * drilldownPageSize, drilldownTotalCount).toLocaleString()}
                    </span>
                    {' '}of{' '}
                    <span className="font-medium text-gray-900">{drilldownTotalCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={drilldownPage <= 1}
                      onClick={() => {
                        const next = Math.max(1, drilldownPage - 1)
                        setDrilldownPage(next)
                        fetchContractsDrilldownPage(next, drilldownQuery)
                      }}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={drilldownPage * drilldownPageSize >= drilldownTotalCount}
                      onClick={() => {
                        const next = drilldownPage + 1
                        setDrilldownPage(next)
                        fetchContractsDrilldownPage(next, drilldownQuery)
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {claimDrilldownKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-[96vw] max-w-[96vw] rounded-lg shadow-lg p-4 md:max-h-[90vh] overflow-y-auto px-6 pb-6">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold truncate">
                  {claimDrilldownKind === 'mutu' ? 'Outstanding Claim Mutu' : 'Outstanding Claim Susut'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Latest import • OS days ≥ 0 • PO exists in contracts
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {loadingClaimDrilldown
                    ? 'Loading...'
                    : `${claimDrilldownTotalCount.toLocaleString()} rows • Page ${claimDrilldownPage}`}
                </p>
              </div>
              <Button variant="ghost" onClick={closeClaimDrilldown} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(claimDrilldownKind === 'mutu' ? '/trucking/claim-mutu' : '/trucking/claim-susut')
                  }
                >
                  Open full Claim {claimDrilldownKind === 'mutu' ? 'Mutu' : 'Susut'} page
                </Button>
              </div>
              <div className="overflow-x-auto">
                {loadingClaimDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : claimDrilldownRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No rows found</div>
                ) : claimDrilldownKind === 'mutu' ? (
                  <table className="w-full text-sm min-w-[1100px]">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">PO</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ext</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Vendor</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Qty claim (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Amount IDR (after tax)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">OS days</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">CR date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {claimDrilldownRows.map((r) => (
                        <tr key={String(r.id)} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{String(r.po_number ?? '-')}</td>
                          <td className="px-4 py-3">{String(r.contract_ext_no ?? '-')}</td>
                          <td className="px-4 py-3">{String(r.vendor_name ?? '-')}</td>
                          <td className="px-4 py-3">{String(r.product ?? '-')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(r.qty_claim_kg as number)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-teal-800 font-medium">
                            {formatRupiah(r.amount_after_tax_idr)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.os_days != null ? String(r.os_days) : '-'}</td>
                          <td className="px-4 py-3">{formatDate(String(r.cr_date ?? ''))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm min-w-[1100px]">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">PO</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ext</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Vendor</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Commodity</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Qty claim</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Amount IDR (after tax)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">OS days</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">CR date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {claimDrilldownRows.map((r) => (
                        <tr key={String(r.id)} className="hover:bg-gray-50">
                          <td className="px-4 py-3">{String(r.po_number ?? '-')}</td>
                          <td className="px-4 py-3">{String(r.contract_ext_no ?? '-')}</td>
                          <td className="px-4 py-3">{String(r.vendor_name ?? '-')}</td>
                          <td className="px-4 py-3">{String(r.commodity ?? '-')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(r.qty_claim as number)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-rose-800 font-medium">
                            {formatRupiah(r.amount_after_tax_idr)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.os_days != null ? String(r.os_days) : '-'}</td>
                          <td className="px-4 py-3">{formatDate(String(r.cr_date ?? ''))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!loadingClaimDrilldown && claimDrilldownTotalCount > claimDrilldownPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                  <div className="text-xs text-gray-600">
                    Showing{' '}
                    <span className="font-medium text-gray-900">
                      {((claimDrilldownPage - 1) * claimDrilldownPageSize + 1).toLocaleString()}
                    </span>
                    {' '}to{' '}
                    <span className="font-medium text-gray-900">
                      {Math.min(claimDrilldownPage * claimDrilldownPageSize, claimDrilldownTotalCount).toLocaleString()}
                    </span>
                    {' '}of{' '}
                    <span className="font-medium text-gray-900">{claimDrilldownTotalCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={claimDrilldownPage <= 1}
                      onClick={() => {
                        const next = Math.max(1, claimDrilldownPage - 1)
                        setClaimDrilldownPage(next)
                        fetchClaimDrilldownPage(next, claimDrilldownKind)
                      }}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={claimDrilldownPage * claimDrilldownPageSize >= claimDrilldownTotalCount}
                      onClick={() => {
                        const next = claimDrilldownPage + 1
                        setClaimDrilldownPage(next)
                        fetchClaimDrilldownPage(next, claimDrilldownKind)
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

