'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
  Filter
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

interface IncotermQuantity {
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

export default function DashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    contracts: { total: 0, active: 0, closed: 0, completed: 0, cancelled: 0, outstanding: 0, totalQuantity: 0, deliveredQuantity: 0, outstandingQuantity: 0 },
    shipments: { total: 0, planned: 0, inProgress: 0, loading: 0, inTransit: 0, arrived: 0, unloading: 0, completed: 0, cancelled: 0, late: 0 },
    trucking: { total: 0, planned: 0, inProgress: 0, loading: 0, inTransit: 0, unloading: 0, completed: 0, cancelled: 0, late: 0 },
    finance: { total: 0, pending: 0, paid: 0, overdue: 0, totalAmount: 0, pendingAmount: 0, paidAmount: 0, overdueAmount: 0, revenue: 0 }
  })
  const [topSuppliers, setTopSuppliers] = useState<TopPerformer[]>([])
  const [topTruckingOwners, setTopTruckingOwners] = useState<TopPerformer[]>([])
  const [topVessels, setTopVessels] = useState<TopPerformer[]>([])
  const [productQuantities, setProductQuantities] = useState<ProductQuantity[]>([])
  const [plantQuantities, setPlantQuantities] = useState<PlantQuantity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlant, setSelectedPlant] = useState<PlantQuantity | null>(null)
  const [plantDetails, setPlantDetails] = useState<PlantContractDetail[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductQuantity | null>(null)
  const [productDetails, setProductDetails] = useState<PlantContractDetail[]>([])
  const [incotermQuantities, setIncotermQuantities] = useState<IncotermQuantity[]>([])
  const [selectedIncoterm, setSelectedIncoterm] = useState<IncotermQuantity | null>(null)
  const [incotermDetails, setIncotermDetails] = useState<PlantContractDetail[]>([])
  const [loadingIncotermDetails, setLoadingIncotermDetails] = useState(false)
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
  
  // Filter states
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedPlantFilter, setSelectedPlantFilter] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [availablePlants, setAvailablePlants] = useState<string[]>([])
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboardData()
    fetchFilterOptions()
  }, [])

  useEffect(() => {
    fetchDashboardData()
  }, [dateFrom, dateTo, selectedPlantFilter, selectedSupplier])

  const fetchDashboardData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Build query parameters
      const params = new URLSearchParams()
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (selectedPlantFilter) params.append('plant', selectedPlantFilter)
      if (selectedSupplier) params.append('supplier', selectedSupplier)

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
          api.get(`/dashboard/contract-quantity-by-product${urlSuffix}`),
          api.get(`/dashboard/contract-quantity-by-plant${urlSuffix}`),
          api.get(`/dashboard/contract-quantity-by-incoterm${urlSuffix}`)
        ])

        const [
          suppliersRes,
          truckingRes,
          vesselsRes,
          productRes,
          plantRes,
          incotermRes
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
        if (productRes.status === 'fulfilled') {
          setProductQuantities(productRes.value.data.data)
        }
        if (plantRes.status === 'fulfilled') {
          setPlantQuantities(plantRes.value.data.data)
        }
        if (incotermRes.status === 'fulfilled') {
          setIncotermQuantities(incotermRes.value.data.data)
        }

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
      const [plantsRes, suppliersRes] = await Promise.all([
        api.get('/dashboard/filter-options/plants'),
        api.get('/dashboard/filter-options/suppliers')
      ])
      setAvailablePlants(plantsRes.data.data)
      setAvailableSuppliers(suppliersRes.data.data)
    } catch (error) {
      console.error('Failed to fetch filter options:', error)
    }
  }

  const clearFilters = () => {
    setDateFrom('')
    setDateTo('')
    setSelectedPlantFilter('')
    setSelectedSupplier('')
  }

  const formatNumber = (num: number | string) => {
    if (num === null || num === undefined) return '0'
    const value = typeof num === 'string' ? Number(num) : num
    if (!Number.isFinite(value)) return '0'
    return value.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 2,
      useGrouping: true
    })
  }

  const buildFilterQuery = () => {
    const params = new URLSearchParams()
    if (dateFrom) params.append('dateFrom', dateFrom)
    if (dateTo) params.append('dateTo', dateTo)
    if (selectedPlantFilter) params.append('plant', selectedPlantFilter)
    if (selectedSupplier) params.append('supplier', selectedSupplier)
    const q = params.toString()
    return q ? `?${q}` : ''
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

  const fetchIncotermDetails = async (inc: IncotermQuantity) => {
    setSelectedIncoterm(inc)
    setLoadingIncotermDetails(true)
    try {
      const filterSuffix = buildFilterQuery()
      const base = `/dashboard/incoterm-details?incoterm=${encodeURIComponent(inc.incoterm || 'Blank')}`
      const sep = filterSuffix ? '&' : ''
      const response = await api.get(`${base}${sep}${filterSuffix.replace('?', '')}`)
      setIncotermDetails(response.data.data)
    } catch (error) {
      console.error('Failed to fetch incoterm details:', error)
      alert('Failed to load incoterm details')
    } finally {
      setLoadingIncotermDetails(false)
    }
  }

  const closeIncotermModal = () => {
    setSelectedIncoterm(null)
    setIncotermDetails([])
  }

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
    if (selectedPlantFilter) params.append('plant', selectedPlantFilter)
    if (selectedSupplier) params.append('supplier', selectedSupplier)
    
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
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Plant/Site</label>
                  <select
                    value={selectedPlantFilter}
                    onChange={(e) => setSelectedPlantFilter(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Plants</option>
                    {availablePlants.map((plant) => (
                      <option key={plant} value={plant}>{plant}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Supplier</label>
                  <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="w-full h-10 px-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Suppliers</option>
                    {availableSuppliers.map((supplier) => (
                      <option key={supplier} value={supplier}>{supplier}</option>
                    ))}
                  </select>
                </div>
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

        {/* Contract Performance & Key KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Contract Performance</CardTitle>
              <div className="p-2 rounded-lg bg-blue-100">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleViewDetails('contracts'); }}
                  className="group flex flex-col items-center rounded-md py-1 px-2 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                >
                  <span className="text-2xl font-bold text-gray-900 group-hover:text-blue-600">{loading ? '...' : formatNumber(stats.contracts.total)}</span>
                  <span className="text-xs text-muted-foreground mt-0.5">Total</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleViewDetails('contracts', 'Close'); }}
                  className="group flex flex-col items-center rounded-md py-1 px-2 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                >
                  <span className="text-2xl font-bold text-blue-600 group-hover:text-blue-700">
                    {loading ? '...' : formatNumber(stats.contracts.closed)}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5">Close</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleViewDetails('contracts', 'Open'); }}
                  className="group flex flex-col items-center rounded-md py-1 px-2 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                >
                  <span className="text-2xl font-bold text-green-600 group-hover:text-green-700">
                    {loading ? '...' : formatNumber(stats.contracts.outstanding)}
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5">Outstanding</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Shipments Performance</CardTitle>
              <div className="p-2 rounded-lg bg-green-100">
                <Package className="h-4 w-4 text-green-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.total)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Total Shipments</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'PLANNED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.planned)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Planned</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'IN_PROGRESS')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.inProgress)}</span>
                  <span className="text-xs text-muted-foreground mt-1">In Progress</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'LOADING')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.loading)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Loading</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'IN_TRANSIT')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.inTransit)}</span>
                  <span className="text-xs text-muted-foreground mt-1">In Transit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'ARRIVED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.arrived)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Arrived</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'UNLOADING')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.unloading)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Unloading</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'COMPLETED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.completed)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Completed</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', 'CANCELLED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-green-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.shipments.cancelled)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Cancelled</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('shipments', undefined, { delayed: 'true' })}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-red-50 transition-colors"
                >
                  <span className="text-xl font-bold text-red-600">{loading ? '...' : formatNumber(stats.shipments.late)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Late / Delayed</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Trucking Performance</CardTitle>
              <div className="p-2 rounded-lg bg-orange-100">
                <Truck className="h-4 w-4 text-orange-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.total)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Total Trucking</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'PLANNED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.planned)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Planned</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'IN_PROGRESS')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.inProgress)}</span>
                  <span className="text-xs text-muted-foreground mt-1">In Progress</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'LOADING')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.loading)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Loading</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'IN_TRANSIT')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.inTransit)}</span>
                  <span className="text-xs text-muted-foreground mt-1">In Transit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'UNLOADING')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.unloading)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Unloading</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'COMPLETED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.completed)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Completed</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'CANCELLED')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-orange-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">{loading ? '...' : formatNumber(stats.trucking.cancelled)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Cancelled</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('trucking', 'LATE')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-red-50 transition-colors"
                >
                  <span className="text-xl font-bold text-red-600">{loading ? '...' : formatNumber(stats.trucking.late)}</span>
                  <span className="text-xs text-muted-foreground mt-1">Late</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Finance Performance</CardTitle>
              <div className="p-2 rounded-lg bg-purple-100">
                <DollarSign className="h-4 w-4 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleViewDetails('finance')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-purple-50 transition-colors"
                >
                  <span className="text-xl font-bold text-gray-900">
                    {loading ? '...' : `$${formatNumber(stats.finance.totalAmount)}`}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">Total Payments</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('finance')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-purple-50 transition-colors"
                >
                  <span className="text-xl font-bold text-yellow-600">
                    {loading ? '...' : `$${formatNumber(stats.finance.pendingAmount)}`}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">Pending Amount</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('finance')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-purple-50 transition-colors"
                >
                  <span className="text-xl font-bold text-green-600">
                    {loading ? '...' : `$${formatNumber(stats.finance.paidAmount)}`}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">Paid Amount</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('finance')}
                  className="flex flex-col items-start rounded-md p-2 hover:bg-purple-50 transition-colors"
                >
                  <span className="text-xl font-bold text-red-600">
                    {loading ? '...' : `$${formatNumber(stats.finance.overdueAmount)}`}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">Overdue Amount</span>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quantity Performance */}
        <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Quantity Performance</CardTitle>
              <div className="p-2 rounded-lg bg-blue-100">
                <BarChart3 className="h-4 w-4 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <button
                  type="button"
                  onClick={() => handleViewDetails('contracts')}
                  className="flex flex-col items-center rounded-md p-2 hover:bg-blue-50 transition-colors"
                >
                  <div className="text-xl font-bold text-gray-900">
                    {loading ? '...' : `${formatNumber(stats.contracts.totalQuantity)} MT`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Total Quantity</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('contracts', undefined, { outstanding: 'true' })}
                  className="flex flex-col items-center rounded-md p-2 hover:bg-blue-50 transition-colors"
                >
                  <div className="text-xl font-bold text-green-600">
                    {loading ? '...' : `${formatNumber(stats.contracts.outstandingQuantity)} MT`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Outstanding Quantity</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDetails('contracts', undefined, { delivered: 'true' })}
                  className="flex flex-col items-center rounded-md p-2 hover:bg-blue-50 transition-colors"
                >
                  <div className="text-xl font-bold text-blue-600">
                    {loading ? '...' : `${formatNumber(stats.contracts.deliveredQuantity)} MT`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Quantity Delivered (STO)</div>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* New Dashboard Widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contract Quantity by Product Materials */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
              <CardTitle className="text-lg">Contract Quantity by Product</CardTitle>
              <CardDescription>Total, outstanding, and delivered quantity per product</CardDescription>
              </div>
              <Layers className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : productQuantities.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  productQuantities.map((product, index) => (
                    <div 
                      key={product.product} 
                      className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => fetchProductDetails(product)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{product.product}</div>
                            <div className="text-xs text-gray-500">
                              {product.contract_count} contracts • {product.supplier_count} suppliers
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-sm">
                            ${formatNumber(product.total_contract_value)}
                          </div>
                          <div className="text-xs text-gray-500">Total Amount</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs">
                          <span className="text-gray-500">Total:</span>
                          <span className="font-semibold text-gray-900 ml-1">
                            {formatNumber(product.total_quantity)} MT
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Outstanding:</span>
                          <span className="font-semibold text-green-600 ml-1">
                            {formatNumber(product.outstanding_quantity)} MT
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Completed:</span>
                          <span className="font-semibold text-blue-600 ml-1">
                            {formatNumber(product.completed_quantity)} MT
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Contract Quantity by Incoterm */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Contract Quantity by Incoterm</CardTitle>
                <CardDescription>Total, outstanding, and delivered quantity per incoterm</CardDescription>
              </div>
              <Layers className="h-5 w-5 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {loading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : incotermQuantities.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No data available</div>
                ) : (
                  incotermQuantities.map((row, index) => (
                    <button
                      key={row.incoterm || `incoterm-${index}`}
                      type="button"
                      onClick={() => fetchIncotermDetails(row)}
                      className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{row.incoterm || 'Blank'}</div>
                            <div className="text-xs text-gray-500">
                              {row.contract_count} contracts • {row.supplier_count} suppliers
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-sm">
                            ${formatNumber(row.total_contract_value)}
                          </div>
                          <div className="text-xs text-gray-500">Total Amount</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs">
                          <span className="text-gray-500">Total:</span>
                          <span className="font-semibold text-gray-900 ml-1">
                            {formatNumber(row.total_quantity)} MT
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Outstanding:</span>
                          <span className="font-semibold text-green-600 ml-1">
                            {formatNumber(row.outstanding_quantity)} MT
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Completed:</span>
                          <span className="font-semibold text-blue-600 ml-1">
                            {formatNumber(row.completed_quantity)} MT
                          </span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

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
                            ${formatNumber(plant.total_contract_value)}
                          </div>
                          <div className="text-xs text-gray-500">Total Amount</div>
                        </div>
                      </div>
                      {/* Quantity Breakdown - mirror product widget style */}
                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs">
                          <span className="text-gray-500">Total:</span>
                          <span className="font-semibold text-gray-900 ml-1">
                            {formatNumber(plant.total_quantity)} MT
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Outstanding:</span>
                          <span className="font-semibold text-green-600 ml-1">
                            {formatNumber(
                              (plant.total_quantity || 0) - (plant.total_quantity_delivered || 0)
                            )} MT
                          </span>
                        </div>
                        <div className="text-xs text-right">
                          <span className="text-gray-500">Completed:</span>
                          <span className="font-semibold text-blue-600 ml-1">
                            {formatNumber(plant.total_quantity_delivered)} MT
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
                        <div className="font-semibold text-sm">{formatNumber(supplier.total_quantity)} MT</div>
                        <div className="text-xs text-gray-500">
                          ${formatNumber(supplier.total_contract_value || 0)}
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
                        <div className="font-semibold text-sm">{formatNumber(owner.total_quantity_sent || 0)} MT</div>
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
                        <div className="font-semibold text-sm">{formatNumber(vessel.total_quantity_sent || 0)} MT</div>
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
                  {formatNumber(selectedProduct.total_quantity)} MT
                </div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Outstanding</div>
                <div className="text-xl font-semibold text-orange-600">
                  {formatNumber(selectedProduct.outstanding_quantity)} MT
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Completed</div>
                <div className="text-xl font-semibold text-green-600">
                  {formatNumber(selectedProduct.completed_quantity)} MT
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Value</div>
                <div className="text-xl font-semibold text-purple-600">
                  ${formatNumber(selectedProduct.total_contract_value)}
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
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Quantity Ordered (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Completed (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding (MT)</th>
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
                            {formatNumber(detail.total_quantity)}
                          </td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium">
                            {formatNumber(detail.quantity_delivered)}
                          </td>
                          <td className="px-4 py-3 text-right text-orange-600 font-medium">
                            {formatNumber(detail.quantity_shipped)}
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

      {/* Incoterm Details Modal */}
      {selectedIncoterm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">{selectedIncoterm.incoterm || 'Blank'}</h2>
                <p className="text-sm text-gray-500">
                  {selectedIncoterm.contract_count} Contracts • {selectedIncoterm.supplier_count} Suppliers
                </p>
              </div>
              <Button variant="ghost" onClick={closeIncotermModal} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Quantity</div>
                <div className="text-xl font-semibold text-blue-600">
                  {formatNumber(selectedIncoterm.total_quantity)} MT
                </div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Outstanding</div>
                <div className="text-xl font-semibold text-orange-600">
                  {formatNumber(selectedIncoterm.outstanding_quantity)} MT
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Completed</div>
                <div className="text-xl font-semibold text-green-600">
                  {formatNumber(selectedIncoterm.completed_quantity)} MT
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Value</div>
                <div className="text-xl font-semibold text-purple-600">
                  ${formatNumber(selectedIncoterm.total_contract_value)}
                </div>
              </div>
            </div>

            {/* Contract Details Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-semibold">Contract Details</h3>
              </div>
              <div className="overflow-x-auto">
                {loadingIncotermDetails ? (
                  <div className="text-center py-8 text-gray-500">Loading details...</div>
                ) : incotermDetails.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No contract details available</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Contract ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">STO Number</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Quantity Ordered (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Completed (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding (MT)</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {incotermDetails.map((detail, idx) => (
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
                            {formatNumber(detail.quantity_shipped)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                detail.status === 'COMPLETED'
                                  ? 'bg-green-100 text-green-700'
                                  : detail.status === 'CANCELLED'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {detail.status || 'UNKNOWN'}
                            </span>
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
                  {formatNumber(selectedPlant.total_quantity)} MT
                </div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Outstanding</div>
                <div className="text-xl font-semibold text-orange-600">
                  {formatNumber(
                    (selectedPlant.total_quantity || 0) - (selectedPlant.total_quantity_delivered || 0),
                  )}{' '}
                  MT
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Completed</div>
                <div className="text-xl font-semibold text-green-600">
                  {formatNumber(selectedPlant.total_quantity_delivered)} MT
                </div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Value</div>
                <div className="text-xl font-semibold text-purple-600">
                  ${formatNumber(selectedPlant.total_contract_value)}
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
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Quantity Ordered (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Completed (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding (MT)</th>
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
                        <th className="px-4 py-3 text-right">Total (MT)</th>
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
                        <th className="px-4 py-3 text-right">Sent (MT)</th>
                        <th className="px-4 py-3 text-right">Delivered (MT)</th>
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
                        <th className="px-4 py-3 text-right">Shipped (MT)</th>
                        <th className="px-4 py-3 text-right">Delivered (MT)</th>
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
    </Layout>
  )
}

