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
    completed: number
    cancelled: number
    outstanding: number
    outstandingQuantity: number
  }
  shipments: {
    total: number
    active: number
    completed: number
    planned: number
    delayed: number
  }
  trucking: {
    total: number
    active: number
    completed: number
    planned: number
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
  outstanding_quantity: number
  completed_quantity: number
  avg_unit_price: number
  total_contract_value: number
  supplier_count: number
}

interface PlantQuantity {
  plant_location: string
  transport_mode: string
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
    contracts: { total: 0, active: 0, completed: 0, cancelled: 0, outstanding: 0, outstandingQuantity: 0 },
    shipments: { total: 0, active: 0, completed: 0, planned: 0, delayed: 0 },
    trucking: { total: 0, active: 0, completed: 0, planned: 0 },
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

  useEffect(() => {
    fetchDashboardData()
    fetchFilterOptions()
  }, [])

  useEffect(() => {
    fetchDashboardData()
  }, [dateFrom, dateTo, selectedPlantFilter, selectedSupplier])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      
      // Build query parameters
      const params = new URLSearchParams()
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      if (selectedPlantFilter) params.append('plant', selectedPlantFilter)
      if (selectedSupplier) params.append('supplier', selectedSupplier)
      
      const queryString = params.toString()
      const urlSuffix = queryString ? `?${queryString}` : ''

      const [statsRes, suppliersRes, truckingRes, vesselsRes, productRes, plantRes] = await Promise.all([
        api.get(`/dashboard/stats${urlSuffix}`),
        api.get(`/dashboard/top-suppliers${urlSuffix}`),
        api.get(`/dashboard/top-trucking-owners${urlSuffix}`),
        api.get(`/dashboard/top-vessels${urlSuffix}`),
        api.get(`/dashboard/contract-quantity-by-product${urlSuffix}`),
        api.get(`/dashboard/contract-quantity-by-plant${urlSuffix}`)
      ])

      setStats(statsRes.data.data)
      setTopSuppliers(suppliersRes.data.data)
      setTopTruckingOwners(truckingRes.data.data)
      setTopVessels(vesselsRes.data.data)
      setProductQuantities(productRes.data.data)
      setPlantQuantities(plantRes.data.data)
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
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

