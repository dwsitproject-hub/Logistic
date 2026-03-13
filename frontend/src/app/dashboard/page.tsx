'use client'

import { useEffect, useRef, useState } from 'react'
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
  FileText, 
  Truck,
  Eye,
  Users,
  Ship,
  BarChart3,
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

interface DashboardStats {
  contracts: {
    total: number
    active: number
    closed: number
    completed: number
    cancelled: number
    outstanding: number
    totalQuantity: number
    deliveredQuantity: number
    outstandingQuantity: number
    deliveredPaidQuantity: number
    deliveredPendingQuantity: number
    outstandingPaidQuantity: number
    outstandingPendingQuantity: number
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
  avg_unit_price: number
  total_contract_value: number
  supplier_count: number
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
  product?: string
  quantity_ordered?: number
  unit?: string
  incoterm?: string
  loading_site?: string
  unloading_site?: string
  contract_date?: string
  delivery_start_date?: string
  delivery_end_date?: string
  contract_value?: number
  currency?: string
  status?: string
  delivered_quantity?: number
  outstanding_quantity?: number
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

export default function DashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    contracts: {
      total: 0,
      active: 0,
      closed: 0,
      completed: 0,
      cancelled: 0,
      outstanding: 0,
      totalQuantity: 0,
      deliveredQuantity: 0,
      outstandingQuantity: 0,
      deliveredPaidQuantity: 0,
      deliveredPendingQuantity: 0,
      outstandingPaidQuantity: 0,
      outstandingPendingQuantity: 0
    },
    shipments: { total: 0, planned: 0, inProgress: 0, loading: 0, inTransit: 0, arrived: 0, unloading: 0, completed: 0, cancelled: 0, late: 0 },
    trucking: { total: 0, planned: 0, inProgress: 0, loading: 0, inTransit: 0, unloading: 0, completed: 0, cancelled: 0, late: 0 },
    finance: { total: 0, pending: 0, paid: 0, overdue: 0, totalAmount: 0, pendingAmount: 0, paidAmount: 0, overdueAmount: 0, revenue: 0 }
  })
  const [topSuppliers, setTopSuppliers] = useState<TopPerformer[]>([])
  const [topTruckingOwners, setTopTruckingOwners] = useState<TopPerformer[]>([])
  const [topVessels, setTopVessels] = useState<TopPerformer[]>([])
  const [productIncotermRows, setProductIncotermRows] = useState<ProductIncotermRow[]>([])
  const [plantQuantities, setPlantQuantities] = useState<PlantQuantity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlant, setSelectedPlant] = useState<PlantQuantity | null>(null)
  const [plantDetails, setPlantDetails] = useState<PlantContractDetail[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductQuantity | null>(null)
  const [productDetails, setProductDetails] = useState<PlantContractDetail[]>([])
  const [loadingProductDetails, setLoadingProductDetails] = useState(false)
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
  
  // Filter states
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedPlantFilter, setSelectedPlantFilter] = useState<string[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<string[]>([])
  const [availablePlants, setAvailablePlants] = useState<string[]>([])
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([])
  const [selectedProductFilter, setSelectedProductFilter] = useState<string[]>([])
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [availableGroups, setAvailableGroups] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiInsight, setAiInsight] = useState<DashboardAiInsight | null>(null)
  const [loadingAiInsight, setLoadingAiInsight] = useState(false)
  const [aiInsightError, setAiInsightError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboardData()
    fetchAiInsight(false)
    fetchFilterOptions()
  }, [])

  useEffect(() => {
    fetchDashboardData()
    fetchAiInsight(false)
  }, [dateFrom, dateTo, selectedPlantFilter, selectedSupplier, selectedProductFilter, selectedGroupFilter])

  const fetchDashboardData = async () => {
    setLoading(true)
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

      // 1) Always fetch stats first so cards update even if a widget fails
      const statsRes = await api.get(`/dashboard/stats${urlSuffix}`)
      setStats(statsRes.data.data)

      // 2) Fetch the rest in parallel, but don't block stats if one fails
      try {
        const widgetResults = await Promise.allSettled([
          api.get(`/dashboard/top-suppliers${urlSuffix}`),
          api.get(`/dashboard/top-trucking-owners${urlSuffix}`),
          api.get(`/dashboard/top-vessels${urlSuffix}`),
          api.get(`/dashboard/contract-quantity-by-product-incoterm${urlSuffix}`),
          api.get(`/dashboard/contract-quantity-by-plant${urlSuffix}`),
          // keep slot for potential future widget
          Promise.resolve({ data: { data: [] } })
        ])

        const [
          suppliersRes,
          truckingRes,
          vesselsRes,
          prodIncotermRes,
          plantRes,
          _unused
        ] = widgetResults

        if (suppliersRes.status === 'fulfilled') {
          setTopSuppliers(suppliersRes.value.data.data)
        }
        if (truckingRes.status === 'fulfilled') {
          setTopTruckingOwners(truckingRes.value.data.data)
        }
        if (vesselsRes.status === 'fulfilled') {
          setTopVessels(vesselsRes.value.data.data)
        }
        if (prodIncotermRes.status === 'fulfilled') {
          setProductIncotermRows(prodIncotermRes.value.data.data)
        }
        if (plantRes.status === 'fulfilled') {
          setPlantQuantities(plantRes.value.data.data)
        }
        // Incoterm-only widget removed (now integrated into Product breakdown)

        const rejected = widgetResults.filter(r => r.status === 'rejected')
        if (rejected.length > 0) {
          console.error('Some dashboard widgets failed to load', rejected)
        }
      } catch (err) {
        console.error('Failed to fetch some dashboard widgets:', err)
      }
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fetchFilterOptions = async () => {
    try {
      const [plantsRes, suppliersRes, productsRes, groupsRes] = await Promise.all([
        api.get('/dashboard/filter-options/plants'),
        api.get('/dashboard/filter-options/suppliers'),
        api.get('/dashboard/filter-options/products'),
        api.get('/dashboard/filter-options/groups')
      ])
      setAvailablePlants(plantsRes.data.data)
      setAvailableSuppliers(suppliersRes.data.data)
      setAvailableProducts(productsRes.data.data)
      setAvailableGroups(groupsRes.data.data)
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
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      useGrouping: true,
    })
  }

  const formatRupiah = (v: unknown) => {
    const n = parseNumberLoose(v) ?? 0
    // Display-only: keep decimals as per formatNumber()
    return `Rp. ${formatNumber(n)}`
  }

  const formatKg = (mt: unknown) => {
    const n = parseNumberLoose(mt)
    if (n === null) return '-'
    return `${formatNumber(n)} Kg`
  }

  const formatDate = (dateStr?: string) => {
    const s = (dateStr || '').trim()
    if (!s) return '-'
    const t = Date.parse(s)
    if (Number.isNaN(t)) return s
    return new Date(t).toLocaleDateString()
  }

  const pct = (num: number, den: number) => {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0
    return Math.round((num / den) * 1000) / 10 // 1 decimal
  }

  const pctText = (num: number, den: number) => {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return '0%'
    const raw = (num / den) * 100
    if (!Number.isFinite(raw) || raw <= 0) return '0%'
    if (raw < 0.1) return '<0.1%'
    return `${pct(num, den)}%`
  }

  const money = (v: number) => formatRupiah(v)

  const KpiTile = ({
    label,
    value,
    sublabel,
    tone = 'default',
    onClick,
  }: {
    label: string
    value: string
    sublabel?: string
    tone?: 'default' | 'good' | 'warn' | 'bad'
    onClick?: () => void
  }) => {
    const toneClass =
      tone === 'good'
        ? 'text-green-700'
        : tone === 'warn'
          ? 'text-yellow-700'
          : tone === 'bad'
            ? 'text-red-700'
            : 'text-gray-900'

    const body = (
      <div className="rounded-lg border bg-white px-3 py-2 hover:bg-gray-50 transition-colors min-w-0 overflow-hidden">
        <div className="text-[11px] text-gray-500 truncate">{label}</div>
        <div className={`text-lg font-semibold leading-tight ${toneClass} tabular-nums truncate`}>{value}</div>
        {sublabel ? <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sublabel}</div> : null}
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
    segments: Array<{ label: string; value: number; tone?: 'good' | 'warn' | 'bad' | 'default' }>
    onSegmentClick?: (label: string) => void
    legendMdCols?: 3 | 4
    formatValue?: (v: number) => string
  }) => {
    const total = segments.reduce((s, x) => s + (Number.isFinite(x.value) ? x.value : 0), 0)
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
              const common = {
                key: seg.label,
                className: `${color(seg.tone)} ${clickable ? 'cursor-pointer hover:opacity-90' : ''} border-r border-white/60 last:border-r-0`,
                style: { width: `${w}%` },
                title: `${seg.label}: ${(formatValue ? formatValue(v) : formatNumber(v))} (${pctText(v, total)})`,
              } as const
              return clickable ? (
                <button
                  type="button"
                  {...common}
                  onClick={() => onSegmentClick(seg.label)}
                  aria-label={`Filter: ${seg.label}`}
                />
              ) : (
                <div {...common} />
              )
            })}
          </div>
        </div>

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
                  <span className="text-[11px] text-gray-600 leading-snug break-words">{seg.label}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2 min-w-0">
                  <span className="text-[11px] font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                    {formatValue ? formatValue(v) : formatNumber(v)}
                  </span>
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
    const q: Record<string, string> = { ...(opts.extraParams || {}) }
    setDrilldownQuery(q)
    setDrilldownPage(1)
    await fetchContractsDrilldownPage(1, q)
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
  }

  const closeContractsDrilldown = () => {
    setDrilldownTitle(null)
    setDrilldownSubtitle('')
    setDrilldownContracts([])
    setDrilldownTotalCount(0)
    setDrilldownPage(1)
    setDrilldownQuery({})
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

  const fetchProductDetails = async (product: ProductQuantity) => {
    setSelectedProduct(product)
    setLoadingProductDetails(true)
    try {
      const filterSuffix = buildFilterQuery()
      const base = `/dashboard/product-details?product=${encodeURIComponent(product.product)}`
      const sep = filterSuffix ? '&' : ''
      const response = await api.get(`${base}${sep}${filterSuffix.replace('?', '')}`)
      setProductDetails(response.data.data)
    } catch (error) {
      console.error('Failed to fetch product details:', error)
      alert('Failed to load product details')
    } finally {
      setLoadingProductDetails(false)
    }
  }

  const closeProductModal = () => {
    setSelectedProduct(null)
    setProductDetails([])
  }

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
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-2">
              Welcome to KPN Logistics Intelligence Platform
            </p>
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

        {/* AI Logistics Insight */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <div>
                <CardTitle className="text-lg">AI Logistics Insight</CardTitle>
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
        {!loading && stats.contracts.total === 0 && stats.shipments.total === 0 && stats.trucking.total === 0 && stats.finance.total === 0 && (dateFrom || dateTo || selectedPlantFilter.length > 0 || selectedSupplier.length > 0 || selectedProductFilter.length > 0 || selectedGroupFilter.length > 0) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800">
              No data matches your current filters. Try clearing filters to see all data.
            </p>
            <Button variant="outline" size="sm" onClick={clearFilters} className="shrink-0">
              Clear Filters
            </Button>
          </div>
        )}

        {/* Performance Cards (management-friendly) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contract Performance */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Contract Performance</CardTitle>
                  <CardDescription>Health and closure progress</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-blue-100">
                    <FileText className="h-4 w-4 text-blue-600" />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleViewDetails('contracts')}>
                    View
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <KpiTile
                  label="Total contracts"
                  value={loading ? '...' : formatNumber(stats.contracts.total)}
                  sublabel="All statuses"
                onClick={() => openContractsDrilldown({ title: 'All contracts' })}
                />
                <KpiTile
                  label="Closure rate"
                  value={loading ? '...' : `${pct(stats.contracts.closed, stats.contracts.total)}%`}
                  sublabel={`${loading ? '...' : formatNumber(stats.contracts.closed)} closed`}
                onClick={() => openContractsDrilldown({ title: 'Closed contracts', extraParams: { contractStatus: 'Close' } })}
                />
                <KpiTile
                  label="Open / outstanding"
                  value={loading ? '...' : formatNumber(stats.contracts.outstanding)}
                  sublabel={`${loading ? '...' : pct(stats.contracts.outstanding, stats.contracts.total)}% of total`}
                  tone="good"
                onClick={() => openContractsDrilldown({ title: 'Open contracts', extraParams: { contractStatus: 'Open' } })}
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Open', value: loading ? 0 : stats.contracts.outstanding, tone: 'good' },
                  { label: 'Close', value: loading ? 0 : stats.contracts.closed, tone: 'default' },
                  { label: 'Cancelled', value: loading ? 0 : stats.contracts.cancelled, tone: 'bad' },
                ]}
                onSegmentClick={(label) => {
                  if (label === 'Open') return openContractsDrilldown({ title: 'Open contracts', extraParams: { contractStatus: 'Open' } })
                  if (label === 'Close') return openContractsDrilldown({ title: 'Closed contracts', extraParams: { contractStatus: 'Close' } })
                  if (label === 'Cancelled') return openContractsDrilldown({ title: 'Cancelled contracts', extraParams: { contractStatus: 'Cancelled' } })
                  return openContractsDrilldown({ title: 'All contracts' })
                }}
              />
            </CardContent>
          </Card>

          {/* Shipment Performance */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Shipment Performance</CardTitle>
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
                  value={loading ? '...' : formatNumber(stats.shipments.total)}
                  sublabel="All shipments"
                  onClick={() => openShipmentsDrilldown({ title: 'All shipments' })}
                />
                <KpiTile
                  label="Completion rate"
                  value={loading ? '...' : `${pct(stats.shipments.completed, stats.shipments.total)}%`}
                  sublabel={`${loading ? '...' : formatNumber(stats.shipments.completed)} completed`}
                  tone="good"
                  onClick={() => openShipmentsDrilldown({ title: 'Completed shipments', extraParams: { status: 'COMPLETED' } })}
                />
                <KpiTile
                  label="Late / delayed rate"
                  value={loading ? '...' : `${pct(stats.shipments.late, stats.shipments.total)}%`}
                  sublabel={`${loading ? '...' : formatNumber(stats.shipments.late)} shipments`}
                  tone="bad"
                  onClick={() => openShipmentsDrilldown({ title: 'Late shipments', extraParams: { delayed: 'true' } })}
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Planned', value: loading ? 0 : stats.shipments.planned, tone: 'default' },
                  { label: 'Loading', value: loading ? 0 : stats.shipments.loading, tone: 'warn' },
                  { label: 'In transit', value: loading ? 0 : stats.shipments.inTransit, tone: 'default' },
                  { label: 'Arrived', value: loading ? 0 : stats.shipments.arrived, tone: 'default' },
                  { label: 'Unloading', value: loading ? 0 : stats.shipments.unloading, tone: 'warn' },
                  { label: 'Completed', value: loading ? 0 : stats.shipments.completed, tone: 'good' },
                  { label: 'Cancelled', value: loading ? 0 : stats.shipments.cancelled, tone: 'bad' },
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
                  <CardTitle className="text-base">Trucking Performance</CardTitle>
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
                  value={loading ? '...' : formatNumber(stats.trucking.total)}
                  sublabel="All trucking operations"
                  onClick={() => openTruckingDrilldown({ title: 'All trucking operations' })}
                />
                <KpiTile
                  label="Completion rate"
                  value={loading ? '...' : `${pct(stats.trucking.completed, stats.trucking.total)}%`}
                  sublabel={`${loading ? '...' : formatNumber(stats.trucking.completed)} completed`}
                  tone="good"
                  onClick={() => openTruckingDrilldown({ title: 'Completed trucking operations', extraParams: { status: 'COMPLETED' } })}
                />
                <KpiTile
                  label="Late rate"
                  value={loading ? '...' : `${pct(stats.trucking.late, stats.trucking.total)}%`}
                  sublabel={`${loading ? '...' : formatNumber(stats.trucking.late)} ops`}
                  tone="bad"
                  onClick={() => openTruckingDrilldown({ title: 'Late trucking operations', extraParams: { status: 'LATE' } })}
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Planned', value: loading ? 0 : stats.trucking.planned, tone: 'default' },
                  { label: 'Loading', value: loading ? 0 : stats.trucking.loading, tone: 'warn' },
                  { label: 'In transit', value: loading ? 0 : stats.trucking.inTransit, tone: 'default' },
                  { label: 'Unloading', value: loading ? 0 : stats.trucking.unloading, tone: 'warn' },
                  { label: 'Completed', value: loading ? 0 : stats.trucking.completed, tone: 'good' },
                  { label: 'Cancelled', value: loading ? 0 : stats.trucking.cancelled, tone: 'bad' },
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
                  <CardTitle className="text-base">Payment Performance</CardTitle>
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
                  value={loading ? '...' : money(stats.finance.totalAmount)}
                  sublabel="All payments"
                  onClick={() => openPaymentsDrilldown({ title: 'All payments' })}
                />
                <KpiTile
                  label="Paid rate"
                  value={loading ? '...' : `${pct(stats.finance.paidAmount, stats.finance.totalAmount)}%`}
                  sublabel={loading ? '...' : money(stats.finance.paidAmount)}
                  tone="good"
                  onClick={() => openPaymentsDrilldown({ title: 'Paid payments', extraParams: { status: 'PAID' } })}
                />
                <KpiTile
                  label="Overdue rate"
                  value={loading ? '...' : `${pct(stats.finance.overdueAmount, stats.finance.totalAmount)}%`}
                  sublabel={loading ? '...' : money(stats.finance.overdueAmount)}
                  tone="bad"
                  onClick={() => openPaymentsDrilldown({ title: 'Overdue payments', extraParams: { status: 'OVERDUE' } })}
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Paid', value: loading ? 0 : stats.finance.paidAmount, tone: 'good' },
                  { label: 'Pending payment', value: loading ? 0 : stats.finance.pendingAmount, tone: 'warn' },
                  { label: 'Overdue payment', value: loading ? 0 : stats.finance.overdueAmount, tone: 'bad' },
                ]}
                legendMdCols={3}
                formatValue={money}
                onSegmentClick={(label) => {
                  const map: Record<string, string> = {
                    Paid: 'PAID',
                    'Pending payment': 'PENDING',
                    'Overdue payment': 'OVERDUE',
                  }
                  const status = map[label]
                  return openPaymentsDrilldown({ title: `${label}`, extraParams: { status } })
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Quantity Performance */}
        <div className="grid grid-cols-1 gap-6">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Quantity Performance</CardTitle>
                  <CardDescription>Delivered vs outstanding across contracts</CardDescription>
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
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <KpiTile label="Total quantity" value={loading ? '...' : formatKg(stats.contracts.totalQuantity)} sublabel="Ordered" onClick={() => openContractsDrilldown({ title: 'All contracts (quantity basis)' })} />
                <KpiTile
                  label="Delivered"
                  value={loading ? '...' : formatKg(stats.contracts.deliveredQuantity)}
                  sublabel={
                    loading
                      ? '...'
                      : `Paid ${formatKg(stats.contracts.deliveredPaidQuantity)} • Pending ${formatKg(stats.contracts.deliveredPendingQuantity)}`
                  }
                  tone="good"
                  onClick={() =>
                    openContractsDrilldown({
                      title: 'Contracts with delivered quantity',
                      extraParams: { delivered: 'true' }
                    })
                  }
                />
                <KpiTile
                  label="Outstanding"
                  value={loading ? '...' : formatKg(stats.contracts.outstandingQuantity)}
                  sublabel={
                    loading
                      ? '...'
                      : `Paid ${formatKg(stats.contracts.outstandingPaidQuantity)} • Pending ${formatKg(stats.contracts.outstandingPendingQuantity)}`
                  }
                  tone="warn"
                  onClick={() =>
                    openContractsDrilldown({
                      title: 'Contracts with outstanding quantity',
                      extraParams: { outstanding: 'true' }
                    })
                  }
                />
              </div>

              <StackedBar
                segments={[
                  { label: 'Delivered', value: loading ? 0 : stats.contracts.deliveredQuantity, tone: 'good' },
                  { label: 'Outstanding', value: loading ? 0 : stats.contracts.outstandingQuantity, tone: 'warn' },
                ]}
                onSegmentClick={(label) => {
                  if (label === 'Delivered') return openContractsDrilldown({ title: 'Contracts with delivered quantity', extraParams: { delivered: 'true' } })
                  if (label === 'Outstanding') return openContractsDrilldown({ title: 'Contracts with outstanding quantity', extraParams: { outstanding: 'true' } })
                  return openContractsDrilldown({ title: 'All contracts (quantity basis)' })
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* New Dashboard Widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contract Quantity by Product Materials */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
              <CardTitle className="text-lg">Contract Quantity by Product (Incoterm mix)</CardTitle>
              <CardDescription>Top products with incoterm distribution</CardDescription>
              </div>
              <Layers className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
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
                          avg_unit_price: total_quantity > 0 ? total_contract_value / total_quantity : 0,
                          total_contract_value
                        } satisfies ProductQuantity
                      }
                    }).sort((a, b) => b.summary.total_quantity - a.summary.total_quantity)

                    const tones: Array<'default' | 'good' | 'warn' | 'bad'> = ['default', 'good', 'warn', 'bad']

                    return products.map((p, index) => {
                      const top = p.rows.slice(0, 4)
                      const otherValue = p.rows.slice(4).reduce((s, x) => s + (Number(x.total_quantity) || 0), 0)
                      const segments = [
                        ...top.map((r, i) => ({ label: r.incoterm || 'Blank', value: Number(r.total_quantity) || 0, tone: tones[i % tones.length] })),
                        ...(otherValue > 0 ? [{ label: 'Other', value: otherValue, tone: 'default' as const }] : []),
                      ]

                      return (
                        <button
                          key={p.product}
                          type="button"
                          className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                          onClick={() => fetchProductDetails(p.summary)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5">
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{p.product}</div>
                                <div className="text-xs text-gray-500">
                                  {p.summary.contract_count} contracts • {p.summary.supplier_count} suppliers
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-semibold text-sm">{formatRupiah(p.summary.total_contract_value)}</div>
                              <div className="text-xs text-gray-500">Total Amount</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-200">
                            <div className="text-xs">
                              <span className="text-gray-500">Total:</span>
                              <span className="font-semibold text-gray-900 ml-1">{formatKg(p.summary.total_quantity)}</span>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Outstanding:</span>
                              <span className="font-semibold text-orange-700 ml-1">{formatKg(p.summary.outstanding_quantity)}</span>
                            </div>
                            <div className="text-xs">
                              <span className="text-gray-500">Completed:</span>
                              <span className="font-semibold text-green-700 ml-1">{formatKg(p.summary.completed_quantity)}</span>
                            </div>
                          </div>

                          <div className="mt-2">
                            <StackedBar
                              segments={segments}
                              onSegmentClick={(label) => {
                                if (label === 'Other') {
                                  return openContractsDrilldown({
                                    title: `${p.product} — Other incoterms`,
                                    extraParams: { product: p.product },
                                  })
                                }
                                return openContractsDrilldown({
                                  title: `${p.product} — ${label}`,
                                  extraParams: { product: p.product, incoterm: label === 'Blank' ? 'Blank' : label },
                                })
                              }}
                              legendMdCols={3}
                              formatValue={(v) => formatKg(v)}
                            />
                          </div>
                        </button>
                      )
                    })
                  })()
                )}
              </div>
            </CardContent>
          </Card>

          {/* Incoterm mix is now integrated into Product card */}

          {/* Contract Quantity by Plant/Site */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Contract Quantity by Plant/Site</CardTitle>
                <CardDescription>Total, outstanding, and delivered quantity per plant/site</CardDescription>
              </div>
              <MapPin className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : plantQuantities.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  plantQuantities.map((plant, index) => (
                    <button
                      key={`${plant.plant_location}-${index}`}
                      type="button"
                      className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => fetchPlantDetails(plant)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-semibold">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{plant.plant_location}</div>
                            <div className="text-xs text-gray-500">
                              {plant.contract_count} contracts
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-sm">
                            {formatRupiah(plant.total_contract_value)}
                          </div>
                          <div className="text-xs text-gray-500">Total Amount</div>
                        </div>
                      </div>
                      {/* Quantity Breakdown - mirror product widget style */}
                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs">
                          <span className="text-gray-500">Total:</span>
                          <span className="font-semibold text-gray-900 ml-1">
                            {formatKg(plant.total_quantity)}
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Outstanding:</span>
                          <span className="font-semibold text-green-600 ml-1">
                            {formatKg((plant.total_quantity || 0) - (plant.total_quantity_delivered || 0))}
                          </span>
                        </div>
                        <div className="text-xs text-right">
                          <span className="text-gray-500">Completed:</span>
                          <span className="font-semibold text-blue-600 ml-1">
                            {formatKg(plant.total_quantity_delivered)}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Performers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top 5 Suppliers */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Top 5 Suppliers</CardTitle>
                <CardDescription>By total quantity</CardDescription>
              </div>
              <Users className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
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
                <CardTitle className="text-lg">Top 5 Trucking Owners</CardTitle>
                <CardDescription>By quantity sent</CardDescription>
              </div>
              <Truck className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
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
                          {owner.avg_gain_loss_percentage && typeof owner.avg_gain_loss_percentage === 'number' ? `${owner.avg_gain_loss_percentage.toFixed(1)}% GL` : '0% GL'}
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
                <CardTitle className="text-lg">Top 5 Vessels</CardTitle>
                <CardDescription>By quantity shipped</CardDescription>
              </div>
              <Ship className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
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

        {/* Status Breakdown section removed per latest dashboard requirements */}
      </div>

      {/* Product Details Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">{selectedProduct.product}</h2>
                <p className="text-sm text-gray-500">
                  {selectedProduct.contract_count} Contracts • {selectedProduct.supplier_count} Suppliers
                </p>
              </div>
              <Button variant="ghost" onClick={closeProductModal} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Quantity</div>
                <div className="text-xl font-semibold text-blue-600">
                  {formatKg(selectedProduct.total_quantity)}
                </div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Outstanding</div>
                <div className="text-xl font-semibold text-orange-600">
                  {formatKg(selectedProduct.outstanding_quantity)}
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Completed</div>
                <div className="text-xl font-semibold text-green-600">
                  {formatKg(selectedProduct.completed_quantity)}
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Value</div>
                <div className="text-xl font-semibold text-purple-600">
                  {formatRupiah(selectedProduct.total_contract_value)}
                </div>
              </div>
            </div>

            {/* Contract Details Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold">Contract Details</h3>
              </div>
              <div className="overflow-x-auto">
                {loadingProductDetails ? (
                  <div className="text-center py-8 text-gray-500">Loading details...</div>
                ) : productDetails.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No contract details available</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">STO Number</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Quantity Ordered (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Completed (Kg)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding (Kg)</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {productDetails.map((detail, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-left">{detail.contract_id}</td>
                          <td className="px-4 py-3 text-left">{detail.sto_number || '-'}</td>
                          <td className="px-4 py-3 text-left">{detail.supplier}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatNumber(parseNumberLoose(detail.total_quantity) ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium">
                            {formatNumber(parseNumberLoose(detail.quantity_delivered) ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right text-orange-600 font-medium">
                            {formatNumber(parseNumberLoose(detail.quantity_shipped) ?? 0)}
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

      {/* Incoterm Details Modal removed (incoterm mix shown per product) */}

      {/* Plant Details Modal */}
      {selectedPlant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
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
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Value</div>
                <div className="text-xl font-semibold text-purple-600">
                  {formatRupiah(selectedPlant.total_contract_value)}
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
                          <td className="px-4 py-3 text-left">{detail.sto_number || '-'}</td>
                          <td className="px-4 py-3 text-left">{detail.supplier}</td>
                          <td className="px-4 py-3 text-left">{detail.product}</td>
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
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
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
                          <td className="px-4 py-3">{c.supplier}</td>
                          <td className="px-4 py-3">{c.product}</td>
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
          <div className="bg-white w-full max-w-5xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
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
          <div className="bg-white w-full max-w-5xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
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
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
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
                            {s.sto_number || s.operation_id || s.shipment_id || '-'}
                          </td>
                          <td className="px-4 py-3">{s.vessel_name || '-'}</td>
                          <td className="px-4 py-3">{s.port_of_loading || '-'}</td>
                          <td className="px-4 py-3">{s.port_of_discharge || '-'}</td>
                          <td className="px-4 py-3">{s.contract_id || '-'}</td>
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
                              {s.late_indicator || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge>{s.status || '-'}</Badge>
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
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
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
                          <td className="px-4 py-3">{t.operation_id || '-'}</td>
                          <td className="px-4 py-3">{t.sto_number || '-'}</td>
                          <td className="px-4 py-3">{t.contract_ext_no || '-'}</td>
                          <td className="px-4 py-3">{t.location || '-'}</td>
                          <td className="px-4 py-3">{t.trucking_owner || '-'}</td>
                          <td className="px-4 py-3">{t.contract_id || '-'}</td>
                          <td className="px-4 py-3">{t.supplier || '-'}</td>
                          <td className="px-4 py-3">{t.product || '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(t.quantity_sent ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(t.quantity_delivered ?? 0)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge>{t.status || '-'}</Badge>
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
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold truncate">{payDrilldownTitle}</h2>
                {payDrilldownSubtitle ? (
                  <p className="text-sm text-gray-500 mt-1 truncate">{payDrilldownSubtitle}</p>
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
                <h3 className="font-semibold">Payments</h3>
                <Button variant="outline" size="sm" onClick={() => handleViewDetails('finance')}>
                  Open in Finance page
                </Button>
              </div>
              <div className="overflow-x-auto">
                {loadingPayDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : payDrilldownRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No payments found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract</th>
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
                          <td className="px-4 py-3">{p.contract_id || '-'}</td>
                          <td className="px-4 py-3">{p.sto_number || '-'}</td>
                          <td className="px-4 py-3">{p.contract_ext_no || '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(p.unit_price ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(p.contract_value ?? 0)}</td>
                          <td className="px-4 py-3">{p.invoice_number || '-'}</td>
                          <td className="px-4 py-3">{formatDate(p.payment_due_date)}</td>
                          <td className="px-4 py-3">{formatDate(p.dp_date)}</td>
                          <td className="px-4 py-3">{formatDate(p.payoff_date)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.dp_date_deviation_days ?? '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.payoff_date_deviation_days ?? '-'}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {money(p.payment_amount ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge>{p.payment_status || '-'}</Badge>
                          </td>
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
          <div className="bg-white w-full max-w-5xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
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
                <h3 className="font-semibold">Contract Details</h3>
                <Button variant="outline" size="sm" onClick={() => handleViewDetails('contracts')}>
                  Open in Contracts page
                </Button>
              </div>
              <div className="overflow-x-auto">
                {loadingDrilldown ? (
                  <div className="text-center py-10 text-gray-500">Loading details...</div>
                ) : drilldownContracts.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No contracts found</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract Ext No</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Incoterm</th>
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
                          <td className="px-4 py-3">{c.contract_ext_no || '-'}</td>
                          <td className="px-4 py-3">{c.supplier || '-'}</td>
                          <td className="px-4 py-3">{c.product || '-'}</td>
                          <td className="px-4 py-3">{c.incoterm || '-'}</td>
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
                              {c.status || '-'}
                            </span>
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
    </Layout>
  )
}

