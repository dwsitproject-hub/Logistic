'use client'

import { useEffect, useMemo, useRef, useState, Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Filter, X, Ship, Package, Save, Loader2, Download, Upload, Check, Edit2, Plus, Pencil, FileText, ChevronDown, ChevronUp, ChevronRight, ArrowDown, ArrowUp, ArrowUpDown, Minus, SlidersHorizontal, ArrowLeft, ArrowRight, GripVertical, Anchor } from 'lucide-react'
import api from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldHelp } from '@/components/FieldHelp'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY, formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import { AddShipmentModal } from '@/components/shipments/AddShipmentModal'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { format } from 'date-fns'
import {
  usePermissions,
  canCreatePermission,
  canEditPermission,
  canViewPermission,
} from '@/components/PermissionsContext'
// import * as XLSX from 'xlsx' // Temporarily disabled

/** Extract fixed px width from a minmax(Npx, …) grid track for <col style>. */
function compactGridTrackMinPx(track: string): string {
  const m = track.match(/minmax\((\d+)px/)
  if (m) return `${m[1]}px`
  const px = track.match(/^(\d+)px$/)
  return px ? `${px[1]}px` : '96px'
}

const SHIPMENT_COLUMN_WIDTH_PX: Record<string, number> = {
  operation_id: 150,
  shipment_id: 200,
  status: 120,
  contract_numbers: 180,
  po_numbers: 150,
  contract_reference_po: 150,
  contract_ext_no: 150,
  delivery_start: 180,
  delivery_end: 180,
  ata_vessel_completed_loading: 200,
  ata_vessel_complete_discharge: 200,
  late_indicator: 130,
  vessel_name: 180,
  sto_quantity: 140,
  incoterm: 120,
  b2b_flag: 100,
  port_of_loading: 160,
  port_of_discharge: 160,
  quantity_receive: 140,
  vessel_code: 120,
  quantity_delivered: 140,
}

interface Shipment {
  id: string
  shipment_id: string
  operation_id?: string
  contract_id: string
  contract_number: string
  vessel_name: string
  vessel_code: string
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

function apiErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return err?.response?.data?.error?.message || err?.message || fallback
}

function dateInputFromUnknown(v: unknown): string | Date | null | undefined {
  if (v == null) return v as null | undefined
  if (v instanceof Date) return v
  if (typeof v === 'string') return v
  return undefined
}

/** Payload for PUT /shipments/:id/loading-ports/:portId (only fields the API accepts). */
function buildLoadingPortUpdatePayload(
  source: Record<string, unknown>,
  portId: string,
): Record<string, unknown> {
  const berthedLoading = toApiDateOnly(
    dateInputFromUnknown(source.eta_vessel_berthed_at_loading_port ?? source.eta_vessel_berthed),
  )
  return {
    id: portId,
    port_name: source.port_name,
    port_sequence: source.port_sequence ?? 1,
    quantity_at_loading_port: source.quantity_at_loading_port ?? 0,
    is_discharge_port: Boolean(source.is_discharge_port),
    quality_ffa: source.quality_ffa ?? null,
    quality_mi: source.quality_mi ?? null,
    quality_dobi: source.quality_dobi ?? null,
    quality_red: source.quality_red ?? null,
    quality_ds: source.quality_ds ?? null,
    quality_stone: source.quality_stone ?? null,
    eta_vessel_arrival: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_arrival)),
    ata_vessel_arrival: toApiDateOnly(dateInputFromUnknown(source.ata_vessel_arrival)),
    eta_vessel_berthed: berthedLoading,
    ata_vessel_berthed: toApiDateOnly(dateInputFromUnknown(source.ata_vessel_berthed)),
    eta_vessel_berthed_at_loading_port: berthedLoading,
    eta_loading_start: toApiDateOnly(dateInputFromUnknown(source.eta_loading_start)),
    ata_loading_start: toApiDateOnly(dateInputFromUnknown(source.ata_loading_start)),
    eta_loading_completed: toApiDateOnly(dateInputFromUnknown(source.eta_loading_completed)),
    ata_loading_completed: toApiDateOnly(dateInputFromUnknown(source.ata_loading_completed)),
    eta_vessel_sailed: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_sailed)),
    ata_vessel_sailed: toApiDateOnly(dateInputFromUnknown(source.ata_vessel_sailed)),
    eta_vessel_arrive_at_discharge_port: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_arrive_at_discharge_port)),
    eta_vessel_berthed_at_discharge_port: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_berthed_at_discharge_port)),
    eta_vessel_start_discharging: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_start_discharging)),
    eta_vessel_complete_discharge: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_complete_discharge)),
  }
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
  const perms = usePermissions()
  const canAddShipment = canCreatePermission(perms, 'data.shipments')
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  // Permissions load async. For UX, fail-open on button visibility and enforce on click.
  const canShowEditShipmentButton = !perms.loaded || canEditShipment
  const canOpenAddShipmentModal = canAddShipment || canEditShipment
  const canExportShipments = canViewPermission(perms, 'action.export_data')
  const canBulkShipments = canCreatePermission(perms, 'data.shipments') || canCreatePermission(perms, 'action.bulk_operations')
  const canImportShipments = canViewPermission(perms, 'action.import_excel')
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalCount, setTotalCount] = useState(0)
  // Search should apply only on Enter / Apply (not per keystroke)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedData, setEditedData] = useState<Partial<Shipment>>({})
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [lateIndicatorFilter, setLateIndicatorFilter] = useState<string>('ALL')
  const [etaLoadingFilter, setEtaLoadingFilter] = useState<'ALL' | 'MORE_THAN_7D' | 'D_MINUS_2' | 'D' | 'DELAY' | 'NO_ETA'>('ALL')
  const [etaDischargeFilter, setEtaDischargeFilter] = useState<'ALL' | 'MORE_THAN_7D' | 'D_MINUS_2' | 'D' | 'DELAY' | 'NO_ETA'>('ALL')
  const [vesselFilter, setVesselFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedPlantSites, setSelectedPlantSites] = useState<string[]>([])
  const [availablePlantSites, setAvailablePlantSites] = useState<string[]>([])
  
  // Excel-like column filtering
  type ColumnFilter =
    | { type: 'text'; value: string; exact?: boolean; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'number'; min?: string; max?: string; emptyOnly?: boolean; notBlankOnly?: boolean }
    | { type: 'date'; from?: string; to?: string; emptyOnly?: boolean; notBlankOnly?: boolean }

  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)

  const [viewOption, setViewOption] = useState<
    'all' | 'sto' | 'contract' | 'contract_ext' | 'vessel' | 'port_loading' | 'port_discharge'
  >('all')
  const [viewFilterValue, setViewFilterValue] = useState('')

  // Daily Planning Deliverables (Shipments) calendar state
  type ShipmentCalendarRow = {
    id: string
    shipment_id: string
    sto_number?: string
    contract_number?: string
    contract_ext_no?: string
    vessel_name?: string
    supplier?: string
    product?: string
    group_name?: string
    source_type?: string
    lt_spot?: string
    delivery_start_date?: string
    delivery_end_date?: string
    bl_quantity?: number
    quantity_shipped?: number
    actual_vessel_qty_receive?: number
    outstanding_quantity?: number
    daily_deliverables?: Array<{ date: string; quantity_delivered: number }>
    ata_vessel_complete_discharge?: string
  }

  const [shipCalendarMonth, setShipCalendarMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [shipCalendarRows, setShipCalendarRows] = useState<ShipmentCalendarRow[]>([])
  const [shipCalendarLoading, setShipCalendarLoading] = useState(false)
  const [shipCalendarSavingKey, setShipCalendarSavingKey] = useState<string | null>(null)
  const [shipCalendarEditing, setShipCalendarEditing] = useState<{ id: string; date: string } | null>(null)
  const [shipCalendarEditValue, setShipCalendarEditValue] = useState('')
  const shipDailyPlanningPrefKey = 'shipments.daily_planning.view.v1'
  const [shipCalendarMetaOrderIds, setShipCalendarMetaOrderIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['due_start', 'due_end', 'bl_qty']
    try {
      const raw = localStorage.getItem('shipments.daily_planning.metaOrder.v1')
      const parsed = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String)
    } catch {}
    return ['due_start', 'due_end', 'bl_qty']
  })
  const [shipCalendarDragMetaColId, setShipCalendarDragMetaColId] = useState<string | null>(null)
  const shipDailyPlanningSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shipPlanningFileInputRef = useRef<HTMLInputElement | null>(null)
  const [shipPlanningUploading, setShipPlanningUploading] = useState(false)
  const [shipPlanningUploadOpen, setShipPlanningUploadOpen] = useState(false)
  const [shipPlanningUploadSummary, setShipPlanningUploadSummary] = useState<any>(null)

  useEffect(() => {
    // Load per-user saved daily planning view (best effort).
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(shipDailyPlanningPrefKey)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const order = Array.isArray(value?.metaOrderIds) ? value.metaOrderIds : Array.isArray(value?.metaOrder) ? value.metaOrder : null
        if (Array.isArray(order) && order.length > 0) setShipCalendarMetaOrderIds(order.map((x: any) => String(x)))
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('shipments.daily_planning.metaOrder.v1', JSON.stringify(shipCalendarMetaOrderIds))
    } catch {}
  }, [shipCalendarMetaOrderIds])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (shipDailyPlanningSaveTimerRef.current) clearTimeout(shipDailyPlanningSaveTimerRef.current)
    shipDailyPlanningSaveTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: shipDailyPlanningPrefKey,
          value: { metaOrderIds: shipCalendarMetaOrderIds },
        })
        .catch(() => null)
    }, 600)
    return () => {
      if (shipDailyPlanningSaveTimerRef.current) clearTimeout(shipDailyPlanningSaveTimerRef.current)
    }
  }, [shipCalendarMetaOrderIds])

  const reorderShipCalendarMetaCols = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setShipCalendarMetaOrderIds((prev) => {
      const base = prev.length > 0 ? [...prev] : ['due_start', 'due_end', 'bl_qty']
      const from = base.indexOf(dragId)
      const to = base.indexOf(dropId)
      if (from < 0 || to < 0) return base
      base.splice(from, 1)
      base.splice(to, 0, dragId)
      return base
    })
  }

  const shipPlanningYearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 18 }, (_, i) => y - 8 + i)
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
  const [uploading, setUploading] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    return `${yyyy}-01-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    return `${yyyy}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [uploadingId, setUploadingId] = useState<string>('')
  const [shipmentsSummary, setShipmentsSummary] = useState<any>(null)
  const shipmentsSummaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const [showAddShipment, setShowAddShipment] = useState(false)

  // Master Vessel / Master Loading Port suggestions (inline edit row + AddShipmentModal has its own)
  const [vesselSuggestions, setVesselSuggestions] = useState<Array<{ vessel_code: string; vessel_name: string; vessel_capacity_mt: number | null; vessel_owner: string | null; hull_type: string | null }>>([])
  const [showVesselSuggestions, setShowVesselSuggestions] = useState(false)
  const [portSuggestions, setPortSuggestions] = useState<Array<{ port: string; region: string | null }>>([])
  const [showPortSuggestions, setShowPortSuggestions] = useState(false)
  const vesselSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const portSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Compact/Expand view state
  const [expandedShipmentIds, setExpandedShipmentIds] = useState<Set<string>>(() => new Set())
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [dragColId, setDragColId] = useState<string | null>(null)
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

  // ---- ETA Loading Status buckets (counts for toolbar chips; scoped to current result page only) ----
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

  // ---- ETA Discharge Status buckets (counts for toolbar chips; scoped to current result page only) ----
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

  // Sync URL params -> local filter state
  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (statusParam) setStatusFilter(statusParam)
    setPage(1)
  }, [searchParams])

  useEffect(() => {
    setPage(1)
    fetchShipments(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    statusFilter,
    dateFrom,
    dateTo,
    selectedPlantSites,
    lateIndicatorFilter,
    viewOption,
    etaLoadingFilter,
    etaDischargeFilter,
  ])

  useEffect(() => {
    let cancelled = false
    api
      .get('/dashboard/filter-options/plants')
      .then((res) => {
        if (cancelled) return
        const plantPayload = res.data?.data
        const plants = (Array.isArray(plantPayload)
          ? plantPayload
          : plantPayload && typeof plantPayload === 'object' && 'plants' in plantPayload
            ? (plantPayload as { plants?: string[] }).plants
            : []) as string[]
        setAvailablePlantSites(Array.isArray(plants) ? plants : [])
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Failed to fetch plant/site options:', e)
        setAvailablePlantSites([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const applySearch = useCallback(() => {
    setPage(1)
    setSearchTerm(searchDraft)
    fetchShipments(1, searchDraft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const applyViewFilter = useCallback(() => {
    setPage(1)
    fetchShipments(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Column header filters apply only when user presses Enter inside the filter popover.

  const fetchShipments = async (forcedPage?: number, searchOverride?: string) => {
    setLoading(true)
    try {
      const effectivePage = forcedPage ?? page
      const params = new URLSearchParams()
      params.append('limit', String(pageSize))
      params.append('page', String(effectivePage))
      params.append('compact', 'true')
      if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter)
      }
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      const searchTrim = (searchOverride ?? searchTerm).trim()
      if (searchTrim.length >= 2) {
        params.append('search', searchTrim)
      }
      const cfKeys = Object.keys(columnFilters)
      if (cfKeys.length > 0) {
        params.append('columnFilters', JSON.stringify(columnFilters))
      }
      if (lateIndicatorFilter && lateIndicatorFilter !== 'ALL') {
        params.append('lateIndicator', lateIndicatorFilter)
      }
      if (viewOption !== 'all' && viewFilterValue.trim().length > 0) {
        params.append('viewOption', viewOption)
        params.append('viewQuery', viewFilterValue.trim())
      }
      if (etaLoadingFilter !== 'ALL') {
        params.append('etaLoading', etaLoadingFilter)
      }
      if (etaDischargeFilter !== 'ALL') {
        params.append('etaDischarge', etaDischargeFilter)
      }
      
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
      if (selectedPlantSites.length > 0) {
        selectedPlantSites.forEach((p) => params.append('plant', p))
      }

      // List path: skip heavy enriched summary SQL on the same round-trip; load summary after (debounced).
      params.append('includeSummary', 'false')
      // First paint: skip joining sap_processed_data (often the slowest part); hydrate rows right after.
      params.append('skipSapJoin', 'true')

      const response = await api.get(`/shipments?${params.toString()}`)

      // Check if response structure is correct
      if (response.data && response.data.success && response.data.data && response.data.data.shipments) {
        setShipments(response.data.data.shipments)
        setTotalCount(Number(response.data.data.pagination?.total || 0))
        setShipmentsSummary(response.data.data.summary || null)

        const hydrateParams = new URLSearchParams(params.toString())
        hydrateParams.delete('skipSapJoin')
        void api
          .get(`/shipments?${hydrateParams.toString()}`)
          .then((res) => {
            const rows = res.data?.data?.shipments
            if (Array.isArray(rows) && rows.length > 0) setShipments(rows)
          })
          .catch(() => {
            /* keep first-paint rows */
          })

        if (shipmentsSummaryTimerRef.current) clearTimeout(shipmentsSummaryTimerRef.current)
        const summaryParams = new URLSearchParams(params.toString())
        summaryParams.set('summaryOnly', 'true')
        summaryParams.delete('includeSummary')
        summaryParams.delete('skipSapJoin')
        shipmentsSummaryTimerRef.current = setTimeout(() => {
          void api
            .get(`/shipments?${summaryParams.toString()}`)
            .then((res) => {
              if (res.data?.data?.summary) setShipmentsSummary(res.data.data.summary)
            })
            .catch(() => {
              /* keep zeros / prior summary */
            })
        }, 450)
      } else {
        console.error('Unexpected response structure:', response.data)
        setShipments([])
        setShipmentsSummary(null)
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
      setShipmentsSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const shipIso = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const fetchShipmentCalendarRows = useCallback(async () => {
    setShipCalendarLoading(true)
    try {
      const from = new Date(shipCalendarMonth.getFullYear(), shipCalendarMonth.getMonth(), 1)
      const to = new Date(shipCalendarMonth.getFullYear(), shipCalendarMonth.getMonth() + 1, 0)
      const params = new URLSearchParams()
      params.set('from', shipIso(from))
      params.set('to', shipIso(to))
      const res = await api.get(`/shipments/daily-planning-deliverables?${params.toString()}`)
      setShipCalendarRows((res.data?.data || []) as ShipmentCalendarRow[])
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || e?.message || 'Failed to load shipment daily planning deliverables')
      setShipCalendarRows([])
    } finally {
      setShipCalendarLoading(false)
    }
  }, [shipCalendarMonth])

  const downloadShipmentPlanningTemplate = async () => {
    try {
      const res = await api.get('/shipments/daily-planning-deliverables/template', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'shipment_daily_planning_deliverables_template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || e?.message || 'Failed to download template')
    }
  }

  const handleShipmentPlanningFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setShipPlanningUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/shipments/daily-planning-deliverables/bulk-upload', fd)
      if (res.data?.data) {
        setShipPlanningUploadSummary(res.data.data)
        setShipPlanningUploadOpen(true)
      }
      await fetchShipmentCalendarRows()
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err?.message || 'Upload failed')
    } finally {
      setShipPlanningUploading(false)
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

      // Status is derived from ETA/ATA; only manual override allowed is CANCELLED.
      if (String(payload.status || '').trim().toUpperCase() === 'CANCELLED') {
        payload.status = 'CANCELLED'
      } else {
        delete payload.status
      }
      
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
            alert(`Sum of "Contract Qty assign to STO" (${formatNumber(sumAssigned)} MT) cannot exceed Vessel Capacity (${formatNumber(capacityForCheck)} MT).`)
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
    const headers = [
      'PO Number',
      'Vessel Name',
      'Loading Port',
      'Discharge Port',
      'Qty Delivery',
      'ETA Vessel Arrival at Loading Port',
      'ETA Vessel Berthed at Loading Port',
      'ETA Vessel Start Loading',
      'ETA Vessel Completed Loading',
      'ETA Vessel Sailed from Loading Port',
      'ETA Vessel Arrive at Discharge Port',
      'ETA Vessel Berthed at Discharge Port',
      'ETA Vessel Start Discharging',
      'ETA Vessel Complete Discharge',
    ]

    const sampleRow = [
      'PO-2025-001',
      'MV Example',
      'Jakarta',
      'Singapore',
      '5000',
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
      '2025-01-04',
      '2025-01-05',
      '2025-01-08',
      '2025-01-09',
      '2025-01-10',
      '2025-01-11',
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
      'STO Number','Contract Numbers','Status','Vessel Name','Vessel Code','Vessel Owner','Vessel Draft (m)','Vessel Capacity (MT)','Hull Type','Charter Type','Port of Loading','Port of Discharge','Quantity Shipped (MT)','Quantity Delivered (MT)','Inbound Weight (MT)','Outbound Weight (MT)','Gain/Loss %','Gain/Loss Amount (MT)','Shipment Date (YYYY-MM-DD)','Arrival Date (YYYY-MM-DD)','SLA Days','Is Delayed (TRUE/FALSE)','SAP Delivery ID',
      // Loading port groups (1..3)
      'LP1 Port Name','LP1 Quantity (MT)','LP1 ETA Arrival','LP1 ATA Arrival','LP1 ETA Berthed','LP1 ATA Berthed','LP1 ETA Load Start','LP1 ATA Load Start','LP1 ETA Load Completed','LP1 ATA Load Completed','LP1 ETA Sailed','LP1 ATA Sailed','LP1 Loading Rate (MT/day)',
      'LP2 Port Name','LP2 Quantity (MT)','LP2 ETA Arrival','LP2 ATA Arrival','LP2 ETA Berthed','LP2 ATA Berthed','LP2 ETA Load Start','LP2 ATA Load Start','LP2 ETA Load Completed','LP2 ATA Load Completed','LP2 ETA Sailed','LP2 ATA Sailed','LP2 Loading Rate (MT/day)',
      'LP3 Port Name','LP3 Quantity (MT)','LP3 ETA Arrival','LP3 ATA Arrival','LP3 ETA Berthed','LP3 ATA Berthed','LP3 ETA Load Start','LP3 ATA Load Start','LP3 ETA Load Completed','LP3 ATA Load Completed','LP3 ETA Sailed','LP3 ATA Sailed','LP3 Loading Rate (MT/day)'
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
      // Pre-fetch all reference data in parallel
      let masterVessels: Array<{ vessel_code: string; vessel_name: string }> = []
      let masterPorts: Array<{ port: string; region: string | null }> = []
      let allContracts: Array<{ contract_id: string; po_numbers: string }> = []
      let allShipmentsForLookup: Shipment[] = []
      try {
        const [vRes, pRes, cRes, sRes] = await Promise.all([
          api.get('/master-vessels', { params: { limit: 9999 } }),
          api.get('/master-loading-ports', { params: { limit: 9999 } }),
          api.get('/contracts', { params: { limit: 9999 } }),
          api.get('/shipments', { params: { limit: 9999, compact: true, includeSummary: false } }),
        ])
        masterVessels = vRes.data?.data?.items ?? []
        masterPorts = pRes.data?.data?.items ?? []
        allContracts = cRes.data?.data?.contracts ?? []
        allShipmentsForLookup = sRes.data?.data?.shipments ?? []
      } catch {
        alert('Gagal memuat data referensi. Silakan coba lagi.')
        setUploading(false)
        e.target.value = ''
        return
      }

      // Build lookup maps
      const vesselSet = new Set(masterVessels.map(v => v.vessel_name.toLowerCase()))
      const portSet = new Set(masterPorts.map(p => p.port.toLowerCase()))

      // po_number → contract (business contract_id)
      // API returns po_numbers (plural, comma-separated STRING_AGG), not po_number
      const contractByPo = new Map<string, { contract_id: string; po_numbers: string }>()
      for (const c of allContracts) {
        if (!(c as any).po_numbers) continue
        for (const po of (c as any).po_numbers.split(',').map((p: string) => p.trim())) {
          if (po) contractByPo.set(po, c)
        }
      }

      // contract_id (business key) → existing shipment
      const shipmentByContractId = new Map<string, Shipment>()
      for (const s of allShipmentsForLookup) {
        if (!s.contract_numbers) continue
        for (const cid of s.contract_numbers.split(',').map((c: string) => c.trim())) {
          if (cid) shipmentByContractId.set(cid, s)
        }
      }

      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      const headers = parseCsvLine(lines[0])

      let createCount = 0
      let updateCount = 0
      let errorCount = 0
      const errors: string[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i])
        if (values.length < 1) continue

        const row: any = {}
        headers.forEach((header, index) => {
          row[header.trim()] = values[index]?.trim() || ''
        })

        const poNumber = row['PO Number']
        if (!poNumber) {
          errors.push(`Row ${i + 1}: PO Number wajib diisi`)
          errorCount++
          continue
        }

        // Validate PO exists in contracts
        const contract = contractByPo.get(poNumber)
        if (!contract) {
          errors.push(`Row ${i + 1}: PO Number "${poNumber}" tidak ditemukan di database contracts`)
          errorCount++
          continue
        }

        // Validate vessel and port against master data
        const rowErrors: string[] = []
        if (row['Vessel Name'] && !vesselSet.has(row['Vessel Name'].toLowerCase())) {
          rowErrors.push(`vessel "${row['Vessel Name']}" tidak ada di Master Vessel`)
        }
        if (row['Loading Port'] && !portSet.has(row['Loading Port'].toLowerCase())) {
          rowErrors.push(`loading port "${row['Loading Port']}" tidak ada di Master Port`)
        }
        if (row['Discharge Port'] && !portSet.has(row['Discharge Port'].toLowerCase())) {
          rowErrors.push(`discharge port "${row['Discharge Port']}" tidak ada di Master Port`)
        }
        if (rowErrors.length > 0) {
          errors.push(`Row ${i + 1} (PO ${poNumber}): ${rowErrors.join('; ')}`)
          errorCount++
          continue
        }

        const contractId = contract.contract_id
        const existingShipment = shipmentByContractId.get(contractId)
        const toDate = (v: string) => (v ? v.substring(0, 10) : null)

        try {
          if (existingShipment) {
            // UPDATE — shipment already exists for this contract
            const updateData: any = { shipment_id: existingShipment.shipment_id }
            if (row['Vessel Name']) updateData.vessel_name = row['Vessel Name']
            if (row['Loading Port']) updateData.port_of_loading = row['Loading Port']
            if (row['Discharge Port']) updateData.port_of_discharge = row['Discharge Port']
            if (row['Qty Delivery']) updateData.quantity_delivered = parseFloat(row['Qty Delivery'])

            const shipRes = await api.put(`/shipments/${existingShipment.id}`, updateData)
            if (!shipRes.data.success) {
              errors.push(`Row ${i + 1}: Gagal update shipment untuk PO ${poNumber}`)
              errorCount++
              continue
            }

            // Update ETA on loading port record
            const etaPayload: Record<string, string | null> = {}
            if (row['ETA Vessel Arrival at Loading Port']) etaPayload.eta_vessel_arrival = toDate(row['ETA Vessel Arrival at Loading Port'])
            if (row['ETA Vessel Berthed at Loading Port']) {
              const d = toDate(row['ETA Vessel Berthed at Loading Port'])
              etaPayload.eta_vessel_berthed = d
              etaPayload.eta_vessel_berthed_at_loading_port = d
            }
            if (row['ETA Vessel Start Loading']) etaPayload.eta_loading_start = toDate(row['ETA Vessel Start Loading'])
            if (row['ETA Vessel Completed Loading']) etaPayload.eta_loading_completed = toDate(row['ETA Vessel Completed Loading'])
            if (row['ETA Vessel Sailed from Loading Port']) etaPayload.eta_vessel_sailed = toDate(row['ETA Vessel Sailed from Loading Port'])
            if (row['ETA Vessel Arrive at Discharge Port']) etaPayload.eta_vessel_arrive_at_discharge_port = toDate(row['ETA Vessel Arrive at Discharge Port'])
            if (row['ETA Vessel Berthed at Discharge Port']) etaPayload.eta_vessel_berthed_at_discharge_port = toDate(row['ETA Vessel Berthed at Discharge Port'])
            if (row['ETA Vessel Start Discharging']) etaPayload.eta_vessel_start_discharging = toDate(row['ETA Vessel Start Discharging'])
            if (row['ETA Vessel Complete Discharge']) etaPayload.eta_vessel_complete_discharge = toDate(row['ETA Vessel Complete Discharge'])

            if (Object.keys(etaPayload).length > 0) {
              const portsRes = await api.get(`/shipments/${existingShipment.id}/loading-ports`)
              const ports: VesselLoadingPort[] = portsRes.data.success ? portsRes.data.data : []
              const lp1 = ports.find(p => !p.is_discharge_port && p.port_sequence === 1)
              if (lp1?.id) {
                await api.put(`/shipments/${existingShipment.id}/loading-ports/${lp1.id}`, { id: lp1.id, ...etaPayload })
              } else {
                await api.post(`/shipments/${existingShipment.id}/loading-ports`, {
                  port_sequence: 1,
                  port_name: row['Loading Port'] || '',
                  quantity_at_loading_port: 0,
                  is_discharge_port: false,
                  ...etaPayload,
                })
              }
            }
            updateCount++
          } else {
            // CREATE — no shipment yet for this contract; mirror AddShipmentModal payload
            const etaByContract = {
              [contractId]: {
                eta_arrival: toDate(row['ETA Vessel Arrival at Loading Port']),
                eta_berthed: toDate(row['ETA Vessel Berthed at Loading Port']),
                eta_loading_start: toDate(row['ETA Vessel Start Loading']),
                eta_loading_complete: toDate(row['ETA Vessel Completed Loading']),
                eta_sailed: toDate(row['ETA Vessel Sailed from Loading Port']),
                eta_discharge_arrival: toDate(row['ETA Vessel Arrive at Discharge Port']),
                eta_discharge_berthed: toDate(row['ETA Vessel Berthed at Discharge Port']),
                eta_discharge_start: toDate(row['ETA Vessel Start Discharging']),
                eta_discharge_complete: toDate(row['ETA Vessel Complete Discharge']),
              },
            }
            const shipmentData = {
              operationId: `OP-${contractId}-${Date.now().toString().slice(-8)}`,
              stoNumber: '',
              contractNumbers: [contractId],
              contractQtyAssigned: { [contractId]: row['Qty Delivery'] || '0' },
              etaByContract,
              vesselName: row['Vessel Name'] || '',
              vesselCode: '',
              vesselOwner: '',
              vesselDraft: '',
              vesselCapacity: '',
              vesselHullType: '',
              charterType: '',
              portOfLoading: row['Loading Port'] || '',
              portOfDischarge: row['Discharge Port'] || '',
            }
            const createRes = await api.post('/shipments', shipmentData)
            if (createRes.data.success) {
              createCount++
            } else {
              errors.push(`Row ${i + 1}: Gagal buat shipment untuk PO ${poNumber}: ${createRes.data.error?.message || ''}`)
              errorCount++
            }
          }
        } catch (error: any) {
          const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error'
          errors.push(`Row ${i + 1}: ${errorMsg}`)
          errorCount++
        }
      }

      let message = `Upload selesai!\n\nDibuat: ${createCount}\nDiperbarui: ${updateCount}\nGagal: ${errorCount}`
      if (errors.length > 0 && errors.length <= 10) {
        message += `\n\nErrors:\n${errors.join('\n')}`
      } else if (errors.length > 10) {
        message += `\n\nShowing first 10 errors:\n${errors.slice(0, 10).join('\n')}`
      }

      alert(message)
      await fetchShipments()
    } catch (error) {
      console.error('Bulk upload error:', error)
      alert('Gagal memproses file CSV. Periksa format file dan coba lagi.')
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

  const formatDate = (dateStr: string) => formatDateDMY(dateStr)

  const hasActiveShipmentColumnFilters = useCallback((filters: Record<string, ColumnFilter>): boolean => {
    for (const f of Object.values(filters)) {
      if (f.emptyOnly || f.notBlankOnly) return true
      if (f.type === 'text' && (f.value || '').trim().length > 0) return true
      if (f.type === 'number') {
        if ((f.min !== undefined && String(f.min).trim() !== '') || (f.max !== undefined && String(f.max).trim() !== '')) {
          return true
        }
      }
      if (f.type === 'date' && ((f.from && String(f.from).trim()) || (f.to && String(f.to).trim()))) return true
    }
    return false
  }, [])

  const hasActiveShipmentFilters =
    Boolean(dateFrom || dateTo || searchDraft || searchTerm) ||
    statusFilter !== 'ALL' ||
    lateIndicatorFilter !== 'ALL' ||
    viewFilterValue !== '' ||
    viewOption !== 'all' ||
    selectedPlantSites.length > 0 ||
    etaLoadingFilter !== 'ALL' ||
    etaDischargeFilter !== 'ALL' ||
    hasActiveShipmentColumnFilters(columnFilters)

  const clearShipmentFilters = useCallback(() => {
    setSearchDraft('')
    setSearchTerm('')
    setStatusFilter('ALL')
    setLateIndicatorFilter('ALL')
    setViewOption('all')
    setViewFilterValue('')
    setSelectedPlantSites([])
    setDateFrom('')
    setDateTo('')
    setColumnFilters({})
    setEtaLoadingFilter('ALL')
    setEtaDischargeFilter('ALL')
    setPage(1)
    fetchShipments(1, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Search, columns, view-by, late indicator, and ETA toolbar buckets are applied on the server (full DB).
  const filteredShipments = shipments

  // Fetch contract details for a shipment
  const fetchContractDetails = async (shipment: Shipment) => {
    if (!shipment.contract_numbers) return
    // Always fetch to get latest data, but skip if already loading
    if (loadingContractDetails[shipment.id]) return

    setLoadingContractDetails(prev => ({ ...prev, [shipment.id]: true }))
    try {
      const contractNumbers = shipment.contract_numbers.split(/,\s*/).filter(c => c.trim())
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
      const contractNumbers = shipment.contract_numbers.split(/,\s*/).filter(c => c.trim())
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

  const formatShortDate = (dateStr: string) => formatDateDMY(dateStr)

  // Column visibility and sorting
  const columnStorageKey = 'shipments.compact.visibleColumns'
  const columnOrderStorageKey = 'shipments.compact.columnOrder'
  const sortStorageKey = 'shipments.compact.sort'
  const userViewPrefKey = 'shipments.compact.view.v1'

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

  const [columnOrderIds, setColumnOrderIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem(columnOrderStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        return Array.isArray(parsed) ? parsed.map(String) : []
      }
    } catch {}
    return []
  })

  useEffect(() => {
    if (visibleColumnIds.size > 0) {
      localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(visibleColumnIds)))
    }
  }, [visibleColumnIds])

  useEffect(() => {
    if (columnOrderIds.length > 0) {
      localStorage.setItem(columnOrderStorageKey, JSON.stringify(columnOrderIds))
    }
  }, [columnOrderIds])

  // Load per-user saved view (columns + order). Falls back to localStorage/defaults.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/user-preferences/me?key=${encodeURIComponent(userViewPrefKey)}`)
        const value = res.data?.data?.value
        if (cancelled) return
        const cols = Array.isArray(value?.visibleColumnIds) ? value.visibleColumnIds : Array.isArray(value?.visible) ? value.visible : null
        const order = Array.isArray(value?.columnOrderIds) ? value.columnOrderIds : Array.isArray(value?.order) ? value.order : null
        if (Array.isArray(cols) && cols.length > 0) setVisibleColumnIds(new Set(cols.map((x: any) => String(x))))
        if (Array.isArray(order) && order.length > 0) setColumnOrderIds(order.map((x: any) => String(x)))
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist per-user saved view (debounced, best-effort).
  const saveViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    saveViewTimerRef.current = setTimeout(() => {
      void api
        .post('/user-preferences/me', {
          key: userViewPrefKey,
          value: {
            visibleColumnIds: Array.from(visibleColumnIds),
            columnOrderIds,
          },
        })
        .catch(() => {
          /* keep localStorage fallback */
        })
    }, 500)
    return () => {
      if (saveViewTimerRef.current) clearTimeout(saveViewTimerRef.current)
    }
  }, [columnOrderIds, userViewPrefKey, visibleColumnIds])

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
        <span className="text-sm break-words block">
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
      label: 'Contract Reff PO',
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
        'contract_numbers',
        'contract_ext_no',
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

  // Initialize / heal column order whenever column definitions change.
  useEffect(() => {
    const allIds = compactColumns.map((c) => c.id)
    setColumnOrderIds((prev) => {
      const base = prev.length > 0 ? prev : allIds
      const deduped = Array.from(new Set(base))
      const missing = allIds.filter((id) => !deduped.includes(id))
      return [...deduped, ...missing].filter((id) => allIds.includes(id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactColumns])

  const visibleColumns = useMemo(() => {
    const byId = new Map(compactColumns.map((c) => [c.id, c] as const))
    const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : compactColumns.map((c) => c.id))
      .filter((id) => byId.has(id))
    const orderedAll = orderedIds.map((id) => byId.get(id)!).filter(Boolean)
    const visible = orderedAll.filter((c) => visibleColumnIds.has(c.id))

    // Keep required columns always visible (order is controlled by drag & drop).
    const required = ['late_indicator', 'operation_id', 'shipment_id', 'status']
    const visibleIds = new Set(visible.map((c) => c.id))
    const missingRequired = required
      .map((id) => byId.get(id))
      .filter((c): c is CompactColumn => Boolean(c))
      .filter((c) => !visibleIds.has(c.id))

    return [...visible, ...missingRequired]
  }, [compactColumns, visibleColumnIds, editingId, columnOrderIds])

  const moveColumnOrder = (id: string, direction: 'up' | 'down') => {
    const pinned = new Set(['late_indicator', 'operation_id', 'shipment_id', 'status'])
    if (pinned.has(id)) return
    setColumnOrderIds((prev) => {
      const ids = prev.length > 0 ? [...prev] : compactColumns.map((c) => c.id)
      const idx = ids.indexOf(id)
      if (idx < 0) return ids
      const swapWith = direction === 'up' ? idx - 1 : idx + 1
      if (swapWith < 0 || swapWith >= ids.length) return ids
      if (pinned.has(ids[swapWith])) return ids
      ;[ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]]
      return ids
    })
  }

  const reorderColumnByDrag = (dragId: string, dropId: string) => {
    if (dragId === dropId) return
    setColumnOrderIds((prev) => {
      const ids = prev.length > 0 ? [...prev] : compactColumns.map((c) => c.id)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(dropId)
      if (from < 0 || to < 0) return ids
      ids.splice(from, 1)
      ids.splice(to, 0, dragId)
      return ids
    })
  }

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

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((totalCount || 0) / pageSize)),
    [totalCount, pageSize]
  )

  const handlePageChange = useCallback((nextPage: number) => {
    if (nextPage >= 1 && nextPage <= totalPages) {
      setPage(nextPage)
      fetchShipments(nextPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages])

  const resetCompactColumnView = useCallback(() => {
    const vis = new Set(defaultVisibleColumnIds)
    const order = compactColumns.map((c) => c.id)
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
  }, [defaultVisibleColumnIds, compactColumns, columnStorageKey, columnOrderStorageKey])

  const compactGridColumnTracks = useMemo(() => {
    const tracks: Record<string, string> = {}
    for (const [id, px] of Object.entries(SHIPMENT_COLUMN_WIDTH_PX)) {
      tracks[id] = `minmax(${px}px, ${px}px)`
    }
    return tracks
  }, [])

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
      const portData = buildLoadingPortUpdatePayload(editedPortData as Record<string, unknown>, portId)
      const response = await api.put(`/shipments/${selectedShipment.id}/loading-ports/${portId}`, portData)
      
      if (response.data.success) {
        await fetchLoadingPorts(selectedShipment.id, true)
        setEditingPortId(null)
        setEditedPortData(null)
        alert('Loading port updated successfully!')
      }
    } catch (error) {
      console.error('Error saving loading port:', error)
      alert(apiErrorMessage(error, 'Failed to save loading port'))
    }
  }

  const handleCancelEditAll = () => {
    handleCancelEditShipmentInfo()
    handleCancelEditPort()
  }

  const handleSaveAll = async () => {
    // Save overall shipment info (includes first loading + first discharge port ETA)
    await handleSaveShipmentInfo()

    // Also save the edited port row (including first loading/discharge) so edits made in the table
    // are not silently dropped when user presses "Save All".
    if (editingPortId) {
      await handleSavePort(editingPortId)
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
        vessel_discharge_port_1: shipmentInfo.vessel_discharge_port_1 || '',
        // Ensure Quality fields are included (editable)
        quality_at_loading_loc_1_ffa: shipmentInfo.quality_at_loading_loc_1_ffa ?? null,
        quality_at_loading_loc_1_mi: shipmentInfo.quality_at_loading_loc_1_mi ?? null,
        quality_at_loading_loc_1_dobi: shipmentInfo.quality_at_loading_loc_1_dobi ?? null,
        quality_at_loading_loc_1_red: shipmentInfo.quality_at_loading_loc_1_red ?? null,
        quality_at_loading_loc_1_ds: shipmentInfo.quality_at_loading_loc_1_ds ?? null,
        quality_at_loading_loc_1_stone: shipmentInfo.quality_at_loading_loc_1_stone ?? null,
        quality_at_discharge_loc_1_ffa: shipmentInfo.quality_at_discharge_loc_1_ffa ?? null,
        quality_at_discharge_loc_1_mi: shipmentInfo.quality_at_discharge_loc_1_mi ?? null,
        quality_at_discharge_loc_1_dobi: shipmentInfo.quality_at_discharge_loc_1_dobi ?? null,
        quality_at_discharge_loc_1_red: shipmentInfo.quality_at_discharge_loc_1_red ?? null,
        quality_at_discharge_loc_1_ds: shipmentInfo.quality_at_discharge_loc_1_ds ?? null,
        quality_at_discharge_loc_1_stone: shipmentInfo.quality_at_discharge_loc_1_stone ?? null,
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
      const identifier = selectedShipment.id
      const info = editedShipmentInfo

      const updateData: Record<string, unknown> = {}
      if (info.quantity_delivered !== undefined && info.quantity_delivered !== null) {
        updateData.quantity_delivered = info.quantity_delivered
      }
      if (info.actual_vessel_qty_receive !== undefined && info.actual_vessel_qty_receive !== null) {
        updateData.actual_vessel_qty_receive = info.actual_vessel_qty_receive
      }
      if (info.vessel_oa_actual !== undefined && info.vessel_oa_actual !== null) {
        updateData.vessel_oa_actual = info.vessel_oa_actual
      }
      if (info.vessel_oa_budget !== undefined && info.vessel_oa_budget !== null) {
        updateData.vessel_oa_budget = info.vessel_oa_budget
      }
      if (info.bl_quantity !== undefined && info.bl_quantity !== null) {
        updateData.bl_quantity = info.bl_quantity
      }
      const pol = String(info.vessel_loading_port_1 ?? '').trim()
      if (pol && pol !== '0.00') updateData.port_of_loading = pol
      const pod = String(info.vessel_discharge_port_1 ?? '').trim()
      if (pod && pod !== '0.00') updateData.port_of_discharge = pod

      if (Object.keys(updateData).length > 0) {
        const response = await api.put(`/shipments/${identifier}`, updateData)
        if (!response.data?.success) {
          throw new Error(response.data?.error?.message || 'Failed to update shipment')
        }
      }

      const refreshedPortsResponse = await api.get(`/shipments/${identifier}/loading-ports`)
      let refreshedPorts: VesselLoadingPort[] = []
      if (refreshedPortsResponse.data.success && refreshedPortsResponse.data.data.ports) {
        refreshedPorts = refreshedPortsResponse.data.data.ports
      }

      const firstPort =
        refreshedPorts.find((p) => !p.is_discharge_port && p.port_sequence === 1) ||
        refreshedPorts.find((p) => !p.is_discharge_port) ||
        loadingPorts.find((p) => !p.is_discharge_port && p.port_sequence === 1) ||
        loadingPorts.find((p) => !p.is_discharge_port)

      const hasAnyLoadingPort =
        refreshedPorts.some((p) => !p.is_discharge_port) || loadingPorts.some((p) => !p.is_discharge_port)

      if (firstPort?.id) {
        const loadingPortUpdateData = buildLoadingPortUpdatePayload(
          {
            ...(firstPort as unknown as Record<string, unknown>),
            port_name: info.vessel_loading_port_1 || firstPort.port_name || 'Loading Port 1',
            port_sequence: firstPort.port_sequence ?? 1,
            quantity_at_loading_port: info.actual_vessel_qty_receive ?? firstPort.quantity_at_loading_port ?? 0,
            is_discharge_port: false,
            quality_ffa: info.quality_at_loading_loc_1_ffa ?? firstPort.quality_ffa ?? null,
            quality_mi: info.quality_at_loading_loc_1_mi ?? firstPort.quality_mi ?? null,
            quality_dobi: info.quality_at_loading_loc_1_dobi ?? firstPort.quality_dobi ?? null,
            quality_red: info.quality_at_loading_loc_1_red ?? firstPort.quality_red ?? null,
            quality_ds: info.quality_at_loading_loc_1_ds ?? firstPort.quality_ds ?? null,
            quality_stone: info.quality_at_loading_loc_1_stone ?? firstPort.quality_stone ?? null,
            eta_vessel_arrival: info.eta_vessel_arrival_at_loading_port ?? firstPort.eta_vessel_arrival,
            eta_vessel_berthed_at_loading_port:
              info.eta_vessel_berthed_at_loading_port ?? firstPort.eta_vessel_berthed_at_loading_port,
            eta_vessel_berthed:
              info.eta_vessel_berthed_at_loading_port ?? firstPort.eta_vessel_berthed_at_loading_port ?? firstPort.eta_vessel_berthed,
            eta_loading_start: info.eta_vessel_start_loading ?? firstPort.eta_loading_start,
            eta_loading_completed: info.eta_vessel_completed_loading ?? firstPort.eta_loading_completed,
            eta_vessel_sailed: info.eta_vessel_sailed_from_loading_port ?? firstPort.eta_vessel_sailed,
            eta_vessel_arrive_at_discharge_port: null,
            eta_vessel_berthed_at_discharge_port: null,
            eta_vessel_start_discharging: null,
            eta_vessel_complete_discharge: null,
          },
          firstPort.id,
        )
        await api.put(`/shipments/${identifier}/loading-ports/${firstPort.id}`, loadingPortUpdateData)
      } else if (
        !hasAnyLoadingPort &&
        (info.eta_vessel_arrival_at_loading_port ||
          info.eta_vessel_berthed_at_loading_port ||
          info.eta_vessel_start_loading ||
          info.eta_vessel_completed_loading ||
          info.eta_vessel_sailed_from_loading_port ||
          info.vessel_loading_port_1)
      ) {
        const newPortData = buildLoadingPortUpdatePayload(
          {
            port_name: info.vessel_loading_port_1 || 'Loading Port 1',
            port_sequence: 1,
            quantity_at_loading_port: info.actual_vessel_qty_receive || 0,
            is_discharge_port: false,
            quality_ffa: info.quality_at_loading_loc_1_ffa ?? null,
            quality_mi: info.quality_at_loading_loc_1_mi ?? null,
            quality_dobi: info.quality_at_loading_loc_1_dobi ?? null,
            quality_red: info.quality_at_loading_loc_1_red ?? null,
            quality_ds: info.quality_at_loading_loc_1_ds ?? null,
            quality_stone: info.quality_at_loading_loc_1_stone ?? null,
            eta_vessel_arrival: info.eta_vessel_arrival_at_loading_port,
            eta_vessel_berthed_at_loading_port: info.eta_vessel_berthed_at_loading_port,
            eta_vessel_berthed: info.eta_vessel_berthed_at_loading_port,
            eta_loading_start: info.eta_vessel_start_loading,
            eta_loading_completed: info.eta_vessel_completed_loading,
            eta_vessel_sailed: info.eta_vessel_sailed_from_loading_port,
          },
          '',
        )
        delete newPortData.id
        await api.post(`/shipments/${identifier}/loading-ports`, newPortData)
      }

      const finalPortsResponse = await api.get(`/shipments/${identifier}/loading-ports`)
      let finalPorts: VesselLoadingPort[] = []
      if (finalPortsResponse.data.success && finalPortsResponse.data.data.ports) {
        finalPorts = finalPortsResponse.data.data.ports
      }
      const dischargePort =
        finalPorts.find((p) => p.is_discharge_port) ||
        refreshedPorts.find((p) => p.is_discharge_port) ||
        loadingPorts.find((p) => p.is_discharge_port)

      if (dischargePort?.id) {
        const dischargePortUpdateData = buildLoadingPortUpdatePayload(
          {
            ...(dischargePort as unknown as Record<string, unknown>),
            port_name: info.vessel_discharge_port_1 || dischargePort.port_name || 'Discharge Port',
            port_sequence: dischargePort.port_sequence ?? 999,
            is_discharge_port: true,
            eta_vessel_arrive_at_discharge_port:
              info.eta_vessel_arrive_at_discharge_port ?? dischargePort.eta_vessel_arrive_at_discharge_port,
            eta_vessel_berthed_at_discharge_port:
              info.eta_vessel_berthed_at_discharge_port ?? dischargePort.eta_vessel_berthed_at_discharge_port,
            eta_vessel_start_discharging:
              info.eta_vessel_start_discharging ?? dischargePort.eta_vessel_start_discharging,
            eta_vessel_complete_discharge:
              info.eta_vessel_complete_discharge ?? dischargePort.eta_vessel_complete_discharge,
            eta_vessel_arrival: null,
            eta_vessel_berthed_at_loading_port: null,
            eta_loading_start: null,
            eta_loading_completed: null,
            eta_vessel_sailed: null,
          },
          dischargePort.id,
        )
        await api.put(`/shipments/${identifier}/loading-ports/${dischargePort.id}`, dischargePortUpdateData)
      }

      await fetchLoadingPorts(identifier, true)
      setEditingShipmentInfo(false)
      setEditedShipmentInfo(null)
      alert('Shipment information updated successfully!')
    } catch (error) {
      console.error('Error saving shipment info:', error)
      alert(apiErrorMessage(error, 'Failed to save shipment information'))
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

  const formatDateTime = (dateStr: string) => formatDateTimeDMY(dateStr)

  const getColumnWidth = useCallback(
    (colId: string): string => compactGridColumnTracks[colId] ?? 'minmax(150px, 150px)',
    [compactGridColumnTracks]
  )

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
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={downloadTemplate}
              className="border-green-600 text-green-700 hover:bg-green-50"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            {canExportShipments && (
              <Button
                size="sm"
                variant="outline"
                onClick={exportFilteredData}
              >
                <Download className="h-4 w-4 mr-2" />
                Export Data
              </Button>
            )}
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
                size="sm"
                variant="outline"
                onClick={() => document.getElementById('bulk-upload-input')?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload CSV
                  </>
                )}
              </Button>
            </>
            <Button
              size="sm"
              onClick={() => {
                // Allow opening the modal immediately; permissions load async and may fail open for admin workflows.
                if (perms.loaded && !canOpenAddShipmentModal) {
                  alert(
                    'You need Create or Edit permission on Shipments (data.shipments) to add a shipment. Ask an admin to update your role.'
                  )
                  return
                }
                setShowAddShipment(true)
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Shipment
            </Button>
          </div>
        </div>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex w-full min-w-0 items-center justify-start gap-3 overflow-x-auto py-4 px-4 md:gap-6">
              <div className="flex flex-nowrap items-center shrink-0">
              {[
                { status: 'PLANNED',     label: 'Planned',     color: 'bg-blue-100',   textColor: 'text-blue-800',   badgeColor: 'bg-blue-600',   tooltip: 'Shipment sudah memiliki ETA — minimal satu milestone ETA sudah diinput.' },
                { status: 'IN_PROGRESS', label: 'In Progress', color: 'bg-yellow-100', textColor: 'text-yellow-800', badgeColor: 'bg-yellow-600', tooltip: 'Shipment sedang diproses — kapal menuju lokasi pemuatan (ATA arrival at loading port).' },
                { status: 'LOADING',     label: 'Loading',     color: 'bg-orange-100', textColor: 'text-orange-800', badgeColor: 'bg-orange-600', tooltip: 'Kapal sedang memuat muatan di pelabuhan asal.' },
                { status: 'IN_TRANSIT',  label: 'In Transit',  color: 'bg-purple-100', textColor: 'text-purple-800', badgeColor: 'bg-purple-600', tooltip: 'Kapal sudah berangkat dan sedang dalam perjalanan ke pelabuhan tujuan.' },
                { status: 'ARRIVED',     label: 'Arrived',     color: 'bg-indigo-100', textColor: 'text-indigo-800', badgeColor: 'bg-indigo-600', tooltip: 'Kapal sudah tiba di pelabuhan tujuan, menunggu proses bongkar.' },
                { status: 'UNLOADING',   label: 'Unloading',   color: 'bg-cyan-100',   textColor: 'text-cyan-800',   badgeColor: 'bg-cyan-600',   tooltip: 'Muatan sedang dibongkar dari kapal di pelabuhan tujuan.' },
                { status: 'COMPLETED',   label: 'Completed',   color: 'bg-green-100',  textColor: 'text-green-800',  badgeColor: 'bg-green-600',  tooltip: 'Pengiriman selesai — muatan sudah diterima di tujuan.' },
                { status: 'CANCELLED',   label: 'Cancelled',   color: 'bg-red-100',    textColor: 'text-red-800',    badgeColor: 'bg-red-600',    tooltip: 'Shipment dibatalkan dan tidak dilanjutkan.' },
              ].map((statusInfo, index, array) => {
                const summary = shipmentsSummary?.status
                const count =
                  statusInfo.status === 'PLANNED' ? Number(summary?.planned ?? 0)
                    : statusInfo.status === 'IN_PROGRESS' ? Number(summary?.inProgress ?? 0)
                      : statusInfo.status === 'LOADING' ? Number(summary?.loading ?? 0)
                        : statusInfo.status === 'IN_TRANSIT' ? Number(summary?.inTransit ?? 0)
                          : statusInfo.status === 'ARRIVED' ? Number(summary?.arrived ?? 0)
                            : statusInfo.status === 'UNLOADING' ? Number(summary?.unloading ?? 0)
                              : statusInfo.status === 'COMPLETED' ? Number(summary?.completed ?? 0)
                                : statusInfo.status === 'CANCELLED' ? Number(summary?.cancelled ?? 0)
                                  : 0
                return (
                  <div key={statusInfo.status} className="flex items-center flex-shrink-0">
                    <div className="relative">
                      <div
                        title={statusInfo.tooltip}
                        className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-white shadow-lg hover:shadow-xl transition-shadow cursor-help ${statusInfo.color} flex items-center justify-center`}
                      >
                        {/* Count Badge */}
                        <div className={`absolute -top-3 -right-3 text-white text-xs md:text-sm font-bold rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center shadow-lg z-10 ${statusInfo.badgeColor}`}>
                          {count}
                        </div>
                        {/* Status Label */}
                        <span className={`text-xs md:text-sm font-semibold px-2 leading-tight ${statusInfo.textColor} text-center`}>
                          {statusInfo.label}
                        </span>
                      </div>
                    </div>
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
                  label: 'ETA Loading > 7D',
                  count: Number(shipmentsSummary?.etaLoading?.moreThan7D ?? etaLoadingBuckets.counts.moreThan7D),
                  color: 'bg-sky-50',
                },
                {
                  key: 'D_MINUS_2' as const,
                  label: 'ETA Loading D-2',
                  count: Number(shipmentsSummary?.etaLoading?.dMinus2 ?? etaLoadingBuckets.counts.dMinus2),
                  color: 'bg-amber-50',
                },
                {
                  key: 'D' as const,
                  label: 'ETA Loading D',
                  count: Number(shipmentsSummary?.etaLoading?.d ?? etaLoadingBuckets.counts.d),
                  color: 'bg-emerald-50',
                },
                {
                  key: 'DELAY' as const,
                  label: 'ETA Loading Delay',
                  count: Number(shipmentsSummary?.etaLoading?.delay ?? etaLoadingBuckets.counts.delay),
                  color: 'bg-rose-50',
                },
                {
                  key: 'NO_ETA' as const,
                  label: 'No ETA',
                  count: Number(shipmentsSummary?.etaLoading?.noEta ?? etaLoadingBuckets.counts.noEta),
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
                  count: Number(shipmentsSummary?.etaDischarge?.moreThan7D ?? etaDischargeBuckets.counts.moreThan7D),
                  color: 'bg-sky-50',
                },
                {
                  key: 'D_MINUS_2' as const,
                  label: 'ETA Discharge D-2',
                  count: Number(shipmentsSummary?.etaDischarge?.dMinus2 ?? etaDischargeBuckets.counts.dMinus2),
                  color: 'bg-amber-50',
                },
                {
                  key: 'D' as const,
                  label: 'ETA Discharge D',
                  count: Number(shipmentsSummary?.etaDischarge?.d ?? etaDischargeBuckets.counts.d),
                  color: 'bg-emerald-50',
                },
                {
                  key: 'DELAY' as const,
                  label: 'ETA Discharge Delay',
                  count: Number(shipmentsSummary?.etaDischarge?.delay ?? etaDischargeBuckets.counts.delay),
                  color: 'bg-rose-50',
                },
                {
                  key: 'NO_ETA' as const,
                  label: 'No ETA',
                  count: Number(shipmentsSummary?.etaDischarge?.noEta ?? etaDischargeBuckets.counts.noEta),
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


        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="relative min-w-[12rem] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
                  <Input
                    placeholder="Search by Shipment ID, Contract Ext No, Contract Numbers, PO No, or Vessel Name..."
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
                <option value="PLANNED">Planned</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="LOADING">Loading</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="ARRIVED">Arrived</option>
                <option value="UNLOADING">Unloading</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                </select>
                <select
                  value={lateIndicatorFilter}
                  onChange={(e) => setLateIndicatorFilter(e.target.value)}
                  className="rounded-lg border px-4 py-2"
                >
                <option value="ALL">All Late Indicator</option>
                <option value="ON_TIME">On Time</option>
                <option value="LATE">Late</option>
                <option value="NA">N/A</option>
                </select>
                <select
                  value={viewOption}
                  onChange={(e) => {
                    setViewOption(
                      e.target.value as
                        | 'all'
                        | 'sto'
                        | 'contract'
                        | 'contract_ext'
                        | 'vessel'
                        | 'port_loading'
                        | 'port_discharge',
                    )
                    setViewFilterValue('')
                  }}
                  className="rounded-lg border px-4 py-2"
                >
                  <option value="all">View by: All</option>
                  <option value="sto">View by: STO Number</option>
                  <option value="contract">View by: Contract Numbers</option>
                  <option value="contract_ext">View by: Contract Ext No</option>
                  <option value="vessel">View by: Vessel Name</option>
                  <option value="port_loading">View by: Port of Loading</option>
                  <option value="port_discharge">View by: Port of Discharge</option>
                </select>
                {viewOption !== 'all' && (
                  <Input
                    placeholder={`Filter by ${
                      viewOption === 'sto' ? 'STO Number'
                        : viewOption === 'contract' ? 'Contract Numbers'
                          : viewOption === 'contract_ext' ? 'Contract Ext No'
                          : viewOption === 'vessel' ? 'Vessel Name'
                            : viewOption === 'port_loading' ? 'Port of Loading'
                              : 'Port of Discharge'
                    }...`}
                    value={viewFilterValue}
                    onChange={(e) => setViewFilterValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        applyViewFilter()
                      }
                    }}
                    className="w-48"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SearchableMultiSelect
                  label="Plant/Site"
                  options={availablePlantSites}
                  selected={selectedPlantSites}
                  onChange={setSelectedPlantSites}
                  placeholder="Select plant/site(s)"
                  emptyMessage="Loading plants..."
                />
              </div>

              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Contract Date:</label>
                  <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={setDateFrom} className="w-40" />
                  <span className="text-gray-500">to</span>
                  <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={setDateTo} className="w-40" />
                  {hasActiveShipmentFilters && (
                    <Button
                      type="button"
                      onClick={clearShipmentFilters}
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

        {false && (
          <>
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base flex flex-wrap items-center gap-2">
                    Daily Planning Deliverables — Calendar
                    <Badge variant="outline" className="text-[10px]">Unit: Kg</Badge>
                  </CardTitle>
                  <div className="text-xs text-gray-600 mt-1 max-w-xl">
                    SEA shipment daily planning deliverables. Upload CSV/Excel (Contract Ext No, date, quantity) — validation matches the website (due date range, B/L quantity caps).
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={downloadShipmentPlanningTemplate}>
                    <Download className="h-4 w-4 mr-1" />
                    Template
                  </Button>
                  <input
                    ref={shipPlanningFileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    className="hidden"
                    onChange={handleShipmentPlanningFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={shipPlanningUploading}
                    onClick={() => shipPlanningFileInputRef.current?.click()}
                  >
                    {shipPlanningUploading ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-1" />
                    )}
                    Upload
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShipCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
                  value={shipCalendarMonth.getMonth()}
                  onChange={(e) => setShipCalendarMonth(new Date(shipCalendarMonth.getFullYear(), Number(e.target.value), 1))}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>
                      {format(new Date(2000, i, 1), 'MMMM')}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[88px]"
                  value={shipCalendarMonth.getFullYear()}
                  onChange={(e) => setShipCalendarMonth(new Date(Number(e.target.value), shipCalendarMonth.getMonth(), 1))}
                >
                  {shipPlanningYearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShipCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                >
                  Next <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date()
                    setShipCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                  }}
                >
                  Today
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                {shipCalendarLoading ? (
                  <div className="text-center py-10 text-gray-500">Loading…</div>
                ) : shipCalendarRows.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">No shipments in this month window</div>
                ) : (
                  <table className="min-w-[1400px] w-full text-xs border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-100">
                        <th className="sticky left-0 z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200 min-w-[220px]">
                          Shipment / STO
                        </th>
                        <th className="sticky left-[220px] z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200 min-w-[260px]">
                          Contract Ext No / Supplier
                        </th>
                        {shipCalendarMetaOrderIds.map((id) => {
                          const label = id === 'due_start' ? 'Due Start' : id === 'due_end' ? 'Due End' : 'B/L Qty (MT)'
                          const alignRight = id === 'bl_qty'
                          return (
                            <th
                              key={id}
                              className={`px-3 py-2 font-semibold text-gray-700 border-b border-gray-200 cursor-move ${alignRight ? 'text-right' : 'text-left'} ${shipCalendarDragMetaColId === id ? 'opacity-60' : ''}`}
                              draggable
                              onDragStart={(e) => {
                                setShipCalendarDragMetaColId(id)
                                e.dataTransfer.setData('text/plain', id)
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onDragEnd={() => setShipCalendarDragMetaColId(null)}
                              onDragOver={(e) => {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                const dragged = e.dataTransfer.getData('text/plain')
                                if (dragged) reorderShipCalendarMetaCols(dragged, id)
                                setShipCalendarDragMetaColId(null)
                              }}
                              title="Drag to reorder"
                            >
                              {label}
                            </th>
                          )
                        })}
                        {Array.from({ length: new Date(shipCalendarMonth.getFullYear(), shipCalendarMonth.getMonth() + 1, 0).getDate() }, (_, i) => i + 1).map((d) => (
                          <th key={d} className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 tabular-nums">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {shipCalendarRows.map((r) => {
                        const daysInMonth = new Date(shipCalendarMonth.getFullYear(), shipCalendarMonth.getMonth() + 1, 0).getDate()
                        const dayIso = (day: number) => {
                          const yyyy = shipCalendarMonth.getFullYear()
                          const mm = String(shipCalendarMonth.getMonth() + 1).padStart(2, '0')
                          const dd = String(day).padStart(2, '0')
                          return `${yyyy}-${mm}-${dd}`
                        }
                        const getQtyKg = (date: string) => {
                          const hit = (r.daily_deliverables || []).find((x) => (x?.date || '').slice(0, 10) === date)
                          return hit ? Number(hit.quantity_delivered || 0) : 0
                        }
                        const kgToMt = (kg: number) => kg / 1000
                        const fmtMt = (mt: number) =>
                          Number.isFinite(mt)
                            ? mt.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: mt === 0 ? 0 : 2 })
                            : '—'
                        const dueStart = r.delivery_start_date ? formatDateDMY(r.delivery_start_date) : '-'
                        const dueEnd = r.delivery_end_date ? formatDateDMY(r.delivery_end_date) : '-'
                        const blQty = Number(r.bl_quantity ?? r.quantity_shipped ?? 0)
                        const blQtyMt = kgToMt(blQty)
                        const commitShipDailyDeliverable = async (date: string, rawValue: string) => {
                          const key = `${r.id}:${date}`
                          const mt = rawValue.trim() === '' ? null : Number(String(rawValue).replace(/,/g, ''))
                          if (mt != null && (!Number.isFinite(mt) || mt < 0)) {
                            alert('Quantity must be a valid number (>= 0)')
                            return false
                          }
                          const qKg = mt == null ? null : mt * 1000
                          const existing = (r.daily_deliverables || []).slice()
                          const next = existing.filter((x) => (x?.date || '').slice(0, 10) !== date)
                          if (qKg != null && qKg !== 0) {
                            next.push({ date, quantity_delivered: qKg })
                            next.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                          }
                          setShipCalendarSavingKey(key)
                          try {
                            const res = await api.put(`/shipments/${r.id}/daily-planning-deliverables`, { daily_deliverables: next })
                            if (res.data?.success) {
                              setShipCalendarRows((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, daily_deliverables: res.data.data.daily_deliverables || next } : x)),
                              )
                              return true
                            }
                            return false
                          } catch (e2: any) {
                            alert(e2?.response?.data?.error?.message || e2?.message || 'Failed to update daily deliverables')
                            return false
                          } finally {
                            setShipCalendarSavingKey(null)
                          }
                        }
                        return (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-gray-100 min-w-[220px] align-top">
                              <div className="font-semibold text-gray-900 truncate" title={r.shipment_id}>{r.shipment_id}</div>
                              <div className="text-[10px] text-gray-500 truncate" title={r.sto_number || ''}>STO: {r.sto_number || '—'}</div>
                              <div className="text-[10px] text-gray-500 truncate" title={r.vessel_name || ''}>Vessel: {r.vessel_name || '—'}</div>
                            </td>
                            <td className="sticky left-[220px] z-10 bg-white px-3 py-2 border-b border-gray-100 min-w-[260px] align-top">
                              <div className="font-medium text-gray-900 whitespace-normal break-words" title={r.contract_ext_no || ''}>{r.contract_ext_no || '—'}</div>
                              <div className="text-[10px] text-gray-500 whitespace-normal break-words" title={r.supplier || ''}>{r.supplier || '—'}</div>
                            </td>
                            {shipCalendarMetaOrderIds.map((id) => {
                              if (id === 'due_start') return <td key={id} className="px-3 py-2 border-b border-gray-100 tabular-nums">{dueStart}</td>
                              if (id === 'due_end') return <td key={id} className="px-3 py-2 border-b border-gray-100 tabular-nums">{dueEnd}</td>
                              return <td key={id} className="px-3 py-2 border-b border-gray-100 text-right tabular-nums">{blQty ? `${fmtMt(blQtyMt)} MT` : '—'}</td>
                            })}
                            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                              const date = dayIso(d)
                              const qtyKg = getQtyKg(date)
                              const qtyMt = kgToMt(qtyKg)
                              const key = `${r.id}:${date}`
                              const isEditing = shipCalendarEditing?.id === r.id && shipCalendarEditing?.date === date
                              const isSaving = shipCalendarSavingKey === key
                              return (
                                <td
                                  key={date}
                                  className={`px-2 py-1.5 border-b border-gray-100 text-right tabular-nums ${isEditing ? 'bg-amber-50' : ''}`}
                                  onClick={() => {
                                    if (isSaving) return
                                    setShipCalendarEditing({ id: r.id, date })
                                    setShipCalendarEditValue(qtyKg ? String(qtyMt) : '')
                                  }}
                                >
                                  {isEditing ? (
                                    <div className="flex items-center justify-end gap-1">
                                      <input
                                        autoFocus
                                        value={shipCalendarEditValue}
                                        onChange={(e) => setShipCalendarEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Escape') setShipCalendarEditing(null)
                                          if (e.key === 'Enter') (async () => {
                                            const ok = await commitShipDailyDeliverable(date, shipCalendarEditValue)
                                            if (ok) {
                                              setShipCalendarEditing(null)
                                              setShipCalendarEditValue('')
                                            }
                                          })()
                                          if (e.key === 'Tab') (async () => {
                                            e.preventDefault()
                                            const ok = await commitShipDailyDeliverable(date, shipCalendarEditValue)
                                            if (!ok) return
                                            const nextDay = d + 1
                                            if (nextDay > daysInMonth) {
                                              setShipCalendarEditing(null)
                                              setShipCalendarEditValue('')
                                              return
                                            }
                                            const nextDate = dayIso(nextDay)
                                            const nextQtyKg = getQtyKg(nextDate)
                                            const nextQtyMt = kgToMt(nextQtyKg)
                                            setShipCalendarEditing({ id: r.id, date: nextDate })
                                            setShipCalendarEditValue(nextQtyKg ? String(nextQtyMt) : '')
                                          })()
                                        }}
                                        onBlur={() => setShipCalendarEditing(null)}
                                        className="w-[64px] h-7 px-2 rounded border bg-white text-right text-xs"
                                        placeholder="0"
                                      />
                                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" /> : null}
                                    </div>
                                  ) : qtyKg ? (
                                    <span className="font-medium text-slate-900">{fmtMt(qtyMt)}</span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          <Dialog open={shipPlanningUploadOpen} onOpenChange={setShipPlanningUploadOpen}>
            <DialogContent className="max-w-2xl max-h-[88vh]">
              <DialogHeader>
                <DialogTitle>Shipment daily planning upload result</DialogTitle>
              </DialogHeader>
              {shipPlanningUploadSummary ? (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Rows processed</div>
                      <div className="text-lg font-semibold tabular-nums">{shipPlanningUploadSummary.processedRows}</div>
                    </div>
                    <div className="rounded-md border bg-green-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Succeeded</div>
                      <div className="text-lg font-semibold tabular-nums text-green-800">{shipPlanningUploadSummary.succeededOperations}</div>
                    </div>
                    <div className="rounded-md border bg-red-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Failed</div>
                      <div className="text-lg font-semibold tabular-nums text-red-800">{shipPlanningUploadSummary.failedOperations}</div>
                    </div>
                  </div>
                  {(shipPlanningUploadSummary.rowParseFailures?.length ?? 0) > 0 ? (
                    <div>
                      <div className="font-medium text-gray-900 mb-2">Row issues</div>
                      <ul className="max-h-40 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                        {shipPlanningUploadSummary.rowParseFailures.map((f: any, i: number) => (
                          <li key={`spr-${i}`}>
                            <span className="font-mono">Line {f.rowNumber}</span>{f.contract_ext_no ? ` Â· ${f.contract_ext_no}` : ''}: {f.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(shipPlanningUploadSummary.operationFailures?.length ?? 0) > 0 ? (
                    <div>
                      <div className="font-medium text-gray-900 mb-2">Failures</div>
                      <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-2 p-2">
                        {shipPlanningUploadSummary.operationFailures.map((f: any, i: number) => (
                          <li key={`spf-${i}`}>
                            <span className="font-semibold">{f.contract_ext_no}</span>
                            {f.shipment_ids?.length ? <span className="text-gray-600"> Â· Shipments: {f.shipment_ids.join(', ')}</span> : null}
                            {f.rowNumbers?.length ? <span className="text-gray-600"> (rows {f.rowNumbers.join(', ')})</span> : null}
                            : {f.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
          </>
        )}

        {/* Shipments List */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>All Shipments</CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  {totalCount} total shipments | Showing {sortedShipments.length} on this page
                  {totalPages > 1 && ` (Page ${page} of ${totalPages})`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                        <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={() => setVisibleColumnIds(new Set(compactColumns.map(c => c.id)))}>Select All</Button>
                        <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={() => setVisibleColumnIds(new Set(['late_indicator', 'operation_id', 'shipment_id', 'status']))}>Unselect All</Button>
                        <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={() => resetCompactColumnView()}>Reset</Button>
                      </div>
                      <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
                        {(() => {
                          const pinned = new Set(['late_indicator', 'operation_id', 'shipment_id', 'status'])
                          const visibleInMenu = visibleColumns.filter(c => !pinned.has(c.id))
                          const visibleIds = new Set(visibleInMenu.map(c => c.id))
                          const byId = new Map(compactColumns.map(c => [c.id, c] as const))
                          const orderedIds = (columnOrderIds.length > 0 ? columnOrderIds : compactColumns.map(c => c.id))
                          const hiddenCols = orderedIds
                            .map(id => byId.get(id))
                            .filter((c): c is CompactColumn => !!c && !pinned.has(c.id) && !visibleIds.has(c.id))
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
                              <Checkbox checked={visibleColumnIds.has(col.id)} onCheckedChange={() => toggleColumn(col.id)} />
                              <span className="truncate">{col.label}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="hidden">
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
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-2 ml-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page <= 1 || loading}
                    >
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (page <= 3) {
                          pageNum = i + 1
                        } else if (page >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = page - 2 + i
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={page === pageNum ? 'default' : 'outline'}
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
                      onClick={() => handlePageChange(page + 1)}
                      disabled={page >= totalPages || loading}
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
              <div className="text-center py-8">Loading shipments...</div>
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
                      <table className="w-full min-w-[1100px] table-fixed border-collapse">
                        <colgroup>
                          <col style={{ width: '40px' }} />
                          {visibleColumns.map((c) => (
                            <col key={c.id} style={{ width: compactGridTrackMinPx(getColumnWidth(c.id)) }} />
                          ))}
                          <col style={{ width: '160px' }} />
                        </colgroup>
                        <thead>
                        <tr className="text-xs font-semibold text-gray-600 bg-gray-50 border-b sticky top-0 z-10">
                          <th scope="col" className="w-10 px-2 py-2 align-bottom" />
                        {visibleColumns.map(col => {
                          const active = sortKey === col.id
                          const filterActive = isColumnFilterActive(col.id)
                          const filterType = getFilterTypeForColumn(col.id)
                          const current = columnFilters[col.id]

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
                                    className={`shrink-0 p-0.5 rounded hover:bg-gray-200 ${active ? 'text-blue-600' : 'text-gray-400'}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      e.preventDefault()
                                      onSortHeaderClick(col)
                                    }}
                                    title="Sort"
                                  >
                                    {active
                                      ? sortDir === 'asc'
                                        ? <ArrowUp className="h-3.5 w-3.5" />
                                        : <ArrowDown className="h-3.5 w-3.5" />
                                      : <ArrowUpDown className="h-3.5 w-3.5" />
                                    }
                                  </button>
                                )}

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
                                        value={(current?.type === 'text' && current.value) ? current.value : ''}
                                        onChange={(e) => {
                                          const value = e.target.value
                                          setOrClearFilter(col.id, {
                                            type: 'text',
                                            value,
                                            exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                            emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
                                            notBlankOnly: current?.type === 'text' ? Boolean((current as any).notBlankOnly) : false,
                                          })
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault()
                                            setPage(1)
                                            fetchShipments(1)
                                          }
                                        }}
                                        placeholder="Type to filter (contains)"
                                        className="h-8 text-sm"
                                      />
                                      <div className="flex flex-col gap-2">
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
                                                notBlankOnly: current?.type === 'text' ? Boolean((current as any).notBlankOnly) : false,
                                              })
                                            }}
                                          />
                                          Only blanks
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-gray-700">
                                          <Checkbox
                                            checked={Boolean((current as any)?.notBlankOnly)}
                                            onCheckedChange={(checked) => {
                                              const value = current?.type === 'text' ? current.value : ''
                                              setOrClearFilter(col.id, {
                                                type: 'text',
                                                value,
                                                exact: current?.type === 'text' ? Boolean(current.exact) : false,
                                                emptyOnly: current?.type === 'text' ? Boolean(current.emptyOnly) : false,
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
                                          value={(current?.type === 'number' && current.min) ? current.min : ''}
                                          onChange={(e) => {
                                            const min = e.target.value
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchShipments(1)
                                            }
                                          }}
                                          placeholder="Min"
                                          className="h-8 text-sm"
                                        />
                                        <Input
                                          value={(current?.type === 'number' && current.max) ? current.max : ''}
                                          onChange={(e) => {
                                            const max = e.target.value
                                            const min = current?.type === 'number' ? current.min : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchShipments(1)
                                            }
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
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(checked), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean((current as any)?.notBlankOnly)}
                                          onCheckedChange={(checked) => {
                                            const min = current?.type === 'number' ? current.min : ''
                                            const max = current?.type === 'number' ? current.max : ''
                                            setOrClearFilter(col.id, { type: 'number', min, max, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean(checked) })
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
                                          value={(current?.type === 'date' && current.from) ? current.from : ''}
                                          onChange={(e) => {
                                            const from = e.target.value
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchShipments(1)
                                            }
                                          }}
                                          className="h-8 text-sm"
                                        />
                                        <Input
                                          type="date"
                                          value={(current?.type === 'date' && current.to) ? current.to : ''}
                                          onChange={(e) => {
                                            const to = e.target.value
                                            const from = current?.type === 'date' ? current.from : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault()
                                              setPage(1)
                                              fetchShipments(1)
                                            }
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
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(checked), notBlankOnly: Boolean((current as any)?.notBlankOnly) })
                                          }}
                                        />
                                        Only blanks
                                      </label>
                                      <label className="flex items-center gap-2 text-xs text-gray-700">
                                        <Checkbox
                                          checked={Boolean((current as any)?.notBlankOnly)}
                                          onCheckedChange={(checked) => {
                                            const from = current?.type === 'date' ? current.from : ''
                                            const to = current?.type === 'date' ? current.to : ''
                                            setOrClearFilter(col.id, { type: 'date', from, to, emptyOnly: Boolean(current?.emptyOnly), notBlankOnly: Boolean(checked) })
                                          }}
                                        />
                                        Only not blanks
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
                            </th>
                          )
                        })}
                        <th scope="col" className="sticky right-0 z-20 bg-gray-50 border-l px-3 py-2 text-center align-bottom font-semibold whitespace-nowrap shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]">
                          Actions
                        </th>
                        </tr>
                        </thead>
                        <tbody>

                      {/* Rows */}
                        {sortedShipments.length === 0 ? (
                          <tr>
                            <td colSpan={visibleColumns.length + 2} className="px-4 py-10 text-center text-gray-500 bg-white">
                              <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                              <p>No shipments found</p>
                              {searchTerm && <p className="text-sm mt-2">Try adjusting your search filters</p>}
                            </td>
                          </tr>
                        ) : sortedShipments.map((shipment, idx) => {
                          const isEditing = editingId === shipment.id
                          const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                          return (
                            <>
                              <tr key={shipment.id} className={rowBg}>
                                <td className="px-2 py-2 align-middle w-10">
                                  <div className="hidden">
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
                                  </div>
                                </td>

                                  {visibleColumns.map(col => (
                                    <td key={col.id} className="px-3 py-2 align-middle min-w-0">
                                      <div className="min-h-[40px] flex items-center">
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
                                        (() => {
                                          const currentStatus = String(shipment.status || '').toUpperCase()
                                          if (currentStatus === 'CANCELLED') {
                                            return (
                                              <Badge className={getStatusColor('CANCELLED')}>CANCELLED</Badge>
                                            )
                                          }
                                          const selected =
                                            String(editedData.status || '').toUpperCase() === 'CANCELLED'
                                              ? 'CANCELLED'
                                              : currentStatus
                                          return (
                                            <select
                                              value={selected}
                                              onChange={(e) => {
                                                if (e.target.value === 'CANCELLED') {
                                                  handleFieldChange('status', 'CANCELLED')
                                                } else {
                                                  const next = { ...editedData }
                                                  delete next.status
                                                  setEditedData(next)
                                                }
                                              }}
                                              className="h-8 text-sm px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-full bg-white"
                                              title="Status diturunkan otomatis. Hanya dapat dibatalkan secara manual."
                                            >
                                              <option value={currentStatus}>{shipment.status}</option>
                                              <option value="CANCELLED">CANCELLED</option>
                                            </select>
                                          )
                                        })()
                                      ) : (
                                        col.render(shipment)
                                      )}
                                      </div>
                                    </td>
                                  ))}

                                  <td className={`sticky right-0 z-10 border-l px-3 py-2 align-middle shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] ${rowBg}`}>
                                  <div className="flex items-center justify-end gap-2 min-h-[40px]">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={handleCancelEdit}
                                          disabled={saving}
                                          title="Cancel"
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          onClick={() => handleSave(shipment.id)}
                                          disabled={saving}
                                          title="Save"
                                          className="bg-green-600 hover:bg-green-700 text-white"
                                        >
                                          {saving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Save className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                      {canShowEditShipmentButton &&
                                        shipment.vessel_name?.trim() && (
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => {
                                              if (perms.loaded && !canEditShipment) {
                                                alert('You need Edit permission on Shipments (data.shipments) to edit a shipment. Ask an admin to update your role.')
                                                return
                                              }
                                              handleEdit(shipment)
                                            }}
                                            title="Edit"
                                          >
                                            <Pencil className="h-4 w-4" />
                                          </Button>
                                        )}
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={() => handleViewLoadingPorts(shipment)}
                                          title="Ports"
                                          className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                        >
                                          <Ship className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          onClick={() => handleViewDocuments(shipment)}
                                          title="Docs"
                                          className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                                        >
                                          <FileText className="h-4 w-4" />
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
                                          size="icon"
                                          onClick={() => document.getElementById(`shipment-file-${shipment.id}`)?.click()}
                                          disabled={uploadingId === shipment.id}
                                          title="Upload"
                                          className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                        >
                                          {uploadingId === shipment.id ? (
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
                              {false && expandedShipmentIds.has(shipment.id) && (
                                <tr key={`${shipment.id}-expanded`} className={rowBg}>
                                  <td colSpan={visibleColumns.length + 2} className="px-3 py-3">
                                  <div className="p-3 border rounded bg-white">
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
                                                <div className="text-gray-500">PO No</div>
                                                <div className="font-medium">{detail.po_number || '-'}</div>
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
                                                <div className="text-gray-500">Quantity Received</div>
                                                <div className="font-medium">{formatNumber(detail.quantity_receive ?? 0)} Kg</div>
                                              </div>
                                              <div>
                                                <div className="text-gray-500">Quantity Delivered</div>
                                                <div className="font-medium">{formatNumber(detail.quantity_delivered ?? 0)} Kg</div>
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
                                  </td>
                                </tr>
                              )}
                            </>
                          )
                        })}
                        </tbody>
                      </table>
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
                              <div className="hidden">
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
                              </div>
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
                                  <Button variant="outline" size="icon" onClick={handleCancelEdit} disabled={saving} title="Cancel">
                                    <X className="h-4 w-4" />
                                  </Button>
                                  <Button size="icon" onClick={() => handleSave(shipment.id)} disabled={saving} title="Save" className="bg-green-600 hover:bg-green-700 text-white">
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                  </Button>
                                </>
                              ) : (
                                <>
                                  {canShowEditShipmentButton &&
                                    shipment.vessel_name?.trim() && (
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => {
                                          if (perms.loaded && !canEditShipment) {
                                            alert('You need Edit permission on Shipments (data.shipments) to edit a shipment. Ask an admin to update your role.')
                                            return
                                          }
                                          handleEdit(shipment)
                                        }}
                                        title="Edit"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    )}
                                  <Button variant="outline" size="icon" onClick={() => handleViewLoadingPorts(shipment)} title="Ports" className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100">
                                    <Ship className="h-4 w-4" />
                                  </Button>
                                  <Button variant="outline" size="icon" onClick={() => handleViewDocuments(shipment)} title="Docs" className="bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100">
                                    <FileText className="h-4 w-4" />
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
                                    size="icon"
                                    onClick={() => document.getElementById(`shipment-file-${shipment.id}`)?.click()}
                                    disabled={uploadingId === shipment.id}
                                    title="Upload"
                                    className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                                  >
                                    {uploadingId === shipment.id ? (
                                      <span className="h-4 w-4 inline-block border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <Upload className="h-4 w-4" />
                                    )}
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {false && expandedShipmentIds.has(shipment.id) && (
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
                                            <div className="text-gray-500">PO No</div>
                                            <div className="font-medium">{detail.po_number || '-'}</div>
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

                {totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-between border-t pt-4">
                    <div className="text-sm text-gray-700">
                      Showing page {page} of {totalPages} ({totalCount} total shipments)
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1 || loading}
                      >
                        Previous
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number
                          if (totalPages <= 5) {
                            pageNum = i + 1
                          } else if (page <= 3) {
                            pageNum = i + 1
                          } else if (page >= totalPages - 2) {
                            pageNum = totalPages - 4 + i
                          } else {
                            pageNum = page - 2 + i
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={page === pageNum ? 'default' : 'outline'}
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
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page >= totalPages || loading}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Loading Ports Modal */}
      {showLoadingPorts && selectedShipment && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-6xl rounded-xl shadow-xl my-4 max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="shrink-0 border-b border-gray-200">
              <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-white shrink-0">
                    <Anchor className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {selectedShipment.vessel_name || selectedShipment.shipment_id}
                    </h3>
                    <p className="text-xs text-gray-500">Vessel Loading Ports &amp; Shipment Information</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Close" onClick={() => setShowLoadingPorts(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto px-6 py-4">
              {/* Combined Shipment Information and Loading Ports */}
              <div
                className={[
                  'rounded-xl border border-gray-200 shadow-sm flex flex-col min-h-0',
                  portsListExpanded ? 'flex-1' : 'flex-none'
                ].join(' ')}
              >
                <div
                  className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-blue-50 to-white cursor-pointer hover:from-blue-100 rounded-t-xl border-b border-gray-200 transition-colors"
                  onClick={() => setPortsListExpanded(!portsListExpanded)}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 shrink-0">
                      <FileText className="h-3.5 w-3.5 text-blue-600" />
                    </div>
                    <h4 className="font-semibold text-sm text-gray-800">Shipment Information</h4>
                  </div>
                  {portsListExpanded ? (
                    <ChevronUp className="h-4.5 w-4.5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4.5 w-4.5 text-gray-400" />
                  )}
                </div>
                {portsListExpanded && (
                <div className="space-y-4 overflow-auto p-4 flex-1 min-h-0">
                  {/* Shipment-Level Information */}
                  {shipmentInfo ? (
                    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-2">
                      {/* Key Metrics Summary Bar */}
                      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100 bg-gray-50 border-b border-gray-200">
                        {[
                          { label: 'Qty Delivery', value: shipmentInfo.quantity_delivered ? `${formatNumber(shipmentInfo.quantity_delivered)} Kg` : '—', color: 'text-gray-800' },
                          { label: 'Qty Receive', value: shipmentInfo.actual_vessel_qty_receive ? `${formatNumber(shipmentInfo.actual_vessel_qty_receive)} Kg` : '—', color: 'text-gray-800' },
                          { label: 'Loading Port', value: shipmentInfo.vessel_loading_port_1 || '—', color: 'text-blue-700' },
                          { label: 'Discharge Port', value: shipmentInfo.vessel_discharge_port_1 || '—', color: 'text-cyan-700' },
                        ].map((m) => (
                          <div key={m.label} className="px-4 py-3">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{m.label}</div>
                            <div className={`text-sm font-semibold mt-0.5 truncate ${m.color}`}>{m.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Edit Action Bar */}
                      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white">
                        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Detail Fields</h5>
                        <div className="flex gap-2">
                          {editingShipmentInfo ? (
                            <>
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCancelEditAll}>
                                <X className="h-3.5 w-3.5 mr-1" /> Cancel
                              </Button>
                              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={handleSaveAll}>
                                <Save className="h-3.5 w-3.5 mr-1" /> Save Changes
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                handleEditShipmentInfo()
                                if (loadingPorts.length > 0) {
                                  handleEditPort(loadingPorts[0])
                                }
                              }}
                            >
                              <Edit2 className="h-3.5 w-3.5 mr-1" />
                              Edit
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="p-4 space-y-4">
                      {/* Quantities & Port Fields */}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Quantities &amp; Ports</p>
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
                          <div className="text-gray-500">Loading Rate (Kg/day)</div>
                          <div className="font-semibold text-blue-700">
                            {shipmentInfo.loading_rate_kg_per_day !== null && shipmentInfo.loading_rate_kg_per_day !== undefined
                              ? formatNumber(shipmentInfo.loading_rate_kg_per_day)
                              : shipmentInfo.loading_rate_mt_per_hour !== null && shipmentInfo.loading_rate_mt_per_hour !== undefined
                                ? formatNumber(shipmentInfo.loading_rate_mt_per_hour)
                                : '-'}
                      </div>
                          {(shipmentInfo.loading_rate_kg_per_day ?? shipmentInfo.loading_rate_mt_per_hour) && (
                            <div className="text-xs text-gray-500 mt-1">
                              Qty Receive &divide; (Completed &minus; Start Loading) days
                    </div>
                  )}
                        </div>
                      </div>
                      </div>
                      </div>

                      {/* ATA Fields Section */}
                      <div className="border-t pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">ATA &mdash; Actual Time of Arrival</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          {[
                            { label: 'Arrival at Loading Port', value: shipmentInfo.ata_vessel_arrival_at_loading_port },
                            { label: 'Berthed at Loading Port', value: shipmentInfo.ata_vessel_berthed_at_loading_port },
                            { label: 'Start Loading', value: shipmentInfo.ata_vessel_start_loading },
                            { label: 'Completed Loading', value: shipmentInfo.ata_vessel_completed_loading },
                            { label: 'Sailed from Loading Port', value: shipmentInfo.ata_vessel_sailed_from_loading_port },
                            { label: 'Arrive at Discharge Port', value: shipmentInfo.ata_vessel_arrive_at_discharge_port },
                            { label: 'Berthed at Discharge Port', value: shipmentInfo.ata_vessel_berthed_at_discharge_port },
                            { label: 'Start Discharging', value: shipmentInfo.ata_vessel_start_discharging },
                            { label: 'Complete Discharge', value: shipmentInfo.ata_vessel_complete_discharge },
                          ].map(({ label, value }) => (
                            <div key={label}>
                              <div className="text-xs text-gray-500">ATA Vessel {label}</div>
                              <div className="font-medium text-sm mt-0.5">{formatDate(value) || "—"}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ETA Fields Section */}
                      <div className="border-t pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">ETA — Estimated Time of Arrival</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrival at Loading Port</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_arrival_at_loading_port}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_arrival_at_loading_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_arrival_at_loading_port)}</div>
                            )}
                  </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Loading Port</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_berthed_at_loading_port}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_berthed_at_loading_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_berthed_at_loading_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Loading</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_start_loading}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_start_loading: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_start_loading)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Completed Loading</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_completed_loading}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_completed_loading: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_completed_loading)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Sailed from Loading Port</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_sailed_from_loading_port}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_sailed_from_loading_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_sailed_from_loading_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrive at Discharge Port</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_arrive_at_discharge_port}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_arrive_at_discharge_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_arrive_at_discharge_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Discharge Port</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_berthed_at_discharge_port}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_berthed_at_discharge_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_berthed_at_discharge_port)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Discharging</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_start_discharging}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_start_discharging: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_start_discharging)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Complete Discharge</div>
                            {editingShipmentInfo ? (
                              <DateInputDdMmYyyy
                                valueIso={editedShipmentInfo?.eta_vessel_complete_discharge}
                                onChangeIso={(iso) => setEditedShipmentInfo({ ...editedShipmentInfo!, eta_vessel_complete_discharge: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(shipmentInfo.eta_vessel_complete_discharge)}</div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Quality Fields Section */}
                      <div className="border-t pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Quality at Loading Loc 1</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 FFA</div>
                            <div className="font-medium">
                              {editingShipmentInfo ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editedShipmentInfo?.quality_at_loading_loc_1_ffa ?? ''}
                                  onChange={(e) =>
                                    setEditedShipmentInfo({
                                      ...editedShipmentInfo!,
                                      quality_at_loading_loc_1_ffa: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="h-8 text-sm mt-1"
                                />
                              ) : null}
                              {shipmentInfo.quality_at_loading_loc_1_ffa !== null && shipmentInfo.quality_at_loading_loc_1_ffa !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_ffa) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 M&I</div>
                            <div className="font-medium">
                              {editingShipmentInfo ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editedShipmentInfo?.quality_at_loading_loc_1_mi ?? ''}
                                  onChange={(e) =>
                                    setEditedShipmentInfo({
                                      ...editedShipmentInfo!,
                                      quality_at_loading_loc_1_mi: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="h-8 text-sm mt-1"
                                />
                              ) : null}
                              {shipmentInfo.quality_at_loading_loc_1_mi !== null && shipmentInfo.quality_at_loading_loc_1_mi !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_mi) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 DOBI</div>
                            <div className="font-medium">
                              {editingShipmentInfo ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editedShipmentInfo?.quality_at_loading_loc_1_dobi ?? ''}
                                  onChange={(e) =>
                                    setEditedShipmentInfo({
                                      ...editedShipmentInfo!,
                                      quality_at_loading_loc_1_dobi: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="h-8 text-sm mt-1"
                                />
                              ) : null}
                              {shipmentInfo.quality_at_loading_loc_1_dobi !== null && shipmentInfo.quality_at_loading_loc_1_dobi !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_dobi) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 Color</div>
                            <div className="font-medium">
                              {editingShipmentInfo ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editedShipmentInfo?.quality_at_loading_loc_1_red ?? ''}
                                  onChange={(e) =>
                                    setEditedShipmentInfo({
                                      ...editedShipmentInfo!,
                                      quality_at_loading_loc_1_red: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="h-8 text-sm mt-1"
                                />
                              ) : null}
                              {shipmentInfo.quality_at_loading_loc_1_red !== null && shipmentInfo.quality_at_loading_loc_1_red !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_red) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 D&S</div>
                            <div className="font-medium">
                              {editingShipmentInfo ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editedShipmentInfo?.quality_at_loading_loc_1_ds ?? ''}
                                  onChange={(e) =>
                                    setEditedShipmentInfo({
                                      ...editedShipmentInfo!,
                                      quality_at_loading_loc_1_ds: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="h-8 text-sm mt-1"
                                />
                              ) : null}
                              {shipmentInfo.quality_at_loading_loc_1_ds !== null && shipmentInfo.quality_at_loading_loc_1_ds !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_ds) 
                                : '-'}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500">Quality at Loading Loc 1 Stone</div>
                            <div className="font-medium">
                              {editingShipmentInfo ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editedShipmentInfo?.quality_at_loading_loc_1_stone ?? ''}
                                  onChange={(e) =>
                                    setEditedShipmentInfo({
                                      ...editedShipmentInfo!,
                                      quality_at_loading_loc_1_stone: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="h-8 text-sm mt-1"
                                />
                              ) : null}
                              {shipmentInfo.quality_at_loading_loc_1_stone !== null && shipmentInfo.quality_at_loading_loc_1_stone !== undefined 
                                ? formatNumber(shipmentInfo.quality_at_loading_loc_1_stone) 
                                : '-'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Quality at Discharge Loc 1</p>
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
                            <div className="text-gray-500">Quality at Discharge Port Color</div>
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
                    <div className="rounded-xl border border-gray-200 p-6 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Loading shipment information...</p>
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
                    const rateLabel = port.is_discharge_port ? 'Discharge Rate (Kg/day)' : 'Loading Rate (Kg/day)'

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
                      [`${qualityPrefix} Color`, port.quality_red],
                      [`${qualityPrefix} D&S`, port.quality_ds],
                      [`${qualityPrefix} Stone`, port.quality_stone]
                    ]
                    const hasQuality = qualityValues.some(([, value]) => value !== null && value !== undefined)

                    const isEditing = port.id && editingPortId === port.id
                    const displayData = isEditing && editedPortData ? editedPortData : port

                    // Loading ports: quantity at this port / (ATA completed loading âˆ’ ATA start loading) in days
                    let computedLoadingRate: number | null = null
                    if (!port.is_discharge_port) {
                      const ataStart = displayData.ata_loading_start
                      const ataCompleted = displayData.ata_loading_completed
                      const quantityReceive = displayData.quantity_at_loading_port

                      if (ataStart && ataCompleted && quantityReceive != null && quantityReceive > 0) {
                        const startDate = new Date(ataStart)
                        const endDate = new Date(ataCompleted)
                        const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
                        if (diffDays > 0) {
                          computedLoadingRate = quantityReceive / diffDays
                        }
                      }
                    }

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
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_arrival}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_arrival: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_arrival || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Loading Port</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_berthed_at_loading_port}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_berthed_at_loading_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_berthed_at_loading_port || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Loading</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_loading_start}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_loading_start: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_loading_start || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Completed Loading</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_loading_completed}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_loading_completed: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_loading_completed || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Sailed from Loading Port</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_sailed}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_sailed: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_sailed || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Arrive at Discharge Port</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_arrive_at_discharge_port}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_arrive_at_discharge_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_arrive_at_discharge_port || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Berthed at Discharge Port</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_berthed_at_discharge_port || displayData.eta_vessel_berthed}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_berthed_at_discharge_port: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_berthed_at_discharge_port || displayData.eta_vessel_berthed || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Start Discharging</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_start_discharging}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_start_discharging: iso })}
                                className="h-8 text-sm mt-1"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(displayData.eta_vessel_start_discharging || '')}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500">ETA Vessel Complete Discharge</div>
                            {isEditing ? (
                              <DateInputDdMmYyyy
                                valueIso={displayData.eta_vessel_complete_discharge}
                                onChangeIso={(iso) => setEditedPortData({ ...editedPortData!, eta_vessel_complete_discharge: iso })}
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
                                Formula: Quantity Receive / (ATA Completed Loading âˆ’ ATA Start Loading) days
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
                  'rounded-xl border border-gray-200 shadow-sm flex flex-col min-h-0',
                  addPortExpanded ? 'flex-1' : 'flex-none'
                ].join(' ')}
              >
                <div
                  className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-green-50 to-white cursor-pointer hover:from-green-100 rounded-t-xl border-b border-gray-200 transition-colors"
                  onClick={() => setAddPortExpanded(!addPortExpanded)}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 shrink-0">
                      <Plus className="h-3.5 w-3.5 text-green-600" />
                    </div>
                    <h4 className="font-semibold text-sm text-gray-800">Add Loading Port</h4>
                  </div>
                  {addPortExpanded ? (
                    <ChevronUp className="h-4.5 w-4.5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4.5 w-4.5 text-gray-400" />
                  )}
                </div>
                {addPortExpanded && (
                <div className="p-4 overflow-auto flex-1 min-h-0 space-y-4">

                  {/* Basic Info */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Port Info</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Port Name</label>
                        <Input
                          value={newPort.port_name as string}
                          onChange={(e) => setNewPort({ ...newPort, port_name: e.target.value })}
                          className="h-9 text-sm"
                          placeholder="e.g., Loading Port 1"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Sequence</label>
                        <Input
                          type="number"
                          value={newPort.port_sequence as number}
                          onChange={(e) => {
                            const v = parseInt(e.target.value || '1')
                            setNewPort({ ...newPort, port_sequence: v })
                          }}
                          className="h-9 text-sm"
                          min={1}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Quantity (Kg)</label>
                        <Input
                          type="number"
                          value={newPort.quantity_at_loading_port as number}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value || '0')
                            setNewPort({ ...newPort, quantity_at_loading_port: v })
                          }}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Loading Rate (Kg/day)</label>
                        <Input
                          type="number"
                          step="0.01"
                          value={newPort.loading_rate as number}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value || '0')
                            setNewPort({ ...newPort, loading_rate: v })
                          }}
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ETA Date Fields */}
                  <div className="border-t pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">ETA Date Fields</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
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
                          <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                          <DateInputDdMmYyyy
                            valueIso={(newPort as any)[key]}
                            onChangeIso={(iso) => setNewPort({ ...(newPort as any), [key]: iso } as any)}
                            className="h-9 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="border-t pt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-400 italic">ETA fields are optional</p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
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
                        <X className="h-3.5 w-3.5 mr-1" /> Reset
                      </Button>
                      <Button size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700" onClick={handleSaveLoadingPort}>
                        <Save className="h-3.5 w-3.5 mr-1" />
                        Save Loading Port
                      </Button>
                    </div>
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
          <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h3 className="text-xl font-semibold">Documents — {selectedShipment.vessel_name || selectedShipment.shipment_id}</h3>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={() => setShowDocs(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
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
                        {(doc.document_type || 'FILE')} • {doc.created_at ? formatDateTimeDMY(doc.created_at) : ''}
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

      <AddShipmentModal
        open={showAddShipment}
        onClose={() => setShowAddShipment(false)}
        onCreated={() => {
          void fetchShipments(1)
        }}
      />
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


