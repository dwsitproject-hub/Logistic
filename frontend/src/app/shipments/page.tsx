'use client'

import { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Filter, X, Ship, Package, Save, Loader2, Download, Upload, Check, Edit2, Plus, ChevronDown, ChevronUp, ChevronRight, ArrowDown, ArrowUp, Minus, SlidersHorizontal } from 'lucide-react'
import api from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
// import * as XLSX from 'xlsx' // Temporarily disabled

interface Shipment {
  id: string
  shipment_id: string
  operation_id?: string
  contract_id: string
  contract_number: string
  vessel_name: string
  vessel_code: string
  voyage_no: string
  vessel_owner: string
  vessel_draft: number | null
  vessel_loa?: number | null
  vessel_capacity: number | null
  vessel_hull_type: string
  vessel_registration_year?: number | null
  charter_type: string
  shipment_date: string
  arrival_date: string
  port_of_loading: string
  port_of_discharge: string
  plant_site: string // Vessel Discharge Port = Plant/Site
  quantity_shipped: number
  quantity_delivered: number
  inbound_weight: number
  outbound_weight: number
  gain_loss_percentage: number
  gain_loss_amount: number
  estimated_km?: number | null
  estimated_nautical_miles?: number | null
  vessel_oa_budget?: number | null
  vessel_oa_actual?: number | null
  bl_quantity?: number | null
  actual_vessel_qty_receive?: number | null
  difference_final_qty_vs_bl_qty?: number | null
  average_vessel_speed?: number | null
  status: string
  sla_days: number
  is_delayed: boolean
  sap_delivery_id: string
  created_at: string
  supplier: string
  buyer: string
  product: string
  group_name: string
  // STO-based aggregation fields
  sto_number: string
  total_quantity_shipped: number
  total_quantity_delivered: number
  total_inbound_weight: number
  total_outbound_weight: number
  avg_gain_loss_percentage: number
  total_gain_loss_amount: number
  contract_numbers: string
  suppliers: string
  buyers: string
  products: string
  group_names: string
  contract_count: number
  // Additional fields for display
  po_numbers?: string
  delivery_start_date?: string
  delivery_end_date?: string
  sto_quantity?: number
  incoterm?: string
  b2b_flag?: string
  source_type?: string
  contract_reference_po?: string
  contract_ext_no?: string
  ata_vessel_completed_loading?: string
  ata_vessel_complete_discharge?: string
  eta_vessel_complete_discharge?: string
  quantity_receive?: number
  quantity_delivered_sap?: number
  // Basic ETA loading dates at shipment level
  eta_arrival?: string
  eta_berthed?: string
  eta_loading_start?: string
  eta_loading_complete?: string
  eta_sailed?: string
  // Basic ETA discharge dates at shipment level
  eta_discharge_arrival?: string
  eta_discharge_berthed?: string
  eta_discharge_start?: string
  eta_discharge_complete?: string
  // Contract details (for expanded view)
  contract_details?: Array<{
    contract_number: string
    contract_qty: number
    outstanding_qty: number
    sto_qty_assigned: number
    po_number?: string
  }>
}

interface VesselLoadingPort {
  id?: string
  shipment_id?: string
  contract_number?: string
  port_name: string
  port_sequence: number
  quantity_at_loading_port: number
  eta_vessel_arrival: string
  ata_vessel_arrival: string
  eta_vessel_berthed: string
  ata_vessel_berthed: string
  eta_loading_start: string
  ata_loading_start: string
  eta_loading_completed: string
  ata_loading_completed: string
  eta_vessel_sailed: string
  ata_vessel_sailed: string
  // New ETA fields
  eta_vessel_berthed_at_loading_port?: string
  eta_vessel_arrive_at_discharge_port?: string
  eta_vessel_berthed_at_discharge_port?: string
  eta_vessel_start_discharging?: string
  eta_vessel_complete_discharge?: string
  loading_rate: number
  quality_ffa?: number | null
  quality_mi?: number | null
  quality_dobi?: number | null
  quality_red?: number | null
  quality_ds?: number | null
  quality_stone?: number | null
  is_discharge_port?: boolean
  created_at?: string
  updated_at?: string
}

interface DocumentItem {
  id: string
  document_type?: string
  file_name: string
  file_path?: string
  mime_type?: string
  file_size?: number
  shipment_id?: string
  created_at?: string
}

