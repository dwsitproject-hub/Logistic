'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  AlertCircle,
  Anchor,
  Check,
  CheckCircle2,
  Clock,
  Edit2,
  FileText,
  FlaskConical,
  History,
  Loader2,
  MapPin,
  Plus,
  Ship,
  Upload,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import {
  resolveShipmentApiLookupKey,
  resolveShipmentDisplayStoNumber,
} from '@/lib/shipmentStoDisplay'
import { formatDateDMY, formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import { formatQtyMtFromKg } from '@/lib/utils'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { hasVesselPortsQuantityUserEdits } from '@/lib/vesselPortsQuantityEdits'
import {
  mergeShipmentQtyOverridesOnContractRows,
  sapDeliveredOrReceiveMtToKg,
  shipmentStoredQtyKg,
} from '@/lib/shipmentQuantityUnits'
import {
  sumVesselPortsQuantityEdits,
  type VesselPortsQuantityEdits,
  type VesselPortsQuantityRow,
} from '@/components/shipments/VesselPortsQuantitiesTable'
import type { AddNewShipmentSubmitPayload } from '@/components/shared/addNewShipmentTypes'
import {
  VESSEL_MODAL_BODY_CLASS,
  VESSEL_MODAL_COMPACT_TD,
  VESSEL_MODAL_COMPACT_TH,
  VESSEL_MODAL_HEADER_CLASS,
  VESSEL_MODAL_OVERLAY_CLASS,
  VESSEL_MODAL_PANEL_CLASS,
  VESSEL_MODAL_SECTION_CLASS,
  VESSEL_MODAL_SECTION_HEADER_CLASS,
  VESSEL_MODAL_TABLE_FOOTER_CLASS,
} from '@/lib/vesselModalUi'
import {
  saveEditShipmentChanges,
  type EditEtaFields,
  type LoadingPortRef,
} from '@/lib/editShipmentModalSave'
import {
  ataFieldsFromShipmentInfo,
  ataSapReferenceFromShipmentInfo,
  emptyAtaFields,
  type ShipmentAtaApiField,
  type ShipmentAtaFields,
} from '@/lib/shipmentAtaFields'
import {
  usePermissions,
  canEditPermission,
} from '@/components/PermissionsContext'
const SHIPMENT_SLD_DOC_TYPE = 'SLD'
const SHIPMENT_SDD_DOC_TYPE = 'SDD'
const READONLY_FIELD_CLASS = 'bg-gray-50 cursor-not-allowed text-gray-600'
const ETA_INFO_VALUE_CLASS = 'text-sm font-medium text-gray-900 tabular-nums'

const ETA_FIELD_ROWS: { key: keyof EditEtaFields; label: string }[] = [
  { key: 'etaVesselArrivalAtLoadingPort', label: 'ETA Vessel Arrival at Loading Port' },
  { key: 'etaVesselBerthedAtLoadingPort', label: 'ETA Vessel Berthed at Loading Port' },
  { key: 'etaVesselStartLoading', label: 'ETA Vessel Start Loading' },
  { key: 'etaVesselCompletedLoading', label: 'ETA Vessel Completed Loading' },
  { key: 'etaVesselSailedFromLoadingPort', label: 'ETA Vessel Sailed from Loading Port' },
  { key: 'etaVesselArriveAtDischargePort', label: 'ETA Vessel Arrive at Discharge Port' },
  { key: 'etaVesselBerthedAtDischargePort', label: 'ETA Vessel Berthed at Discharge Port' },
  { key: 'etaVesselStartDischarging', label: 'ETA Vessel Start Discharging' },
  { key: 'etaVesselCompleteDischarge', label: 'ETA Vessel Complete Discharge' },
]

const ATA_FIELD_ROWS: { key: ShipmentAtaApiField; label: string }[] = [
  { key: 'ata_vessel_arrival_at_loading_port', label: 'Arrival at Loading Port' },
  { key: 'ata_vessel_berthed_at_loading_port', label: 'Berthed at Loading Port' },
  { key: 'ata_vessel_start_loading', label: 'Start Loading' },
  { key: 'ata_vessel_completed_loading', label: 'Completed Loading' },
  { key: 'ata_vessel_sailed_from_loading_port', label: 'Sailed from Loading Port' },
  { key: 'ata_vessel_arrive_at_discharge_port', label: 'Arrive at Discharge Port' },
  { key: 'ata_vessel_berthed_at_discharge_port', label: 'Berthed at Discharge Port' },
  { key: 'ata_vessel_start_discharging', label: 'Start Discharging' },
  { key: 'ata_vessel_complete_discharge', label: 'Complete Discharge' },
]

const QUALITY_LOADING_FIELDS: { key: string; label: string }[] = [
  { key: 'quality_at_loading_loc_1_ffa', label: 'FFA' },
  { key: 'quality_at_loading_loc_1_mi', label: 'M&I' },
  { key: 'quality_at_loading_loc_1_dobi', label: 'DOBI' },
  { key: 'quality_at_loading_loc_1_red', label: 'Color' },
  { key: 'quality_at_loading_loc_1_ds', label: 'D&S' },
  { key: 'quality_at_loading_loc_1_stone', label: 'Stone' },
]

const QUALITY_DISCHARGE_FIELDS: { key: string; label: string }[] = [
  { key: 'quality_at_discharge_loc_1_ffa', label: 'FFA' },
  { key: 'quality_at_discharge_loc_1_mi', label: 'M&I' },
  { key: 'quality_at_discharge_loc_1_dobi', label: 'DOBI' },
  { key: 'quality_at_discharge_loc_1_red', label: 'Color' },
  { key: 'quality_at_discharge_loc_1_ds', label: 'D&S' },
  { key: 'quality_at_discharge_loc_1_stone', label: 'Stone' },
]

function emptyEtaFields(): EditEtaFields {
  return {
    etaVesselArrivalAtLoadingPort: '',
    etaVesselBerthedAtLoadingPort: '',
    etaVesselStartLoading: '',
    etaVesselCompletedLoading: '',
    etaVesselSailedFromLoadingPort: '',
    etaVesselArriveAtDischargePort: '',
    etaVesselBerthedAtDischargePort: '',
    etaVesselStartDischarging: '',
    etaVesselCompleteDischarge: '',
  }
}

function sliceIsoDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function parseApiNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function mergeContractNumberLists(...sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const src of sources) {
    for (const part of String(src ?? '').split(',')) {
      const trimmed = part.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

function MtQtyInput({
  valueKg,
  disabled,
  onChange,
}: {
  valueKg: number | null
  disabled?: boolean
  onChange: (kg: number | null) => void
}) {
  const mtDisplay = valueKg === null ? '' : String(valueKg / 1000)
  return (
    <div className="relative w-full min-w-[6.5rem]">
      <Input
        type="number"
        step="0.01"
        disabled={disabled}
        value={mtDisplay}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange(null)
            return
          }
          const mt = parseFloat(raw)
          onChange(Number.isNaN(mt) ? null : mt * 1000)
        }}
        className={`h-8 text-xs pr-10 text-right tabular-nums ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">
        MT
      </span>
    </div>
  )
}

type ShipmentDetailRow = {
  rowKey: string
  contract_number: string
  po_number: string
  supplier: string
  product: string
  contract_qty: number
  outstanding_qty: number
  sto_qty_assigned: number
  quantity_delivered: number | null
  quantity_receive: number | null
}

type EtaBlock = {
  id: string
  status: 'active' | 'historical'
  loadingPort: string
  contractLabels: string[]
  fields: EditEtaFields
  isEditing: boolean
  /** Unsaved block created via Add — Cancel restores the previous active ETA. */
  isDraft?: boolean
}

type ActivityLogRow = {
  id: string
  action: string
  entity_type: string
  timestamp: string
  username?: string
  full_name?: string
  before_data?: Record<string, unknown> | null
  after_data?: Record<string, unknown> | null
}

function formatActivityLabel(log: ActivityLogRow): string {
  const user = log.full_name?.trim() || log.username?.trim() || 'Unknown User'
  const entity = log.entity_type?.replace(/_/g, ' ') ?? 'Record'
  const action = log.action?.toUpperCase() ?? 'UPDATE'
  if (action === 'UPDATE' && log.entity_type === 'SHIPMENT') return `Updated Shipment — ${user}`
  if (action === 'CREATE' && log.entity_type === 'LOADING_PORT') return `Added Loading Port — ${user}`
  if (action === 'UPDATE' && log.entity_type === 'LOADING_PORT') return `Updated ETA / Port — ${user}`
  if (action === 'CANCEL' && log.entity_type === 'LOADING_PORT') return `Cancelled Port Activity — ${user}`
  return `${action} ${entity} — ${user}`
}

export type EditShipmentModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (payload: AddNewShipmentSubmitPayload) => Promise<void>
  editContractId?: string | null
  editShipmentId?: string | null
  /** STO from Shipments list row (sto_key / displayed sto_number). */
  editStoNumber?: string | null
  /** All contract numbers on the grouped list row (comma-separated). */
  editContractNumbers?: string | null
}

export function EditShipmentModal({
  open,
  onClose,
  onSubmit,
  editContractId = null,
  editShipmentId: editShipmentIdProp = null,
  editStoNumber = null,
  editContractNumbers = null,
}: EditShipmentModalProps) {
  const perms = usePermissions()
  const canEditShipment = canEditPermission(perms, 'data.shipments')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shipmentId, setShipmentId] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [vesselName, setVesselName] = useState('')
  const [originalVesselName, setOriginalVesselName] = useState('')
  const [vesselMeta, setVesselMeta] = useState<Record<string, string>>({})
  const [operationId, setOperationId] = useState('')
  const [stoNumber, setStoNumber] = useState('')
  const [plantSiteName, setPlantSiteName] = useState('')

  const [detailRows, setDetailRows] = useState<ShipmentDetailRow[]>([])
  const [qtyEdits, setQtyEdits] = useState<VesselPortsQuantityEdits>({})
  const [editingQtyRowKey, setEditingQtyRowKey] = useState<string | null>(null)
  const [sfalQty, setSfalQty] = useState<number | null>(null)
  const [sfbdQty, setSfbdQty] = useState<number | null>(null)
  const [originalSfalQty, setOriginalSfalQty] = useState<number | null>(null)
  const [originalSfbdQty, setOriginalSfbdQty] = useState<number | null>(null)
  const [originalDeliveredKg, setOriginalDeliveredKg] = useState<number | null>(null)
  const [originalReceiveKg, setOriginalReceiveKg] = useState<number | null>(null)

  const [hasUploadedSld, setHasUploadedSld] = useState(false)
  const [hasUploadedSdd, setHasUploadedSdd] = useState(false)
  const [sldDocUploading, setSldDocUploading] = useState(false)
  const [sddDocUploading, setSddDocUploading] = useState(false)

  const [loadingPort, setLoadingPort] = useState('')
  const [dischargePort, setDischargePort] = useState('')
  const [loadingPorts, setLoadingPorts] = useState<LoadingPortRef[]>([])
  const [etaBlocks, setEtaBlocks] = useState<EtaBlock[]>([])
  const [shipmentInfo, setShipmentInfo] = useState<Record<string, unknown>>({})
  const [ataFields, setAtaFields] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [originalAtaFields, setOriginalAtaFields] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [ataSapReference, setAtaSapReference] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [ataIsEditing, setAtaIsEditing] = useState(false)
  const [activityLog, setActivityLog] = useState<ActivityLogRow[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  const [vesselSuggestions, setVesselSuggestions] = useState<
    Array<{ vessel_code: string; vessel_name: string; vessel_owner: string | null }>
  >([])
  const [showVesselSuggestions, setShowVesselSuggestions] = useState(false)
  const vesselSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initSessionRef = useRef<string | null>(null)

  const isQuantityUnlocked = hasUploadedSld || hasUploadedSdd
  const canModifyShipment = canEditShipment

  const qtyTableRows: VesselPortsQuantityRow[] = useMemo(
    () =>
      detailRows.map((d) => ({
        rowKey: d.rowKey,
        contract_ext_no: d.contract_number,
        po_number: d.po_number,
        contract_qty: d.contract_qty,
        sto_qty: d.sto_qty_assigned,
        quantity_delivered: d.quantity_delivered,
        quantity_receive: d.quantity_receive,
      })),
    [detailRows],
  )

  const vesselCapacityMt = parseApiNumber(vesselMeta.vessel_capacity)
  // sto_qty_assigned from contract details API is kg (same as contract_qty / list sto_quantity).
  const totalAssignedMt = useMemo(() => {
    let sumKg = 0
    for (const row of detailRows) {
      sumKg += row.sto_qty_assigned ?? 0
    }
    return sumKg / 1000
  }, [detailRows])

  const qtyTotals = useMemo(
    () => sumVesselPortsQuantityEdits(qtyTableRows, qtyEdits),
    [qtyTableRows, qtyEdits],
  )

  const resetState = useCallback(() => {
    setShipmentId(null)
    setVesselName('')
    setOriginalVesselName('')
    setVesselMeta({})
    setDetailRows([])
    setQtyEdits({})
    setEditingQtyRowKey(null)
    setSfalQty(null)
    setSfbdQty(null)
    setEtaBlocks([])
    setActivityLog([])
    setShipmentInfo({})
    setAtaFields(emptyAtaFields())
    setOriginalAtaFields(emptyAtaFields())
    setAtaSapReference(emptyAtaFields())
    setAtaIsEditing(false)
    setHasUploadedSld(false)
    setHasUploadedSdd(false)
    initSessionRef.current = null
  }, [])

  const hydrateQuantityDocs = useCallback(async (sid: string) => {
    try {
      const params = new URLSearchParams()
      params.append('shipmentId', sid)
      const res = await api.get(`/documents?${params.toString()}`)
      const docs: Array<{ document_type?: string }> = res.data?.data ?? []
      setHasUploadedSld(docs.some((d) => d.document_type === SHIPMENT_SLD_DOC_TYPE))
      setHasUploadedSdd(docs.some((d) => d.document_type === SHIPMENT_SDD_DOC_TYPE))
    } catch {
      // non-blocking
    }
  }, [])

  const loadActivityLog = useCallback(async (sid: string) => {
    setActivityLoading(true)
    try {
      const res = await api.get(`/shipments/${sid}/activity-log`)
      setActivityLog(res.data?.data ?? [])
    } catch {
      setActivityLog([])
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const loadShipment = useCallback(
    async (
      contractId: string,
      directShipmentId?: string | null,
      preferredStoNumber?: string | null,
    ) => {
      setLoading(true)
      setShipmentId(null)
      try {
        let row: Record<string, unknown>
        let sid: string
        let editContext: { lookup_key?: string; contract_numbers?: string; po_numbers?: string } | null =
          null

        if (directShipmentId?.trim()) {
          sid = directShipmentId.trim()
          const [detailRes, contextRes] = await Promise.all([
            api.get(`/shipments/${sid}`),
            api.get(`/shipments/${sid}/edit-context`).catch(() => null),
          ])
          row = (detailRes.data?.data ?? {}) as Record<string, unknown>
          row.id = sid
          editContext = contextRes?.data?.data ?? null
        } else {
          const listRes = await api.get('/shipments', {
            params: { contract: contractId, limit: 100, page: 1, compact: 'true' },
          })
          const shipments: Array<Record<string, unknown>> = listRes.data?.data?.shipments ?? []
          row = shipments[0] ?? {}
          if (!row?.id) throw new Error('No shipment found for this contract')
          sid = String(row.id)
          const [detailRes, contextRes] = await Promise.all([
            api.get(`/shipments/${sid}`),
            api.get(`/shipments/${sid}/edit-context`).catch(() => null),
          ])
          row = { ...row, ...(detailRes.data?.data ?? {}) }
          editContext = contextRes?.data?.data ?? null
        }

        setShipmentId(sid)

        const portsRes = await api.get(`/shipments/${sid}/loading-ports`)
        const ports: LoadingPortRef[] = portsRes.data?.data?.ports ?? []
        const info: Record<string, unknown> =
          portsRes.data?.data?.shipmentInfo ?? portsRes.data?.data?.shipment_info ?? {}
        setLoadingPorts(ports)
        setShipmentInfo(info)
        const loadedAta = ataFieldsFromShipmentInfo(info)
        setAtaFields(loadedAta)
        setOriginalAtaFields(loadedAta)
        setAtaSapReference(ataSapReferenceFromShipmentInfo(info))
        setAtaIsEditing(false)

        const contractNumbers = mergeContractNumberLists(
          editContractNumbers,
          editContext?.contract_numbers,
          row.contract_numbers as string | undefined,
          row.contract_number as string | undefined,
          contractId,
        )
        const apiLookupKey =
          String(preferredStoNumber ?? '').trim() ||
          String(editContext?.lookup_key ?? '').trim() ||
          resolveShipmentApiLookupKey({
            sto_key: row.sto_key as string | undefined,
            sto_number: row.sto_number as string | undefined,
            operation_id: row.operation_id as string | undefined,
            shipment_id: row.shipment_id as string | undefined,
            id: sid,
          })
        const displaySto = resolveShipmentDisplayStoNumber(
          row.contract_sto_number ?? row.sto_number,
        )

        let contractDetails: ShipmentDetailRow[] = []
        if (apiLookupKey) {
          const detailsRes = await api.get('/shipments/contracts/details', {
            params: {
              sto: apiLookupKey,
              ...(contractNumbers.length > 0 ? { contractNumbers: contractNumbers.join(',') } : {}),
            },
          })
          if (detailsRes.data?.success && Array.isArray(detailsRes.data.data)) {
            for (const d of detailsRes.data.data as Array<Record<string, unknown>>) {
              const cn = String(d.contract_number ?? '').trim()
              const po = String(d.po_number ?? '').trim()
              let supplier = ''
              let product = ''
              try {
                const valRes = await api.get(
                  `/shipments/contracts/validate?contract_number=${encodeURIComponent(cn)}`,
                )
                const cd = valRes.data?.data as Record<string, unknown> | undefined
                supplier = String(cd?.supplier ?? '')
                product = String(cd?.product ?? '')
              } catch {
                // optional enrichment
              }
              contractDetails.push({
                rowKey: `${sid}-${cn}-${po || 'po'}`,
                contract_number: cn,
                po_number: po,
                supplier,
                product,
                contract_qty: parseApiNumber(d.contract_qty) ?? 0,
                outstanding_qty: parseApiNumber(d.outstanding_qty) ?? 0,
                sto_qty_assigned: parseApiNumber(d.sto_qty_assigned) ?? 0,
                quantity_delivered: sapDeliveredOrReceiveMtToKg(parseApiNumber(d.quantity_delivered)),
                quantity_receive: sapDeliveredOrReceiveMtToKg(parseApiNumber(d.quantity_receive)),
              })
            }
          }
        }

        if (contractDetails.length === 0 && contractNumbers.length > 0) {
          for (const cn of contractNumbers) {
            let supplier = ''
            let product = ''
            let po = ''
            let contractQty = 0
            let outstanding = 0
            try {
              const valRes = await api.get(
                `/shipments/contracts/validate?contract_number=${encodeURIComponent(cn)}`,
              )
              const cd = valRes.data?.data as Record<string, unknown> | undefined
              supplier = String(cd?.supplier ?? '')
              product = String(cd?.product ?? '')
              po = String(cd?.po_number ?? '')
              contractQty = parseApiNumber(cd?.quantity_ordered) ?? 0
              outstanding = parseApiNumber(cd?.outstanding_quantity) ?? 0
            } catch {
              // fallback row
            }
            contractDetails.push({
              rowKey: `${sid}-${cn}`,
              contract_number: cn,
              po_number: po,
              supplier,
              product,
              contract_qty: contractQty,
              outstanding_qty: outstanding,
              sto_qty_assigned: 0,
              quantity_delivered: shipmentStoredQtyKg(parseApiNumber(info.quantity_delivered)),
              quantity_receive: shipmentStoredQtyKg(parseApiNumber(info.actual_vessel_qty_receive)),
            })
          }
        }

        const shipmentDeliveredKg = shipmentStoredQtyKg(parseApiNumber(info.quantity_delivered))
        const shipmentReceiveKg = shipmentStoredQtyKg(parseApiNumber(info.actual_vessel_qty_receive))
        contractDetails = mergeShipmentQtyOverridesOnContractRows(
          contractDetails,
          shipmentDeliveredKg,
          shipmentReceiveKg,
        )

        setDetailRows(contractDetails)

        const vn = String(row.vessel_name ?? '')
        setVesselName(vn)
        setOriginalVesselName(vn)
        setVesselMeta({
          vessel_code: String(row.vessel_code ?? ''),
          vessel_owner: String(row.vessel_owner ?? ''),
          vessel_capacity: String(row.vessel_capacity ?? ''),
          vessel_draft: String(row.vessel_draft ?? ''),
          vessel_hull_type: String(row.vessel_hull_type ?? ''),
          charter_type: String(row.charter_type ?? ''),
          port_of_discharge: String(row.port_of_discharge ?? info.vessel_discharge_port_1 ?? ''),
        })
        setOperationId(String(row.operation_id ?? ''))
        setStoNumber(displaySto === '-' ? '' : displaySto)

        const pol = String(info.vessel_loading_port_1 ?? row.port_of_loading ?? '')
        const pod = String(info.vessel_discharge_port_1 ?? row.port_of_discharge ?? '')
        setLoadingPort(pol)
        setDischargePort(pod)

        const sfal = parseApiNumber(info.sfal_qty ?? row.sfal_qty)
        const sfbd = parseApiNumber(info.sfbd_qty ?? row.sfbd_qty)
        setSfalQty(sfal)
        setSfbdQty(sfbd)
        setOriginalSfalQty(sfal)
        setOriginalSfbdQty(sfbd)

        const deliveredKg =
          contractDetails.reduce((s, r) => s + (r.quantity_delivered ?? 0), 0) ||
          shipmentDeliveredKg
        const receiveKg =
          contractDetails.reduce((s, r) => s + (r.quantity_receive ?? 0), 0) ||
          shipmentReceiveKg
        setOriginalDeliveredKg(deliveredKg)
        setOriginalReceiveKg(receiveKg)

        const loadingPortRow =
          ports.find((p) => !p.is_discharge_port && p.port_sequence === 1) ||
          ports.find((p) => !p.is_discharge_port)

        const etaFields: EditEtaFields = {
          etaVesselArrivalAtLoadingPort:
            sliceIsoDate(loadingPortRow?.eta_vessel_arrival as string) ||
            sliceIsoDate(info.eta_vessel_arrival_at_loading_port as string) ||
            sliceIsoDate(row.eta_arrival as string),
          etaVesselBerthedAtLoadingPort:
            sliceIsoDate(loadingPortRow?.eta_vessel_berthed_at_loading_port as string) ||
            sliceIsoDate(info.eta_vessel_berthed_at_loading_port as string) ||
            sliceIsoDate(row.eta_berthed as string),
          etaVesselStartLoading:
            sliceIsoDate(loadingPortRow?.eta_loading_start as string) ||
            sliceIsoDate(info.eta_vessel_start_loading as string) ||
            sliceIsoDate(row.eta_loading_start as string),
          etaVesselCompletedLoading:
            sliceIsoDate(loadingPortRow?.eta_loading_completed as string) ||
            sliceIsoDate(info.eta_vessel_completed_loading as string) ||
            sliceIsoDate(row.eta_loading_complete as string),
          etaVesselSailedFromLoadingPort:
            sliceIsoDate(loadingPortRow?.eta_vessel_sailed as string) ||
            sliceIsoDate(info.eta_vessel_sailed_from_loading_port as string) ||
            sliceIsoDate(row.eta_sailed as string),
          etaVesselArriveAtDischargePort:
            sliceIsoDate(info.eta_vessel_arrive_at_discharge_port as string) ||
            sliceIsoDate(row.eta_discharge_arrival as string),
          etaVesselBerthedAtDischargePort:
            sliceIsoDate(info.eta_vessel_berthed_at_discharge_port as string) ||
            sliceIsoDate(row.eta_discharge_berthed as string),
          etaVesselStartDischarging:
            sliceIsoDate(info.eta_vessel_start_discharging as string) ||
            sliceIsoDate(row.eta_discharge_start as string),
          etaVesselCompleteDischarge:
            sliceIsoDate(info.eta_vessel_complete_discharge as string) ||
            sliceIsoDate(row.eta_discharge_complete as string),
        }

        const poLabels = contractDetails.map((d) => d.po_number || d.contract_number).filter(Boolean)
        setEtaBlocks([
          {
            id: `eta-active-${Date.now()}`,
            status: 'active',
            loadingPort: pol,
            contractLabels: poLabels,
            fields: etaFields,
            isEditing: false,
          },
        ])

        const plantCode = String(row.plant_site ?? row.plant_code ?? '').trim()
        if (plantCode) {
          try {
            const plantsRes = await api.get('/master-plants', { params: { search: plantCode, limit: 20 } })
            const items: Array<{ plant_code?: string; plant_name?: string }> =
              plantsRes.data?.data?.items ?? []
            const match = items.find(
              (p) => String(p.plant_code ?? '').trim().toUpperCase() === plantCode.toUpperCase(),
            )
            setPlantSiteName(match?.plant_name?.trim() || plantCode)
          } catch {
            setPlantSiteName(plantCode)
          }
        }

        await hydrateQuantityDocs(sid)
        await loadActivityLog(sid)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to load shipment'
        setNotification({ type: 'error', message: msg })
      } finally {
        setLoading(false)
      }
    },
    [hydrateQuantityDocs, loadActivityLog, editContractNumbers],
  )

  useEffect(() => {
    if (!open) {
      initSessionRef.current = null
      return
    }
    const sessionKey = `${editContractId ?? ''}:${editShipmentIdProp ?? ''}:${editStoNumber ?? ''}:${editContractNumbers ?? ''}`
    if (initSessionRef.current === sessionKey) return
    initSessionRef.current = sessionKey
    resetState()
    const contractId = editContractId?.trim()
    const directId = editShipmentIdProp?.trim()
    const sto = editStoNumber?.trim()
    if (directId) {
      void loadShipment(contractId || directId, directId, sto)
    } else if (contractId) {
      void loadShipment(contractId, null, sto)
    }
  }, [open, editContractId, editShipmentIdProp, editStoNumber, editContractNumbers, loadShipment, resetState])

  const handleVesselSearch = (value: string) => {
    setVesselName(value)
    if (vesselSearchTimeoutRef.current) clearTimeout(vesselSearchTimeoutRef.current)
    if (value.trim().length < 2) {
      setVesselSuggestions([])
      return
    }
    vesselSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/master-vessels', { params: { search: value.trim(), limit: 20 } })
        setVesselSuggestions(res.data?.data?.items ?? res.data?.data ?? [])
        setShowVesselSuggestions(true)
      } catch {
        setVesselSuggestions([])
      }
    }, 300)
  }

  const handleQtyDocUpload = async (
    kind: typeof SHIPMENT_SLD_DOC_TYPE | typeof SHIPMENT_SDD_DOC_TYPE,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (!file || !shipmentId) return
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      alert('Only PDF files are allowed.')
      e.target.value = ''
      return
    }
    const isSld = kind === SHIPMENT_SLD_DOC_TYPE
    if ((isSld && hasUploadedSld) || (!isSld && hasUploadedSdd)) return
    const setUploading = isSld ? setSldDocUploading : setSddDocUploading
    const setUploaded = isSld ? setHasUploadedSld : setHasUploadedSdd
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', kind)
      form.append('shipment_id', shipmentId)
      form.append('description', `${kind} document for quantity authorization`)
      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data?.success) setUploaded(true)
      else alert(res.data?.error?.message || 'Upload failed')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      alert(msg)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const resolveRowQty = (
    row: VesselPortsQuantityRow,
    field: 'quantity_delivered' | 'quantity_receive',
  ): number | null => {
    const edited = qtyEdits[row.rowKey]?.[field]
    if (edited !== undefined) return edited
    return row[field] ?? null
  }

  const handleSave = async () => {
    if (!shipmentId) return
    if (perms.loaded && !canEditShipment) {
      setNotification({ type: 'error', message: 'You need Edit permission on Shipments.' })
      return
    }
    const activeBlock = etaBlocks.find((b) => b.status === 'active')
    if (!activeBlock) {
      setNotification({ type: 'error', message: 'No active ETA block to save.' })
      return
    }

    setSaving(true)
    setNotification(null)
    try {
      const qtyUserEdited = hasVesselPortsQuantityUserEdits(qtyTableRows, qtyEdits)
      await saveEditShipmentChanges({
        shipmentId,
        vesselName,
        originalVesselName,
        sfalQty,
        sfbdQty,
        originalSfalQty,
        originalSfbdQty,
        loadingPort,
        dischargePort,
        activeEta: activeBlock.fields,
        qtyRows: qtyTableRows,
        qtyEdits,
        originalDeliveredKg,
        originalReceiveKg,
        quantityUnlocked: isQuantityUnlocked,
        hasSldOrSddDoc: hasUploadedSld || hasUploadedSdd,
        loadingPorts,
        ataFields,
        originalAtaFields,
      })

      await onSubmit({
        kind: 'update',
        shipmentId,
        vessel_name: vesselName.trim() !== originalVesselName.trim() ? vesselName.trim() : undefined,
        ...(qtyUserEdited && qtyTotals.quantity_delivered !== null
          ? { quantity_delivered: qtyTotals.quantity_delivered }
          : {}),
        ...(qtyUserEdited && qtyTotals.quantity_receive !== null
          ? { actual_vessel_qty_receive: qtyTotals.quantity_receive }
          : {}),
        sfal_qty: sfalQty,
        sfbd_qty: sfbdQty,
        eta_arrival: toApiDateOnly(activeBlock.fields.etaVesselArrivalAtLoadingPort),
        eta_berthed: toApiDateOnly(activeBlock.fields.etaVesselBerthedAtLoadingPort),
        eta_loading_start: toApiDateOnly(activeBlock.fields.etaVesselStartLoading),
        eta_loading_complete: toApiDateOnly(activeBlock.fields.etaVesselCompletedLoading),
        eta_sailed: toApiDateOnly(activeBlock.fields.etaVesselSailedFromLoadingPort),
        eta_discharge_arrival: toApiDateOnly(activeBlock.fields.etaVesselArriveAtDischargePort),
        eta_discharge_berthed: toApiDateOnly(activeBlock.fields.etaVesselBerthedAtDischargePort),
        eta_discharge_start: toApiDateOnly(activeBlock.fields.etaVesselStartDischarging),
        eta_discharge_complete: toApiDateOnly(activeBlock.fields.etaVesselCompleteDischarge),
      })

      setNotification({ type: 'success', message: 'Shipment updated successfully.' })
      onClose()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save shipment'
      setNotification({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  const handleAddEta = () => {
    setEtaBlocks((prev) => {
      const active = prev.find((b) => b.status === 'active')
      if (!active || active.isDraft) return prev
      const historical = { ...active, status: 'historical' as const, isEditing: false, isDraft: false }
      const newActive: EtaBlock = {
        id: `eta-${Date.now()}`,
        status: 'active',
        loadingPort: active.loadingPort,
        contractLabels: [...active.contractLabels],
        fields: emptyEtaFields(),
        isEditing: true,
        isDraft: true,
      }
      return [...prev.filter((b) => b.id !== active.id), historical, newActive]
    })
  }

  const handleCancelAddEta = () => {
    setEtaBlocks((prev) => {
      const draft = prev.find((b) => b.status === 'active' && b.isDraft)
      if (!draft) return prev
      const withoutDraft = prev.filter((b) => b.id !== draft.id)
      const promotedHistorical = [...withoutDraft]
        .reverse()
        .find((b) => b.status === 'historical')
      if (!promotedHistorical) return withoutDraft
      const restored: EtaBlock = {
        ...promotedHistorical,
        status: 'active',
        isEditing: false,
        isDraft: false,
      }
      return [
        ...withoutDraft.filter((b) => b.id !== promotedHistorical.id),
        restored,
      ]
    })
  }

  const updateActiveEtaField = (key: keyof EditEtaFields, value: string) => {
    setEtaBlocks((prev) =>
      prev.map((b) =>
        b.status === 'active' ? { ...b, fields: { ...b.fields, [key]: value } } : b,
      ),
    )
  }

  if (!open) return null

  const activeEtaBlock = etaBlocks.find((b) => b.status === 'active')
  const historicalEtaBlocks = etaBlocks.filter((b) => b.status === 'historical')
  const capacityPct =
    vesselCapacityMt && vesselCapacityMt > 0
      ? Math.min(100, (totalAssignedMt / vesselCapacityMt) * 100)
      : 0

  return (
    <div className={VESSEL_MODAL_OVERLAY_CLASS}>
      <div className={VESSEL_MODAL_PANEL_CLASS}>
        <div className={VESSEL_MODAL_HEADER_CLASS}>
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">
                <Ship className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Edit Shipment</h3>
                <p className="text-xs text-gray-500">
                  {stoNumber
                    ? `STO ${stoNumber} — edit ETA schedule and manual ATA (SAP reference preserved)`
                    : 'Update vessel, quantities, ETA schedule, and manual ATA'}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className={VESSEL_MODAL_BODY_CLASS}>
          {loading && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading shipment details…
            </div>
          )}

          {notification && (
            <div
              className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                notification.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {notification.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <p>{notification.message}</p>
            </div>
          )}

          <div className="space-y-5">
            {/* Section 1: Vessel Detail */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100">
                  <Anchor className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">1. Vessel Detail</h4>
              </div>
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="relative md:col-span-2 lg:col-span-3">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Vessel Name</label>
                  <Input
                    value={vesselName}
                    onChange={(e) => {
                      if (!canModifyShipment) return
                      handleVesselSearch(e.target.value)
                    }}
                    onFocus={() => {
                      if (!canModifyShipment) return
                      vesselName.trim().length >= 2 && setShowVesselSuggestions(true)
                    }}
                    onBlur={() => setTimeout(() => setShowVesselSuggestions(false), 200)}
                    readOnly={!canModifyShipment}
                    disabled={!canModifyShipment}
                    className={`h-9 text-sm ${!canModifyShipment ? READONLY_FIELD_CLASS : ''}`}
                    placeholder="Search Master Vessel..."
                  />
                  {canModifyShipment && showVesselSuggestions && vesselSuggestions.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
                      {vesselSuggestions.map((v) => (
                        <button
                          key={v.vessel_code}
                          type="button"
                          className="w-full border-b px-3 py-2 text-left text-xs hover:bg-gray-50 last:border-b-0"
                          onMouseDown={() => {
                            setVesselName(v.vessel_name)
                            setVesselMeta((m) => ({
                              ...m,
                              vessel_code: v.vessel_code,
                              vessel_owner: v.vessel_owner ?? m.vessel_owner,
                            }))
                            setShowVesselSuggestions(false)
                          }}
                        >
                          <div className="font-medium">{v.vessel_name}</div>
                          <div className="text-gray-500">{v.vessel_code}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {[
                  ['Vessel Code', vesselMeta.vessel_code],
                  ['Vessel Owner', vesselMeta.vessel_owner],
                  ['Vessel Capacity (MT)', vesselMeta.vessel_capacity],
                  ['Vessel Draft', vesselMeta.vessel_draft],
                  ['Hull Type', vesselMeta.vessel_hull_type],
                  ['Charter Type', vesselMeta.charter_type],
                  ['Discharge Port', vesselMeta.port_of_discharge],
                  ['Plant / Site', plantSiteName],
                  ['Operation ID', operationId],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
                    <Input value={value || '—'} readOnly disabled className={`h-9 text-sm ${READONLY_FIELD_CLASS}`} />
                  </div>
                ))}
              </div>
            </div>

            {/* Section 2: Shipment Detail */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100">
                  <FileText className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">2. Shipment Detail</h4>
              </div>
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-xs font-medium text-amber-900">Upload SLD</p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80">Required to unlock Delivered / Receive qty.</p>
                    <input
                      id="edit-shipment-sld"
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => handleQtyDocUpload(SHIPMENT_SLD_DOC_TYPE, e)}
                      disabled={!canModifyShipment || sldDocUploading || hasUploadedSld}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8 text-xs border-amber-300"
                      disabled={!canModifyShipment || sldDocUploading || hasUploadedSld}
                      onClick={() => document.getElementById('edit-shipment-sld')?.click()}
                    >
                      {sldDocUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : hasUploadedSld ? (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> SLD uploaded
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5 mr-1" /> Upload SLD
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-xs font-medium text-amber-900">Upload SDD</p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80">Required to unlock Delivered / Receive qty.</p>
                    <input
                      id="edit-shipment-sdd"
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => handleQtyDocUpload(SHIPMENT_SDD_DOC_TYPE, e)}
                      disabled={!canModifyShipment || sddDocUploading || hasUploadedSdd}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8 text-xs border-amber-300"
                      disabled={!canModifyShipment || sddDocUploading || hasUploadedSdd}
                      onClick={() => document.getElementById('edit-shipment-sdd')?.click()}
                    >
                      {sddDocUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : hasUploadedSdd ? (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> SDD uploaded
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5 mr-1" /> Upload SDD
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {!isQuantityUnlocked && (
                  <p className="text-[11px] text-amber-800/80">
                    Delivered / Received quantities stay locked until at least one of SLD or SDD is uploaded.
                  </p>
                )}

                <div className="max-w-xs">
                  <label className="mb-1 block text-xs font-medium text-gray-600">STO Number</label>
                  <Input value={stoNumber || '—'} readOnly disabled className={`h-9 text-sm ${READONLY_FIELD_CLASS}`} />
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>PO</TableHead>
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>Supplier / Product</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Contract Qty</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>STO Qty</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Outstanding Qty</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Delivered Qty</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Receive Qty</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-center`}>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailRows.map((row) => {
                        const qtyRow = qtyTableRows.find((r) => r.rowKey === row.rowKey)!
                        const isEditing = editingQtyRowKey === row.rowKey
                        const deliveredKg = resolveRowQty(qtyRow, 'quantity_delivered')
                        const receiveKg = resolveRowQty(qtyRow, 'quantity_receive')
                        return (
                          <TableRow key={row.rowKey}>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {formatSapDisplayValue(row.po_number || row.contract_number)}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <span className="line-clamp-2 text-gray-600">
                                {[row.supplier, row.product].filter(Boolean).join(' • ') || '—'}
                              </span>
                            </TableCell>
                            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                              {formatQtyMtFromKg(row.contract_qty)}
                            </TableCell>
                            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                              {row.sto_qty_assigned > 0
                                ? formatQtyMtFromKg(row.sto_qty_assigned)
                                : '—'}
                            </TableCell>
                            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                              {formatQtyMtFromKg(row.outstanding_qty)}
                            </TableCell>
                            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                              {isEditing ? (
                                <MtQtyInput
                                  valueKg={deliveredKg}
                                  disabled={!canModifyShipment || !isQuantityUnlocked}
                                  onChange={(kg) =>
                                    setQtyEdits((p) => ({
                                      ...p,
                                      [row.rowKey]: { ...p[row.rowKey], quantity_delivered: kg },
                                    }))
                                  }
                                />
                              ) : (
                                formatQtyMtFromKg(deliveredKg)
                              )}
                            </TableCell>
                            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                              {isEditing ? (
                                <MtQtyInput
                                  valueKg={receiveKg}
                                  disabled={!canModifyShipment || !isQuantityUnlocked}
                                  onChange={(kg) =>
                                    setQtyEdits((p) => ({
                                      ...p,
                                      [row.rowKey]: { ...p[row.rowKey], quantity_receive: kg },
                                    }))
                                  }
                                />
                              ) : (
                                formatQtyMtFromKg(receiveKg)
                              )}
                            </TableCell>
                            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-center`}>
                              {isEditing ? (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setEditingQtyRowKey(null)}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    className="h-7 w-7 bg-green-600 hover:bg-green-700 text-white"
                                    disabled={!canModifyShipment || !isQuantityUnlocked}
                                    onClick={() => setEditingQtyRowKey(null)}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : canModifyShipment ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Edit quantities"
                                  onClick={() => setEditingQtyRowKey(row.rowKey)}
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <span className="text-[10px] text-gray-400">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow className={VESSEL_MODAL_TABLE_FOOTER_CLASS}>
                        <TableCell colSpan={5} className={VESSEL_MODAL_COMPACT_TD}>
                          Grand Total
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                          {formatQtyMtFromKg(qtyTotals.quantity_delivered)}
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                          {formatQtyMtFromKg(qtyTotals.quantity_receive)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>

                {vesselCapacityMt != null && vesselCapacityMt > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-1 flex justify-between text-xs text-gray-600">
                      <span>Total Assigned (STO)</span>
                      <span className="tabular-nums">
                        {formatNumber(totalAssignedMt)} / {formatNumber(vesselCapacityMt)} MT
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={`h-full rounded-full ${capacityPct > 100 ? 'bg-red-500' : 'bg-blue-600'}`}
                        style={{ width: `${capacityPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">SFAL Qty</label>
                    <MtQtyInput valueKg={sfalQty} disabled={!canModifyShipment} onChange={setSfalQty} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">SFBD Qty</label>
                    <MtQtyInput valueKg={sfbdQty} disabled={!canModifyShipment} onChange={setSfbdQty} />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: ETA + Loading Port */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100">
                  <Clock className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">3. ETA + Loading Port</h4>
              </div>
              <div className="space-y-4 p-4">
                {activeEtaBlock && (
                  <div className="rounded-lg border border-blue-100 bg-white p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        className={
                          activeEtaBlock.isDraft
                            ? 'bg-amber-600 text-white text-[10px]'
                            : 'bg-blue-600 text-white text-[10px]'
                        }
                      >
                        {activeEtaBlock.isDraft ? 'New ETA' : 'Active ETA'}
                      </Badge>
                      {canModifyShipment && (
                      <div className="flex gap-2">
                        {activeEtaBlock.isDraft ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-red-600 hover:text-red-700"
                            onClick={handleCancelAddEta}
                          >
                            <X className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                setEtaBlocks((prev) =>
                                  prev.map((b) =>
                                    b.status === 'active' ? { ...b, isEditing: !b.isEditing } : b,
                                  ),
                                )
                              }
                            >
                              <Edit2 className="h-3.5 w-3.5 mr-1" />
                              {activeEtaBlock.isEditing ? 'Lock' : 'Edit'}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={handleAddEta}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add
                            </Button>
                          </>
                        )}
                      </div>
                      )}
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Loading Port</label>
                        <Input
                          value={activeEtaBlock.loadingPort}
                          readOnly
                          disabled
                          className={`h-9 text-sm ${READONLY_FIELD_CLASS}`}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Apply to PO</label>
                        <Input
                          value={activeEtaBlock.contractLabels.join(', ') || '—'}
                          readOnly
                          disabled
                          className={`h-9 text-sm ${READONLY_FIELD_CLASS}`}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {ETA_FIELD_ROWS.map(({ key, label }) => (
                        <div key={key}>
                          <label className="mb-1 block text-[10px] font-medium text-gray-600">{label}</label>
                          {activeEtaBlock.isEditing && canModifyShipment ? (
                            <DateInputDdMmYyyy
                              valueIso={activeEtaBlock.fields[key]}
                              onChangeIso={(iso) => updateActiveEtaField(key, iso)}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <div className={`flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`}>
                              {formatDateDMY(activeEtaBlock.fields[key]) || '—'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {historicalEtaBlocks.map((block) => (
                  <div key={block.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 opacity-80">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        Previous ETA (historical)
                      </Badge>
                      <span className="text-xs text-gray-500">{block.loadingPort || '—'}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {ETA_FIELD_ROWS.map(({ key, label }) => (
                        <div key={key}>
                          <div className="text-[10px] text-gray-500">{label}</div>
                          <div className="text-xs font-medium">{formatDateDMY(block.fields[key]) || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 4: ATA */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={`${VESSEL_MODAL_SECTION_HEADER_CLASS} justify-between gap-2`}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">
                    <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800">4. ATA Vessel Information</h4>
                </div>
                {canModifyShipment && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setAtaIsEditing((prev) => !prev)}
                  >
                    <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                    {ataIsEditing ? 'Done' : 'Edit ATA'}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
                {ATA_FIELD_ROWS.map(({ key, label }) => {
                  const sapRef = ataSapReference[key]
                  const hasOverride = Boolean(ataFields[key] && sapRef && ataFields[key] !== sapRef)
                  return (
                    <div key={key}>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                        ATA {label}
                      </div>
                      {ataIsEditing && canModifyShipment ? (
                        <DateInputDdMmYyyy
                          valueIso={ataFields[key]}
                          onChangeIso={(iso) =>
                            setAtaFields((prev) => ({ ...prev, [key]: iso }))
                          }
                          className="mt-1 h-8 text-xs"
                        />
                      ) : (
                        <div className="mt-0.5 text-sm font-medium text-gray-800">
                          {formatDateDMY(ataFields[key]) || '—'}
                        </div>
                      )}
                      {sapRef ? (
                        <div className="mt-1 text-[10px] text-gray-400">
                          SAP: {formatDateDMY(sapRef)}
                          {hasOverride ? (
                            <span className="ml-1 font-medium text-emerald-600">(manual)</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Section 5: Quality */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100">
                  <FlaskConical className="h-3.5 w-3.5 text-violet-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">5. Quality Vessel Information</h4>
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Quality at Loading Loc 1
                  </p>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {QUALITY_LOADING_FIELDS.map(({ key, label }) => (
                      <div key={key}>
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="text-sm font-medium">
                          {formatNumber(parseApiNumber(shipmentInfo[key]))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Quality at Discharge Loc 1
                  </p>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {QUALITY_DISCHARGE_FIELDS.map(({ key, label }) => (
                      <div key={key}>
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="text-sm font-medium">
                          {formatNumber(parseApiNumber(shipmentInfo[key]))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 6: Activity History */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100">
                  <History className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">6. Activity History</h4>
              </div>
              <div className="p-4">
                {activityLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading activity…
                  </div>
                ) : activityLog.length === 0 ? (
                  <p className="text-sm text-gray-500">No edit history recorded for this shipment yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {activityLog.map((log) => (
                      <li
                        key={log.id}
                        className="flex flex-col gap-0.5 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="font-medium text-gray-800">{formatActivityLabel(log)}</span>
                        <span className="text-xs text-gray-500 tabular-nums">
                          {formatDateTimeDMY(log.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4 flex justify-end gap-2 rounded-b-lg">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => void handleSave()}
            disabled={saving || loading || !shipmentId || !canModifyShipment}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