  const formatNumber = (num: number) => {
    if (num === null || num === undefined) return '0'
    return num.toLocaleString('en-US', { 
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
      const base = `/dashboard/plant-details?plant=${encodeURIComponent(plant.plant_location)}&transport_mode=${plant.transport_mode}`
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

        {/* Main KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('contracts')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Contracts</CardTitle>
              <div className="p-2 rounded-lg bg-blue-100">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : formatNumber(stats.contracts.total)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.contracts.active} active, {stats.contracts.outstanding} outstanding
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('shipments', 'IN_TRANSIT')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Shipments</CardTitle>
              <div className="p-2 rounded-lg bg-green-100">
                <Package className="h-4 w-4 text-green-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : formatNumber(stats.shipments.active)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.shipments.total} total, {stats.shipments.delayed} delayed
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('trucking', 'IN_PROGRESS')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Trucking Operations</CardTitle>
              <div className="p-2 rounded-lg bg-orange-100">
                <Truck className="h-4 w-4 text-orange-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : formatNumber(stats.trucking.total)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.trucking.active} active, {stats.trucking.planned} planned
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('finance')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
              <div className="p-2 rounded-lg bg-purple-100">
                <DollarSign className="h-4 w-4 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : `$${formatNumber(stats.finance.totalAmount)}`}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.finance.total} records
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Finance overview: amounts by status (aligned with Finance page) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('finance')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{loading ? '...' : `$${formatNumber(stats.finance.pendingAmount)}`}</div>
              <p className="text-xs text-muted-foreground mt-1">{stats.finance.pending} pending</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('finance')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Paid Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{loading ? '...' : `$${formatNumber(stats.finance.paidAmount)}`}</div>
              <p className="text-xs text-muted-foreground mt-1">{stats.finance.paid} paid</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('finance')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overdue Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{loading ? '...' : `$${formatNumber(stats.finance.overdueAmount)}`}</div>
              <p className="text-xs text-muted-foreground mt-1">{stats.finance.overdue} overdue</p>
            </CardContent>
          </Card>
        </div>

        {/* Outstanding Contracts & Quantities */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('contracts', undefined, { outstanding: 'true' })}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outstanding Contracts</CardTitle>
              <div className="p-2 rounded-lg bg-yellow-100">
                <Clock className="h-4 w-4 text-yellow-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{loading ? '...' : formatNumber(stats.contracts.outstanding)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Contracts with pending deliveries
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('contracts', undefined, { outstanding: 'true' })}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outstanding Quantity</CardTitle>
              <div className="p-2 rounded-lg bg-red-100">
                <BarChart3 className="h-4 w-4 text-red-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{loading ? '...' : `${formatNumber(stats.contracts.outstandingQuantity)} MT`}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Total quantity pending delivery
              </p>
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
                <CardDescription>Total quantity per product materials</CardDescription>
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
                          <div className="font-semibold text-sm">{formatNumber(product.total_quantity)} MT</div>
                          <div className="text-xs text-gray-500">
                            ${formatNumber(product.total_contract_value)}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs">
                          <span className="text-gray-500">Outstanding:</span>
                          <span className="font-semibold text-orange-600 ml-1">{formatNumber(product.outstanding_quantity)} MT</span>
                        </div>
                        <div className="text-xs">
                          <span className="text-gray-500">Completed:</span>
                          <span className="font-semibold text-green-600 ml-1">{formatNumber(product.completed_quantity)} MT</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Contract Quantity by Plant */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Quantity by Plant/Site</CardTitle>
                <CardDescription>Actual shipped and delivered quantities per plant location</CardDescription>
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
                    <div 
                      key={`${plant.plant_location}-${plant.transport_mode}`} 
                      className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
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
                              {plant.contract_count} contracts • {plant.transport_mode} transport
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-sm">{formatNumber(plant.total_quantity)} MT</div>
                          <div className="text-xs text-gray-500">
                            ${formatNumber(plant.total_contract_value)}
                          </div>
                        </div>
                      </div>
                      {/* Quantity Breakdown */}
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs">
                          <span className="text-gray-500">Shipped: </span>
                          <span className="font-medium text-blue-600">{formatNumber(plant.total_quantity_shipped)} MT</span>
                        </div>
                        <div className="text-xs text-right">
                          <span className="text-gray-500">Delivered: </span>
                          <span className="font-medium text-green-600">{formatNumber(plant.total_quantity_delivered)} MT</span>
                        </div>
                      </div>
                    </div>
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
                        <div className="font-semibold text-sm">{formatNumber(vessel.total_quantity_shipped || 0)} MT</div>
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

        {/* Status Breakdown Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Contract Status */}
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('contracts', 'ACTIVE')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Contracts</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : formatNumber(stats.contracts.active)}</div>
              <p className="text-xs text-muted-foreground mt-1">Click to view details</p>
            </CardContent>
          </Card>

          {/* Shipment Status */}
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('shipments', 'IN_TRANSIT')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Transit</CardTitle>
              <Package className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : formatNumber(stats.shipments.active)}</div>
              <p className="text-xs text-muted-foreground mt-1">Click to view details</p>
            </CardContent>
          </Card>

          {/* Delayed Shipments */}
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('shipments', undefined, { delayed: 'true' })}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delayed Shipments</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : formatNumber(stats.shipments.delayed)}</div>
              <p className="text-xs text-muted-foreground mt-1">Click to view details</p>
            </CardContent>
          </Card>

          {/* Pending Payments (amount) */}
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleViewDetails('finance')}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
              <Clock className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '...' : `$${formatNumber(stats.finance.pendingAmount)}`}</div>
              <p className="text-xs text-muted-foreground mt-1">{stats.finance.pending} payments</p>
            </CardContent>
          </Card>
        </div>
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

      {/* Plant Details Modal */}
      {selectedPlant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">{selectedPlant.plant_location}</h2>
                <p className="text-sm text-gray-500">
                  {selectedPlant.transport_mode} Transport • {selectedPlant.contract_count} Contracts
                </p>
              </div>
              <Button variant="ghost" onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                ✕
              </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Shipped</div>
                <div className="text-xl font-semibold text-blue-600">
                  {formatNumber(selectedPlant.total_quantity_shipped)} MT
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-gray-600">Total Delivered</div>
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
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Shipped (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Delivered (MT)</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Total (MT)</th>
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
                          <td className="px-4 py-3 text-right text-blue-600 font-medium">
                            {formatNumber(detail.quantity_shipped)}
                          </td>
                          <td className="px-4 py-3 text-right text-green-600 font-medium">
                            {formatNumber(detail.quantity_delivered)}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {formatNumber(detail.total_quantity)}
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