function ShipmentsPageContent() {
  const searchParams = useSearchParams()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedData, setEditedData] = useState<Partial<Shipment>>({})
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [lateIndicatorFilter, setLateIndicatorFilter] = useState<string>('ALL')
  const [etaLoadingFilter, setEtaLoadingFilter] = useState<'ALL' | 'MORE_THAN_7D' | 'D_MINUS_2' | 'D' | 'DELAY' | 'NO_ETA'>('ALL')
  const [etaDischargeFilter, setEtaDischargeFilter] = useState<'ALL' | 'MORE_THAN_7D' | 'D_MINUS_2' | 'D' | 'DELAY' | 'NO_ETA'>('ALL')
  const [vesselFilter, setVesselFilter] = useState('')
  const [saving, setSaving] = useState(false)
  
  // Excel-like column filtering
  type ColumnFilter =
    | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean }
    | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean }
    | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean }

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
  const [uploading, setUploading] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [uploadingId, setUploadingId] = useState<string>('')
  
  // Vessel loading ports state
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null)
  const [loadingPorts, setLoadingPorts] = useState<VesselLoadingPort[]>([])
  const [shipmentInfo, setShipmentInfo] = useState<any>(null)
  const [showLoadingPorts, setShowLoadingPorts] = useState(false)
  const [editingPort, setEditingPort] = useState<VesselLoadingPort | null>(null)
  const [newPort, setNewPort] = useState<Partial<VesselLoadingPort>>({
    port_name: '',
    port_sequence: 1,
    quantity_at_loading_port: 0,
    eta_vessel_arrival: '',
    ata_vessel_arrival: '',
    eta_vessel_berthed: '',
    ata_vessel_berthed: '',
    eta_loading_start: '',
    ata_loading_start: '',
    eta_loading_completed: '',
    ata_loading_completed: '',
    eta_vessel_sailed: '',
    ata_vessel_sailed: '',
    eta_vessel_berthed_at_loading_port: '',
    eta_vessel_arrive_at_discharge_port: '',
    eta_vessel_berthed_at_discharge_port: '',
    eta_vessel_start_discharging: '',
    eta_vessel_complete_discharge: '',
    loading_rate: 0,
    is_discharge_port: false
  })
  
  // Documents state
  const [shipmentDocs, setShipmentDocs] = useState<DocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [showDocs, setShowDocs] = useState(false)

  // Add new shipment state
  const [showAddShipment, setShowAddShipment] = useState(false)
  const [newShipment, setNewShipment] = useState({
    operationId: '',
    stoNumber: '',
    contractNumbers: [] as string[],
    vesselName: '',
    vesselCode: '',
    voyageNo: '',
    vesselOwner: '',
    vesselDraft: '',
    vesselCapacity: '',
    vesselHullType: '',
    charterType: '',
    portOfLoading: '',
    portOfDischarge: '',
    etaVesselArrivalAtLoadingPort: '',
    etaVesselBerthedAtLoadingPort: '',
    etaVesselStartLoading: '',
    etaVesselCompletedLoading: '',
    etaVesselSailedFromLoadingPort: '',
    etaVesselArriveAtDischargePort: '',
    etaVesselBerthedAtDischargePort: '',
    etaVesselStartDischarging: '',
    etaVesselCompleteDischarge: ''
  })
  const [contractQtyAssigned, setContractQtyAssigned] = useState<Record<string, string>>({})
  const [contractSuggestions, setContractSuggestions] = useState<any[]>([])
  const [contractSearchTerm, setContractSearchTerm] = useState('')
  const [showContractSuggestions, setShowContractSuggestions] = useState(false)
  const [stoValidation, setStoValidation] = useState<{exists: boolean, message: string} | null>(null)
  const [contractValidations, setContractValidations] = useState<{ [contractId: string]: {
    checking: boolean
    exists: boolean
    contractData: any
    message: string
  } }>({})

  // Master Vessel / Master Loading Port suggestions for Add Shipment
  const [vesselSuggestions, setVesselSuggestions] = useState<Array<{ vessel_code: string; vessel_name: string; vessel_capacity_mt: number | null; vessel_owner: string | null; hull_type: string | null }>>([])
  const [showVesselSuggestions, setShowVesselSuggestions] = useState(false)
  const [portSuggestions, setPortSuggestions] = useState<Array<{ port: string; region: string | null }>>([])
  const [showPortSuggestions, setShowPortSuggestions] = useState(false)
  const vesselSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const portSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Compact/Expand view state
  const [expandedShipmentIds, setExpandedShipmentIds] = useState<Set<string>>(() => new Set())
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Desktop table horizontal scroll sync (top + bottom)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)

  // Contract details state for expanded view
  const [contractDetailsMap, setContractDetailsMap] = useState<{ [shipmentId: string]: Array<{
    contract_number: string
    contract_qty: number
    outstanding_qty: number
    sto_qty_assigned: number
    po_number?: string
    delivery_start_date?: string | null
    delivery_end_date?: string | null
    quantity_delivered?: number
    quantity_receive?: number
    contract_ext_no?: string | null
    locked_from_sap?: boolean
  }> }>({})
  const [loadingContractDetails, setLoadingContractDetails] = useState<{ [shipmentId: string]: boolean }>({})
  const [savingStoQty, setSavingStoQty] = useState<{ [key: string]: boolean }>({})
  const [editedContractDetails, setEditedContractDetails] = useState<{ [key: string]: number }>({})
  
  // Loading ports modal state for shrink/expand
  const [portsListExpanded, setPortsListExpanded] = useState(true)
  const [addPortExpanded, setAddPortExpanded] = useState(true)
  const [editingShipmentInfo, setEditingShipmentInfo] = useState(false)
  const [editedShipmentInfo, setEditedShipmentInfo] = useState<any>(null)
  const [editingPortId, setEditingPortId] = useState<string | null>(null)
  const [editedPortData, setEditedPortData] = useState<Partial<VesselLoadingPort> | null>(null)

  // ---- ETA Loading Status buckets (grouped by STO / Operation ID) ----
  const etaLoadingBuckets = useMemo(() => {
    const buckets = {
      MORE_THAN_7D: new Set<string>(),
      D_MINUS_2: new Set<string>(),
      D: new Set<string>(),
      DELAY: new Set<string>(),
      NO_ETA: new Set<string>(),
    }

    const today = new Date()
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const msPerDay = 24 * 60 * 60 * 1000

    const toDayDiff = (value: any): number | null => {
      if (!value) return null
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return null
      const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      return Math.floor((dMidnight.getTime() - todayMidnight.getTime()) / msPerDay)
    }

    const groupDiffs: Map<string, number[]> = new Map()

    for (const s of shipments) {
      if (s.status === 'COMPLETED') continue
      const rawSto = (s as any).sto_number
      const rawOp = (s as any).operation_id
      const sto = rawSto && String(rawSto).trim()
      const opId = rawOp && String(rawOp).trim()
      const key = sto || opId || s.shipment_id || s.id
      if (!key) continue

      const diffs: number[] = groupDiffs.get(key) ?? []

      const etaCandidates = [
        s.eta_arrival,
        s.eta_berthed,
        s.eta_loading_start,
        s.eta_loading_complete,
        s.eta_sailed,
      ]

      for (const v of etaCandidates) {
        const diff = toDayDiff(v)
        if (diff !== null) diffs.push(diff)
      }

      if (diffs.length > 0) {
        groupDiffs.set(key, diffs)
      } else if (!groupDiffs.has(key)) {
        // Track groups that currently have no ETA values at all
        groupDiffs.set(key, [])
      }
    }

    for (const [key, diffs] of groupDiffs.entries()) {
      if (diffs.length === 0) {
        buckets.NO_ETA.add(key)
        continue
      }
      const hasDelay = diffs.some((d) => d < 0)
      const hasToday = diffs.some((d) => d === 0)
      const hasDMinus2 = diffs.some((d) => d > 0 && d <= 2)
      const hasMoreThan7 = diffs.some((d) => d > 7)

      if (hasDelay) {
        buckets.DELAY.add(key)
      } else if (hasToday) {
        buckets.D.add(key)
      } else if (hasDMinus2) {
        buckets.D_MINUS_2.add(key)
      } else if (hasMoreThan7) {
        buckets.MORE_THAN_7D.add(key)
      }
    }

    return {
      counts: {
        moreThan7D: buckets.MORE_THAN_7D.size,
        dMinus2: buckets.D_MINUS_2.size,
        d: buckets.D.size,
        delay: buckets.DELAY.size,
        noEta: buckets.NO_ETA.size,
      },
      keysByFilter: buckets,
    }
  }, [shipments])

  // ---- ETA Discharge Status buckets (grouped by STO / Operation ID) ----
  const etaDischargeBuckets = useMemo(() => {
    const buckets = {
      MORE_THAN_7D: new Set<string>(),
      D_MINUS_2: new Set<string>(),
      D: new Set<string>(),
      DELAY: new Set<string>(),
      NO_ETA: new Set<string>(),
    }

    const today = new Date()
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const msPerDay = 24 * 60 * 60 * 1000

    const toDayDiff = (value: any): number | null => {
      if (!value) return null
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return null
      const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      return Math.floor((dMidnight.getTime() - todayMidnight.getTime()) / msPerDay)
    }

    const groupDiffs: Map<string, number[]> = new Map()

    for (const s of shipments) {
      if (s.status === 'COMPLETED') continue
      const rawSto = (s as any).sto_number
      const rawOp = (s as any).operation_id
      const sto = rawSto && String(rawSto).trim()
      const opId = rawOp && String(rawOp).trim()
      const key = sto || opId || s.shipment_id || s.id
      if (!key) continue

      const diffs: number[] = groupDiffs.get(key) ?? []

      const etaCandidates = [
        s.eta_discharge_arrival,
        s.eta_discharge_berthed,
        s.eta_discharge_start,
        s.eta_discharge_complete,
      ]

      for (const v of etaCandidates) {
        const diff = toDayDiff(v)
        if (diff !== null) diffs.push(diff)
      }

      if (diffs.length > 0) {
        groupDiffs.set(key, diffs)
      } else if (!groupDiffs.has(key)) {
        groupDiffs.set(key, [])
      }
    }

    for (const [key, diffs] of groupDiffs.entries()) {
      if (diffs.length === 0) {
        buckets.NO_ETA.add(key)
        continue
      }
      const hasDelay = diffs.some((d) => d < 0)
      const hasToday = diffs.some((d) => d === 0)
      const hasDMinus2 = diffs.some((d) => d > 0 && d <= 2)
      const hasMoreThan7 = diffs.some((d) => d > 7)

      if (hasDelay) {
        buckets.DELAY.add(key)
      } else if (hasToday) {
        buckets.D.add(key)
      } else if (hasDMinus2) {
        buckets.D_MINUS_2.add(key)
      } else if (hasMoreThan7) {
        buckets.MORE_THAN_7D.add(key)
      }
    }

    return {
      counts: {
        moreThan7D: buckets.MORE_THAN_7D.size,
        dMinus2: buckets.D_MINUS_2.size,
        d: buckets.D.size,
        delay: buckets.DELAY.size,
        noEta: buckets.NO_ETA.size,
      },
      keysByFilter: buckets,
    }
  }, [shipments])

  useEffect(() => {
    // Read URL parameters
    const statusParam = searchParams.get('status')
    if (statusParam) {
      setStatusFilter(statusParam)
    }
    // Note: 'delayed' param will be handled directly in fetchShipments
    fetchShipments()
  }, [searchParams])

  const fetchShipments = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', '100')
      if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter)
      }
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      
      // Check for delayed parameter from URL
      const delayedParam = searchParams.get('delayed')
      if (delayedParam === 'true') {
        params.append('delayed', 'true')
      }
      
      // Check for STO parameter from URL
      const stoParam = searchParams.get('sto')
      if (stoParam) {
        params.append('sto', stoParam)
      }
      
      // Check for contract parameter from URL
      const contractParam = searchParams.get('contract')
      if (contractParam) {
        params.append('contract', contractParam)
      }
      
      const response = await api.get(`/shipments?${params.toString()}`)
      
      // Check if response structure is correct
      if (response.data && response.data.success && response.data.data && response.data.data.shipments) {
        setShipments(response.data.data.shipments)
      } else {
        console.error('Unexpected response structure:', response.data)
        setShipments([])
        alert('Received unexpected response format from server. Please check console for details.')
      }
    } catch (error: any) {
      console.error('Failed to fetch shipments:', error)
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url
      })
      
      // Show more detailed error message
      const errorMessage = error.response?.data?.error?.message 
        || error.response?.data?.message 
        || error.message 
        || 'Unknown error occurred'
      
      alert(`Failed to load shipments: ${errorMessage}\n\nPlease check the console for more details.`)
      setShipments([])
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (shipment: Shipment) => {
    setEditingId(shipment.id)
    setEditedData({ ...shipment })
    // Ensure contract details are loaded so we can validate sto_qty_assigned vs vessel capacity
    fetchContractDetails(shipment)
    // Initialize contract details editing state
    if (contractDetailsMap[shipment.id] && contractDetailsMap[shipment.id].length > 0) {
      const initialValues: { [key: string]: number } = {}
      contractDetailsMap[shipment.id].forEach(detail => {
        const key = `${shipment.id}-${detail.contract_number}`
        initialValues[key] = detail.sto_qty_assigned || 0
      })
      setEditedContractDetails(initialValues)
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditedData({})
    setEditedContractDetails({})
  }

  const handleSave = async (shipmentId: string) => {
    setSaving(true)
    try {
      const currentShipment = shipments.find(s => s.id === shipmentId)
      if (!currentShipment) return

      // Prepare shipment payload
      const payload: Partial<Shipment> = { ...editedData }
      
      // Validate: sum of "Contract Qty assign to STO" <= Vessel Capacity (MT)
      const capacityForCheck =
        payload.vessel_capacity !== undefined && payload.vessel_capacity !== null
          ? Number(payload.vessel_capacity)
          : currentShipment.vessel_capacity != null
            ? Number(currentShipment.vessel_capacity)
            : null

      if (capacityForCheck != null && !Number.isNaN(capacityForCheck)) {
        const details = contractDetailsMap[shipmentId] || []
        if (details.length > 0) {
          const sumAssigned = details.reduce((sum, d) => {
            const key = `${shipmentId}-${d.contract_number}`
            const v = editedContractDetails[key] ?? d.sto_qty_assigned ?? 0
            const n = Number(v) || 0
            return sum + n
          }, 0)
          if (sumAssigned > capacityForCheck) {
            alert(`Sum of "Contract Qty assign to STO" (${formatNumber(sumAssigned)} Kg) cannot exceed Vessel Capacity (${formatNumber(capacityForCheck)} Kg).`)
            setSaving(false)
            return
          }
        }
      }

      const actualValue = typeof payload.actual_vessel_qty_receive === 'number'
        ? payload.actual_vessel_qty_receive
        : currentShipment?.actual_vessel_qty_receive ?? null
      const blValue = typeof payload.bl_quantity === 'number'
        ? payload.bl_quantity
        : currentShipment?.bl_quantity ?? null

      if ((payload.actual_vessel_qty_receive !== undefined || payload.bl_quantity !== undefined) && payload.difference_final_qty_vs_bl_qty === undefined) {
        if (actualValue !== null && actualValue !== undefined && blValue !== null && blValue !== undefined) {
          payload.difference_final_qty_vs_bl_qty = actualValue - blValue
        }
      }

      // Save shipment data
      const response = await api.put(`/shipments/${shipmentId}`, payload)
      
      if (response.data.success) {
        // Save contract details if they were edited
        if (contractDetailsMap[shipmentId] && Object.keys(editedContractDetails).length > 0) {
          const stoNumber = currentShipment.sto_number || currentShipment.shipment_id
          for (const detail of contractDetailsMap[shipmentId]) {
            const key = `${shipmentId}-${detail.contract_number}`
            if (editedContractDetails[key] !== undefined) {
              const newValue = editedContractDetails[key]
              await handleUpdateStoQtyAssigned(shipmentId, detail.contract_number, stoNumber, newValue)
            }
          }
        }

        setShipments(prev => prev.map(shipment => 
          shipment.id === shipmentId 
            ? { ...shipment, ...response.data.data }
            : shipment
        ))
        setEditingId(null)
        setEditedData({})
        setEditedContractDetails({})
        alert('Shipment updated successfully!')
      }
    } catch (error) {
      console.error('Update shipment error:', error)
      alert('Failed to update shipment. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleFieldChange = (field: keyof Shipment, value: any) => {
    setEditedData(prev => ({ ...prev, [field]: value }))
  }

  const downloadTemplate = () => {
    // Build CSV template with headers only (no data, just a clean template for import)
    const headers = [
      'STO Number','Contract Numbers','Status','Vessel Name','Vessel Code','Voyage No','Vessel Owner','Vessel Draft (m)','Vessel LOA (m)','Vessel Capacity (MT)','Hull Type','Charter Type','Vessel OA Budget','Vessel OA Actual','Estimated KM','Estimated NM','Average Vessel Speed','Port of Loading','Port of Discharge','Quantity Shipped (MT)','Quantity Delivered (MT)','B/L Quantity (MT)','Actual Vessel Qty Receive (MT)','Difference Final Qty BL QTY','Inbound Weight (MT)','Outbound Weight (MT)','Gain/Loss %','Gain/Loss Amount (MT)','Shipment Date (YYYY-MM-DD)','Arrival Date (YYYY-MM-DD)','SLA Days','Is Delayed (TRUE/FALSE)','SAP Delivery ID',
      // Loading port groups (1..3)
      'LP1 Port Name','LP1 Quantity (MT)','LP1 ETA Arrival','LP1 ATA Arrival','LP1 ETA Berthed','LP1 ATA Berthed','LP1 ETA Load Start','LP1 ATA Load Start','LP1 ETA Load Completed','LP1 ATA Load Completed','LP1 ETA Sailed','LP1 ATA Sailed','LP1 Loading Rate (MT/h)',
      'LP2 Port Name','LP2 Quantity (MT)','LP2 ETA Arrival','LP2 ATA Arrival','LP2 ETA Berthed','LP2 ATA Berthed','LP2 ETA Load Start','LP2 ATA Load Start','LP2 ETA Load Completed','LP2 ATA Load Completed','LP2 ETA Sailed','LP2 ATA Sailed','LP2 Loading Rate (MT/h)',
      'LP3 Port Name','LP3 Quantity (MT)','LP3 ETA Arrival','LP3 ATA Arrival','LP3 ETA Berthed','LP3 ATA Berthed','LP3 ETA Load Start','LP3 ATA Load Start','LP3 ETA Load Completed','LP3 ATA Load Completed','LP3 ETA Sailed','LP3 ATA Sailed','LP3 Loading Rate (MT/h)'
    ]

    // Sample row with STO Number and Contract Numbers
    const sampleRow = [
      '2587817452','2313586719, 2313586720','PLANNED','MV Example','VES001','V001','Example Shipping Co','12.5','210','50000','Single Hull','Time Charter','75000','72000','1200','650','12.5','Jakarta','Singapore','1000','950','940','930','-10','1000','980','0','0','2025-01-01','2025-01-05','5','FALSE','SAP001',
      'Loading Port 1','500','2025-01-01T08:00','','2025-01-01T10:00','','2025-01-01T11:00','','2025-01-01T18:00','','2025-01-01T20:00','','71.43',
      '','','','','','','','','','','','','',
      '','','','','','','','','','','',''
    ].join(',')

    const csvContent = [headers.join(','), sampleRow].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'Shipments_Import_Template.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    // Wrap in quotes if contains comma, newline, or quotes
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const exportFilteredData = async () => {
    // Export actual filtered shipments data from the page
    const headers = [
      'STO Number','Contract Numbers','Status','Vessel Name','Vessel Code','Voyage No','Vessel Owner','Vessel Draft (m)','Vessel Capacity (MT)','Hull Type','Charter Type','Port of Loading','Port of Discharge','Quantity Shipped (MT)','Quantity Delivered (MT)','Inbound Weight (MT)','Outbound Weight (MT)','Gain/Loss %','Gain/Loss Amount (MT)','Shipment Date (YYYY-MM-DD)','Arrival Date (YYYY-MM-DD)','SLA Days','Is Delayed (TRUE/FALSE)','SAP Delivery ID',
      // Loading port groups (1..3)
      'LP1 Port Name','LP1 Quantity (MT)','LP1 ETA Arrival','LP1 ATA Arrival','LP1 ETA Berthed','LP1 ATA Berthed','LP1 ETA Load Start','LP1 ATA Load Start','LP1 ETA Load Completed','LP1 ATA Load Completed','LP1 ETA Sailed','LP1 ATA Sailed','LP1 Loading Rate (MT/h)',
      'LP2 Port Name','LP2 Quantity (MT)','LP2 ETA Arrival','LP2 ATA Arrival','LP2 ETA Berthed','LP2 ATA Berthed','LP2 ETA Load Start','LP2 ATA Load Start','LP2 ETA Load Completed','LP2 ATA Load Completed','LP2 ETA Sailed','LP2 ATA Sailed','LP2 Loading Rate (MT/h)',
      'LP3 Port Name','LP3 Quantity (MT)','LP3 ETA Arrival','LP3 ATA Arrival','LP3 ETA Berthed','LP3 ATA Berthed','LP3 ETA Load Start','LP3 ATA Load Start','LP3 ETA Load Completed','LP3 ATA Load Completed','LP3 ETA Sailed','LP3 ATA Sailed','LP3 Loading Rate (MT/h)'
    ]

    // Use the shipments that are currently displayed on the page (filtered by search and other filters)
    const rows: string[] = []
    const data = filteredShipments // Use the filtered shipments that are actually displayed on the page
    
    if (data.length === 0) {
      alert('No shipments to export. Please adjust your filters.')
      return
    }

    for (const s of data) {
      // fetch loading ports for each shipment (sequential to keep it simple)
      let ports: VesselLoadingPort[] = []
      try {
        const res = await api.get(`/shipments/${s.id}/loading-ports`)
        if (res.data.success) ports = res.data.data
      } catch {}

      const differenceValue = s.difference_final_qty_vs_bl_qty ?? ((s.actual_vessel_qty_receive ?? 0) - (s.bl_quantity ?? 0))

      const lp = [1,2,3].map(i => ports.find(p => p.port_sequence === i)).map(p => ([
        p?.port_name || '',
        p?.quantity_at_loading_port ?? '',
        p?.eta_vessel_arrival || '',
        p?.ata_vessel_arrival || '',
        p?.eta_vessel_berthed || '',
        p?.ata_vessel_berthed || '',
        p?.eta_loading_start || '',
        p?.ata_loading_start || '',
        p?.eta_loading_completed || '',
        p?.ata_loading_completed || '',
        p?.eta_vessel_sailed || '',
        p?.ata_vessel_sailed || '',
        p?.loading_rate ?? ''
      ]).flat())

      // Use proper CSV escaping for all fields
      const base = [
        escapeCsvValue(s.sto_number || s.shipment_id),
        escapeCsvValue(s.contract_numbers || s.contract_number || ''),
        escapeCsvValue(s.status),
        escapeCsvValue(s.vessel_name),
        escapeCsvValue(s.vessel_code),
        escapeCsvValue(s.voyage_no),
        escapeCsvValue(s.vessel_owner),
        escapeCsvValue(s.vessel_draft ?? ''),
        escapeCsvValue(s.vessel_loa ?? ''),
        escapeCsvValue(s.vessel_capacity ?? ''),
        escapeCsvValue(s.vessel_hull_type),
        escapeCsvValue(s.charter_type),
        escapeCsvValue(s.vessel_oa_budget ?? ''),
        escapeCsvValue(s.vessel_oa_actual ?? ''),
        escapeCsvValue(s.estimated_km ?? ''),
        escapeCsvValue(s.estimated_nautical_miles ?? ''),
        escapeCsvValue(s.average_vessel_speed ?? ''),
        escapeCsvValue(s.port_of_loading),
        escapeCsvValue(s.port_of_discharge),
        escapeCsvValue(s.quantity_shipped),
        escapeCsvValue(s.quantity_delivered),
        escapeCsvValue(s.bl_quantity ?? ''),
        escapeCsvValue(s.actual_vessel_qty_receive ?? ''),
        escapeCsvValue(differenceValue),
        escapeCsvValue(s.inbound_weight),
        escapeCsvValue(s.outbound_weight),
        escapeCsvValue(s.gain_loss_percentage),
        escapeCsvValue(s.gain_loss_amount),
        escapeCsvValue(s.shipment_date ? String(s.shipment_date).substring(0,10) : ''),
        escapeCsvValue(s.arrival_date ? String(s.arrival_date).substring(0,10) : ''),
        escapeCsvValue(s.sla_days),
        s.is_delayed ? 'TRUE' : 'FALSE',
        escapeCsvValue(s.sap_delivery_id)
      ]

      // Escape loading port data
      const escapedLp = lp.flat().map(v => escapeCsvValue(v))

      rows.push([...base, ...escapedLp].join(','))
    }

    const csvContent = [headers.join(','), ...rows].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    const timestamp = new Date().toISOString().substring(0,10)
    link.setAttribute('download', `Shipments_Export_${timestamp}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      const nextChar = line[i + 1]
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote ("")
          current += '"'
          i++ // Skip next quote
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        // Field delimiter
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    
    // Push last field
    result.push(current.trim())
    return result
  }

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      const headers = parseCsvLine(lines[0])
      
      // Debug: Log headers to help identify the issue
      console.log('CSV Headers found:', headers)
      
      let createCount = 0
      let updateCount = 0
      let errorCount = 0
      const errors: string[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i])
        if (values.length < 2) continue // At least need STO Number and one more field

        const row: any = {}
        headers.forEach((header, index) => {
          row[header.trim()] = values[index]?.trim() || ''
        })

        // Support both old and new column names
        const stoNumber = row['STO Number'] || row['Shipment ID']
        const contractNumbers = row['Contract Numbers'] || row['Contract Number']
        
        // Debug: Log the first row to see what data we're getting
        if (i === 1) {
          console.log('First row data:', row)
          console.log('STO Number value:', stoNumber)
          console.log('Contract Numbers value:', contractNumbers)
        }
        
        if (!stoNumber) {
          errors.push(`Row ${i + 1}: Missing STO Number (found headers: ${headers.join(', ')})`)
          console.log(`Row ${i + 1} data:`, row)
          console.log(`Row ${i + 1} STO Number:`, stoNumber)
          console.log(`Row ${i + 1} Contract Numbers:`, contractNumbers)
          errorCount++
          continue
        }

        // Check if STO exists
        const existingShipment = shipments.find(s => s.sto_number === stoNumber)

        // Prepare shipment data
        const shipmentData = {
          stoNumber: stoNumber,
          contractNumbers: contractNumbers ? contractNumbers.split(',').map((c: string) => c.trim()).filter((c: string) => c) : [],
          vesselName: row['Vessel Name'] || '',
          vesselCode: row['Vessel Code'] || '',
          voyageNo: row['Voyage No'] || '',
          vesselOwner: row['Vessel Owner'] || '',
          vesselDraft: row['Vessel Draft (m)'] || '',
          vesselCapacity: row['Vessel Capacity (MT)'] || '',
          vesselHullType: row['Hull Type'] || '',
          charterType: row['Charter Type'] || '',
          portOfLoading: row['Port of Loading'] || '',
          portOfDischarge: row['Port of Discharge'] || '',
          quantityShipped: row['Quantity Shipped (MT)'] || '',
          shipmentDate: row['Shipment Date (YYYY-MM-DD)'] || '',
          arrivalDate: row['Arrival Date (YYYY-MM-DD)'] || ''
        }

        try {
          if (existingShipment) {
            // UPDATE existing shipment
            const updateData: any = {
              shipment_id: existingShipment.shipment_id // Add required shipment_id field
            }
        if (row['Status']) updateData.status = row['Status']
        if (row['Vessel Name']) updateData.vessel_name = row['Vessel Name']
        if (row['Vessel Code']) updateData.vessel_code = row['Vessel Code']
        if (row['Voyage No']) updateData.voyage_no = row['Voyage No']
            if (row['Vessel Owner']) updateData.vessel_owner = row['Vessel Owner']
            if (row['Vessel Draft (m)']) updateData.vessel_draft = parseFloat(row['Vessel Draft (m)'])
            if (row['Vessel Capacity (MT)']) updateData.vessel_capacity = parseFloat(row['Vessel Capacity (MT)'])
            if (row['Hull Type']) updateData.vessel_hull_type = row['Hull Type']
            if (row['Charter Type']) updateData.charter_type = row['Charter Type']
        if (row['Port of Loading']) updateData.port_of_loading = row['Port of Loading']
        if (row['Port of Discharge']) updateData.port_of_discharge = row['Port of Discharge']
        if (row['Quantity Shipped (MT)']) updateData.quantity_shipped = parseFloat(row['Quantity Shipped (MT)'])
        if (row['Quantity Delivered (MT)']) updateData.quantity_delivered = parseFloat(row['Quantity Delivered (MT)'])
        if (row['Shipment Date (YYYY-MM-DD)']) updateData.shipment_date = row['Shipment Date (YYYY-MM-DD)']
        if (row['Arrival Date (YYYY-MM-DD)']) updateData.arrival_date = row['Arrival Date (YYYY-MM-DD)']

            console.log(`Updating shipment ${existingShipment.id} with data:`, updateData)
            const response = await api.put(`/shipments/${existingShipment.id}`, updateData)
          if (response.data.success) {
              updateCount++
          } else {
              const errorMsg = response.data.error?.message || 'Update failed'
              errors.push(`Row ${i + 1}: ${errorMsg} for STO ${stoNumber}`)
              console.error(`Update failed for STO ${stoNumber}:`, response.data)
            errorCount++
          }
          } else {
            // CREATE new shipment
            if (!contractNumbers || shipmentData.contractNumbers.length === 0) {
              errors.push(`Row ${i + 1}: Missing Contract Numbers for new STO ${stoNumber}`)
          errorCount++
              continue
            }

            const response = await api.post('/shipments', shipmentData)
            if (response.data.success) {
              createCount++
            } else {
              errors.push(`Row ${i + 1}: ${response.data.error?.message || 'Create failed for STO ' + stoNumber}`)
              errorCount++
            }
          }
        } catch (error: any) {
          const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error'
          errors.push(`Row ${i + 1}: ${errorMsg}`)
          errorCount++
        }
      }

      // Show detailed results
      let message = `Bulk operation completed!\n\n`
      message += `✅ Created: ${createCount}\n`
      message += `✅ Updated: ${updateCount}\n`
      message += `❌ Failed: ${errorCount}`
      
      if (errors.length > 0 && errors.length <= 10) {
        message += `\n\nErrors:\n${errors.join('\n')}`
      } else if (errors.length > 10) {
        message += `\n\nShowing first 10 errors:\n${errors.slice(0, 10).join('\n')}`
      }

      alert(message)
      await fetchShipments() // Refresh the list
    } catch (error) {
      console.error('Bulk upload error:', error)
      alert('Failed to process bulk upload. Please check your CSV file format.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLANNED': return 'bg-blue-100 text-blue-800'
      case 'IN_TRANSIT': return 'bg-yellow-100 text-yellow-800'
      case 'ARRIVED': return 'bg-purple-100 text-purple-800'
      case 'UNLOADING': return 'bg-orange-100 text-orange-800'
      case 'COMPLETED': return 'bg-green-100 text-green-800'
      case 'CANCELLED': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
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

  const formatNumber = (num: number | string) => {
    if (num === null || num === undefined || num === '') return '-'
    const n = parseNumberLoose(num)
    if (n === null) return '-'
    if (n === 0) return '0'
    return n.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 2,
      useGrouping: true
    })
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString()
  }

  const handleFilterChange = () => {
    fetchShipments()
  }

  // View options state
  const [viewOption, setViewOption] = useState<'all' | 'sto' | 'contract' | 'vessel' | 'port_loading' | 'port_discharge'>('all')
  const [viewFilterValue, setViewFilterValue] = useState('')

  // Helper function to calculate late indicator for shipments
  const getLateIndicator = (shipment: Shipment): { color: string; text: string } => {
    if (!shipment.delivery_end_date) {
      return { color: 'bg-gray-100 text-gray-800', text: '-' }
    }
    
    const deliveryEnd = new Date(shipment.delivery_end_date).getTime()
    const today = new Date().setHours(0, 0, 0, 0)
    const ataDischarge = shipment.ata_vessel_complete_discharge ? new Date(shipment.ata_vessel_complete_discharge).getTime() : null
    const etaDischarge = shipment.eta_vessel_complete_discharge ? new Date(shipment.eta_vessel_complete_discharge).getTime() : null
    
    // Red if delivery_end < Today
    if (deliveryEnd < today) {
      return { color: 'bg-red-100 text-red-800', text: 'Late' }
    }
    
    // If both discharge dates are null, cannot determine (but check if past due date)
    if (ataDischarge === null && etaDischarge === null) {
      return { color: 'bg-gray-100 text-gray-800', text: '-' }
    }
    
    // Red if delivery_end < ata_discharge OR delivery_end < eta_discharge
    // Green if delivery_end >= ata_discharge OR delivery_end >= eta_discharge
    const isLate = 
      (ataDischarge !== null && deliveryEnd < ataDischarge) ||
      (etaDischarge !== null && deliveryEnd < etaDischarge)
    
    if (isLate) {
      return { color: 'bg-red-100 text-red-800', text: 'Late' }
    } else {
      return { color: 'bg-green-100 text-green-800', text: 'On Time' }
    }
  }

  // Excel-like filtering helpers
  const getFilterTypeForColumn = (colId: string): ColumnFilter['type'] => {
    if (colId === 'quantity_shipped' || colId === 'quantity_delivered' || colId === 'sto_quantity' || colId === 'inbound_weight' || colId === 'outbound_weight' || colId === 'gain_loss_percentage' || colId === 'gain_loss_amount' || colId === 'estimated_km' || colId === 'estimated_nautical_miles' || colId === 'vessel_oa_budget' || colId === 'vessel_oa_actual' || colId === 'bl_quantity' || colId === 'actual_vessel_qty_receive' || colId === 'difference_final_qty_vs_bl_qty' || colId === 'average_vessel_speed' || colId === 'vessel_draft' || colId === 'vessel_loa' || colId === 'vessel_capacity' || colId === 'vessel_registration_year' || colId === 'sla_days') return 'number'
    if (colId === 'shipment_date' || colId === 'arrival_date' || colId === 'delivery_start' || colId === 'delivery_end' || colId === 'delivery_start_date' || colId === 'delivery_end_date' || colId === 'ata_vessel_completed_loading' || colId === 'ata_vessel_complete_discharge' || colId === 'eta_vessel_complete_discharge' || colId === 'created_at') return 'date'
    return 'text'
  }

  const getColumnRawValue = (s: Shipment, colId: string): string | number | null => {
    switch (colId) {
      case 'late_indicator': return getLateIndicator(s).text
      case 'operation_id': return s.operation_id || ''
      case 'shipment_id': return s.shipment_id || ''
      case 'sto_number': return s.sto_number || ''
      case 'status': return s.status || ''
      case 'contract_numbers': return s.contract_numbers || s.contract_number || ''
      case 'contract_number': return s.contract_number || ''
      case 'po_numbers': return s.po_numbers || ''
      case 'contract_reference_po': return s.contract_reference_po || ''
      case 'vessel_name': return s.vessel_name || ''
      case 'vessel_code': return s.vessel_code || ''
      case 'voyage_no': return s.voyage_no || ''
      case 'vessel_owner': return s.vessel_owner || ''
      case 'port_of_loading': return s.port_of_loading || ''
      case 'port_of_discharge': return s.port_of_discharge || ''
      case 'plant_site': return s.plant_site || ''
      case 'supplier': return s.supplier || ''
      case 'buyers': return s.buyers || ''
      case 'buyer': return s.buyer || ''
      case 'product': return s.product || ''
      case 'products': return s.products || ''
      case 'group_name': return s.group_name || ''
      case 'group_names': return s.group_names || ''
      case 'incoterm': return s.incoterm || ''
      case 'b2b_flag': return s.b2b_flag || ''
      case 'charter_type': return s.charter_type || ''
      case 'quantity_shipped': return typeof s.quantity_shipped === 'number' ? s.quantity_shipped : null
      case 'quantity_delivered': return typeof s.quantity_delivered === 'number' ? s.quantity_delivered : null
      case 'sto_quantity': return typeof s.sto_quantity === 'number' ? s.sto_quantity : null
      case 'inbound_weight': return typeof s.inbound_weight === 'number' ? s.inbound_weight : null
      case 'outbound_weight': return typeof s.outbound_weight === 'number' ? s.outbound_weight : null
      case 'gain_loss_percentage': return typeof s.gain_loss_percentage === 'number' ? s.gain_loss_percentage : null
      case 'gain_loss_amount': return typeof s.gain_loss_amount === 'number' ? s.gain_loss_amount : null
      case 'estimated_km': return typeof s.estimated_km === 'number' ? s.estimated_km : null
      case 'estimated_nautical_miles': return typeof s.estimated_nautical_miles === 'number' ? s.estimated_nautical_miles : null
      case 'vessel_oa_budget': return typeof s.vessel_oa_budget === 'number' ? s.vessel_oa_budget : null
      case 'vessel_oa_actual': return typeof s.vessel_oa_actual === 'number' ? s.vessel_oa_actual : null
      case 'bl_quantity': return typeof s.bl_quantity === 'number' ? s.bl_quantity : null
      case 'actual_vessel_qty_receive': return typeof s.actual_vessel_qty_receive === 'number' ? s.actual_vessel_qty_receive : null
      case 'difference_final_qty_vs_bl_qty': return typeof s.difference_final_qty_vs_bl_qty === 'number' ? s.difference_final_qty_vs_bl_qty : null
      case 'average_vessel_speed': return typeof s.average_vessel_speed === 'number' ? s.average_vessel_speed : null
      case 'vessel_draft': return typeof s.vessel_draft === 'number' ? s.vessel_draft : null
      case 'vessel_loa': return typeof s.vessel_loa === 'number' ? s.vessel_loa : null
      case 'vessel_capacity': return typeof s.vessel_capacity === 'number' ? s.vessel_capacity : null
      case 'vessel_registration_year': return typeof s.vessel_registration_year === 'number' ? s.vessel_registration_year : null
      case 'sla_days': return typeof s.sla_days === 'number' ? s.sla_days : null
      case 'shipment_date': return s.shipment_date || ''
      case 'arrival_date': return s.arrival_date || ''
      case 'delivery_start': return s.delivery_start_date || ''
      case 'delivery_end': return s.delivery_end_date || ''
      case 'delivery_start_date': return s.delivery_start_date || ''
      case 'delivery_end_date': return s.delivery_end_date || ''
      case 'ata_vessel_completed_loading': return s.ata_vessel_completed_loading || ''
      case 'ata_vessel_complete_discharge': return s.ata_vessel_complete_discharge || ''
      case 'eta_vessel_complete_discharge': return s.eta_vessel_complete_discharge || ''
      case 'created_at': return s.created_at || ''
      default: return (s as any)[colId] ?? ''
    }
  }

  const isEmptyValue = (v: unknown) => {
    if (v === null || v === undefined) return true
    const s = String(v).trim()
    return s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined'
  }

  const passesColumnFilters = (s: Shipment) => {
    for (const [colId, filter] of Object.entries(columnFilters)) {
      const raw = getColumnRawValue(s, colId)
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
    }
    return true
  }

  const isColumnFilterActive = (colId: string) => {
    const f = columnFilters[colId]
    if (!f) return false
    if (f.emptyOnly) return true
    if (f.type === 'text') return Boolean(f.value && f.value.trim() !== '')
    if (f.type === 'number') return Boolean((f.min && f.min !== '') || (f.max && f.max !== ''))
    if (f.type === 'date') return Boolean((f.from && f.from !== '') || (f.to && f.to !== ''))
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
      (next.type === 'date' && Boolean((next.from && next.from !== '') || (next.to && next.to !== '')))

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

  const filteredShipments = shipments.filter(shipment => {
    // Search filter - works with STO No, Shipment ID, Contract Numbers, PO No, Vessel Name, Supplier, and Port/Plant
    const term = searchTerm.trim().toLowerCase()
    const matchesSearch =
      term === '' ||
      shipment.sto_number?.toLowerCase().includes(term) ||
      shipment.shipment_id?.toLowerCase().includes(term) ||
      shipment.contract_numbers?.toLowerCase().includes(term) ||
      shipment.po_numbers?.toLowerCase().includes(term) ||
      shipment.vessel_name?.toLowerCase().includes(term) ||
      shipment.contract_number?.toLowerCase().includes(term) ||
      shipment.supplier?.toLowerCase().includes(term) ||
      shipment.plant_site?.toLowerCase().includes(term) ||
      shipment.port_of_discharge?.toLowerCase().includes(term)
    
    // View option filter
    let matchesViewOption = true
    if (viewOption !== 'all' && viewFilterValue) {
      const filterLower = viewFilterValue.toLowerCase()
      if (viewOption === 'sto') {
        matchesViewOption = shipment.sto_number?.toLowerCase().includes(filterLower) || false
      } else if (viewOption === 'contract') {
        matchesViewOption = shipment.contract_numbers?.toLowerCase().includes(filterLower) || 
                           shipment.contract_number?.toLowerCase().includes(filterLower) || false
      } else if (viewOption === 'vessel') {
        matchesViewOption = shipment.vessel_name?.toLowerCase().includes(filterLower) || false
      } else if (viewOption === 'port_loading') {
        matchesViewOption = shipment.port_of_loading?.toLowerCase().includes(filterLower) || false
      } else if (viewOption === 'port_discharge') {
        matchesViewOption = shipment.port_of_discharge?.toLowerCase().includes(filterLower) || 
                           shipment.plant_site?.toLowerCase().includes(filterLower) || false
      }
    }
    
    // Filter by Late Indicator
    if (lateIndicatorFilter !== 'ALL') {
      const indicator = getLateIndicator(shipment)
      if (lateIndicatorFilter === 'ON_TIME' && indicator.text !== 'On Time') return false
      if (lateIndicatorFilter === 'LATE' && indicator.text !== 'Late') return false
      if (lateIndicatorFilter === 'NA' && indicator.text !== '-') return false
    }

    // ETA Loading Status filter (grouped by STO / Operation ID)
    if (etaLoadingFilter !== 'ALL') {
      const rawSto = (shipment as any).sto_number
      const rawOp = (shipment as any).operation_id
      const sto = rawSto && String(rawSto).trim()
      const opId = rawOp && String(rawOp).trim()
      const key = sto || opId || shipment.shipment_id || shipment.id
      const bucketSets = etaLoadingBuckets.keysByFilter
      const targetSet =
        etaLoadingFilter === 'MORE_THAN_7D'
          ? bucketSets.MORE_THAN_7D
          : etaLoadingFilter === 'D_MINUS_2'
            ? bucketSets.D_MINUS_2
            : etaLoadingFilter === 'D'
              ? bucketSets.D
              : etaLoadingFilter === 'DELAY'
                ? bucketSets.DELAY
                : bucketSets.NO_ETA

      if (!key || !targetSet.has(key)) return false
    }

    // ETA Discharge Status filter (grouped by STO / Operation ID)
    if (etaDischargeFilter !== 'ALL') {
      const rawSto = (shipment as any).sto_number
      const rawOp = (shipment as any).operation_id
      const sto = rawSto && String(rawSto).trim()
      const opId = rawOp && String(rawOp).trim()
      const key = sto || opId || shipment.shipment_id || shipment.id
      const bucketSets = etaDischargeBuckets.keysByFilter
      const targetSet =
        etaDischargeFilter === 'MORE_THAN_7D'
          ? bucketSets.MORE_THAN_7D
          : etaDischargeFilter === 'D_MINUS_2'
            ? bucketSets.D_MINUS_2
            : etaDischargeFilter === 'D'
              ? bucketSets.D
              : etaDischargeFilter === 'DELAY'
                ? bucketSets.DELAY
                : bucketSets.NO_ETA

      if (!key || !targetSet.has(key)) return false
    }

    return matchesSearch && matchesViewOption && passesColumnFilters(shipment)
  })

  // Fetch contract details for a shipment
  const fetchContractDetails = async (shipment: Shipment) => {
    if (!shipment.contract_numbers) return
    // Always fetch to get latest data, but skip if already loading
    if (loadingContractDetails[shipment.id]) return

    setLoadingContractDetails(prev => ({ ...prev, [shipment.id]: true }))
    try {
      const contractNumbers = shipment.contract_numbers.split(', ').filter(c => c.trim())
      const stoForDetails = (shipment.sto_number && String(shipment.sto_number).trim()) || (shipment as any).sto_key || shipment.shipment_id
      const hasSto = Boolean(stoForDetails && String(stoForDetails).trim() !== '')
      
      if (hasSto) {
        // Use STO-specific endpoint when a real STO number exists (backend fills sto_number from sto_key when needed)
        const stoNumber = String(stoForDetails)
        const response = await api.get(`/shipments/contracts/details?sto=${encodeURIComponent(stoNumber)}&contractNumbers=${contractNumbers.join(',')}`)
      
        if (response.data.success && response.data.data.length > 0) {
          const details = response.data.data.map((detail: any) => ({
            contract_number: detail.contract_number,
            contract_qty: detail.contract_qty || 0,
            outstanding_qty: detail.outstanding_qty || 0,
            sto_qty_assigned: detail.sto_qty_assigned || 0,
            po_number: detail.po_number || '',
            delivery_start_date: detail.delivery_start_date || null,
            delivery_end_date: detail.delivery_end_date || null,
            quantity_delivered: detail.quantity_delivered || 0,
            quantity_receive: detail.quantity_receive || 0,
            contract_ext_no: detail.contract_ext_no || null,
            locked_from_sap: Boolean(detail.locked_from_sap)
          }))
          setContractDetailsMap(prev => ({ ...prev, [shipment.id]: details }))
          return
        }
      }

      // No STO, or STO-based API returned no data: use aggregated Contracts API so numbers match Contracts page
      const fallbackDetails = await Promise.all(
          contractNumbers.map(async (contractNumber) => {
          const trimmed = contractNumber.trim()
            try {
            const contractResponse = await api.get(`/contracts?contract_id=${encodeURIComponent(trimmed)}&limit=1`)
              if (contractResponse.data.success && contractResponse.data.data.contracts.length > 0) {
                const contract = contractResponse.data.data.contracts[0]
                return {
                  contract_number: trimmed,
                  contract_qty: contract.quantity_ordered || 0,
                  outstanding_qty: contract.outstanding_quantity || 0,
                  sto_qty_assigned: 0,
                  po_number: contract.po_numbers || contract.po_number || '',
                  delivery_start_date: contract.delivery_start_date || null,
                  delivery_end_date: contract.delivery_end_date || null,
                  contract_ext_no: contract.contract_ext_no || null,
                  locked_from_sap: false
                }
              }
            } catch (err) {
            console.error(`Error fetching contract ${trimmed}:`, err)
            }
            return {
              contract_number: trimmed,
              contract_qty: 0,
              outstanding_qty: 0,
              sto_qty_assigned: 0,
              po_number: '',
              delivery_start_date: null,
              delivery_end_date: null,
              contract_ext_no: null,
              locked_from_sap: false
            }
          })
        )
      setContractDetailsMap(prev => ({ ...prev, [shipment.id]: fallbackDetails }))
    } catch (error) {
      console.error('Error fetching contract details:', error)
      // Fallback on error
      const contractNumbers = shipment.contract_numbers.split(', ').filter(c => c.trim())
      const details = contractNumbers.map((contractNumber) => ({
        contract_number: contractNumber.trim(),
        contract_qty: 0,
        outstanding_qty: 0,
        sto_qty_assigned: 0,
        po_number: '',
        delivery_start_date: null,
        delivery_end_date: null,
        contract_ext_no: null,
        locked_from_sap: false
      }))
      setContractDetailsMap(prev => ({ ...prev, [shipment.id]: details }))
    } finally {
      setLoadingContractDetails(prev => ({ ...prev, [shipment.id]: false }))
    }
  }

  // Update STO quantity assigned
  const handleUpdateStoQtyAssigned = async (shipmentId: string, contractNumber: string, stoNumber: string, newValue: number) => {
    const key = `${shipmentId}-${contractNumber}`
    setSavingStoQty(prev => ({ ...prev, [key]: true }))
    
    try {
      await api.put('/shipments/contracts/sto-qty', {
        sto: stoNumber,
        contractNumber: contractNumber,
        stoQtyAssigned: newValue
      })
      
      // Update local state
      setContractDetailsMap(prev => {
        const details = prev[shipmentId] || []
        const updated = details.map(d => 
          d.contract_number === contractNumber 
            ? { ...d, sto_qty_assigned: newValue }
            : d
        )
        return { ...prev, [shipmentId]: updated }
      })
    } catch (error) {
      console.error('Error updating STO quantity assigned:', error)
      alert('Failed to update STO quantity assigned. Please try again.')
    } finally {
      setSavingStoQty(prev => ({ ...prev, [key]: false }))
    }
  }

  // Expand/Collapse functions
  const toggleExpanded = (id: string) => {
    setExpandedShipmentIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        // Fetch contract details when expanding (for both single and multiple contracts)
        const shipment = sortedShipments.find(s => s.id === id)
        if (shipment && shipment.contract_numbers) {
          fetchContractDetails(shipment)
        }
      }
      return next
    })
  }

  const collapseAll = () => setExpandedShipmentIds(new Set())
  const expandAll = (ids: string[]) => setExpandedShipmentIds(new Set(ids))

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '-'
    try {
      const d = new Date(dateStr)
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
    } catch {
      return '-'
    }
  }

  // Column visibility and sorting
  const columnStorageKey = 'shipments.compact.visibleColumns'
  const sortStorageKey = 'shipments.compact.sort'

  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem(columnStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        return new Set(parsed)
      }
    } catch {}
    return new Set()
  })

  useEffect(() => {
    if (visibleColumnIds.size > 0) {
      localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(visibleColumnIds)))
    }
  }, [visibleColumnIds])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(sortStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        setSortKey(parsed.key || 'created_at')
        setSortDir(parsed.dir || 'desc')
      }
    } catch {}
  }, [])

  useEffect(() => {
    localStorage.setItem(sortStorageKey, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortKey, sortDir])

  const toggleColumn = (colId: string) => {
    if (colId === 'late_indicator' || colId === 'operation_id' || colId === 'shipment_id' || colId === 'status') return // Always visible
    setVisibleColumnIds(prev => {
      const next = new Set(prev)
      if (next.has(colId)) {
        next.delete(colId)
      } else {
        next.add(colId)
      }
      return next
    })
  }

  type CompactColumn = {
    id: string
    label: string
    defaultVisible: boolean
    sortable?: boolean
    formulaHelp?: string
    getSortValue?: (s: Shipment) => string | number
    render: (s: Shipment) => React.ReactNode
    className?: string
    headerClassName?: string
  }

  const compactColumns: CompactColumn[] = useMemo(() => [
    {
      id: 'late_indicator',
      label: 'Late Indicator',
      formulaHelp: FIELD_HELP.shipmentLateIndicator,
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => {
        const indicator = getLateIndicator(s)
        return indicator.text
      },
      render: (s) => {
        const indicator = getLateIndicator(s)
        return <Badge className={indicator.color}>{indicator.text}</Badge>
      }
    },
    {
      id: 'operation_id',
      label: 'Operation ID',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.operation_id || '',
      render: (s) => (
        <span className="text-sm break-words block" title={s.operation_id || ''}>
          {s.operation_id || '-'}
        </span>
      )
    },
    {
      id: 'shipment_id',
      label: 'STO No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.sto_number || '',
      render: (s) => (
        <span className="text-sm font-semibold break-words block">
          {s.sto_number || ''}
        </span>
      )
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.status || '',
      render: (s) => (
        <Badge className={getStatusColor(s.status)}>
          {s.status}
        </Badge>
      )
    },
    {
      id: 'contract_numbers',
      label: 'Contract Numbers',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.contract_numbers || s.contract_number || '',
      render: (s) => (
        <span className="text-sm break-words block" title={s.contract_numbers || s.contract_number || ''}>
          {s.contract_numbers || s.contract_number || '-'}
        </span>
      )
    },
    {
      id: 'po_numbers',
      label: 'PO No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.po_numbers || '',
      render: (s) => (
        <span className="text-sm break-words block" title={s.po_numbers || ''}>
          {s.po_numbers || '-'}
        </span>
      )
    },
    {
      id: 'contract_reference_po',
      label: 'CONTRACT REFF PO',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.contract_reference_po || '',
      render: (s) => (
        <span className="text-sm break-words block" title={s.contract_reference_po || ''}>
          {s.contract_reference_po || '-'}
        </span>
      )
    },
    {
      id: 'contract_ext_no',
      label: 'Contract Ext No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.contract_ext_no || '',
      render: (s) => (
        <span className="text-sm break-words block" title={s.contract_ext_no || ''}>
          {s.contract_ext_no || '-'}
        </span>
      )
    },
    // Due Date Delivery Start/End are shown in the Contract Details section,
    // so they are hidden from the compact view by default.
    {
      id: 'delivery_start',
      label: 'Due Date Delivery Start',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.delivery_start_date || '',
      render: (s) => <span className="text-sm">{formatShortDate(s.delivery_start_date || '')}</span>
    },
    {
      id: 'delivery_end',
      label: 'Due Date Delivery End',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.delivery_end_date || '',
      render: (s) => <span className="text-sm">{formatShortDate(s.delivery_end_date || '')}</span>
    },
    {
      id: 'ata_vessel_completed_loading',
      label: 'ATA Vessel Completed Loading',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.ata_vessel_completed_loading || '',
      render: (s) => <span className="text-sm">{formatShortDate(s.ata_vessel_completed_loading || '')}</span>
    },
    {
      id: 'ata_vessel_complete_discharge',
      label: 'ATA Vessel Complete Discharge',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.ata_vessel_complete_discharge || '',
      render: (s) => <span className="text-sm">{formatShortDate(s.ata_vessel_complete_discharge || '')}</span>
    },
    {
      id: 'vessel_name',
      label: 'Vessel Name',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.vessel_name || '',
      render: (s) => <span className="text-sm break-words">{s.vessel_name || '-'}</span>
    },
    {
      id: 'sto_quantity',
      label: 'STO Quantity',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.sto_quantity || s.total_quantity_shipped || s.quantity_shipped || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {formatNumber(s.sto_quantity || s.total_quantity_shipped || s.quantity_shipped || '-')} Kg
        </span>
      )
    },
    {
      id: 'quantity_receive',
      label: 'Quantity Received (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => (s.quantity_receive ?? 0),
      render: (s) => (
        <span className="text-sm break-words">
          {formatNumber(s.quantity_receive ?? '-')} Kg
        </span>
      )
    },
    {
      id: 'incoterm',
      label: 'Incoterm',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.incoterm || '',
      render: (s) => <span className="text-sm break-words">{s.incoterm || '-'}</span>
    },
    {
      id: 'b2b_flag',
      label: 'B2B Flag',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.b2b_flag || '',
      render: (s) => <span className="text-sm break-words">{s.b2b_flag || '-'}</span>
    },
    {
      id: 'port_of_loading',
      label: 'Port of Loading',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.port_of_loading || '',
      render: (s) => <span className="text-sm break-words">{s.port_of_loading || '-'}</span>
    },
    {
      id: 'port_of_discharge',
      label: 'Port of Discharge',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.port_of_discharge || s.plant_site || '',
      render: (s) => <span className="text-sm break-words">{s.port_of_discharge || s.plant_site || '-'}</span>
    },
    {
      id: 'voyage_no',
      label: 'Voyage No',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.voyage_no || '',
      render: (s) => <span className="text-sm">{s.voyage_no || '-'}</span>
    },
    {
      id: 'vessel_code',
      label: 'Vessel Code',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.vessel_code || '',
      render: (s) => <span className="text-sm">{s.vessel_code || '-'}</span>
    },
    {
      id: 'quantity_delivered',
      label: 'Quantity Delivered',
      defaultVisible: true,
      sortable: true,
      getSortValue: (s) => s.quantity_delivered_sap || s.total_quantity_delivered || s.quantity_delivered || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {formatNumber(s.quantity_delivered_sap ?? s.total_quantity_delivered ?? s.quantity_delivered ?? '-')} Kg
        </span>
      )
    },
    {
      id: 'estimated_nautical_miles',
      label: 'Estimated NM',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.estimated_nautical_miles || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {s.estimated_nautical_miles ? `${formatNumber(s.estimated_nautical_miles)} NM` : '-'}
        </span>
      )
    },
    {
      id: 'vessel_draft',
      label: 'Vessel Draft',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.vessel_draft || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {s.vessel_draft ? `${formatNumber(s.vessel_draft)} m` : '-'}
        </span>
      )
    },
    {
      id: 'vessel_loa',
      label: 'Vessel LOA',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.vessel_loa || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {s.vessel_loa ? `${formatNumber(s.vessel_loa)} m` : '-'}
        </span>
      )
    },
    {
      id: 'vessel_capacity',
      label: 'Vessel Capacity',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.vessel_capacity || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {s.vessel_capacity ? `${formatNumber(s.vessel_capacity)} Kg` : '-'}
        </span>
      )
    },
    {
      id: 'vessel_hull_type',
      label: 'Vessel Hull Type',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.vessel_hull_type || '',
      render: (s) => <span className="text-sm break-words">{s.vessel_hull_type || '-'}</span>
    },
    {
      id: 'vessel_registration_year',
      label: 'Vessel Registration Year',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.vessel_registration_year || 0,
      render: (s) => <span className="text-sm">{s.vessel_registration_year || '-'}</span>
    },
    {
      id: 'average_vessel_speed',
      label: 'Average Vessel Speed',
      defaultVisible: false,
      sortable: true,
      getSortValue: (s) => s.average_vessel_speed || 0,
      render: (s) => (
        <span className="text-sm break-words">
          {s.average_vessel_speed ? `${formatNumber(s.average_vessel_speed)} knots` : '-'}
        </span>
      )
    }
  ], [])

  const defaultVisibleColumnIds = useMemo(() => {
    return compactColumns.filter(c => c.defaultVisible).map(c => c.id)
  }, [compactColumns])

  useEffect(() => {
    if (visibleColumnIds.size === 0) {
      setVisibleColumnIds(new Set(defaultVisibleColumnIds))
    } else {
      // Ensure required columns are always included
      const required = [
        'late_indicator',
        'operation_id',
        'shipment_id',
        'status',
        // Key operational quantities should never "disappear" due to stored user preferences
        'sto_quantity',
        'quantity_receive',
        'quantity_delivered',
      ]
      const current = Array.from(visibleColumnIds)
      const missing = required.filter(id => !current.includes(id))
      if (missing.length > 0) {
        setVisibleColumnIds(new Set([...current, ...missing]))
      }
    }
  }, [defaultVisibleColumnIds, visibleColumnIds])

  const visibleColumns = useMemo(() => {
    const visible = compactColumns.filter(c => visibleColumnIds.has(c.id))
    // Ensure late_indicator, operation_id, shipment_id and status are always visible
    const lateIndicatorCol = compactColumns.find(c => c.id === 'late_indicator')
    const operationIdCol = compactColumns.find(c => c.id === 'operation_id')
    const shipmentIdCol = compactColumns.find(c => c.id === 'shipment_id')
    const statusCol = compactColumns.find(c => c.id === 'status')
    
    // Build visible columns with required ones always included
    const requiredCols: typeof compactColumns = []
    if (lateIndicatorCol) requiredCols.push(lateIndicatorCol)
    if (operationIdCol) requiredCols.push(operationIdCol)
    if (shipmentIdCol) requiredCols.push(shipmentIdCol)
    if (statusCol) requiredCols.push(statusCol)
    
    // Add required columns if they're not already visible
    const visibleIds = new Set(visible.map(c => c.id))
    const missingRequired = requiredCols.filter(col => !visibleIds.has(col.id))
    const visibleWithRequired = [...visible, ...missingRequired]
    
    const ordered = [
      ...visibleWithRequired.filter(c => c.id === 'late_indicator'),
      ...visibleWithRequired.filter(c => c.id === 'operation_id'),
      ...visibleWithRequired.filter(c => c.id === 'shipment_id'),
      ...visibleWithRequired.filter(c => c.id === 'status'),
      ...visibleWithRequired.filter(c => c.id !== 'late_indicator' && c.id !== 'operation_id' && c.id !== 'shipment_id' && c.id !== 'status')
    ]
    return ordered
  }, [compactColumns, visibleColumnIds, editingId])

  const sortedShipments = useMemo(() => {
    const col = compactColumns.find(c => c.id === sortKey)
    if (!col?.sortable || !col.getSortValue) return filteredShipments

    const sorted = [...filteredShipments].sort((a, b) => {
      const aVal = col.getSortValue!(a)
      const bVal = col.getSortValue!(b)
      const dirMul = sortDir === 'asc' ? 1 : -1

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dirMul
      }
      return String(aVal).localeCompare(String(bVal)) * dirMul
    })

    return sorted
  }, [compactColumns, filteredShipments, sortDir, sortKey])

  const allVisibleIds = useMemo(() => sortedShipments.map(s => s.id), [sortedShipments])
  const expandedCount = expandedShipmentIds.size
  const allExpanded = expandedCount > 0 && expandedCount === allVisibleIds.length

  // Sync scroll between top and bottom scrollbars
  useEffect(() => {
    const topEl = topScrollRef.current
    const bottomEl = bottomScrollRef.current
    if (!topEl || !bottomEl) return

    const handleTopScroll = () => {
      if (isSyncingScroll.current) return
      isSyncingScroll.current = true
      bottomEl.scrollLeft = topEl.scrollLeft
      setTimeout(() => { isSyncingScroll.current = false }, 50)
    }

    const handleBottomScroll = () => {
      if (isSyncingScroll.current) return
      isSyncingScroll.current = true
      topEl.scrollLeft = bottomEl.scrollLeft
      setTimeout(() => { isSyncingScroll.current = false }, 50)
    }

    topEl.addEventListener('scroll', handleTopScroll)
    bottomEl.addEventListener('scroll', handleBottomScroll)

    return () => {
      topEl.removeEventListener('scroll', handleTopScroll)
      bottomEl.removeEventListener('scroll', handleBottomScroll)
    }
  }, [visibleColumns, sortedShipments.length])

  // Update table scroll width when content changes
  useEffect(() => {
    const bottomEl = bottomScrollRef.current
    if (bottomEl) {
      setTableScrollWidth(bottomEl.scrollWidth)
    }
  }, [visibleColumns, sortedShipments.length])

  // Vessel loading port functions
  const fetchLoadingPorts = async (shipmentId: string, skipCache = false) => {
    try {
      const url = skipCache
        ? `/shipments/${shipmentId}/loading-ports?_t=${Date.now()}`
        : `/shipments/${shipmentId}/loading-ports`
      const response = await api.get(url)
      console.log('Loading ports response:', response.data)
      if (response.data.success) {
        // Handle new response structure: { ports: [], shipmentInfo: {} }
        if (response.data.data && typeof response.data.data === 'object' && 'ports' in response.data.data) {
          setLoadingPorts(response.data.data.ports || [])
          // Always set shipmentInfo, even if null - we'll fetch it separately if needed
          const info = response.data.data.shipmentInfo
          console.log('ShipmentInfo from response:', info)
          if (info) {
            setShipmentInfo(info)
          } else {
            // Fallback: fetch shipment data directly if shipmentInfo is not in response
            console.log('ShipmentInfo not in response, fetching directly...')
            try {
              // Try with the same identifier first
              const shipmentResponse = await api.get(`/shipments/${shipmentId}`)
              if (shipmentResponse.data.success && shipmentResponse.data.data) {
                const s = shipmentResponse.data.data
                console.log('Fetched shipment data:', s)
                setShipmentInfo({
                  quantity_delivered: s.quantity_delivered,
                  actual_vessel_qty_receive: s.actual_vessel_qty_receive,
                  vessel_oa_actual: s.vessel_oa_actual,
                  vessel_oa_budget: s.vessel_oa_budget,
                  bl_quantity: s.bl_quantity,
                  vessel_loading_port_1: s.port_of_loading,
                  ata_vessel_arrival_at_loading_port: s.ata_arrival,
                  ata_vessel_berthed_at_loading_port: s.ata_berthed,
                  ata_vessel_start_loading: s.ata_loading_start,
                  ata_vessel_completed_loading: s.ata_loading_complete,
                  ata_vessel_sailed_from_loading_port: s.ata_sailed,
                  ata_vessel_arrive_at_discharge_port: s.ata_discharge_arrival,
                  ata_vessel_berthed_at_discharge_port: s.ata_discharge_berthed,
                  ata_vessel_start_discharging: s.ata_discharge_start,
                  ata_vessel_complete_discharge: s.ata_discharge_complete
                })
              } else {
                console.warn('Shipment data fetch returned no data')
                setShipmentInfo(null)
              }
            } catch (err) {
              console.error('Error fetching shipment data:', err)
              setShipmentInfo(null)
            }
          }
        } else {
          // Fallback for old response structure (array)
          console.warn('Unexpected response structure:', response.data.data)
          setLoadingPorts(Array.isArray(response.data.data) ? response.data.data : [])
          setShipmentInfo(null)
        }
      } else {
        console.error('API returned success: false', response.data)
      }
    } catch (error) {
      console.error('Error fetching loading ports:', error)
      setLoadingPorts([])
      setShipmentInfo(null)
    }
  }

  const handleViewLoadingPorts = async (shipment: Shipment) => {
    setSelectedShipment(shipment)
    setShowLoadingPorts(true)
    // For editing/saving we always work per specific shipment (UUID)
    await fetchLoadingPorts(shipment.id)
  }

  const handleSaveLoadingPort = async () => {
    if (!selectedShipment) return

    try {
      const portData = newPort
      const response = await api.post(`/shipments/${selectedShipment.id}/loading-ports`, portData)
      
      if (response.data.success) {
        await fetchLoadingPorts(selectedShipment.id)
        setNewPort({
          port_name: '',
          port_sequence: loadingPorts.length + 1,
          quantity_at_loading_port: 0,
          eta_vessel_arrival: '',
          ata_vessel_arrival: '',
          eta_vessel_berthed: '',
          ata_vessel_berthed: '',
          eta_loading_start: '',
          ata_loading_start: '',
          eta_loading_completed: '',
          ata_loading_completed: '',
          eta_vessel_sailed: '',
          ata_vessel_sailed: '',
          eta_vessel_berthed_at_loading_port: '',
          eta_vessel_arrive_at_discharge_port: '',
          eta_vessel_berthed_at_discharge_port: '',
          eta_vessel_start_discharging: '',
          eta_vessel_complete_discharge: '',
          loading_rate: 0,
          is_discharge_port: false
        })
        alert('Loading port added successfully!')
      }
    } catch (error) {
      console.error('Error saving loading port:', error)
      alert('Failed to save loading port')
    }
  }

  const handleDeleteLoadingPort = async (portId: string) => {
    if (!selectedShipment) return

    try {
      const response = await api.delete(`/shipments/${selectedShipment.id}/loading-ports/${portId}`)
      if (response.data.success) {
        await fetchLoadingPorts(selectedShipment.id)
        alert('Loading port deleted successfully!')
      }
    } catch (error) {
      console.error('Error deleting loading port:', error)
      alert('Failed to delete loading port')
    }
  }

  const handleEditPort = (port: VesselLoadingPort) => {
    if (port.id) {
      setEditingPortId(port.id)
      setEditedPortData({ ...port })
    }
  }

  const handleCancelEditPort = () => {
    setEditingPortId(null)
    setEditedPortData(null)
  }

  const handleSavePort = async (portId: string) => {
    if (!selectedShipment || !editedPortData) return

    try {
      const portData = { ...editedPortData, id: portId }
      // Use PUT for updates
      const response = await api.put(`/shipments/${selectedShipment.id}/loading-ports/${portId}`, portData)
      
      if (response.data.success) {
        await fetchLoadingPorts(selectedShipment.id)
        setEditingPortId(null)
        setEditedPortData(null)
        alert('Loading port updated successfully!')
      }
    } catch (error) {
      console.error('Error saving loading port:', error)
      alert('Failed to save loading port')
    }
  }

  const handleCancelEditAll = () => {
    handleCancelEditShipmentInfo()
    handleCancelEditPort()
  }

  const handleSaveAll = async () => {
    // Save overall shipment info (includes first loading + first discharge port ETA)
    await handleSaveShipmentInfo()

    // Only save the edited port separately when it's an *additional* port (not the first loading/discharge already saved above)
    if (editingPortId) {
      const firstLoading = loadingPorts.find(p => !p.is_discharge_port)
      const firstDischarge = loadingPorts.find(p => p.is_discharge_port)
      const isFirstPort = editingPortId === firstLoading?.id || editingPortId === firstDischarge?.id
      if (!isFirstPort) {
        await handleSavePort(editingPortId)
      }
    }

    setEditingPortId(null)
    setEditedPortData(null)
  }

  const handleEditShipmentInfo = () => {
    if (shipmentInfo) {
      // Initialize with all fields including ETA
      setEditedShipmentInfo({ 
        ...shipmentInfo,
        // Ensure ETA fields are included
        eta_vessel_arrival_at_loading_port: shipmentInfo.eta_vessel_arrival_at_loading_port || '',
        eta_vessel_berthed_at_loading_port: shipmentInfo.eta_vessel_berthed_at_loading_port || '',
        eta_vessel_start_loading: shipmentInfo.eta_vessel_start_loading || '',
        eta_vessel_completed_loading: shipmentInfo.eta_vessel_completed_loading || '',
        eta_vessel_sailed_from_loading_port: shipmentInfo.eta_vessel_sailed_from_loading_port || '',
        eta_vessel_arrive_at_discharge_port: shipmentInfo.eta_vessel_arrive_at_discharge_port || '',
        eta_vessel_berthed_at_discharge_port: shipmentInfo.eta_vessel_berthed_at_discharge_port || '',
        eta_vessel_start_discharging: shipmentInfo.eta_vessel_start_discharging || '',
        eta_vessel_complete_discharge: shipmentInfo.eta_vessel_complete_discharge || '',
        vessel_loading_port_1: shipmentInfo.vessel_loading_port_1 || '',
        vessel_discharge_port_1: shipmentInfo.vessel_discharge_port_1 || ''
      })
      setEditingShipmentInfo(true)
    }
  }

  const handleCancelEditShipmentInfo = () => {
    setEditingShipmentInfo(false)
    setEditedShipmentInfo(null)
  }

  const handleSaveShipmentInfo = async () => {
    if (!selectedShipment || !editedShipmentInfo) return

    try {
      // Always work with specific shipment UUID for loading ports
      const identifier = selectedShipment.id
      
      // Map the edited fields to the update format
      const updateData: any = {
        shipment_id: selectedShipment.shipment_id
      }

      // Add fields that can be updated in shipments table
      if (editedShipmentInfo.quantity_delivered !== undefined) {
        updateData.quantity_delivered = editedShipmentInfo.quantity_delivered
      }
      if (editedShipmentInfo.actual_vessel_qty_receive !== undefined) {
        updateData.actual_vessel_qty_receive = editedShipmentInfo.actual_vessel_qty_receive
      }
      if (editedShipmentInfo.vessel_oa_actual !== undefined) {
        updateData.vessel_oa_actual = editedShipmentInfo.vessel_oa_actual
      }
      if (editedShipmentInfo.vessel_oa_budget !== undefined) {
        updateData.vessel_oa_budget = editedShipmentInfo.vessel_oa_budget
      }
      if (editedShipmentInfo.bl_quantity !== undefined) {
        updateData.bl_quantity = editedShipmentInfo.bl_quantity
      }
      if (editedShipmentInfo.vessel_loading_port_1 !== undefined && editedShipmentInfo.vessel_loading_port_1 !== '' && editedShipmentInfo.vessel_loading_port_1 !== '0.00') {
        updateData.port_of_loading = editedShipmentInfo.vessel_loading_port_1
      }
      if (editedShipmentInfo.vessel_discharge_port_1 !== undefined && editedShipmentInfo.vessel_discharge_port_1 !== '' && editedShipmentInfo.vessel_discharge_port_1 !== '0.00') {
        updateData.port_of_discharge = editedShipmentInfo.vessel_discharge_port_1
      }

      // Save shipment data
      const response = await api.put(`/shipments/${selectedShipment.id}`, updateData)
      
      if (response.data.success) {
        // Refresh loading ports to get the latest data before saving ETA fields
        const refreshedPortsResponse = await api.get(`/shipments/${identifier}/loading-ports`)
        let refreshedPorts: any[] = []
        if (refreshedPortsResponse.data.success && refreshedPortsResponse.data.data.ports) {
          refreshedPorts = refreshedPortsResponse.data.data.ports
        }
        
        // Now save ETA fields to the first loading port
        // Find ANY existing loading port (prefer port_sequence 1, but use any if available)
        let firstPort = refreshedPorts.find((p: any) => !p.is_discharge_port && p.port_sequence === 1) 
                     || refreshedPorts.find((p: any) => !p.is_discharge_port)
                     || loadingPorts.find(p => !p.is_discharge_port && p.port_sequence === 1)
                     || loadingPorts.find(p => !p.is_discharge_port)

        // Detect if shipment already has any loading port at all
        const hasAnyLoadingPort =
          refreshedPorts.some((p: any) => !p.is_discharge_port) ||
          loadingPorts.some(p => !p.is_discharge_port)

        if (firstPort && firstPort.id) {
          // Update existing loading port: merge existing port data so backend does not overwrite with null
          const toDateStr = (v: unknown) => (v != null && v !== '' ? String(v).split('T')[0] : null)
          const loadingPortUpdateData: any = {
            port_name: editedShipmentInfo.vessel_loading_port_1 || firstPort.port_name || 'Loading Port 1',
            port_sequence: firstPort.port_sequence ?? 1,
            quantity_at_loading_port: editedShipmentInfo.actual_vessel_qty_receive ?? firstPort.quantity_at_loading_port ?? 0,
            is_discharge_port: false,
            // ETA from form (override); use existing firstPort values as fallback so we don't clear other fields
            eta_vessel_arrival: toDateStr(editedShipmentInfo.eta_vessel_arrival_at_loading_port) ?? toDateStr(firstPort.eta_vessel_arrival),
            eta_vessel_berthed_at_loading_port: toDateStr(editedShipmentInfo.eta_vessel_berthed_at_loading_port) ?? toDateStr(firstPort.eta_vessel_berthed_at_loading_port),
            eta_loading_start: toDateStr(editedShipmentInfo.eta_vessel_start_loading) ?? toDateStr(firstPort.eta_loading_start),
            eta_loading_completed: toDateStr(editedShipmentInfo.eta_vessel_completed_loading) ?? toDateStr(firstPort.eta_loading_completed),
            eta_vessel_sailed: toDateStr(editedShipmentInfo.eta_vessel_sailed_from_loading_port) ?? toDateStr(firstPort.eta_vessel_sailed),
            // Preserve existing ATA so backend UPDATE does not overwrite with null
            ata_vessel_arrival: toDateStr(firstPort.ata_vessel_arrival),
            ata_vessel_berthed: toDateStr(firstPort.ata_vessel_berthed),
            ata_loading_start: toDateStr(firstPort.ata_loading_start),
            ata_loading_completed: toDateStr(firstPort.ata_loading_completed),
            ata_vessel_sailed: toDateStr(firstPort.ata_vessel_sailed),
            eta_vessel_arrive_at_discharge_port: null,
            eta_vessel_berthed_at_discharge_port: null,
            eta_vessel_start_discharging: null,
            eta_vessel_complete_discharge: null
          }
          
          await api.put(`/shipments/${identifier}/loading-ports/${firstPort.id}`, loadingPortUpdateData)
        } else if (
          !hasAnyLoadingPort &&
          (
            editedShipmentInfo.eta_vessel_arrival_at_loading_port ||
            editedShipmentInfo.eta_vessel_berthed_at_loading_port ||
            editedShipmentInfo.eta_vessel_start_loading ||
            editedShipmentInfo.eta_vessel_completed_loading ||
            editedShipmentInfo.eta_vessel_sailed_from_loading_port ||
            editedShipmentInfo.vessel_loading_port_1
          )
        ) {
          // Create a first loading port ONLY if none exists yet and user entered ETA/port data
          const newPortData: any = {
            port_name: editedShipmentInfo.vessel_loading_port_1 || 'Loading Port 1',
            port_sequence: 1,
            quantity_at_loading_port: editedShipmentInfo.actual_vessel_qty_receive || 0,
            is_discharge_port: false,
            eta_vessel_arrival: editedShipmentInfo.eta_vessel_arrival_at_loading_port || null,
            eta_vessel_berthed_at_loading_port: editedShipmentInfo.eta_vessel_berthed_at_loading_port || null,
            eta_loading_start: editedShipmentInfo.eta_vessel_start_loading || null,
            eta_loading_completed: editedShipmentInfo.eta_vessel_completed_loading || null,
            eta_vessel_sailed: editedShipmentInfo.eta_vessel_sailed_from_loading_port || null,
          }

          await api.post(`/shipments/${identifier}/loading-ports`, newPortData)
        }
        
        // Handle discharge port ETA fields separately
        // Use refreshed ports list - refresh again after loading port operations
        const finalPortsResponse = await api.get(`/shipments/${identifier}/loading-ports`)
        let finalPorts: any[] = []
        if (finalPortsResponse.data.success && finalPortsResponse.data.data.ports) {
          finalPorts = finalPortsResponse.data.data.ports
        }
        let dischargePort = finalPorts.find((p: any) => p.is_discharge_port) || refreshedPorts.find((p: any) => p.is_discharge_port) || loadingPorts.find(p => p.is_discharge_port)
        if (dischargePort && dischargePort.id) {
          const toDateStrD = (v: unknown) => (v != null && v !== '' ? String(v).split('T')[0] : null)
          const dischargePortUpdateData: any = {
            port_name: editedShipmentInfo.vessel_discharge_port_1 || dischargePort.port_name || 'Discharge Port',
            port_sequence: dischargePort.port_sequence ?? 999,
            quantity_at_loading_port: dischargePort.quantity_at_loading_port ?? 0,
            is_discharge_port: true,
            eta_vessel_arrive_at_discharge_port: toDateStrD(editedShipmentInfo.eta_vessel_arrive_at_discharge_port) ?? toDateStrD(dischargePort.eta_vessel_arrive_at_discharge_port),
            eta_vessel_berthed_at_discharge_port: toDateStrD(editedShipmentInfo.eta_vessel_berthed_at_discharge_port) ?? toDateStrD(dischargePort.eta_vessel_berthed_at_discharge_port),
            eta_vessel_start_discharging: toDateStrD(editedShipmentInfo.eta_vessel_start_discharging) ?? toDateStrD(dischargePort.eta_vessel_start_discharging),
            eta_vessel_complete_discharge: toDateStrD(editedShipmentInfo.eta_vessel_complete_discharge) ?? toDateStrD(dischargePort.eta_vessel_complete_discharge),
            eta_vessel_arrival: null,
            eta_vessel_berthed_at_loading_port: null,
            eta_loading_start: null,
            eta_loading_completed: null,
            eta_vessel_sailed: null,
            ata_vessel_arrival: toDateStrD(dischargePort.ata_vessel_arrival),
            ata_vessel_berthed: toDateStrD(dischargePort.ata_vessel_berthed),
            ata_loading_start: toDateStrD(dischargePort.ata_loading_start),
            ata_loading_completed: toDateStrD(dischargePort.ata_loading_completed),
            ata_vessel_sailed: toDateStrD(dischargePort.ata_vessel_sailed)
          }
          await api.put(`/shipments/${identifier}/loading-ports/${dischargePort.id}`, dischargePortUpdateData)
        }
        
        // Refetch so Shipment Information (including ETA) shows saved data (skipCache to avoid stale response)
        await fetchLoadingPorts(identifier, true)
        setEditingShipmentInfo(false)
        setEditedShipmentInfo(null)
        alert('Shipment information updated successfully!')
      }
    } catch (error) {
      console.error('Error saving shipment info:', error)
      alert('Failed to save shipment information')
    }
  }

  // Document functions
  const handleUploadFileChange = async (shipment: Shipment, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const allowed = ['application/pdf', 'image/png', 'image/jpeg']
    if (!allowed.includes(file.type)) {
      alert('Only PDF, PNG, or JPEG files are allowed.')
      e.target.value = ''
      return
    }

    setUploadingId(shipment.id)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', 'OTHER')
      form.append('shipment_id', shipment.id)

      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.data?.success) {
        alert('Document uploaded successfully!')
        if (selectedShipment && selectedShipment.id === shipment.id) {
          await fetchShipmentDocuments(shipment.id)
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

  const fetchShipmentDocuments = async (shipmentInternalId: string) => {
    try {
      setDocsLoading(true)
      const params = new URLSearchParams()
      params.append('shipmentId', shipmentInternalId)
      const res = await api.get(`/documents?${params.toString()}`)
      const docs: DocumentItem[] = res.data?.data || []
      setShipmentDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setShipmentDocs([])
    } finally {
      setDocsLoading(false)
    }
  }

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${docId}/download`, {
        responseType: 'blob'
      })
      
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

  const handleViewDocuments = async (shipment: Shipment) => {
    setSelectedShipment(shipment)
    setShowDocs(true)
    await fetchShipmentDocuments(shipment.id)
  }

  // Add new shipment functions
  const handleStoNumberChange = async (stoNumber: string) => {
    setNewShipment(prev => ({ ...prev, stoNumber }))
    
    if (stoNumber.length >= 3) {
      try {
        const response = await api.get(`/shipments/check-sto/${stoNumber}`)
        if (response.data.success) {
          if (response.data.exists) {
            setStoValidation({
              exists: true,
              message: `STO Number ${stoNumber} already exists with contracts: ${response.data.data.contract_numbers}`
            })
          } else {
            setStoValidation({
              exists: false,
              message: `STO Number ${stoNumber} is available`
            })
          }
        }
      } catch (error) {
        console.error('Error checking STO:', error)
        setStoValidation(null)
      }
    } else {
      setStoValidation(null)
    }
  }

  const handleContractSearch = async (searchTerm: string) => {
    setContractSearchTerm(searchTerm)
    
    if (searchTerm.length >= 2) {
      try {
        const response = await api.get(`/shipments/contracts/suggestions?q=${encodeURIComponent(searchTerm)}`)
        if (response.data.success) {
          setContractSuggestions(response.data.data)
          setShowContractSuggestions(true)
        }
      } catch (error) {
        console.error('Error fetching contract suggestions:', error)
        setContractSuggestions([])
      }
    } else {
      setContractSuggestions([])
      setShowContractSuggestions(false)
    }
  }

  const validateContractNumber = async (contractNumber: string) => {
    if (!contractNumber || contractNumber.trim() === '') {
      setContractValidations(prev => {
        const next = { ...prev }
        delete next[contractNumber]
        return next
      })
      return
    }

    setContractValidations(prev => ({
      ...prev,
      [contractNumber]: {
        checking: true,
        exists: false,
        contractData: null,
        message: 'Validating...'
      }
    }))

    try {
      const response = await api.get(`/shipments/contracts/validate?contract_number=${encodeURIComponent(contractNumber)}`)
      if (response.data.success) {
        if (response.data.exists) {
          setContractValidations(prev => ({
            ...prev,
            [contractNumber]: {
              checking: false,
              exists: true,
              contractData: response.data.data,
              message: 'Contract found'
            }
          }))
          // Auto-fill contract information
          autoFillContractInfo(response.data.data)
        } else {
          setContractValidations(prev => ({
            ...prev,
            [contractNumber]: {
              checking: false,
              exists: false,
              contractData: null,
              message: 'Contract number does not exist'
            }
          }))
        }
      }
    } catch (error) {
      console.error('Error validating contract:', error)
      setContractValidations(prev => ({
        ...prev,
        [contractNumber]: {
          checking: false,
          exists: false,
          contractData: null,
          message: 'Error validating contract number'
        }
      }))
    }
  }

  const autoFillContractInfo = (contractData: any) => {
      setNewShipment(prev => ({
        ...prev,
      // Auto-fill port information if not already set
      portOfLoading: prev.portOfLoading || contractData.port_of_loading || '',
      portOfDischarge: prev.portOfDischarge || contractData.port_of_discharge || ''
      // Note: STO number is NOT auto-filled - user must explicitly enter it if needed
    }))
  }

  const handleAddContract = async (contract: any) => {
    const contractId = contract.contract_id || contract
    if (!newShipment.contractNumbers.includes(contractId)) {
      // Validate contract before adding
      await validateContractNumber(contractId)
      
      setNewShipment(prev => ({
        ...prev,
        contractNumbers: [...prev.contractNumbers, contractId]
      }))
      setContractQtyAssigned(prev => ({ ...prev, [contractId]: prev[contractId] ?? '' }))
    }
    setContractSearchTerm('')
    setShowContractSuggestions(false)
  }

  const handleAddContractManually = async () => {
    const contractId = contractSearchTerm.trim()
    if (!contractId) return
    
    // Validate contract before adding
    await validateContractNumber(contractId)
    
    if (!newShipment.contractNumbers.includes(contractId)) {
      setNewShipment(prev => ({
        ...prev,
        contractNumbers: [...prev.contractNumbers, contractId]
      }))
      setContractQtyAssigned(prev => ({ ...prev, [contractId]: prev[contractId] ?? '' }))
    }
    setContractSearchTerm('')
    setShowContractSuggestions(false)
  }

  const handleRemoveContract = (contractId: string) => {
    setNewShipment(prev => ({
      ...prev,
      contractNumbers: prev.contractNumbers.filter(id => id !== contractId)
    }))
    setContractQtyAssigned(prev => {
      const next = { ...prev }
      delete next[contractId]
      return next
    })
    // Remove validation state
    setContractValidations(prev => {
      const next = { ...prev }
      delete next[contractId]
      return next
    })
  }

  // --- Master Vessel / Loading Port helpers for NEW shipment ---
  const fetchVesselSuggestions = async (search: string) => {
    if (!search || search.trim().length < 2) {
      setVesselSuggestions([])
      return
    }
    try {
      const res = await api.get('/master-vessels', { params: { search: search.trim(), limit: 20 } })
      const items = res.data?.data?.items ?? []
      setVesselSuggestions(items)
      setShowVesselSuggestions(true)
    } catch {
      setVesselSuggestions([])
    }
  }

  const fetchPortSuggestions = async (search: string) => {
    if (!search || search.trim().length < 2) {
      setPortSuggestions([])
      return
    }
    try {
      const res = await api.get('/master-loading-ports', { params: { search: search.trim(), limit: 20 } })
      const items = res.data?.data?.items ?? []
      setPortSuggestions(items)
      setShowPortSuggestions(true)
    } catch {
      setPortSuggestions([])
    }
  }

  const handleVesselNameChange = (value: string) => {
    setNewShipment(prev => ({ ...prev, vesselName: value }))
    if (vesselSearchTimeoutRef.current) clearTimeout(vesselSearchTimeoutRef.current)
    vesselSearchTimeoutRef.current = setTimeout(() => fetchVesselSuggestions(value), 300)
  }

  const handleSelectVessel = (v: { vessel_code: string; vessel_name: string; vessel_capacity_mt: number | null; vessel_owner: string | null; hull_type: string | null }) => {
    setNewShipment(prev => ({
      ...prev,
      vesselName: v.vessel_name,
      vesselCode: v.vessel_code ?? '',
      vesselOwner: v.vessel_owner ?? '',
      vesselCapacity: v.vessel_capacity_mt != null ? String(v.vessel_capacity_mt) : '',
      vesselHullType: v.hull_type ?? ''
    }))
    setShowVesselSuggestions(false)
    setVesselSuggestions([])
  }

  const handlePortOfLoadingChange = (value: string) => {
    setNewShipment(prev => ({ ...prev, portOfLoading: value }))
    if (portSearchTimeoutRef.current) clearTimeout(portSearchTimeoutRef.current)
    portSearchTimeoutRef.current = setTimeout(() => fetchPortSuggestions(value), 300)
  }

  const handleSelectPort = (p: { port: string }) => {
    setNewShipment(prev => ({ ...prev, portOfLoading: p.port }))
    setShowPortSuggestions(false)
    setPortSuggestions([])
  }

  const vesselCapacityNum = newShipment.vesselCapacity ? parseFloat(String(newShipment.vesselCapacity)) : null
  const contractQtyAssignedSum = useMemo(() => {
    return Object.values(contractQtyAssigned).reduce((sum, v) => sum + (parseFloat(String(v)) || 0), 0)
  }, [contractQtyAssigned])
  const contractQtyAssignedExceedsCapacity =
    vesselCapacityNum != null && !Number.isNaN(vesselCapacityNum) && contractQtyAssignedSum > vesselCapacityNum

  // --- Master Vessel / Loading Port helpers for EDITED shipment row ---
  const handleEditVesselNameChange = (value: string) => {
    setEditedData(prev => ({ ...prev, vessel_name: value }))
    if (vesselSearchTimeoutRef.current) clearTimeout(vesselSearchTimeoutRef.current)
    vesselSearchTimeoutRef.current = setTimeout(() => fetchVesselSuggestions(value), 300)
  }

  const handleSelectVesselForEdit = (v: { vessel_code: string; vessel_name: string; vessel_capacity_mt: number | null; vessel_owner: string | null; hull_type: string | null }) => {
    setEditedData(prev => ({
      ...prev,
      vessel_name: v.vessel_name,
      vessel_code: v.vessel_code ?? '',
      vessel_owner: v.vessel_owner ?? '',
      vessel_capacity: v.vessel_capacity_mt != null ? Number(v.vessel_capacity_mt) : null,
      vessel_hull_type: v.hull_type ?? '',
    }))
    setShowVesselSuggestions(false)
    setVesselSuggestions([])
  }

  const handleEditPortOfLoadingChange = (value: string) => {
    setEditedData(prev => ({ ...prev, port_of_loading: value }))
    if (portSearchTimeoutRef.current) clearTimeout(portSearchTimeoutRef.current)
    portSearchTimeoutRef.current = setTimeout(() => fetchPortSuggestions(value), 300)
  }

  const handleSelectPortForEdit = (p: { port: string }) => {
    setEditedData(prev => ({ ...prev, port_of_loading: p.port }))
    setShowPortSuggestions(false)
    setPortSuggestions([])
  }

  const handleCreateShipment = async () => {
    if (newShipment.contractNumbers.length === 0) {
      alert('Please add at least one Contract Number')
      return
    }

    // Validate all contracts exist
    const invalidContracts = newShipment.contractNumbers.filter(
      contractId => !contractValidations[contractId]?.exists
    )

    if (invalidContracts.length > 0) {
      alert(`The following contract numbers are invalid or do not exist: ${invalidContracts.join(', ')}`)
      return
    }

    if (contractQtyAssignedExceedsCapacity) {
      alert('Sum of "Contract Qty assign to STO" cannot exceed Vessel Capacity (Kg).')
      return
    }

    if (contractQtyAssignedExceedsCapacity) {
      alert('Sum of "Contract Qty assign to STO" cannot exceed Vessel Capacity (Kg).')
      return
    }

    // Don't validate STO number - it should remain empty for manual shipments
    // STO will be filled from SAP Data later

    try {
      setSaving(true)
      
      // Auto-generate Operation ID - one Operation ID for all contracts
      const operationId = `OP-${newShipment.contractNumbers[0]}-${Date.now().toString().slice(-8)}`
      
      const shipmentData = {
        ...newShipment,
        operationId,
        stoNumber: '', // Ensure STO Number remains empty - will be filled from SAP Data later
        contractQtyAssigned,
        eta_arrival: newShipment.etaVesselArrivalAtLoadingPort || null,
        eta_berthed: newShipment.etaVesselBerthedAtLoadingPort || null,
        eta_loading_start: newShipment.etaVesselStartLoading || null,
        eta_loading_complete: newShipment.etaVesselCompletedLoading || null,
        eta_sailed: newShipment.etaVesselSailedFromLoadingPort || null,
        eta_discharge_arrival: newShipment.etaVesselArriveAtDischargePort || null,
        eta_discharge_berthed: newShipment.etaVesselBerthedAtDischargePort || null,
        eta_discharge_start: newShipment.etaVesselStartDischarging || null,
        eta_discharge_complete: newShipment.etaVesselCompleteDischarge || null
      }
      const response = await api.post('/shipments', shipmentData)
      
      if (response.data.success) {
        alert('Shipment created successfully!')
        setShowAddShipment(false)
        setNewShipment({
          operationId: '',
          stoNumber: '',
          contractNumbers: [],
          vesselName: '',
          vesselCode: '',
          voyageNo: '',
          vesselOwner: '',
          vesselDraft: '',
          vesselCapacity: '',
          vesselHullType: '',
          charterType: '',
          portOfLoading: '',
          portOfDischarge: '',
          etaVesselArrivalAtLoadingPort: '',
          etaVesselBerthedAtLoadingPort: '',
          etaVesselStartLoading: '',
          etaVesselCompletedLoading: '',
          etaVesselSailedFromLoadingPort: '',
          etaVesselArriveAtDischargePort: '',
          etaVesselBerthedAtDischargePort: '',
          etaVesselStartDischarging: '',
          etaVesselCompleteDischarge: ''
        })
        setContractQtyAssigned({})
        setStoValidation(null)
        setContractValidations({})
        await fetchShipments() // Refresh the list
      } else {
        alert(response.data.error?.message || 'Failed to create shipment')
      }
    } catch (error: any) {
      console.error('Error creating shipment:', error)
      const errorMsg = error.response?.data?.error?.message || 'Failed to create shipment'
      const errorDetails = error.response?.data?.error?.details
      alert(errorMsg + (errorDetails ? `\n\nDetails: ${errorDetails}` : ''))
    } finally {
      setSaving(false)
    }
  }

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString()
  }

  const getColumnWidth = (colId: string): string => {
    const widths: { [key: string]: string } = {
      operation_id: '150px',
      shipment_id: '200px',
      status: '120px',
      contract_numbers: '180px',
      po_numbers: '150px',
      contract_reference_po: '150px',
      contract_ext_no: '150px',
      delivery_start: '180px',
      delivery_end: '180px',
      ata_vessel_completed_loading: '200px',
      ata_vessel_complete_discharge: '200px',
      late_indicator: '130px',
      vessel_name: '180px',
      sto_quantity: '140px',
      incoterm: '120px',
      b2b_flag: '100px',
      port_of_loading: '160px',
      port_of_discharge: '160px',
      quantity_receive: '140px',
      voyage_no: '120px',
      vessel_code: '120px',
      quantity_delivered: '140px'
    }
    return widths[colId] || '150px'
  }

  const onSortHeaderClick = (col: CompactColumn) => {
    if (!col.sortable) return
    if (sortKey === col.id) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(col.id)
      setSortDir('asc')
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold">Shipments</h1>
            <p className="text-gray-600 mt-1">
              Manage and track all shipments - {filteredShipments.length} total
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowAddShipment(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Shipment
            </Button>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <Button
              onClick={exportFilteredData}
              variant="outline"
              className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
            >
              <Download className="h-4 w-4 mr-2" />
              Export Data
            </Button>
            <>
              <input
                type="file"
                accept=".csv"
                onChange={handleBulkUpload}
                className="hidden"
                disabled={uploading}
                id="bulk-upload-input"
              />
              <Button
                onClick={() => document.getElementById('bulk-upload-input')?.click()}
                disabled={uploading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Bulk Update
                  </>
                )}
              </Button>
            </>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4 items-center">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search by Shipment ID, Contract Numbers, PO No, or Vessel Name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Status</option>
                <option value="PLANNED">Planned</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="ARRIVED">Arrived</option>
                <option value="UNLOADING">Unloading</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <select
                value={lateIndicatorFilter}
                onChange={(e) => setLateIndicatorFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Late Indicator</option>
                <option value="ON_TIME">On Time</option>
                <option value="LATE">Late</option>
                <option value="NA">N/A</option>
              </select>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">View by:</span>
                <select
                  value={viewOption}
                  onChange={(e) => {
                    setViewOption(e.target.value as 'all' | 'sto' | 'contract' | 'vessel' | 'port_loading' | 'port_discharge')
                    setViewFilterValue('')
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All</option>
                  <option value="sto">STO Number</option>
                  <option value="contract">Contract Numbers</option>
                  <option value="vessel">Vessel Name</option>
                  <option value="port_loading">Port of Loading</option>
                  <option value="port_discharge">Port of Discharge</option>
                </select>
                {viewOption !== 'all' && (
              <Input
                    placeholder={`Filter by ${
                      viewOption === 'sto' ? 'STO Number' 
                      : viewOption === 'contract' ? 'Contract Numbers' 
                      : viewOption === 'vessel' ? 'Vessel Name'
                      : viewOption === 'port_loading' ? 'Port of Loading'
                      : 'Port of Discharge'
                    }...`}
                    value={viewFilterValue}
                    onChange={(e) => setViewFilterValue(e.target.value)}
                className="w-48"
              />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Shipment Date:</span>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                <span className="text-gray-500">to</span>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
              </div>
              <Button onClick={handleFilterChange} variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-1" />
                Apply
              </Button>
              {(statusFilter !== 'ALL' || lateIndicatorFilter !== 'ALL' || viewFilterValue || dateFrom || dateTo) && (
                <Button 
                  onClick={() => {
                    setStatusFilter('ALL')
                    setLateIndicatorFilter('ALL')
                    setViewOption('all')
                    setViewFilterValue('')
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
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center gap-3 md:gap-6 overflow-x-auto py-4 px-4">
              {[
                { status: 'PLANNED', label: 'Planned', color: 'bg-blue-100', textColor: 'text-blue-800', badgeColor: 'bg-blue-600' },
                { status: 'IN_PROGRESS', label: 'In Progress', color: 'bg-yellow-100', textColor: 'text-yellow-800', badgeColor: 'bg-yellow-600' },
                { status: 'LOADING', label: 'Loading', color: 'bg-orange-100', textColor: 'text-orange-800', badgeColor: 'bg-orange-600' },
                { status: 'IN_TRANSIT', label: 'In Transit', color: 'bg-purple-100', textColor: 'text-purple-800', badgeColor: 'bg-purple-600' },
                { status: 'ARRIVED', label: 'Arrived', color: 'bg-indigo-100', textColor: 'text-indigo-800', badgeColor: 'bg-indigo-600' },
                { status: 'UNLOADING', label: 'Unloading', color: 'bg-cyan-100', textColor: 'text-cyan-800', badgeColor: 'bg-cyan-600' },
                { status: 'COMPLETED', label: 'Completed', color: 'bg-green-100', textColor: 'text-green-800', badgeColor: 'bg-green-600' },
                { status: 'CANCELLED', label: 'Cancelled', color: 'bg-red-100', textColor: 'text-red-800', badgeColor: 'bg-red-600' }
              ].map((statusInfo, index, array) => {
                const count = filteredShipments.filter(s => s.status === statusInfo.status).length
                return (
                  <div key={statusInfo.status} className="flex items-center flex-shrink-0">
                    <div className="relative">
                      {/* Status Circle */}
                      <div className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full ${statusInfo.color} flex items-center justify-center border-2 border-white shadow-lg hover:shadow-xl transition-shadow`}>
                        {/* Count Badge */}
                        <div className={`absolute -top-3 -right-3 ${statusInfo.badgeColor} text-white text-xs md:text-sm font-bold rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center shadow-lg z-10`}>
                          {count}
                        </div>
                        {/* Status Label */}
                        <span className={`text-xs md:text-sm font-semibold ${statusInfo.textColor} text-center px-2 leading-tight`}>
                          {statusInfo.label}
                        </span>
                      </div>
                    </div>
                    {/* Arrow */}
                    {index < array.length - 1 && (
                      <div className="flex-shrink-0 mx-2 md:mx-3">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-400">
                          <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* ETA Loading Status */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>ETA Loading Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                {
                  key: 'MORE_THAN_7D' as const,
                  label: 'ETA Loading &gt; 7D',
                  count: etaLoadingBuckets.counts.moreThan7D,
                  color: 'bg-sky-50',
                },
                {
                  key: 'D_MINUS_2' as const,
                  label: 'ETA Loading D-2',
                  count: etaLoadingBuckets.counts.dMinus2,
                  color: 'bg-amber-50',
                },
                {
                  key: 'D' as const,
                  label: 'ETA Loading D',
                  count: etaLoadingBuckets.counts.d,
                  color: 'bg-emerald-50',
                },
                {
                  key: 'DELAY' as const,
                  label: 'ETA Loading Delay',
                  count: etaLoadingBuckets.counts.delay,
                  color: 'bg-rose-50',
                },
                {
                  key: 'NO_ETA' as const,
                  label: 'No ETA',
                  count: etaLoadingBuckets.counts.noEta,
                  color: 'bg-gray-50',
                },
              ].map((bucket) => {
                const isActive = etaLoadingFilter === bucket.key
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => setEtaLoadingFilter((prev) => (prev === bucket.key ? 'ALL' : bucket.key))}
                    className={`flex flex-col items-start justify-between rounded-xl border px-3 py-3 text-left shadow-sm hover:shadow-md transition-shadow ${bucket.color} ${
                      isActive ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
                    }`}
                  >
                    <div className="text-xs text-gray-600 mb-1">{bucket.label}</div>
                    <div className="text-2xl font-semibold text-gray-900">{bucket.count}</div>
                    {isActive && (
                      <div className="mt-1 text-[11px] text-blue-700">
                        Click again to clear filter
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* ETA Discharge Status */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>ETA Discharge Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                {
                  key: 'MORE_THAN_7D' as const,
                  label: 'ETA Discharge > 7D',
                  count: etaDischargeBuckets.counts.moreThan7D,
                  color: 'bg-sky-50',
                },
                {
                  key: 'D_MINUS_2' as const,
                  label: 'ETA Discharge D-2',
                  count: etaDischargeBuckets.counts.dMinus2,
                  color: 'bg-amber-50',
                },
                {
                  key: 'D' as const,
                  label: 'ETA Discharge D',
                  count: etaDischargeBuckets.counts.d,
                  color: 'bg-emerald-50',
                },
                {
                  key: 'DELAY' as const,
                  label: 'ETA Discharge Delay',
                  count: etaDischargeBuckets.counts.delay,
                  color: 'bg-rose-50',
                },
                {
                  key: 'NO_ETA' as const,
                  label: 'No ETA',
                  count: etaDischargeBuckets.counts.noEta,
                  color: 'bg-gray-50',
                },
              ].map((bucket) => {
                const isActive = etaDischargeFilter === bucket.key
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => setEtaDischargeFilter((prev) => (prev === bucket.key ? 'ALL' : bucket.key))}
                    className={`flex flex-col items-start justify-between rounded-xl border px-3 py-3 text-left shadow-sm hover:shadow-md transition-shadow ${bucket.color} ${
                      isActive ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'
                    }`}
                  >
                    <div className="text-xs text-gray-600 mb-1">{bucket.label}</div>
                    <div className="text-2xl font-semibold text-gray-900">{bucket.count}</div>
                    {isActive && (
                      <div className="mt-1 text-[11px] text-blue-700">
                        Click again to clear filter
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Shipments List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>All Shipments</CardTitle>
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
                          .filter(c => c.id !== 'late_indicator' && c.id !== 'operation_id' && c.id !== 'shipment_id' && c.id !== 'status')
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
                  disabled={loading || sortedShipments.length === 0}
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
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading shipments...</div>
            ) : sortedShipments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p>No shipments found</p>
                {searchTerm && <p className="text-sm mt-2">Try adjusting your search filters</p>}
              </div>
            ) : (
              <>
                {/* Desktop compact table */}
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
                          const active = sortKey === col.id
                          const filterActive = isColumnFilterActive(col.id)
                          const filterType = getFilterTypeForColumn(col.id)
                          const current = columnFilters[col.id]

                          return (
                            <div key={col.id} className="relative min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <button
                                  type="button"
                                  className={`flex items-center gap-1 text-left min-w-0 ${col.sortable ? 'hover:text-gray-900' : ''}`}
                                  onClick={() => {
                                    if (col.sortable) {
                                      onSortHeaderClick(col)
                                    }
                                  }}
                                  title={col.sortable ? 'Sort' : undefined}
                                >
                                  <span className="truncate">{col.label}</span>
                                  {col.formulaHelp ? <FieldHelp text={col.formulaHelp} /> : null}
                                  {col.sortable && active && (
                                    sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                                  )}
                                </button>

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

                                  <div className="flex items-center justify-between mt-3 pt-2 border-t">
                                    <button
                                      type="button"
                                      className="text-xs text-gray-600 hover:text-gray-900"
                                      onClick={() => clearColumnFilter(col.id)}
                                      disabled={!filterActive}
                                    >
                                      Clear filter
                                    </button>
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
                        {sortedShipments.map((shipment, idx) => {
                          const isEditing = editingId === shipment.id
                          return (
                            <div key={shipment.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <div className="px-3 py-2">
                                <div
                                  className="grid gap-3 items-center"
                                  style={{
                                    gridTemplateColumns: `28px ${visibleColumns.map(c => getColumnWidth(c.id)).join(' ')} 320px`
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(shipment.id)}
                                    className="p-1 text-gray-500 hover:text-gray-800"
                                    title={expandedShipmentIds.has(shipment.id) ? 'Collapse' : 'Expand'}
                                  >
                                    {expandedShipmentIds.has(shipment.id) ? (
                                      <ChevronDown className="h-5 w-5" />
                                    ) : (
                                      <ChevronRight className="h-5 w-5" />
                                    )}
                                  </button>

                                  {visibleColumns.map(col => (
                                    <div key={col.id} className="min-w-0">
                                      {col.id === 'vessel_name' && isEditing ? (
                                        <div className="relative">
                                          <Input
                                            value={editedData.vessel_name ?? shipment.vessel_name ?? ''}
                                            onChange={(e) => handleEditVesselNameChange(e.target.value)}
                                            onFocus={() => (editedData.vessel_name ?? shipment.vessel_name ?? '').trim().length >= 2 && setShowVesselSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowVesselSuggestions(false), 200)}
                                            className="h-8 text-sm"
                                            placeholder="Type to search vessel (Master Vessel)"
                                          />
                                          {showVesselSuggestions && vesselSuggestions.length > 0 && (
                                            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-52 overflow-y-auto">
                                              {vesselSuggestions.map((v) => (
                                                <div
                                                  key={v.vessel_code}
                                                  className="px-2 py-1.5 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                                                  onMouseDown={() => handleSelectVesselForEdit(v)}
                                                >
                                                  <div className="text-xs font-medium truncate">{v.vessel_name}</div>
                                                  <div className="text-[11px] text-gray-500 truncate">
                                                    {v.vessel_code} {v.vessel_owner ? `• ${v.vessel_owner}` : ''}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ) : col.id === 'vessel_code' && isEditing ? (
                                        <Input
                                          value={editedData.vessel_code ?? shipment.vessel_code ?? ''}
                                          disabled
                                          className="h-8 text-sm bg-gray-100 cursor-not-allowed"
                                          placeholder="Filled from Master Vessel"
                                        />
                                      ) : col.id === 'vessel_owner' && isEditing ? (
                                        <Input
                                          value={editedData.vessel_owner ?? shipment.vessel_owner ?? ''}
                                          disabled
                                          className="h-8 text-sm bg-gray-100 cursor-not-allowed"
                                          placeholder="Filled from Master Vessel"
                                        />
                                      ) : col.id === 'vessel_capacity' && isEditing ? (
                                        <Input
                                          type="number"
                                          value={
                                            editedData.vessel_capacity != null
                                              ? String(editedData.vessel_capacity)
                                              : shipment.vessel_capacity != null
                                                ? String(shipment.vessel_capacity)
                                                : ''
                                          }
                                          disabled
                                          className="h-8 text-sm bg-gray-100 cursor-not-allowed"
                                          placeholder="Filled from Master Vessel"
                                        />
                                      ) : col.id === 'vessel_hull_type' && isEditing ? (
                                        <Input
                                          value={editedData.vessel_hull_type ?? shipment.vessel_hull_type ?? ''}
                                          disabled
                                          className="h-8 text-sm bg-gray-100 cursor-not-allowed"
                                          placeholder="Filled from Master Vessel"
                                        />
                                      ) : col.id === 'port_of_loading' && isEditing ? (
                                        <div className="relative">
                                          <Input
                                            value={editedData.port_of_loading ?? shipment.port_of_loading ?? ''}
                                            onChange={(e) => handleEditPortOfLoadingChange(e.target.value)}
                                            onFocus={() => (editedData.port_of_loading ?? shipment.port_of_loading ?? '').trim().length >= 2 && setShowPortSuggestions(true)}
                                            onBlur={() => setTimeout(() => setShowPortSuggestions(false), 200)}
                                            className="h-8 text-sm"
                                            placeholder="Type to search port (Master Loading Port)"
                                          />
                                          {showPortSuggestions && portSuggestions.length > 0 && (
                                            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-52 overflow-y-auto">
                                              {portSuggestions.map((p, idx) => (
                                                <div
                                                  key={p.port + (p.region || '') + idx}
                                                  className="px-2 py-1.5 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                                                  onMouseDown={() => handleSelectPortForEdit(p)}
                                                >
                                                  <div className="text-xs font-medium truncate">{p.port}</div>
                                                  {p.region && (
                                                    <div className="text-[11px] text-gray-500 truncate">{p.region}</div>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ) : col.id === 'status' && isEditing ? (
                                        <select
                                          value={editedData.status ?? shipment.status ?? ''}
                                          onChange={(e) => handleFieldChange('status', e.target.value)}
                                          className="h-8 text-sm px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-full bg-white"
                                        >
                                          <option value="">Select Status</option>
                                          <option value="PLANNED">PLANNED</option>
                                          <option value="IN_TRANSIT">IN_TRANSIT</option>
                                          <option value="ARRIVED">ARRIVED</option>
                                          <option value="UNLOADING">UNLOADING</option>
                                          <option value="COMPLETED">COMPLETED</option>
                                          <option value="CANCELLED">CANCELLED</option>
                                        </select>
                                      ) : (
                                        col.render(shipment)
                                      )}
                                    </div>
                                  ))}

                                  <div className="flex items-center justify-end gap-2 sticky right-0 bg-white border-l pl-3 pr-2 shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.35)]">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={handleCancelEdit}
                                          disabled={saving}
                                        >
                                          <X className="h-4 w-4 mr-1" />
                                          Cancel
                                        </Button>
                                        <Button
                                          size="sm"
                                          onClick={() => handleSave(shipment.id)}
                                          disabled={saving}
                                          className="bg-green-600 hover:bg-green-700"
                                        >
                                          {saving ? (
                                            <>
                                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                              Saving...
                                            </>
                                          ) : (
                                            <>
                                              <Save className="h-4 w-4 mr-1" />
                                              Save
                                            </>
                                          )}
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleEdit(shipment)}
                                          className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                        >
                                          <Edit2 className="h-4 w-4 mr-1" />
                                          Edit
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleViewLoadingPorts(shipment)}
                                          className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                        >
                                          <Ship className="h-4 w-4 mr-1" />
                                          Ports
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleViewDocuments(shipment)}
                                          className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                        >
                                          <Package className="h-4 w-4 mr-1" />
                                          Docs
                                        </Button>
                                        <input
                                          id={`shipment-file-${shipment.id}`}
                                          type="file"
                                          accept="application/pdf,image/png,image/jpeg"
                                          className="hidden"
                                          onChange={(e) => handleUploadFileChange(shipment, e)}
                                        />
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => document.getElementById(`shipment-file-${shipment.id}`)?.click()}
                                          disabled={uploadingId === shipment.id}
                                          className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                                        >
                                          {uploadingId === shipment.id ? (
                                            <>
                                              <span className="h-4 w-4 mr-2 inline-block border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                                              Uploading...
                                            </>
                                          ) : (
                                            <>
                                              <Upload className="h-4 w-4 mr-1" />
                                              Upload
                                            </>
                                          )}
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Expanded Details */}
                                {expandedShipmentIds.has(shipment.id) && (
                                  <div className="mt-3 p-3 border rounded bg-white">
                                    {/* Basic Info */}
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-4 pb-4 border-b">
                                      <div>
                                        <div className="text-gray-500">Source</div>
                                        <div className="font-medium">{shipment.source_type || shipment.supplier || '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Buyer</div>
                                        <div className="font-medium">{shipment.buyer || shipment.buyers || '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Group Name</div>
                                        <div className="font-medium">{shipment.group_name || shipment.group_names || '-'}</div>
                                      </div>
                                    </div>

                                    {/* Contract Details */}
                                    {contractDetailsMap[shipment.id] && contractDetailsMap[shipment.id].length > 0 ? (
                                      <div className="space-y-3">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="text-sm font-semibold text-gray-700">Contract Details ({shipment.contract_count} contracts)</div>
                                        </div>
                                        {contractDetailsMap[shipment.id].map((detail, idx) => {
                                          const key = `${shipment.id}-${detail.contract_number}`
                                          const isEditing = editingId === shipment.id
                                          const lockedFromSap = detail.locked_from_sap
                                          const displayValue = isEditing 
                                            ? (editedContractDetails[key] ?? detail.sto_qty_assigned ?? 0)
                                            : (detail.sto_qty_assigned ?? 0)
                                          return (
                                          <div key={idx} className="border rounded p-3 bg-gray-50">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                              <div>
                                                <div className="text-gray-500">Contract Number</div>
                                                <div className="font-medium">{detail.contract_number}</div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500">Contract Ext No</div>
                                                <div className="font-medium">{detail.contract_ext_no || '-'}</div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500">Contract Qty</div>
                                                <div className="font-medium">{formatNumber(detail.contract_qty)} Kg</div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500">Outstanding Qty</div>
                                                <div className={`font-medium ${detail.outstanding_qty < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                                  {formatNumber(detail.outstanding_qty)} Kg
                                                </div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500 mb-1">Contract Qty assign to STO</div>
                                                <div className="flex items-center gap-2">
                                                  {lockedFromSap ? (
                                                    <div className="font-medium">
                                                      {formatNumber(displayValue)} Kg{' '}
                                                      <span className="text-xs text-gray-500">(from SAP)</span>
                                                    </div>
                                                  ) : isEditing ? (
                                                    <Input
                                                      type="number"
                                                      value={displayValue}
                                                      onChange={(e) => {
                                                        const newValue = parseFloat(e.target.value) || 0
                                                        setEditedContractDetails(prev => ({ ...prev, [key]: newValue }))
                                                      }}
                                                      className="h-8 text-sm w-32"
                                                    />
                                                  ) : (
                                                    <div className="font-medium">{formatNumber(displayValue)} Kg</div>
                                                  )}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500">Due Date Delivery Start</div>
                                                <div className="font-medium">{formatShortDate(detail.delivery_start_date || '')}</div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500">Due Date Delivery End</div>
                                                <div className="font-medium">{formatShortDate(detail.delivery_end_date || '')}</div>
                                              </div>
                                            </div>
                                          </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        <div className="text-sm font-semibold text-gray-700 mb-2">Contract Details</div>
                                        <div className="text-gray-500 text-sm">No contract details available. Click "Load Contract Details" to fetch.</div>
                                      </div>
                                    )}
                                    {loadingContractDetails[shipment.id] && (
                                      <div className="text-center py-2 text-sm text-gray-500">
                                        <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                                        Loading contract details...
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mobile/tablet cards */}
                <div className="lg:hidden space-y-2">
                  {sortedShipments.map((shipment) => {
                    const isEditing = editingId === shipment.id
                    return (
                      <div
                        key={shipment.id}
                        className={`border rounded-lg transition-colors ${isEditing ? 'border-blue-300 bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className="p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(shipment.id)}
                                className="p-1 text-gray-500 hover:text-gray-800"
                                title={expandedShipmentIds.has(shipment.id) ? 'Collapse' : 'Expand'}
                              >
                                {expandedShipmentIds.has(shipment.id) ? (
                                  <ChevronDown className="h-5 w-5" />
                                ) : (
                                  <ChevronRight className="h-5 w-5" />
                                )}
                              </button>
                              <div className="min-w-0">
                                <div className="font-semibold truncate">{shipment.sto_number || shipment.operation_id || ''}</div>
                                <div className="text-xs text-gray-600 truncate">{shipment.vessel_name || '-'} • {shipment.contract_number || '-'}</div>
                              </div>
                              <Badge className={getStatusColor(shipment.status)}>
                                {shipment.status}
                              </Badge>
                            </div>
                            <div className="flex gap-2">
                              {isEditing ? (
                                <>
                                  <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={saving}>
                                    <X className="h-4 w-4 mr-1" />
                                    Cancel
                                  </Button>
                                  <Button size="sm" onClick={() => handleSave(shipment.id)} disabled={saving} className="bg-green-600 hover:bg-green-700">
                                    {saving ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        Saving...
                                      </>
                                    ) : (
                                      <>
                                        <Save className="h-4 w-4 mr-1" />
                                        Save
                                      </>
                                    )}
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button variant="outline" size="sm" onClick={() => handleEdit(shipment)} className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100">
                                    <Edit2 className="h-4 w-4 mr-1" />
                                    Edit
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => handleViewLoadingPorts(shipment)} className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                                    <Ship className="h-4 w-4 mr-1" />
                                    Ports
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => handleViewDocuments(shipment)} className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100">
                                    <Package className="h-4 w-4 mr-1" />
                                    Docs
                                  </Button>
                                  <input
                                    id={`shipment-file-${shipment.id}`}
                                    type="file"
                                    accept="application/pdf,image/png,image/jpeg"
                                    className="hidden"
                                    onChange={(e) => handleUploadFileChange(shipment, e)}
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => document.getElementById(`shipment-file-${shipment.id}`)?.click()}
                                    disabled={uploadingId === shipment.id}
                                    className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                                  >
                                    {uploadingId === shipment.id ? (
                                      <>
                                        <span className="h-4 w-4 mr-2 inline-block border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                                        Uploading...
                                      </>
                                    ) : (
                                      <>
                                        <Upload className="h-4 w-4 mr-1" />
                                        Upload
                                      </>
                                    )}
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {expandedShipmentIds.has(shipment.id) && (
                            <div className="mt-4">
                              {/* Basic Info */}
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-4 pb-4 border-b">
                                <div>
                                  <div className="text-gray-500">Source</div>
                                  <div className="font-medium">{shipment.source_type || shipment.supplier || '-'}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500">Buyer</div>
                                  <div className="font-medium">{shipment.buyer || shipment.buyers || '-'}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500">Group Name</div>
                                  <div className="font-medium">{shipment.group_name || shipment.group_names || '-'}</div>
                                </div>
                              </div>

                              {/* Contract Details */}
                              {contractDetailsMap[shipment.id] && contractDetailsMap[shipment.id].length > 0 ? (
                                <div className="space-y-3">
                                  <div className="text-sm font-semibold text-gray-700 mb-2">
                                    Contract Details ({shipment.contract_count} contracts)
                                  </div>
                                  {contractDetailsMap[shipment.id].map((detail, idx) => {
                                    const lockedFromSap = detail.locked_from_sap
                                    const key = `${shipment.id}-${detail.contract_number}`
                                    const currentValue = detail.sto_qty_assigned || 0
                                    return (
                                      <div key={idx} className="border rounded p-3 bg-gray-50">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                          <div>
                                            <div className="text-gray-500">Contract Number</div>
                                            <div className="font-medium">{detail.contract_number}</div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Contract Ext No</div>
                                            <div className="font-medium">{detail.contract_ext_no || '-'}</div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Contract Qty</div>
                                            <div className="font-medium">{formatNumber(detail.contract_qty)} Kg</div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Outstanding Qty</div>
                                            <div
                                              className={`font-medium ${
                                                detail.outstanding_qty < 0 ? 'text-red-600' : 'text-gray-900'
                                              }`}
                                            >
                                              {formatNumber(detail.outstanding_qty)} Kg
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500 mb-1">Contract Qty assign to STO</div>
                                            <div className="flex items-center gap-2">
                                              {lockedFromSap ? (
                                                <div className="font-medium">
                                                  {formatNumber(currentValue)} Kg{' '}
                                                  <span className="text-xs text-gray-500">(from SAP)</span>
                                                </div>
                                              ) : (
                                                <>
                                                  <Input
                                                    type="number"
                                                    value={currentValue}
                                                    onChange={(e) => {
                                                      const newValue = parseFloat(e.target.value) || 0
                                                      const stoNumber = shipment.sto_number || shipment.shipment_id
                                                      handleUpdateStoQtyAssigned(
                                                        shipment.id,
                                                        detail.contract_number,
                                                        stoNumber,
                                                        newValue
                                                      )
                                                    }}
                                                    className="h-8 text-sm w-32"
                                                    disabled={savingStoQty[key]}
                                                  />
                                                  <span className="text-sm text-gray-500">Kg</span>
                                                  {savingStoQty[key] && (
                                                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Due Date Delivery Start</div>
                                            <div className="font-medium">
                                              {formatShortDate(detail.delivery_start_date || '')}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Due Date Delivery End</div>
                                            <div className="font-medium">
                                              {formatShortDate(detail.delivery_end_date || '')}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Quantity Delivered (Kg)</div>
                                            <div className="font-medium">
                                              {formatNumber(detail.quantity_delivered ?? 0)} Kg
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Quantity Receive (Kg)</div>
                                            <div className="font-medium">
                                              {formatNumber(detail.quantity_receive ?? 0)} Kg
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <div className="text-sm font-semibold text-gray-700 mb-2">Contract Details</div>
                                        <div className="text-gray-500 text-sm">No contract details available. Click "Load Contract Details" to fetch.</div>
                                </div>
                              )}
                              {loadingContractDetails[shipment.id] && (
                                <div className="text-center py-2 text-sm text-gray-500">
                                  <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                                  Loading contract details...
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )})}
                  </div>
                </>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Loading Ports Modal */}
      {showLoadingPorts && selectedShipment && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg p-6 my-4 max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Vessel Loading Ports — {selectedShipment.vessel_name || selectedShipment.shipment_id}</h3>
              <Button variant="ghost" onClick={() => setShowLoadingPorts(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-col gap-4 flex-1 min-h-0">
              {/* Combined Shipment Information and Loading Ports */}
              <div
                className={[
                  'border rounded-lg flex flex-col min-h-0',
                  portsListExpanded ? 'flex-1' : 'flex-none'
                ].join(' ')}
              >
                <div 
                  className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 rounded-t-lg"
                  onClick={() => setPortsListExpanded(!portsListExpanded)}
                >
                  <h4 className="font-semibold text-sm">Shipment Information</h4>
                  <div className="flex items-center gap-2">
                    {portsListExpanded ? (
                      <ChevronUp className="h-5 w-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-500" />
                    )}
                  </div>
                </div>
                {portsListExpanded && (
                <div className="space-y-3 overflow-auto p-4 flex-1 min-h-0">
                  {/* Shipment-Level Information */}
                  {shipmentInfo ? (
                    <div className="border rounded-md p-4 bg-gray-50 mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="font-semibold text-sm">Shipment Information</h5>
                          <div className="flex gap-2">
                          {editingShipmentInfo ? (
                            <>
                            <Button
                              variant="outline"
                              size="sm"
                                onClick={handleCancelEditAll}
                            >
                              <X className="h-4 w-4 mr-1" /> Cancel
                            </Button>
                            <Button
                              size="sm"
                                onClick={handleSaveAll}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Save className="h-4 w-4 mr-1" /> Save
                            </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                handleEditShipmentInfo()
                                if (loadingPorts.length > 0) {
                                  handleEditPort(loadingPorts[0])
                                }
                              }}
                            >
                              <Edit2 className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                          )}
                          </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-gray-500">Quantity Delivery</div>
                          {editingShipmentInfo ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editedShipmentInfo?.quantity_delivered || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, quantity_delivered: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm mt-1"
                            />
                          ) : (
                            <div className="font-medium">{formatNumber(shipmentInfo.quantity_delivered)} Kg</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">Quantity Receive</div>
                          {editingShipmentInfo ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editedShipmentInfo?.actual_vessel_qty_receive || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, actual_vessel_qty_receive: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm mt-1"
                            />
                          ) : (
                            <div className="font-medium">{formatNumber(shipmentInfo.actual_vessel_qty_receive)} Kg</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">Vessel Loading Port 1</div>
                          {editingShipmentInfo ? (
                            <Input
                              value={editedShipmentInfo?.vessel_loading_port_1 || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, vessel_loading_port_1: e.target.value })}
                              className="h-8 text-sm mt-1"
                              placeholder="Loading Port Name"
                            />
                          ) : (
                          <div className="font-medium">{shipmentInfo.vessel_loading_port_1 || '-'}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">Vessel Discharge Port 1</div>
                          {editingShipmentInfo ? (
                            <Input
                              value={editedShipmentInfo?.vessel_discharge_port_1 || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, vessel_discharge_port_1: e.target.value })}
                              className="h-8 text-sm mt-1"
                              placeholder="Discharge Port Name"
                            />
                          ) : (
                            <div className="font-medium">{shipmentInfo.vessel_discharge_port_1 || '-'}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500 flex items-center gap-1">
                            Vessel OA Actual
                            <FieldHelp text={FIELD_HELP.vesselOaActual} />
                          </div>
                          {editingShipmentInfo ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editedShipmentInfo?.vessel_oa_actual || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, vessel_oa_actual: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm mt-1"
                            />
                          ) : (
                            <div className="font-medium">{formatNumber(shipmentInfo.vessel_oa_actual)}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500 flex items-center gap-1">
                            Vessel OA Budget
                            <FieldHelp text={FIELD_HELP.vesselOaBudget} />
                          </div>
                          {editingShipmentInfo ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editedShipmentInfo?.vessel_oa_budget || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, vessel_oa_budget: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm mt-1"
                            />
                          ) : (
                            <div className="font-medium">{formatNumber(shipmentInfo.vessel_oa_budget)}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">B/L Quantity</div>
                          {editingShipmentInfo ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editedShipmentInfo?.bl_quantity || ''}
                              onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, bl_quantity: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm mt-1"
                            />
                          ) : (
                            <div className="font-medium">{formatNumber(shipmentInfo.bl_quantity)} Kg</div>
                          )}
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Arrival at Loading Port</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_arrival_at_loading_port)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Berthed at Loading Port</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_berthed_at_loading_port)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Start Loading</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_start_loading)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Completed Loading</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_completed_loading)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Sailed from Loading Port</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_sailed_from_loading_port)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Arrive at Discharge Port</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_arrive_at_discharge_port)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Berthed at Discharge Port</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_berthed_at_discharge_port)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Start Discharging</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_start_discharging)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">ATA Vessel Complete Discharge</div>
                          <div className="font-medium">{formatDate(shipmentInfo.ata_vessel_complete_discharge)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Loading Rate (Kg/hour)</div>
                          <div className="font-semibold text-blue-700">
                            {shipmentInfo.loading_rate_mt_per_hour !== null && shipmentInfo.loading_rate_mt_per_hour !== undefined 
                              ? formatNumber(shipmentInfo.loading_rate_mt_per_hour) 
                              : '-'}
                      </div>
                          {shipmentInfo.loading_rate_mt_per_hour && (
                            <div className="text-xs text-gray-500 mt-1">
                              Formula: Quantity Receive / (ATA Completed - ATA Start) hours
                    </div>
                  )}
                        </div>
                      </div>

                      {/* ETA Fields Section */}
                      <div className="mt-4 pt-4 border-t">
                        <h6 className="font-semibold text-sm mb-3 text-gray-700">ETA (Estimated Time of Arrival) Information</h6>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrival at Loading Port</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_arrival_at_loading_port ? String(editedShipmentInfo.eta_vessel_arrival_at_loading_port).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_arrival_at_loading_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_arrival_at_loading_port)}</div>
                            )}
                  </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Loading Port</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_berthed_at_loading_port ? String(editedShipmentInfo.eta_vessel_berthed_at_loading_port).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_berthed_at_loading_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_berthed_at_loading_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Loading</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_start_loading ? String(editedShipmentInfo.eta_vessel_start_loading).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_start_loading: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_start_loading)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Completed Loading</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_completed_loading ? String(editedShipmentInfo.eta_vessel_completed_loading).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_completed_loading: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_completed_loading)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Sailed from Loading Port</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_sailed_from_loading_port ? String(editedShipmentInfo.eta_vessel_sailed_from_loading_port).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_sailed_from_loading_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_sailed_from_loading_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrive at Discharge Port</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_arrive_at_discharge_port ? String(editedShipmentInfo.eta_vessel_arrive_at_discharge_port).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_arrive_at_discharge_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_arrive_at_discharge_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Discharge Port</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_berthed_at_discharge_port ? String(editedShipmentInfo.eta_vessel_berthed_at_discharge_port).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_berthed_at_discharge_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_berthed_at_discharge_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Discharging</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_start_discharging ? String(editedShipmentInfo.eta_vessel_start_discharging).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_start_discharging: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_start_discharging)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Complete Discharge</div>
                            {editingShipmentInfo ? (
                              <Input
                                type="date"
                                value={editedShipmentInfo?.eta_vessel_complete_discharge ? String(editedShipmentInfo.eta_vessel_complete_discharge).split('T')[0] : ''}
                                onChange={(e) => setEditedShipmentInfo({ ...editedShipmentInfo, eta_vessel_complete_discharge: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_complete_discharge)}</div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Quality Fields Section */}
                      <div className="mt-4 pt-4 border-t">
                        <h6 className="font-semibold text-sm mb-3 text-gray-700">Quality at Loading Loc 1</h6>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 FFA</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_loading_loc_1_ffa !== null && shipmentInfo.quality_at_loading_loc_1_ffa !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_ffa) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 M&I</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_loading_loc_1_mi !== null && shipmentInfo.quality_at_loading_loc_1_mi !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_mi) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 DOBI</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_loading_loc_1_dobi !== null && shipmentInfo.quality_at_loading_loc_1_dobi !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_dobi) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 RED</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_loading_loc_1_red !== null && shipmentInfo.quality_at_loading_loc_1_red !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_red) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 D&S</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_loading_loc_1_ds !== null && shipmentInfo.quality_at_loading_loc_1_ds !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_ds) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 Stone</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_loading_loc_1_stone !== null && shipmentInfo.quality_at_loading_loc_1_stone !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_stone) 
                                : '-'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t">
                        <h6 className="font-semibold text-sm mb-3 text-gray-700">Quality at Discharge Loc 1</h6>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">Quality at Discharge Port FFA</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_discharge_loc_1_ffa !== null && shipmentInfo.quality_at_discharge_loc_1_ffa !== undefined
                                ? formatNumber(shipmentInfo.quality_at_discharge_loc_1_ffa)
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Discharge Port M&I</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_discharge_loc_1_mi !== null && shipmentInfo.quality_at_discharge_loc_1_mi !== undefined
                                ? formatNumber(shipmentInfo.quality_at_discharge_loc_1_mi)
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Discharge Port DOBI</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_discharge_loc_1_dobi !== null && shipmentInfo.quality_at_discharge_loc_1_dobi !== undefined
                                ? formatNumber(shipmentInfo.quality_at_discharge_loc_1_dobi)
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Discharge Port RED</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_discharge_loc_1_red !== null && shipmentInfo.quality_at_discharge_loc_1_red !== undefined
                                ? formatNumber(shipmentInfo.quality_at_discharge_loc_1_red)
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Discharge Port D&S</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_discharge_loc_1_ds !== null && shipmentInfo.quality_at_discharge_loc_1_ds !== undefined
                                ? formatNumber(shipmentInfo.quality_at_discharge_loc_1_ds)
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Discharge Port Stone</div>
                            <div className="font-medium">
                              {shipmentInfo.quality_at_discharge_loc_1_stone !== null && shipmentInfo.quality_at_discharge_loc_1_stone !== undefined
                                ? formatNumber(shipmentInfo.quality_at_discharge_loc_1_stone)
                                : '-'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border rounded-md p-4 bg-gray-50 mb-4">
                      <div className="text-center text-gray-500 py-4">
                        Loading shipment information...
                      </div>
                    </div>
                  )}
                {loadingPorts.length === 0 ? (
                  <div className="text-gray-500">No loading ports yet.</div>
                ) : (() => {
                  const loadingPortsList = loadingPorts.filter(p => !p.is_discharge_port)
                  const dischargePortsList = loadingPorts.filter(p => p.is_discharge_port)
                  const isSingleSet = loadingPortsList.length === 1 && dischargePortsList.length === 1

                  // Single set (1 loading + 1 discharge): everything is in Shipment Information above; no extra sections
                  if (isSingleSet) {
                    return null
                  }

                  // Multiple sets: new section for each additional loading or discharge port (first set stays in Shipment Information)
                  const additionalLoading = loadingPortsList.slice(1)
                  const additionalDischarge = dischargePortsList.slice(1)
                  const additionalPorts = [...additionalLoading, ...additionalDischarge]

                  return (
                    <>
                  {additionalPorts.map((port) => {
                    const sectionTitle = port.is_discharge_port
                      ? `Discharge Port ${dischargePortsList.indexOf(port) + 1} — ${port.port_name || 'Unnamed'}`
                      : `Loading Port ${port.port_sequence} — ${port.port_name || 'Unnamed'}`
                    const quantityLabel = port.is_discharge_port ? 'Received Quantity (Kg)' : 'Quantity at Loading Port (Kg)'
                    const rateLabel = port.is_discharge_port ? 'Discharge Rate (Kg/hour)' : 'Loading Rate (Kg/hour)'

                    // Compute loading rate for loading ports:
                    // (Quantity Receive) / (ATA Vessel Completed Loading - ATA Vessel Start Loading in hours)
                    let computedLoadingRate: number | null = null
                    if (!port.is_discharge_port) {
                      const ataStart = shipmentInfo?.ata_vessel_start_loading
                      const ataCompleted = shipmentInfo?.ata_vessel_completed_loading
                      const quantityReceive = shipmentInfo?.actual_vessel_qty_receive

                      if (ataStart && ataCompleted && quantityReceive) {
                        const startDate = new Date(ataStart)
                        const endDate = new Date(ataCompleted)
                        const diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
                        if (diffHours > 0 && quantityReceive > 0) {
                          computedLoadingRate = quantityReceive / diffHours
                        }
                      }
                    }
                    // Determine quality label prefix based on port location
                    const qualityPrefix = port.is_discharge_port 
                      ? 'Quality at Discharge Port'
                      : port.port_sequence === 1
                        ? 'Quality at Loading Loc 1'
                        : port.port_sequence === 2
                          ? 'Quality at Loading Loc 2'
                          : port.port_sequence === 3
                            ? 'Quality at Loading Loc 3'
                            : `Quality at Loading Loc ${port.port_sequence}`
                    const qualityValues: Array<[string, number | null | undefined]> = [
                      [`${qualityPrefix} FFA`, port.quality_ffa],
                      [`${qualityPrefix} M&I`, port.quality_mi],
                      [`${qualityPrefix} DOBI`, port.quality_dobi],
                      [`${qualityPrefix} RED`, port.quality_red],
                      [`${qualityPrefix} D&S`, port.quality_ds],
                      [`${qualityPrefix} Stone`, port.quality_stone]
                    ]
                    const hasQuality = qualityValues.some(([, value]) => value !== null && value !== undefined)

                    const isEditing = port.id && editingPortId === port.id
                    const displayData = isEditing && editedPortData ? editedPortData : port

                    return (
                      <div key={port.id ?? `${port.port_name}-${port.port_sequence}-${port.is_discharge_port}`} className="mt-4">
                        <h5 className="font-semibold text-sm mb-2 text-gray-700 border-b pb-1">{sectionTitle}</h5>
                        <div className="border rounded-md p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="font-medium">
                                {port.is_discharge_port
                                  ? `Discharge Port — ${displayData.port_name || '-'}`
                                  : `${displayData.port_sequence}. ${displayData.port_name || '-'}`}
                              </div>
                              {port.is_discharge_port && (
                                <Badge className="bg-amber-100 text-amber-700">Discharge</Badge>
                              )}
                            </div>
                            {port.contract_number && (
                              <div className="text-xs text-gray-500 mt-1">Contract: {port.contract_number}</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {!isEditing && port.id && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteLoadingPort(port.id!)}
                                    className="text-red-600 border-red-200 hover:bg-red-50"
                                  >
                                    Delete
                                  </Button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">Port Name</div>
                            {isEditing ? (
                              <Input
                                value={displayData.port_name || ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, port_name: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{displayData.port_name || '-'}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">Sequence</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={displayData.port_sequence || 1}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, port_sequence: parseInt(e.target.value) || 1 })}
                                className="h-8 text-sm mt-1"
                                min={1}
                              />
                            ) : (
                              <div className="font-medium">{displayData.port_sequence || '-'}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">{quantityLabel}</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={displayData.quantity_at_loading_port || ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, quantity_at_loading_port: parseFloat(e.target.value) || 0 })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">
                                {displayData.quantity_at_loading_port !== null && displayData.quantity_at_loading_port !== undefined
                                  ? formatNumber(displayData.quantity_at_loading_port)
                                  : '-'}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrival at Loading Port</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_arrival ? String(displayData.eta_vessel_arrival).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_arrival: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_arrival || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Loading Port</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_berthed_at_loading_port ? String(displayData.eta_vessel_berthed_at_loading_port).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_berthed_at_loading_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_berthed_at_loading_port || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Loading</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_loading_start ? String(displayData.eta_loading_start).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_loading_start: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_loading_start || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Completed Loading</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_loading_completed ? String(displayData.eta_loading_completed).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_loading_completed: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_loading_completed || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Sailed from Loading Port</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_sailed ? String(displayData.eta_vessel_sailed).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_sailed: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_sailed || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrive at Discharge Port</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_arrive_at_discharge_port ? String(displayData.eta_vessel_arrive_at_discharge_port).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_arrive_at_discharge_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_arrive_at_discharge_port || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Discharge Port</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_berthed_at_discharge_port ? String(displayData.eta_vessel_berthed_at_discharge_port || displayData.eta_vessel_berthed).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_berthed_at_discharge_port: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_berthed_at_discharge_port || displayData.eta_vessel_berthed || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Discharging</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_start_discharging ? String(displayData.eta_vessel_start_discharging).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_start_discharging: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_start_discharging || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Complete Discharge</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={displayData.eta_vessel_complete_discharge ? String(displayData.eta_vessel_complete_discharge).split('T')[0] : ''}
                                onChange={(e) => setEditedPortData({ ...editedPortData!, eta_vessel_complete_discharge: e.target.value })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_complete_discharge || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">{rateLabel}</div>
                              <div className="font-semibold text-blue-700">
                              {computedLoadingRate !== null
                                ? formatNumber(computedLoadingRate)
                                : displayData.loading_rate !== null && displayData.loading_rate !== undefined
                                  ? formatNumber(displayData.loading_rate)
                                  : '-'}
                            </div>
                            {!port.is_discharge_port && (
                              <div className="text-xs text-gray-500 mt-1">
                                Formula: (ATA Vessel Completed Loading - ATA Vessel Start Loading) / Quantity Receive
                              </div>
                            )}
                          </div>
                        </div>

                        {hasQuality && (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mt-3 border-t pt-3">
                            {qualityValues.map(([label, value]) => (
                              <div key={label}>
                                <div className="text-gray-500">{label}</div>
                                <div className="font-medium">{value !== null && value !== undefined ? formatNumber(value) : '-'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        </div>
                      </div>
                    )
                  })}
                    </>
                  )
                })()}
                </div>
                )}
              </div>

              {/* Add / Edit Loading Port */}
              <div
                className={[
                  'border rounded-lg flex flex-col min-h-0',
                  addPortExpanded ? 'flex-1' : 'flex-none'
                ].join(' ')}
              >
                <div 
                  className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 rounded-t-lg"
                  onClick={() => setAddPortExpanded(!addPortExpanded)}
                >
                  <h4 className="font-semibold text-sm">Add Loading Port</h4>
                  {addPortExpanded ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </div>
                {addPortExpanded && (
                <div className="p-4 overflow-auto flex-1 min-h-0">

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-gray-500 mb-1">Port Name</div>
                  <Input
                    value={newPort.port_name as string}
                    onChange={(e) => setNewPort({ ...newPort, port_name: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="e.g., Loading Port 1"
                  />
                </div>
                <div>
                  <div className="text-gray-500 mb-1">Sequence</div>
                  <Input
                    type="number"
                    value={newPort.port_sequence as number}
                    onChange={(e) => {
                      const v = parseInt(e.target.value || '1')
                      setNewPort({ ...newPort, port_sequence: v })
                    }}
                    className="h-8 text-sm"
                    min={1}
                  />
                </div>
                <div>
                  <div className="text-gray-500 mb-1">Quantity (Kg)</div>
                  <Input
                    type="number"
                    value={newPort.quantity_at_loading_port as number}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value || '0')
                      setNewPort({ ...newPort, quantity_at_loading_port: v })
                    }}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <div className="text-gray-500 mb-1">Loading Rate (Kg/hour)</div>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPort.loading_rate as number}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value || '0')
                      setNewPort({ ...newPort, loading_rate: v })
                    }}
                    className="h-8 text-sm"
                  />
                </div>

                <div className="col-span-full">
                  <div className="text-gray-500 mb-2 font-medium">ETA Date Fields</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  ['ETA Vessel Arrival at Loading Port', 'eta_vessel_arrival'],
                  ['ETA Vessel Berthed at Loading Port', 'eta_vessel_berthed_at_loading_port'],
                  ['ETA Vessel Start Loading', 'eta_loading_start'],
                  ['ETA Vessel Completed Loading', 'eta_loading_completed'],
                  ['ETA Vessel Sailed from Loading Port', 'eta_vessel_sailed'],
                  ['ETA Vessel Arrive at Discharge Port', 'eta_vessel_arrive_at_discharge_port'],
                  ['ETA Vessel Berthed at Discharge Port', 'eta_vessel_berthed_at_discharge_port'],
                  ['ETA Vessel Start Discharging', 'eta_vessel_start_discharging'],
                  ['ETA Vessel Complete Discharge', 'eta_vessel_complete_discharge']
                ].map(([label, key]) => (
                  <div key={key as string}>
                    <div className="text-gray-500 mb-1">{label}</div>
                    <Input
                      type="date"
                      value={(
                        (newPort as any)[key] 
                          ? String((newPort as any)[key]).split('T')[0]
                          : ''
                      )}
                      onChange={(e) => {
                        const v = e.target.value
                        setNewPort({ ...(newPort as any), [key]: v } as any)
                      }}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setNewPort({
                      port_name: '',
                      port_sequence: loadingPorts.length + 1,
                      quantity_at_loading_port: 0,
                      eta_vessel_arrival: '',
                      ata_vessel_arrival: '',
                      eta_vessel_berthed: '',
                      ata_vessel_berthed: '',
                      eta_loading_start: '',
                      ata_loading_start: '',
                      eta_loading_completed: '',
                      ata_loading_completed: '',
                      eta_vessel_sailed: '',
                      ata_vessel_sailed: '',
                      eta_vessel_berthed_at_loading_port: '',
                      eta_vessel_arrive_at_discharge_port: '',
                      eta_vessel_berthed_at_discharge_port: '',
                      eta_vessel_start_discharging: '',
                      eta_vessel_complete_discharge: '',
                      loading_rate: 0,
                      is_discharge_port: false
                    })
                  }}
                >
                  <X className="h-4 w-4 mr-1" /> Reset
                </Button>
                <Button onClick={handleSaveLoadingPort} className="bg-green-600 hover:bg-green-700">
                  {false ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Add Loading Port
                </Button>
              </div>
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Documents Modal */}
      {showDocs && selectedShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Documents — {selectedShipment.vessel_name || selectedShipment.shipment_id}</h3>
              <Button variant="ghost" onClick={() => setShowDocs(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {docsLoading ? (
              <div className="text-sm text-gray-500 py-8 text-center">Loading documents...</div>
            ) : shipmentDocs.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">No documents uploaded for this shipment.</div>
            ) : (
              <div className="space-y-2">
                {shipmentDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between px-4 py-3 border rounded hover:bg-gray-50">
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
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add New Shipment Modal */}
      {showAddShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold">Add New Shipment</h3>
              <Button variant="ghost" onClick={() => setShowAddShipment(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-6">
              {/* Form Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Required:</strong> At least one Contract Number<br/>
                  <strong>Optional:</strong> Port of Loading, Plant/Site (Discharge Port), and ETA fields.<br/>
                  <strong>Note:</strong> Operation ID and STO Number are automatically generated and cannot be manually entered
                </p>
              </div>

              {/* Operation ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Operation ID <span className="text-gray-500 text-xs">(Auto-generated)</span>
                </label>
                <Input
                  value={newShipment.contractNumbers.length > 0 
                    ? `OP-${newShipment.contractNumbers[0]}-${Date.now().toString().slice(-8)}`
                    : 'Will be auto-generated when contract is added'}
                  disabled
                  className="w-full bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Operation ID will be automatically generated as: OP-{(contractValidations[newShipment.contractNumbers[0]]?.contractData?.contract_ext_no || newShipment.contractNumbers[0]) || '{Contract Ext No}'}-{'{timestamp}'}
                </p>
              </div>

              {/* STO Number - Read-only, only from SAP */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  STO Number <span className="text-gray-500 text-xs">(Will be filled from SAP Data)</span>
                </label>
                <Input
                  value=""
                  disabled
                  placeholder="STO Number will remain empty and be filled from SAP Data later"
                  className="w-full bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  STO Number will remain empty for manual shipments and will be automatically filled when SAP Data is imported.
                </p>
              </div>

              {/* Contract Ext No */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract Ext No <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="flex gap-2">
                  <Input
                    value={contractSearchTerm}
                    onChange={(e) => handleContractSearch(e.target.value)}
                    onFocus={() => setShowContractSuggestions(true)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddContractManually()
                        }
                      }}
                      placeholder="Search or enter Contract Ext No and press Enter"
                      className="flex-1"
                  />
                    <Button
                      type="button"
                      onClick={handleAddContractManually}
                      variant="outline"
                    >
                      Add
                    </Button>
                  </div>
                  {showContractSuggestions && contractSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {contractSuggestions.map((contract) => (
                        <div
                          key={contract.contract_id}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b"
                          onClick={() => handleAddContract(contract)}
                        >
                          <div className="font-medium">{contract.contract_ext_no || contract.contract_id}</div>
                          <div className="text-sm text-gray-500">
                            {contract.contract_ext_no ? <span className="text-gray-400">{contract.contract_id} • </span> : null}
                            {contract.supplier} • {contract.product}
                            {contract.sto_number && ` • STO: ${contract.sto_number}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Selected Contracts with Validation Status + Details */}
                {newShipment.contractNumbers.length > 0 && (
                  <div className="mt-2 space-y-3">
                    {newShipment.contractNumbers.map((contractId) => {
                      const validation = contractValidations[contractId]
                      const data = validation?.contractData
                      const label = (data?.contract_ext_no || contractId) as string
                      return (
                        <div key={contractId} className="border rounded-md px-2 py-2 bg-gray-50">
                          <div className="flex items-center gap-2">
                      <Badge
                              variant={validation?.exists ? "default" : validation?.exists === false ? "destructive" : "secondary"}
                        className="flex items-center gap-1"
                      >
                        {label}
                              {validation?.checking && <Loader2 className="h-3 w-3 animate-spin" />}
                              {validation?.exists && <Check className="h-3 w-3" />}
                              {validation?.exists === false && !validation?.checking && <X className="h-3 w-3" />}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() => handleRemoveContract(contractId)}
                        />
                      </Badge>
                            {data?.contract_ext_no ? <span className="text-[11px] text-gray-400 truncate">({contractId})</span> : null}
                            {validation?.message && (
                              <span className={`text-xs ${
                                validation.exists ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {validation.message}
                              </span>
                            )}
                            {validation?.exists && data && (
                              <div className="text-xs text-gray-500 truncate">
                                {data.supplier} • {data.product} {data.transport_mode ? `• ${data.transport_mode}` : ''}
                              </div>
                            )}
                          </div>

                          {validation?.exists && data && (
                            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-gray-700">
                              <div>
                                <div className="text-gray-500">Contract Qty</div>
                                <div className="font-medium">
                                  {formatNumber(data.quantity_ordered || 0)} {data.unit || ''}
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">Outstanding Qty</div>
                                <div className="font-medium">
                                  {formatNumber(data.outstanding_quantity || 0)} {data.unit || ''}
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">Due Date Delivery Start</div>
                                <div className="font-medium">
                                  {formatShortDate(data.delivery_start_date || '')}
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">Due Date Delivery End</div>
                                <div className="font-medium">
                                  {formatShortDate(data.delivery_end_date || '')}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Vessel Information - Vessel Name from Master Vessel with type-to-search; Code, Owner, Capacity, Hull Type auto-filled and read-only */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Name
                  </label>
                  <Input
                    value={newShipment.vesselName}
                    onChange={(e) => handleVesselNameChange(e.target.value)}
                    onFocus={() => newShipment.vesselName.trim().length >= 2 && setShowVesselSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowVesselSuggestions(false), 200)}
                    placeholder="Type to search vessel name (from Master Vessel)"
                  />
                  {showVesselSuggestions && vesselSuggestions.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-52 overflow-y-auto">
                      {vesselSuggestions.map((v) => (
                        <div
                          key={v.vessel_code}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                          onMouseDown={() => handleSelectVessel(v)}
                        >
                          <div className="font-medium text-sm">{v.vessel_name}</div>
                          <div className="text-xs text-gray-500">{v.vessel_code} {v.vessel_owner ? ` • ${v.vessel_owner}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Code <span className="text-gray-500 text-xs">(from Master Vessel)</span>
                  </label>
                  <Input
                    value={newShipment.vesselCode}
                    disabled
                    placeholder="Filled when vessel is selected"
                    className="bg-gray-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Voyage No
                  </label>
                  <Input
                    value={newShipment.voyageNo}
                    onChange={(e) => setNewShipment(prev => ({ ...prev, voyageNo: e.target.value }))}
                    placeholder="Enter voyage number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Owner <span className="text-gray-500 text-xs">(from Master Vessel)</span>
                  </label>
                  <Input
                    value={newShipment.vesselOwner}
                    disabled
                    placeholder="Filled when vessel is selected"
                    className="bg-gray-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Draft (m)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newShipment.vesselDraft}
                    onChange={(e) => setNewShipment(prev => ({ ...prev, vesselDraft: e.target.value }))}
                    placeholder="Enter vessel draft"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Capacity (Kg) <span className="text-gray-500 text-xs">(from Master Vessel)</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newShipment.vesselCapacity}
                    disabled
                    placeholder="Filled when vessel is selected"
                    className="bg-gray-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Hull Type <span className="text-gray-500 text-xs">(from Master Vessel)</span>
                  </label>
                  <Input
                    value={newShipment.vesselHullType}
                    disabled
                    placeholder="Filled when vessel is selected"
                    className="bg-gray-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Charter Type
                  </label>
                  <Input
                    value={newShipment.charterType}
                    onChange={(e) => setNewShipment(prev => ({ ...prev, charterType: e.target.value }))}
                    placeholder="Enter charter type"
                  />
                </div>
              </div>

              {/* Port Information - Port of Loading from Master Loading Port with type-to-search */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    Port of Loading (Optional)
                  </label>
                  <Input
                    value={newShipment.portOfLoading}
                    onChange={(e) => handlePortOfLoadingChange(e.target.value)}
                    onFocus={() => newShipment.portOfLoading.trim().length >= 2 && setShowPortSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowPortSuggestions(false), 200)}
                    placeholder="Type to search port (from Master Loading Port)"
                  />
                  {showPortSuggestions && portSuggestions.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-52 overflow-y-auto">
                      {portSuggestions.map((p, idx) => (
                        <div
                          key={p.port + (p.region || '') + idx}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                          onMouseDown={() => handleSelectPort(p)}
                        >
                          <div className="font-medium text-sm">{p.port}</div>
                          {p.region && <div className="text-xs text-gray-500">{p.region}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    Plant/Site (Discharge Port) (Optional)
                  </label>
                  <Input
                    value={newShipment.portOfDischarge}
                    onChange={(e) => setNewShipment(prev => ({ ...prev, portOfDischarge: e.target.value }))}
                    placeholder="Enter discharge port"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contract Qty assign to STO (Kg)
                  </label>
                  <div className={`rounded-md border p-3 ${contractQtyAssignedExceedsCapacity ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                    {newShipment.contractNumbers.length === 0 ? (
                      <div className="text-sm text-gray-500">Add contract numbers above to assign quantities.</div>
                    ) : (
                      <div className="space-y-2">
                        {newShipment.contractNumbers.map((contractId) => (
                          <div key={contractId} className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-gray-700 truncate">{contractId}</div>
                            <Input
                              type="number"
                              step="0.01"
                              value={contractQtyAssigned[contractId] ?? ''}
                              onChange={(e) => setContractQtyAssigned(prev => ({ ...prev, [contractId]: e.target.value }))}
                              className="h-8 text-sm w-40 bg-white"
                              placeholder="0"
                            />
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-sm pt-2 border-t">
                          <div className="text-gray-600">Total assigned</div>
                          <div className={`font-semibold ${contractQtyAssignedExceedsCapacity ? 'text-red-700' : 'text-gray-900'}`}>{formatNumber(contractQtyAssignedSum)} Kg</div>
                        </div>
                        {vesselCapacityNum != null && !Number.isNaN(vesselCapacityNum) && (
                          <div className="flex items-center justify-between text-xs text-gray-600">
                            <div>Vessel Capacity</div>
                            <div>{formatNumber(vesselCapacityNum)} Kg</div>
                          </div>
                        )}
                        {contractQtyAssignedExceedsCapacity && (
                          <div className="text-xs text-red-700">Total assigned cannot exceed Vessel Capacity (Kg).</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ETA fields (optional) */}
              <div className="space-y-3 pt-2 border-t">
                <div className="text-sm font-medium text-gray-600">ETA (Optional)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Arrival at Loading Port</label>
                    <Input type="date" value={newShipment.etaVesselArrivalAtLoadingPort} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselArrivalAtLoadingPort: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Berthed at Loading Port</label>
                    <Input type="date" value={newShipment.etaVesselBerthedAtLoadingPort} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselBerthedAtLoadingPort: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Start Loading</label>
                    <Input type="date" value={newShipment.etaVesselStartLoading} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselStartLoading: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Completed Loading</label>
                    <Input type="date" value={newShipment.etaVesselCompletedLoading} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselCompletedLoading: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Sailed from Loading Port</label>
                    <Input type="date" value={newShipment.etaVesselSailedFromLoadingPort} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselSailedFromLoadingPort: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Arrive at Discharge Port</label>
                    <Input type="date" value={newShipment.etaVesselArriveAtDischargePort} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselArriveAtDischargePort: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Berthed at Discharge Port</label>
                    <Input type="date" value={newShipment.etaVesselBerthedAtDischargePort} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselBerthedAtDischargePort: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Start Discharging</label>
                    <Input type="date" value={newShipment.etaVesselStartDischarging} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselStartDischarging: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">ETA Vessel Complete Discharge</label>
                    <Input type="date" value={newShipment.etaVesselCompleteDischarge} onChange={(e) => setNewShipment(prev => ({ ...prev, etaVesselCompleteDischarge: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowAddShipment(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateShipment}
                  disabled={saving || contractQtyAssignedExceedsCapacity || stoValidation?.exists || newShipment.contractNumbers.some(id => !contractValidations[id]?.exists)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Shipment
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

export default function ShipmentsPage() {
  return (
    <Suspense fallback={<Layout><div className="flex items-center justify-center p-8"><div className="text-gray-500">Loading...</div></div></Layout>}>
      <ShipmentsPageContent />
    </Suspense>
  )
}


