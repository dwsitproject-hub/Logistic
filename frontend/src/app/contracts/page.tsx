'use client'

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Minus, Plus, Search, Filter, Eye, X, Upload, Truck, Ship, FileText, SlidersHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { formatKgFromMt, formatRupiah, toKgFromMt } from '@/lib/utils'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'

interface Contract {
  id: string
  contract_id: string
  buyer: string
  supplier: string
  product: string
  quantity_ordered: number
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
  over_under_delivery_status?: string
  log_cycle_days?: number | null
  trade_cycle_days?: number | null
  cash_cycle_days?: number | null
  payment_status?: string
  company_name?: string
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

function ContractsPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [authReady, setAuthReady] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  // Default view: compact (1 line per contract)
  const [expandedContractIds, setExpandedContractIds] = useState<Set<string>>(() => new Set())
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Desktop table horizontal scroll sync (top + bottom)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)
  const [statusFilter, setStatusFilter] = useState<string>('All Status')
  const [b2bFlagFilter, setB2bFlagFilter] = useState<string>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [availableB2bFlags, setAvailableB2bFlags] = useState<string[]>([])
  const [transportModeFilter, setTransportModeFilter] = useState<string>('ALL')
  const [uploadingId, setUploadingId] = useState<string>('')
  const [docsLoading, setDocsLoading] = useState<boolean>(false)
  const [selectedContractDocs, setSelectedContractDocs] = useState<DocumentItem[]>([])
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
  const contractsPerPage = 100
  const [unassignedSeaContracts, setUnassignedSeaContracts] = useState(0)
  const [unassignedLandContracts, setUnassignedLandContracts] = useState(0)
  const [unassignedFilter, setUnassignedFilter] = useState<'sea' | 'land' | null>(null)
  const [updatingContractId, setUpdatingContractId] = useState<string | null>(null)

  type ColumnFilter =
    | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean }
    | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean }
    | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean }
    | { type: 'multi'; values: string[]; includeBlank?: boolean; emptyOnly?: boolean }

  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)

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
  }, [authReady, searchParams, statusFilter, b2bFlagFilter, dateFrom, dateTo, transportModeFilter, unassignedFilter])

  // When user types (or clears) search, refetch so contract_id filter is applied and we find a contract even with "All Status"
  const isFirstSearchRender = useRef(true)
  useEffect(() => {
    if (!authReady) return
    if (isFirstSearchRender.current) {
      isFirstSearchRender.current = false
      return
    }
    const t = setTimeout(() => {
      setCurrentPage(1)
      fetchContracts(1)
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])
  
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

  const expandAll = (ids: string[]) => setExpandedContractIds(new Set(ids))

  const expandedCount = expandedContractIds.size
  // NOTE: allVisibleIds/allExpanded are derived after filteredContracts is defined (below)

  const columnStorageKey = 'contracts.compact.visibleColumns'
  const sortStorageKey = 'contracts.compact.sort'

  const fetchContracts = async (page: number = currentPage) => {
    try {
      if (!authReady) return
      setLoading(true)
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', contractsPerPage.toString())
      const searchTrim = searchTerm.trim()
      if (searchTrim.length >= 3) {
        // If purely numeric, treat as Contract ID (server-side filter)
        if (/^\d+$/.test(searchTrim)) {
          params.append('contract_id', searchTrim)
        } else {
          // Otherwise, use it as a supplier filter so we can find contracts by supplier across all pages
          params.append('supplier', searchTrim)
        }
      }
      if (statusFilter && statusFilter !== 'All Status') {
        // Status is aligned with SAP (Open/Close/Cancelled)
        params.append('status', statusFilter)
      }
      if (b2bFlagFilter && b2bFlagFilter !== 'ALL') {
        params.append('b2bFlag', b2bFlagFilter)
      }
      if (transportModeFilter && transportModeFilter !== 'ALL') {
        params.append('transportMode', transportModeFilter)
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
      if (b2bFlags.length > 0) setAvailableB2bFlags(b2bFlags)
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

  // Dashboard cards: SEA without shipments, LAND without trucking (from dedicated API)
  useEffect(() => {
    if (!authReady) return
    const fetchUnassignedCounts = async () => {
      try {
        const res = await api.get<{ success: boolean; data: { seaWithoutShipments: number; landWithoutTrucking: number } }>('/contracts/unassigned-counts')
        if (res.data?.success && res.data?.data) {
          setUnassignedSeaContracts(res.data.data.seaWithoutShipments ?? 0)
          setUnassignedLandContracts(res.data.data.landWithoutTrucking ?? 0)
        }
      } catch (err) {
        console.error('Failed to fetch unassigned counts:', err)
      }
    }
    fetchUnassignedCounts()
  }, [authReady])

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
  const getShippingIconColor = (c: Contract) => {
    const hasShipping = !!(c.sto_count && c.sto_count > 0)
    if (!hasShipping) return 'text-gray-400'
    const statusRaw = getContractStatusRaw(c)
    const isCompleted = ['COMPLETED', 'CLOSE', 'CLOSED'].includes(statusRaw)
    return isCompleted ? 'text-blue-600' : 'text-green-600'
  }
  const getTruckingIconColor = (c: Contract) => {
    const hasTrucking = !!(c.trucking_count && c.trucking_count > 0)
    if (!hasTrucking) return 'text-gray-400'
    const statusRaw = getContractStatusRaw(c)
    const isCompleted = ['COMPLETED', 'CLOSE', 'CLOSED'].includes(statusRaw)
    return isCompleted ? 'text-blue-600' : 'text-green-600'
  }

  const getDocumentIconColor = (c: Contract) => {
    if (!c.document_count || c.document_count === 0) return 'text-gray-400'
    return 'text-green-600'
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString()
  }

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

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return '-'
    // Keep compact and consistent (MM/DD/YYYY)
    return d.toLocaleDateString('en-US')
  }

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
    fetchContracts(1)
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

  const fetchContractDocuments = async (contractInternalId: string) => {
    try {
      setDocsLoading(true)
      const params = new URLSearchParams()
      params.append('contractId', contractInternalId)
      const res = await api.get(`/documents?${params.toString()}`)
      const docs: DocumentItem[] = res.data?.data || []
      setSelectedContractDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setSelectedContractDocs([])
    } finally {
      setDocsLoading(false)
    }
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
      String(selectedContract.contract_type || selectedContract.b2b_flag || '').toUpperCase() === 'B2B' &&
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
          const list = res.data?.data?.operations ?? res.data?.operations ?? []
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
    if (colId === 'contract_qty' || colId === 'outstanding_qty' || colId === 'contract_aging') return 'number'
    if (colId === 'contract_date' || colId === 'delivery_start' || colId === 'delivery_end' || colId === 'created_at') return 'date'
    if (colId === 'product' || colId === 'status' || colId === 'company_name' || colId === 'lt_spot') return 'multi'
    return 'text'
  }

  const getColumnRawValue = (c: Contract, colId: string): string | number | null => {
    switch (colId) {
      case 'contract_id':
        return c.contract_id || ''
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
      case 'delivery_start':
        return c.delivery_start_date || ''
      case 'delivery_end':
        return c.delivery_end_date || ''
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

  const passesColumnFilters = (c: Contract) => {
    for (const [colId, filter] of Object.entries(columnFilters)) {
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

  // Frontend filtering: search term + header column filters (backend still handles the top filter bar)
  const filteredContracts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return contracts.filter(contract => {
      const matchesSearch =
        q === '' ||
        contract.contract_id?.toLowerCase().includes(q) ||
        contract.po_number?.toLowerCase().includes(q) ||
        contract.po_numbers?.toLowerCase().includes(q) ||
        contract.sto_number?.toLowerCase().includes(q) ||
        contract.sto_numbers?.toLowerCase().includes(q) ||
        contract.supplier?.toLowerCase().includes(q) ||
        contract.product?.toLowerCase().includes(q) ||
        contract.transport_mode?.toLowerCase().includes(q) ||
        contract.contract_ext_no?.toLowerCase().includes(q)

      if (!matchesSearch) return false
      return passesColumnFilters(contract)
    })
  }, [contracts, searchTerm, columnFilters])

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

  const compactColumns: CompactColumn[] = useMemo(() => [
    {
      id: 'contract_id',
      label: 'Contract',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.contract_id || '',
      render: (c) => (
        <div className="min-w-0">
          <div className="font-semibold truncate">{c.contract_id}</div>
          <div className="text-xs text-gray-600 truncate">{c.supplier || '-'} • {c.product || '-'}</div>
        </div>
      )
    },
    {
      id: 'contract_aging',
      label: 'Contract Aging',
      formulaHelp: FIELD_HELP.contractAging,
      defaultVisible: true,
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
      defaultVisible: true,
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
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.product || '',
      render: (c) => <span className="text-sm truncate">{c.product || '-'}</span>
    },
    {
      id: 'delivery_status',
      label: 'Delivery Status',
      defaultVisible: true,
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
      defaultVisible: true,
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
      defaultVisible: true,
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
      id: 'trade_cycle_days',
      label: 'Trade Cycle',
      formulaHelp: FIELD_HELP.tradeCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.trade_cycle_days ?? 0,
      render: (c) => (
        <span className="text-xs font-semibold">
          {c.trade_cycle_days != null ? `${c.trade_cycle_days} days` : '-'}
        </span>
      ),
      className: 'whitespace-nowrap'
    },
    {
      id: 'cash_cycle_days',
      label: 'Cash Cycle',
      formulaHelp: FIELD_HELP.cashCycle,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.cash_cycle_days ?? 0,
      render: (c) => (
        <span className="text-xs font-semibold">
          {c.cash_cycle_days != null ? `${c.cash_cycle_days} days` : '-'}
        </span>
      ),
      className: 'whitespace-nowrap'
    },
    {
      id: 'over_under_delivery_status',
      label: 'Over/Under Delivery Status',
      formulaHelp: FIELD_HELP.overUnderDelivery,
      defaultVisible: true,
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
      id: 'contract_date',
      label: 'Contract Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.contract_date || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.contract_date)}</span>
    },
    {
      id: 'company_name',
      label: 'Company Name',
      formulaHelp: FIELD_HELP.companyName,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.company_name || '',
      render: (c) => <span className="text-sm font-medium">{c.company_name || '-'}</span>
    },
    {
      id: 'lt_spot',
      label: 'LT/SPOT',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.lt_spot || '',
      render: (c) => <span className="text-sm">{c.lt_spot || '-'}</span>
    },
    {
      id: 'po_number',
      label: 'PO Number',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.po_numbers || c.po_number || '',
      render: (c) => (
        <span className="text-sm truncate block" title={c.po_numbers || c.po_number || ''}>
          {c.po_numbers || c.po_number || '-'}
        </span>
      )
    },
    {
      id: 'sto_number',
      label: 'STO Number',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.sto_numbers || c.sto_number || '',
      render: (c) => (
        <span className="text-sm truncate block" title={c.sto_numbers || c.sto_number || ''}>
          {c.sto_numbers || c.sto_number || '-'}
        </span>
      )
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => (typeof c.quantity_ordered === 'number' ? c.quantity_ordered : 0),
      render: (c) => (
        <span className="text-sm truncate">
          {formatNumber(c.quantity_ordered)} Kg
        </span>
      )
    },
    {
      id: 'outstanding_qty',
      label: 'Outstanding Qty (Kg)',
      formulaHelp: FIELD_HELP.outstandingQty,
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => (typeof c.outstanding_quantity === 'number' ? c.outstanding_quantity : 0),
      render: (c) => (
        <span className={`text-sm font-medium ${c.outstanding_quantity < 0 ? 'text-red-600' : 'text-gray-900'}`}>
          {formatNumber(c.outstanding_quantity)} Kg
        </span>
      )
    },
    {
      id: 'delivery_start',
      label: 'Due Date Delivery Start',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.delivery_start_date || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.delivery_start_date)}</span>
    },
    {
      id: 'delivery_end',
      label: 'Due Date Delivery End',
      defaultVisible: true,
      sortable: true,
      getSortValue: (c) => c.delivery_end_date || '',
      render: (c) => <span className="text-sm">{formatShortDate(c.delivery_end_date)}</span>
    },
    {
      id: 'cargo_readiness_date',
      label: 'Cargo Readiness Date',
      defaultVisible: true,
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
  ], [getStatusColor]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaultVisibleColumnIds = useMemo(() => {
    return compactColumns.filter(c => c.defaultVisible).map(c => c.id)
  }, [compactColumns])

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => new Set(defaultVisibleColumnIds))

  // Load persisted columns/sort (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(columnStorageKey)
      if (raw) {
        const ids = JSON.parse(raw) as string[]
        if (Array.isArray(ids) && ids.length > 0) setVisibleColumnIds(new Set(ids))
      }
      const rawSort = localStorage.getItem(sortStorageKey)
      if (rawSort) {
        const s = JSON.parse(rawSort) as { key?: string; dir?: 'asc' | 'desc' }
        if (s?.key) setSortKey(s.key)
        if (s?.dir) setSortDir(s.dir)
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist columns/sort
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(visibleColumnIds)))
      localStorage.setItem(sortStorageKey, JSON.stringify({ key: sortKey, dir: sortDir }))
    } catch {
      // ignore
    }
  }, [visibleColumnIds, sortKey, sortDir])

  // (scroll width effect is defined after visibleColumns/sortedContracts)

  const visibleColumns = useMemo(() => {
    const visible = compactColumns.filter(c => visibleColumnIds.has(c.id))
    // Ensure Contract + Status are always visible
    const mustHave = ['contract_id', 'status']
    for (const id of mustHave) {
      if (!visible.some(v => v.id === id)) {
        const def = compactColumns.find(c => c.id === id)
        if (def) visible.unshift(def)
      }
    }
    // De-dupe
    const seen = new Set<string>()
    return visible.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  }, [compactColumns, visibleColumnIds])

  const getColumnWidth = (id: string): string => {
    switch (id) {
      case 'contract_id':
        return 'minmax(220px, 1.6fr)'
      case 'product':
        return 'minmax(140px, 1fr)'
      case 'status':
        return 'minmax(110px, 0.8fr)'
      case 'contract_date':
        return 'minmax(120px, 0.9fr)'
      case 'company_code':
        return 'minmax(90px, 0.6fr)'
      case 'lt_spot':
        return 'minmax(90px, 0.6fr)'
      case 'contract_ext_no':
        return 'minmax(140px, 1fr)'
      case 'po_number':
      case 'sto_number':
        return 'minmax(150px, 1fr)'
      case 'contract_qty':
      case 'outstanding_qty':
        return 'minmax(150px, 1fr)'
      case 'delivery_start':
      case 'delivery_end':
        return 'minmax(130px, 0.9fr)'
      case 'cargo_readiness_date':
        return 'minmax(220px, 1.1fr)'
      default:
        return 'minmax(120px, 1fr)'
    }
  }

  const toggleColumn = (id: string) => {
    // Prevent hiding required columns
    if (id === 'contract_id' || id === 'status') return
    setVisibleColumnIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onSortHeaderClick = (col: CompactColumn) => {
    if (!col.sortable) return
    setSortDir(prevDir => {
      if (sortKey === col.id) {
        return prevDir === 'asc' ? 'desc' : 'asc'
      }
      return 'asc'
    })
    setSortKey(col.id)
  }

  const sortedContracts = useMemo(() => {
    const col = compactColumns.find(c => c.id === sortKey)
    if (!col?.sortable || !col.getSortValue) return filteredContracts
    const dirMul = sortDir === 'asc' ? 1 : -1
    const copy = [...filteredContracts]
    copy.sort((a, b) => {
      const av = col.getSortValue!(a)
      const bv = col.getSortValue!(b)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul
      const as = String(av ?? '')
      const bs = String(bv ?? '')
      return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' }) * dirMul
    })
    return copy
  }, [compactColumns, filteredContracts, sortDir, sortKey])

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
  }, [visibleColumns, sortedContracts.length])

  const allVisibleIds = useMemo(() => sortedContracts.map(c => c.id), [sortedContracts])
  const allExpanded = expandedCount > 0 && expandedCount === allVisibleIds.length

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            <p className="text-gray-600 mt-2">
              {totalContracts} total contracts | Showing {filteredContracts.length} on this page
              {totalPages > 1 && ` (Page ${currentPage} of ${totalPages})`}
            </p>
          </div>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Contract
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by Contract ID, Contract Ext No, PO, Supplier, or Product..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
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
                <select
                  value={b2bFlagFilter}
                  onChange={(e) => setB2bFlagFilter(e.target.value)}
                  className="px-4 py-2 border rounded-lg"
                >
                  <option value="ALL">All B2B Flags</option>
                  {availableB2bFlags.map(flag => (
                    <option key={flag} value={flag}>{flag}</option>
                  ))}
                </select>
                <select
                  value={transportModeFilter}
                  onChange={(e) => setTransportModeFilter(e.target.value)}
                  className="px-4 py-2 border rounded-lg"
                >
                  <option value="ALL">All Modes</option>
                  <option value="SEA">SEA</option>
                  <option value="LAND">LAND</option>
                </select>
              </div>
              
              {/* Date Range Filter */}
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-40"
                    placeholder="From"
                  />
                  <span className="text-gray-500">to</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-40"
                    placeholder="To"
                  />
                  <Button 
                    onClick={handleFilterChange}
                    variant="outline"
                    size="sm"
                    className="ml-2"
                  >
                    <Filter className="h-4 w-4 mr-1" />
                    Apply
                  </Button>
                  {(dateFrom || dateTo) && (
                    <Button 
                      onClick={() => {
                        setDateFrom('')
                        setDateTo('')
                        handleFilterChange()
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

        {/* Assignment summary - clickable to filter list */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card
            className={`cursor-pointer transition-all hover:shadow-md ${unassignedFilter === 'sea' ? 'ring-2 ring-blue-500 bg-blue-50/50' : ''}`}
            onClick={() => setUnassignedFilter(prev => (prev === 'sea' ? null : 'sea'))}
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
            onClick={() => setUnassignedFilter(prev => (prev === 'land' ? null : 'land'))}
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
        </div>

        {/* Active filter banner */}
        {unassignedFilter && (
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-gray-50 px-4 py-2 text-sm">
            <span className="text-gray-700">
              {unassignedFilter === 'sea'
                ? 'Showing SEA contracts without shipments'
                : 'Showing LAND contracts without trucking'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUnassignedFilter(null)}
              className="text-gray-600 hover:text-gray-900"
            >
              <X className="h-4 w-4 mr-1" />
              Clear filter
            </Button>
          </div>
        )}

        {/* Contracts List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>All Contracts</CardTitle>
                <Badge variant="outline" className="hidden md:inline-flex">
                  Default view: Compact
                </Badge>
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
                      <div className="text-xs font-semibold text-gray-600 mb-2">Visible columns</div>
                      <div className="space-y-2 max-h-72 overflow-auto pr-1">
                        {compactColumns
                          .filter(c => c.id !== 'contract_id' && c.id !== 'status')
                          .map(col => (
                            <label key={col.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                              <Checkbox
                                checked={visibleColumnIds.has(col.id)}
                                onCheckedChange={() => toggleColumn(col.id)}
                              />
                              <span>{col.label}</span>
                            </label>
                          ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setVisibleColumnIds(new Set(defaultVisibleColumnIds))}
                        >
                          Reset
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowColumnsMenu(false)}>
                          Close
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (allExpanded ? collapseAll() : expandAll(allVisibleIds))}
                  disabled={loading || filteredContracts.length === 0}
                >
                  {allExpanded ? (
                    <>
                      <Minus className="h-4 w-4 mr-2" />
                      Collapse All
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Expand All
                    </>
                  )}
                </Button>
              </div>
              {/* Pagination Controls - Top */}
              {totalPages > 1 && (
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
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading contracts...</div>
            ) : filteredContracts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No contracts found</p>
                {searchTerm && <p className="text-sm mt-2">Try adjusting your search filters</p>}
              </div>
            ) : (
              <>
                {/* Desktop compact table: ONE scroll container + clean rows */}
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
                      {/* Header */}
                      <div
                        className="grid gap-3 px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b sticky top-0 z-10"
                        style={{
                          gridTemplateColumns: `28px ${visibleColumns.map(c => getColumnWidth(c.id)).join(' ')} 320px`
                        }}
                      >
                        <div />
                        {visibleColumns.map(col => {
                          const activeSort = sortKey === col.id
                          const filterActive = isColumnFilterActive(col.id)
                          const filterType = getFilterTypeForColumn(col.id)
                          const current = columnFilters[col.id]

                          return (
                            <div key={col.id} className="relative min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                            <button
                              type="button"
                                  className={`flex items-center gap-1 text-left min-w-0 ${col.sortable ? 'hover:text-gray-900' : ''}`}
                              onClick={() => onSortHeaderClick(col)}
                              title={col.sortable ? 'Sort' : undefined}
                            >
                              <span className="whitespace-normal break-words">{col.label}</span>
                                  {col.sortable && activeSort && (
                                sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                              )}
                            </button>
                            {col.formulaHelp ? (
                              <span className="shrink-0 inline-flex items-center">
                                <FieldHelp text={col.formulaHelp} />
                              </span>
                            ) : null}

                                <button
                                  type="button"
                                  className={`p-1 rounded hover:bg-gray-100 ${filterActive ? 'text-blue-700' : 'text-gray-500'}`}
                                  title="Filter"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOpenHeaderFilterId(prev => (prev === col.id ? null : col.id))
                                  }}
                                >
                                  <Filter className="h-3.5 w-3.5" />
                                </button>
                              </div>

                              {openHeaderFilterId === col.id && (
                                <div
                                  ref={headerFilterPopoverRef}
                                  className="absolute left-0 top-full mt-2 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30"
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

                                  {/* Text filter */}
                                  {filterType === 'text' && (
                                    <div className="space-y-2">
                                      <Input
                                        value={(current?.type === 'text' && current.value) ? current.value : ''}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          setOrClearFilter(col.id, {
                                            type: 'text',
                                            value,
                                            exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                            emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
                                          })
                                        }}
                                        placeholder="Type to filter (contains)"
                                        className="h-8 text-sm"
                                      />
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={current?.type === 'text' ? Boolean(current.exact) : false}
                                            onCheckedChange={(checked) => {
                                              const value = current?.type === 'text' ? current.value : ''
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value,
                                                exact: Boolean(checked),
                                                emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
                                              })
                                            }}
                                          />
                                          Exact match
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean(current?.emptyOnly)}
                                            onCheckedChange={(checked) => {
                                              const value = current?.type === 'text' ? current.value : ''
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value,
                                                exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                                emptyOnly: Boolean(checked),
                                              })
                                            }}
                                          />
                                          Only blanks
                                        </label>
                                      </div>
                                    </div>
                                  )}

                                  {/* Number filter */}
                                  {filterType === 'number' && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <Input
                                          value={(current?.type === 'number' && current.min) ? current.min : ''}
                                          onChange={(e) => {
                                            const min = e.target.value
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly) })
                                          }}
                                          placeholder="Min"
                                          className="h-8 text-sm"
                                        />
                                        <Input
                                          value={(current?.type === 'number' && current.max) ? current.max : ''}
                                          onChange={(e) => {
                                            const max = e.target.value
                                            const min = current?.type === 'number' ? current.min : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly) })
                                          }}
                                          placeholder="Max"
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(current?.emptyOnly)}
                                          onCheckedChange={(checked) => {
                                            const min = current?.type === 'number' ? current.min : ''
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                    </div>
                                  )}

                                  {/* Date filter */}
                                  {filterType === 'date' && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <Input
                                          type="date"
                                          value={(current?.type === 'date' && current.from) ? current.from : ''}
                                          onChange={(e) => {
                                            const from = e.target.value
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly) })
                                          }}
                                          className="h-8 text-sm"
                                        />
                                        <Input
                                          type="date"
                                          value={(current?.type === 'date' && current.to) ? current.to : ''}
                                          onChange={(e) => {
                                            const to = e.target.value
                                            const from = current?.type === 'date' ? current.from : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly) })
                                          }}
                                          className="h-8 text-sm"
                                        />
                                      </div>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean(current?.emptyOnly)}
                                          onCheckedChange={(checked) => {
                                            const from = current?.type === 'date' ? current.from : ''
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only blanks
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
                                        const currentMulti = current && current.type === 'multi' ? current : undefined
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
                            </div>
                          )
                        })}
                        <div className="text-right sticky right-0 bg-gray-50 border-l pl-3 pr-2">Actions</div>
                      </div>

                      {/* Rows */}
                      <div className="divide-y">
                        {sortedContracts.map((contract, idx) => (
                          <div key={contract.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <div className="px-3 py-2">
                              <div
                                className="grid gap-3 items-center"
                                style={{
                                  gridTemplateColumns: `28px ${visibleColumns.map(c => getColumnWidth(c.id)).join(' ')} 320px`
                                }}
                              >
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

                                {visibleColumns.map(col => (
                                  <div key={col.id} className="min-w-0">
                                    {col.render(contract)}
                                  </div>
                                ))}

                                <div className="flex items-center justify-end gap-2 sticky right-0 bg-white border-l pl-3 pr-2 shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.35)]">
                                  <button
                                    title="Trucking"
                                    className={`p-1 ${getTruckingIconColor(contract)}`}
                                    onClick={() => {
                                      const firstSto = contract.sto_numbers?.split(',')[0]?.trim() || contract.sto_number
                                      if (firstSto) router.push(`/trucking?sto=${encodeURIComponent(firstSto)}`)
                                      else router.push(`/trucking?contract=${encodeURIComponent(contract.contract_id)}`)
                                    }}
                                  >
                                    <Truck className="h-5 w-5" />
                                  </button>
                                  <button
                                    title="Shipping"
                                    className={`p-1 ${getShippingIconColor(contract)}`}
                                    onClick={() => {
                                      const firstSto = contract.sto_numbers?.split(',')[0]?.trim() || contract.sto_number
                                      if (firstSto) router.push(`/shipments?sto=${encodeURIComponent(firstSto)}`)
                                      else router.push(`/shipments?contract=${encodeURIComponent(contract.contract_id)}`)
                                    }}
                                  >
                                    <Ship className="h-5 w-5" />
                                  </button>
                                  <button
                                    title="Documents"
                                    className={`p-1 ${getDocumentIconColor(contract)}`}
                                    onClick={() => setSelectedContract(contract)}
                                  >
                                    <FileText className="h-5 w-5" />
                                  </button>

                                  <Button variant="outline" size="sm" onClick={() => setSelectedContract(contract)}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    View
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
                                    size="sm"
                                    onClick={() => document.getElementById(`contract-file-${contract.id}`)?.click()}
                                    disabled={uploadingId === contract.id}
                                    className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                  >
                                    {uploadingId === contract.id ? (
                                      <>
                                        <span className="h-4 w-4 mr-2 inline-block border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                                        Uploading...
                                      </>
                                    ) : (
                                      <>
                                        <Upload className="h-4 w-4 mr-2" />
                                        Upload
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>

                              {/* Expanded Details (optional) */}
                              {expandedContractIds.has(contract.id) && (
                                <div className="mt-3 p-3 border rounded bg-white">
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
                                      <div className="font-medium">{contract.buyer || '-'}</div>
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
                          <button
                            title="Trucking"
                            className={`p-1 ${getTruckingIconColor(contract)}`}
                            onClick={() => {
                              const firstSto = contract.sto_numbers?.split(',')[0]?.trim() || contract.sto_number
                              if (firstSto) router.push(`/trucking?sto=${encodeURIComponent(firstSto)}`)
                              else router.push(`/trucking?contract=${encodeURIComponent(contract.contract_id)}`)
                            }}
                          >
                            <Truck className="h-5 w-5" />
                          </button>
                          <button
                            title="Shipping"
                            className={`p-1 ${getShippingIconColor(contract)}`}
                            onClick={() => {
                              const firstSto = contract.sto_numbers?.split(',')[0]?.trim() || contract.sto_number
                              if (firstSto) router.push(`/shipments?sto=${encodeURIComponent(firstSto)}`)
                              else router.push(`/shipments?contract=${encodeURIComponent(contract.contract_id)}`)
                            }}
                          >
                            <Ship className="h-5 w-5" />
                          </button>
                          <button
                            title="Documents"
                            className={`p-1 ${getDocumentIconColor(contract)}`}
                            onClick={() => setSelectedContract(contract)}
                          >
                            <FileText className="h-5 w-5" />
                          </button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedContract(contract)}
                            className="hidden md:inline-flex"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
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
                            className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100 hidden md:inline-flex"
                          >
                            {uploadingId === contract.id ? (
                              <>
                                <span className="h-4 w-4 mr-2 inline-block border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4 mr-2" />
                                Upload
                              </>
                            )}
                          </Button>
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
                              <div className="font-medium">{contract.buyer || '-'}</div>
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

        {/* Contract Details Modal */}
        {selectedContract && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <Card className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Contract Details</CardTitle>
                    <p className="text-sm text-gray-500 mt-1">{selectedContract.contract_id}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedContract(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
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
                        <div className="font-medium mt-1">
                          {selectedContract.trade_cycle_days != null ? `${selectedContract.trade_cycle_days} days` : '-'}
                        </div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500 flex items-center gap-1">
                          Cash Cycle
                          <FieldHelp text={FIELD_HELP.cashCycle} />
                        </div>
                        <div className="font-medium mt-1">
                          {selectedContract.cash_cycle_days != null ? `${selectedContract.cash_cycle_days} days` : '-'}
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
                        <div className="font-medium mt-1">{selectedContract.buyer}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Supplier</div>
                        <div className="font-medium mt-1">{selectedContract.supplier}</div>
                      </div>
                    </div>
                  </div>

                  {/* B2B Parties */}
                  {(String(selectedContract.contract_type || selectedContract.b2b_flag || '').toUpperCase() === 'B2B' &&
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
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Product</div>
                        <div className="font-medium mt-1">{selectedContract.product}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Contract Quantity</div>
                        <div className="font-medium mt-1 text-base">{formatNumber(selectedContract.quantity_ordered)} Kg</div>
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
                              <th className="text-left p-2 font-medium">Quantity Delivered / Quantity Receive (Kg)</th>
                              <th className="text-left p-2 font-medium">Vessel Name / Trucking Owner</th>
                              <th className="text-left p-2 font-medium">ETA Vessel Arrival at Loading Port / ETA Trucking Completion Date</th>
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
                                  {row.type === 'shipment'
                                    ? formatNumber(row.quantity_delivered ?? 0)
                                    : formatNumber(row.quantity_receive ?? 0)}
                                </td>
                                <td className="p-2">
                                  {row.type === 'shipment' ? (row.vessel_name ?? '-') : (row.trucking_owner ?? '-')}
                                </td>
                                <td className="p-2">
                                  {row.type === 'shipment'
                                    ? (row.eta_vessel_arrival_loading_port ? formatDate(row.eta_vessel_arrival_loading_port) : '-')
                                    : (row.eta_trucking_completion_date ? formatDate(row.eta_trucking_completion_date) : '-')}
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
            <Card className="max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {stoDetailRow.type === 'shipment' ? 'Shipment' : 'Trucking'} details
                    {stoDetailRow.sto_number && stoDetailRow.sto_number !== '-' && ` · STO ${stoDetailRow.sto_number}`}
                    {stoDetailRow.operation_id && ` · ${stoDetailRow.operation_id}`}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={closeStoDetail}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
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
