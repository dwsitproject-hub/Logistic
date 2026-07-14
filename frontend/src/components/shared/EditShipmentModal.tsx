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
  MessageSquare,
  Plus,
  Ship,
  Upload,
  Download,
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
  sapContractDetailQtyToKg,
  shipmentStoredQtyKg,
} from '@/lib/shipmentQuantityUnits'
import {
  sumVesselPortsQuantityEdits,
  type VesselPortsQuantityEdits,
  type VesselPortsQuantityRow,
} from '@/components/shipments/VesselPortsQuantitiesTable'
import type { AddNewShipmentSubmitPayload, ShipmentEditContextData, ShipmentPoOption } from '@/components/shared/addNewShipmentTypes'
import { attachPurchaseOrderToShipment, batchSaveShipmentPoPlanQty } from '@/components/shared/addNewShipmentTypes'
import { ShipmentPoSearchCombobox } from '@/components/shared/ShipmentPoSearchCombobox'
import {
  ContractDetailModal,
  fetchContractForDetailModalByPo,
  type ContractDetailModalContract,
} from '@/components/contracts/ContractDetailModal'
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
  saveShipmentEditRemark,
  type DischargeEtaFields,
  type EditEtaFields,
  type LoadingPortRef,
} from '@/lib/editShipmentModalSave'
import {
  buildShipmentEtaBaseline,
  hasShipmentEtaEdits,
  type ShipmentEtaBaseline,
  type ShipmentEtaBlockSnapshot,
} from '@/lib/editShipmentRemarkGate'
import {
  ataFieldsFromShipmentInfo,
  ataSapReferenceFromShipmentInfo,
  emptyAtaFields,
  type ShipmentAtaApiField,
  type ShipmentAtaFields,
} from '@/lib/shipmentAtaFields'
import {
  usePermissions,
  canCreatePermission,
  canEditPermission,
} from '@/components/PermissionsContext'
import {
  formatShipmentStatusLabel,
  shipmentStatusBadgeClass,
} from '@/lib/shipmentStatusDisplay'
const SHIPMENT_SLD_DOC_TYPE = 'SLD'
const SHIPMENT_SDD_DOC_TYPE = 'SDD'

interface ShipmentDocumentItem {
  id: string
  document_type?: string
  file_name: string
  created_at?: string
}
const ETA_INFO_VALUE_CLASS = 'text-sm font-medium text-gray-900 tabular-nums'
const INFO_VALUE_CLASS = 'text-sm font-medium text-gray-900'
const VESSEL_MODAL_TABLE_QTY_VALUE_CLASS = 'text-xs font-normal tabular-nums text-gray-900'

const LOADING_ETA_FIELD_ROWS: { key: keyof EditEtaFields; label: string }[] = [
  { key: 'etaVesselArrivalAtLoadingPort', label: 'Estimation Vessel Arrival at Loading Port' },
  { key: 'etaVesselBerthedAtLoadingPort', label: 'Estimation Vessel Berthed at Loading Port' },
  { key: 'etaVesselStartLoading', label: 'Estimation Vessel Start Loading' },
  { key: 'etaVesselCompletedLoading', label: 'Estimation Vessel Completed Loading' },
  { key: 'etaVesselSailedFromLoadingPort', label: 'Estimation Vessel Sailed from Loading Port' },
]

const DISCHARGE_ETA_FIELD_ROWS: { key: keyof DischargeEtaFields; label: string }[] = [
  { key: 'etaVesselArriveAtDischargePort', label: 'Estimation Vessel Arrive at Discharge Port' },
  { key: 'etaVesselBerthedAtDischargePort', label: 'Estimation Vessel Berthed at Discharge Port' },
  { key: 'etaVesselStartDischarging', label: 'Estimation Vessel Start Discharging' },
  { key: 'etaVesselCompleteDischarge', label: 'Estimation Vessel Complete Discharge' },
]

const ETA_FIELD_ROWS: { key: keyof EditEtaFields; label: string }[] = [
  ...LOADING_ETA_FIELD_ROWS,
  ...DISCHARGE_ETA_FIELD_ROWS,
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

const LOADING_ATA_FIELD_ROWS = ATA_FIELD_ROWS.filter((row) => !row.key.includes('discharge'))

const DISCHARGE_ATA_FIELD_ROWS = ATA_FIELD_ROWS.filter((row) => row.key.includes('discharge'))

const QUALITY_METRICS: { portKey: string; label: string }[] = [
  { portKey: 'quality_ffa', label: 'FFA' },
  { portKey: 'quality_mi', label: 'M&I' },
  { portKey: 'quality_dobi', label: 'DOBI' },
  { portKey: 'quality_red', label: 'Color' },
  { portKey: 'quality_ds', label: 'D&S' },
  { portKey: 'quality_stone', label: 'Stone' },
]

function emptyDischargeEtaFields(): DischargeEtaFields {
  return {
    etaVesselArriveAtDischargePort: '',
    etaVesselBerthedAtDischargePort: '',
    etaVesselStartDischarging: '',
    etaVesselCompleteDischarge: '',
  }
}

function emptyEtaFields(): EditEtaFields {
  return {
    ...emptyDischargeEtaFields(),
    etaVesselArrivalAtLoadingPort: '',
    etaVesselBerthedAtLoadingPort: '',
    etaVesselStartLoading: '',
    etaVesselCompletedLoading: '',
    etaVesselSailedFromLoadingPort: '',
  }
}

function dischargeEtaFromInfo(
  info: Record<string, unknown>,
  row: Record<string, unknown>,
): DischargeEtaFields {
  return {
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
}

function loadingAtaFromPortRow(
  portRow: LoadingPortRef | undefined,
  info: Record<string, unknown>,
): Pick<
  ShipmentAtaFields,
  | 'ata_vessel_arrival_at_loading_port'
  | 'ata_vessel_berthed_at_loading_port'
  | 'ata_vessel_start_loading'
  | 'ata_vessel_completed_loading'
  | 'ata_vessel_sailed_from_loading_port'
> {
  return {
    ata_vessel_arrival_at_loading_port:
      sliceIsoDate(portRow?.ata_vessel_arrival as string) ||
      sliceIsoDate(info.ata_vessel_arrival_at_loading_port as string),
    ata_vessel_berthed_at_loading_port:
      sliceIsoDate(portRow?.ata_vessel_berthed as string) ||
      sliceIsoDate(info.ata_vessel_berthed_at_loading_port as string),
    ata_vessel_start_loading:
      sliceIsoDate(portRow?.ata_loading_start as string) ||
      sliceIsoDate(info.ata_vessel_start_loading as string),
    ata_vessel_completed_loading:
      sliceIsoDate(portRow?.ata_loading_completed as string) ||
      sliceIsoDate(info.ata_vessel_completed_loading as string),
    ata_vessel_sailed_from_loading_port:
      sliceIsoDate(portRow?.ata_vessel_sailed as string) ||
      sliceIsoDate(info.ata_vessel_sailed_from_loading_port as string),
  }
}

function loadingEtaFromPortRow(
  portRow: LoadingPortRef | undefined,
  info: Record<string, unknown>,
  row: Record<string, unknown>,
): EditEtaFields {
  return {
    etaVesselArrivalAtLoadingPort:
      sliceIsoDate(portRow?.eta_vessel_arrival as string) ||
      sliceIsoDate(info.eta_vessel_arrival_at_loading_port as string) ||
      sliceIsoDate(row.eta_arrival as string),
    etaVesselBerthedAtLoadingPort:
      sliceIsoDate(portRow?.eta_vessel_berthed_at_loading_port as string) ||
      sliceIsoDate(info.eta_vessel_berthed_at_loading_port as string) ||
      sliceIsoDate(row.eta_berthed as string),
    etaVesselStartLoading:
      sliceIsoDate(portRow?.eta_loading_start as string) ||
      sliceIsoDate(info.eta_vessel_start_loading as string) ||
      sliceIsoDate(row.eta_loading_start as string),
    etaVesselCompletedLoading:
      sliceIsoDate(portRow?.eta_loading_completed as string) ||
      sliceIsoDate(info.eta_vessel_completed_loading as string) ||
      sliceIsoDate(row.eta_loading_complete as string),
    etaVesselSailedFromLoadingPort:
      sliceIsoDate(portRow?.eta_vessel_sailed as string) ||
      sliceIsoDate(info.eta_vessel_sailed_from_loading_port as string) ||
      sliceIsoDate(row.eta_sailed as string),
    ...emptyDischargeEtaFields(),
  }
}

function qualityMetricFromPort(
  portRow: Record<string, unknown> | LoadingPortRef | undefined,
  portKey: string,
  info: Record<string, unknown>,
  infoKey: string,
): number | null {
  const fromPort = parseApiNumber(portRow?.[portKey as keyof LoadingPortRef])
  if (fromPort != null) return fromPort
  return parseApiNumber(info[infoKey])
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

function formatInfoDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = String(value).trim()
  return text || '—'
}

function ReadOnlyInfoField({
  label,
  value,
  compact = false,
  className,
}: {
  label: string
  value: unknown
  compact?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label
        className={
          compact
            ? 'mb-1 block text-[10px] font-medium text-gray-600'
            : 'mb-1 block text-xs font-medium text-gray-600'
        }
      >
        {label}
      </label>
      <div
        className={
          compact
            ? `flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`
            : INFO_VALUE_CLASS
        }
      >
        {formatInfoDisplayValue(value)}
      </div>
    </div>
  )
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
  if (disabled) {
    return (
      <div className="text-right">
        <div
          className={`flex min-h-0 items-center justify-end ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}
        >
          {valueKg === null ? '—' : formatQtyMtFromKg(valueKg)}
        </div>
      </div>
    )
  }

  const mtDisplay = valueKg === null ? '' : String(valueKg / 1000)
  return (
    <div className="text-right">
      <div className="relative w-full min-w-[5.5rem]">
        <Input
          type="number"
          step="0.01"
          value={mtDisplay}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(0)
              return
            }
            const mt = parseFloat(raw)
            onChange(Number.isNaN(mt) ? 0 : mt * 1000)
          }}
          className={`h-7 px-2 py-1 pr-9 text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-normal text-gray-500">
          MT
        </span>
      </div>
    </div>
  )
}

function MtQtyReadOnly({ valueKg }: { valueKg: number | null | undefined }) {
  if (valueKg === null || valueKg === undefined) {
    return (
      <div className={`text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}>
        <div>—</div>
      </div>
    )
  }
  const kg = typeof valueKg === 'number' ? valueKg : Number(String(valueKg).replace(/,/g, '').trim())
  if (!Number.isFinite(kg)) {
    return (
      <div className={`text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}>
        <div>—</div>
      </div>
    )
  }
  return (
    <div className={`text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}>
      <div>{formatQtyMtFromKg(kg)}</div>
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
  outstanding_qty_actual: number
  outstanding_qty_planning: number
  outstanding_qty_planning_budget: number
  sap_sto_qty: number
  shipment_plan_qty: number
  /** @deprecated alias for shipment_plan_qty */
  sto_qty_assigned: number
  /** @deprecated alias for outstanding_qty_actual */
  outstanding_qty: number
  quantity_delivered: number | null
  quantity_receive: number | null
}

async function fetchContractValidateEnrichment(contractNumber: string): Promise<{
  supplier: string
  product: string
  po_number: string
  contract_qty: number
  outstanding_qty: number
}> {
  try {
    const valRes = await api.get(
      `/shipments/contracts/validate?contract_number=${encodeURIComponent(contractNumber)}`,
    )
    const cd = valRes.data?.data as Record<string, unknown> | undefined
    return {
      supplier: String(cd?.supplier ?? ''),
      product: String(cd?.product ?? ''),
      po_number: String(cd?.po_number ?? ''),
      contract_qty: parseApiNumber(cd?.quantity_ordered) ?? 0,
      outstanding_qty: parseApiNumber(cd?.outstanding_quantity) ?? 0,
    }
  } catch {
    return {
      supplier: '',
      product: '',
      po_number: '',
      contract_qty: 0,
      outstanding_qty: 0,
    }
  }
}

function contractDetailRowFromApi(
  d: Record<string, unknown>,
  shipmentId: string,
): ShipmentDetailRow {
  const cn = String(d.contract_number ?? '').trim()
  const po = String(d.po_number ?? '').trim()
  const shipmentPlanQty = parseApiNumber(d.shipment_plan_qty ?? d.sto_qty_assigned) ?? 0
  const contractQty = parseApiNumber(d.contract_qty) ?? 0
  const osActual = parseApiNumber(d.outstanding_qty_actual ?? d.outstanding_qty) ?? 0
  const osPlan = parseApiNumber(d.outstanding_qty_planning) ?? 0
  const osPlanBudget = parseApiNumber(d.outstanding_qty_planning_budget) ?? osPlan
  return {
    rowKey: `${shipmentId}-${cn}-${po || 'po'}`,
    contract_number: cn,
    po_number: po,
    supplier: String(d.supplier ?? '').trim(),
    product: String(d.product ?? '').trim(),
    contract_qty: contractQty,
    outstanding_qty_actual: osActual,
    outstanding_qty_planning: osPlan,
    outstanding_qty_planning_budget: osPlanBudget,
    sap_sto_qty: parseApiNumber(d.sap_sto_qty) ?? 0,
    shipment_plan_qty: shipmentPlanQty,
    sto_qty_assigned: shipmentPlanQty,
    outstanding_qty: osActual,
    quantity_delivered: sapContractDetailQtyToKg(parseApiNumber(d.quantity_delivered), contractQty),
    quantity_receive: sapContractDetailQtyToKg(parseApiNumber(d.quantity_receive), contractQty),
  }
}

async function buildContractDetailRows(
  detailsData: Array<Record<string, unknown>>,
  shipmentId: string,
  contractNumbers: string[],
  info: Record<string, unknown>,
): Promise<ShipmentDetailRow[]> {
  let contractDetails = detailsData.map((d) => contractDetailRowFromApi(d, shipmentId))

  const needsEnrichment = contractDetails
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.contract_number && !row.supplier && !row.product)

  if (needsEnrichment.length > 0) {
    const enrichments = await Promise.all(
      needsEnrichment.map(({ row }) => fetchContractValidateEnrichment(row.contract_number)),
    )
    contractDetails = contractDetails.map((row, index) => {
      const enrichIdx = needsEnrichment.findIndex((item) => item.index === index)
      if (enrichIdx < 0) return row
      const enriched = enrichments[enrichIdx]
      return {
        ...row,
        supplier: row.supplier || enriched.supplier,
        product: row.product || enriched.product,
      }
    })
  }

  if (contractDetails.length === 0 && contractNumbers.length > 0) {
    const enrichments = await Promise.all(
      contractNumbers.map((cn) => fetchContractValidateEnrichment(cn)),
    )
    contractDetails = contractNumbers.map((cn, i) => {
      const enriched = enrichments[i]
      return {
        rowKey: `${shipmentId}-${cn}`,
        contract_number: cn,
        po_number: enriched.po_number,
        supplier: enriched.supplier,
        product: enriched.product,
        contract_qty: enriched.contract_qty,
        outstanding_qty_actual: enriched.outstanding_qty,
        outstanding_qty_planning: enriched.outstanding_qty,
        outstanding_qty_planning_budget: enriched.outstanding_qty,
        sap_sto_qty: 0,
        shipment_plan_qty: 0,
        sto_qty_assigned: 0,
        outstanding_qty: enriched.outstanding_qty,
        quantity_delivered: shipmentStoredQtyKg(parseApiNumber(info.quantity_delivered)),
        quantity_receive: shipmentStoredQtyKg(parseApiNumber(info.actual_vessel_qty_receive)),
      }
    })
  }

  return contractDetails
}

type EtaBlock = {
  id: string
  portId?: string
  portSequence: number
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

type ShipmentRemarkRow = {
  id: string
  text: string
  category?: string | null
  created_at?: string | null
  username?: string
  full_name?: string
}

function formatShipmentRemarkAuthor(remark: ShipmentRemarkRow): string {
  return remark.full_name?.trim() || remark.username?.trim() || '—'
}

function formatShipmentRemarkCategory(category?: string | null): string | null {
  const key = String(category ?? '').trim().toUpperCase()
  if (key === 'CANCEL_SHIPMENT') return 'Shipment cancellation'
  if (key === 'EDIT_SHIPMENT') return 'Edit shipment'
  return null
}

function formatActivityLabel(log: ActivityLogRow): string {
  const user = log.full_name?.trim() || log.username?.trim() || 'Unknown User'
  const entity = log.entity_type?.replace(/_/g, ' ') ?? 'Record'
  const action = log.action?.toUpperCase() ?? 'UPDATE'
  if (action === 'UPDATE' && log.entity_type === 'SHIPMENT') return `Updated Shipment — ${user}`
  if (action === 'CREATE' && log.entity_type === 'LOADING_PORT') return `Added Loading Port — ${user}`
  if (action === 'UPDATE' && log.entity_type === 'LOADING_PORT') return `Updated Estimation / Port — ${user}`
  if (action === 'CANCEL' && log.entity_type === 'LOADING_PORT') return `Cancelled Port Activity — ${user}`
  if (action === 'CANCEL' && log.entity_type === 'SHIPMENT') return `Cancelled Shipment — ${user}`
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
  /** Read-only mode (e.g. Cancelled shipments on Shipments view table). */
  readOnly?: boolean
  /** Raise z-index when opened above contract detail modal. */
  stacked?: boolean
  /** Called after PO attach so parent can refresh Shipments list. */
  onShipmentChanged?: () => void
}

export function EditShipmentModal({
  open,
  onClose,
  onSubmit,
  editContractId = null,
  editShipmentId: editShipmentIdProp = null,
  editStoNumber = null,
  editContractNumbers = null,
  readOnly = false,
  stacked = false,
  onShipmentChanged,
}: EditShipmentModalProps) {
  const perms = usePermissions()
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canAddShipment = canCreatePermission(perms, 'data.shipments')

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
  const [contractDetailTarget, setContractDetailTarget] =
    useState<ContractDetailModalContract | null>(null)
  const [contractDetailLoading, setContractDetailLoading] = useState(false)
  const [planQtyEdits, setPlanQtyEdits] = useState<Record<string, number>>({})
  const [qtyEdits, setQtyEdits] = useState<VesselPortsQuantityEdits>({})
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
  const [shipmentStatus, setShipmentStatus] = useState<string | null>(null)
  const [shipmentDocuments, setShipmentDocuments] = useState<ShipmentDocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  const [loadingPort, setLoadingPort] = useState('')
  const [dischargePort, setDischargePort] = useState('')
  const [loadingPorts, setLoadingPorts] = useState<LoadingPortRef[]>([])
  const [etaBlocks, setEtaBlocks] = useState<EtaBlock[]>([])
  const [dischargeEtaFields, setDischargeEtaFields] = useState<DischargeEtaFields>(emptyDischargeEtaFields)
  const [etaSectionEditing, setEtaSectionEditing] = useState(false)
  const [isMultiPortLoading, setIsMultiPortLoading] = useState(false)
  const [shipmentInfo, setShipmentInfo] = useState<Record<string, unknown>>({})
  const [ataFields, setAtaFields] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [originalAtaFields, setOriginalAtaFields] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [ataSapReference, setAtaSapReference] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [ataIsEditing, setAtaIsEditing] = useState(false)
  const [activityLog, setActivityLog] = useState<ActivityLogRow[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [shipmentRemarks, setShipmentRemarks] = useState<ShipmentRemarkRow[]>([])
  const [shipmentRemarksLoading, setShipmentRemarksLoading] = useState(false)

  const [editContext, setEditContext] = useState<ShipmentEditContextData | null>(null)
  const [selectedAddPoOption, setSelectedAddPoOption] = useState<ShipmentPoOption | null>(null)
  const [addingPo, setAddingPo] = useState(false)
  const [editRemark, setEditRemark] = useState('')
  const [etaBaseline, setEtaBaseline] = useState<ShipmentEtaBaseline | null>(null)

  const initSessionRef = useRef<string | null>(null)

  const isQuantityUnlocked = hasUploadedSld || hasUploadedSdd
  const canModifyShipment = canEditShipment && !readOnly
  const canAddPoOnEdit =
    (canEditShipment || canAddShipment) &&
    !readOnly &&
    Boolean(shipmentId) &&
    editContext?.can_add_po === true

  const planQtyReadOnly = editContext?.has_sap_sto === true

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

  const totalShipmentPlanKg = useMemo(() => {
    let sum = 0
    for (const row of detailRows) {
      sum += planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0
    }
    return sum
  }, [detailRows, planQtyEdits])

  const poTableQtyTotals = useMemo(() => {
    let contractQty = 0
    let stoQty = 0
    let osQty = 0
    let osPlanQty = 0
    for (const row of detailRows) {
      contractQty += row.contract_qty ?? 0
      stoQty += row.sap_sto_qty ?? 0
      osQty += row.outstanding_qty_actual ?? 0
      osPlanQty += row.outstanding_qty_planning ?? 0
    }
    return { contractQty, stoQty, osQty, osPlanQty }
  }, [detailRows])

  const qtyTotals = useMemo(
    () => sumVesselPortsQuantityEdits(qtyTableRows, qtyEdits),
    [qtyTableRows, qtyEdits],
  )

  const loadingPortRows = useMemo(
    () =>
      loadingPorts
        .filter((p) => !p.is_discharge_port)
        .slice()
        .sort((a, b) => (a.port_sequence ?? 0) - (b.port_sequence ?? 0)),
    [loadingPorts],
  )

  const dischargePortRow = useMemo(
    () => loadingPorts.find((p) => p.is_discharge_port),
    [loadingPorts],
  )

  const etaBlockSnapshots: ShipmentEtaBlockSnapshot[] = useMemo(
    () =>
      etaBlocks.map((block) => ({
        portSequence: block.portSequence,
        status: block.status,
        isDraft: block.isDraft,
        fields: block.fields,
      })),
    [etaBlocks],
  )

  const hasQtyEdits = useMemo(
    () => hasVesselPortsQuantityUserEdits(qtyTableRows, qtyEdits),
    [qtyTableRows, qtyEdits],
  )

  const hasEtaEdits = useMemo(
    () =>
      hasShipmentEtaEdits(etaBaseline, {
        isMultiPortLoading,
        dischargeEta: dischargeEtaFields,
        etaBlocks: etaBlockSnapshots,
      }),
    [etaBaseline, isMultiPortLoading, dischargeEtaFields, etaBlockSnapshots],
  )

  const requiresEditRemark = hasEtaEdits || hasQtyEdits
  const editRemarkMissing = requiresEditRemark && !editRemark.trim()

  const capacityPct =
    vesselCapacityMt != null && vesselCapacityMt > 0
      ? Math.min(100, (totalShipmentPlanKg / 1000 / vesselCapacityMt) * 100)
      : 0

  const resetState = useCallback(() => {
    setShipmentId(null)
    setVesselName('')
    setOriginalVesselName('')
    setVesselMeta({})
    setDetailRows([])
    setPlanQtyEdits({})
    setQtyEdits({})
    setSfalQty(null)
    setSfbdQty(null)
    setEtaBlocks([])
    setDischargeEtaFields(emptyDischargeEtaFields())
    setEtaSectionEditing(false)
    setIsMultiPortLoading(false)
    setActivityLog([])
    setShipmentRemarks([])
    setShipmentRemarksLoading(false)
    setShipmentInfo({})
    setAtaFields(emptyAtaFields())
    setOriginalAtaFields(emptyAtaFields())
    setAtaSapReference(emptyAtaFields())
    setAtaIsEditing(false)
    setHasUploadedSld(false)
    setHasUploadedSdd(false)
    setShipmentStatus(null)
    setShipmentDocuments([])
    setDocsLoading(false)
    setEditContext(null)
    setSelectedAddPoOption(null)
    setAddingPo(false)
    setEditRemark('')
    setEtaBaseline(null)
    setPlantSiteName('')
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

  const loadShipmentDocuments = useCallback(async (sid: string) => {
    setDocsLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('shipmentId', sid)
      const res = await api.get(`/documents?${params.toString()}`)
      setShipmentDocuments(res.data?.data ?? [])
    } catch {
      setShipmentDocuments([])
    } finally {
      setDocsLoading(false)
    }
  }, [])

  const handleDownloadDocument = useCallback(async (docId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${docId}/download`, { responseType: 'blob' })
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch {
      setNotification({ type: 'error', message: 'Failed to download document. Please try again.' })
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

  const loadShipmentRemarks = useCallback(async (sid: string) => {
    setShipmentRemarksLoading(true)
    try {
      const res = await api.get(`/shipments/${sid}/remarks`)
      setShipmentRemarks(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch {
      setShipmentRemarks([])
    } finally {
      setShipmentRemarksLoading(false)
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
        let sid = directShipmentId?.trim() || ''
        if (!sid) {
          const listRes = await api.get('/shipments', {
            params: { contract: contractId, limit: 100, page: 1, compact: 'true' },
          })
          const shipments: Array<Record<string, unknown>> = listRes.data?.data?.shipments ?? []
          const first = shipments[0]
          if (!first?.id) throw new Error('No shipment found for this contract')
          sid = String(first.id)
        }

        const payloadRes = await api.get(`/shipments/${sid}/edit-payload`)
        const payload = payloadRes.data?.data as {
          shipment?: Record<string, unknown>
          editContext?: ShipmentEditContextData | null
          ports?: LoadingPortRef[]
          shipmentInfo?: Record<string, unknown> | null
          contractDetails?: Array<Record<string, unknown>>
        } | null
        if (!payload?.shipment) throw new Error('Failed to load shipment')

        const row = { ...payload.shipment, id: sid } as Record<string, unknown>
        const editContext = payload.editContext ?? null
        const ports: LoadingPortRef[] = payload.ports ?? []
        const info: Record<string, unknown> = payload.shipmentInfo ?? {}

        setShipmentId(sid)

        const contractNumbers = mergeContractNumberLists(
          editContractNumbers,
          editContext?.contract_numbers,
          row.contract_numbers as string | undefined,
          row.contract_number as string | undefined,
          contractId,
        )

        setShipmentStatus(String(row.status ?? info.status ?? '').trim() || null)
        setLoadingPorts(ports)
        setShipmentInfo(info)
        const loadedAta = ataFieldsFromShipmentInfo(info)
        setAtaFields(loadedAta)
        setOriginalAtaFields(loadedAta)
        setAtaSapReference(ataSapReferenceFromShipmentInfo(info))
        setAtaIsEditing(false)

        setEditContext(editContext)
        setSelectedAddPoOption(null)

        // Show the STO the user actually clicked in the list (preferredStoNumber = the row's
        // sto_key). The list keys a shipment by its numeric shipment_id when that differs from
        // the contract's sto_number, but the edit-payload derives sto_number from the contract —
        // so without this the modal would show a different STO than the clicked row.
        const preferredDisplaySto = resolveShipmentDisplayStoNumber(preferredStoNumber)
        const displaySto =
          preferredDisplaySto !== '-'
            ? preferredDisplaySto
            : resolveShipmentDisplayStoNumber(row.contract_sto_number ?? row.sto_number)

        const detailsData = Array.isArray(payload.contractDetails) ? payload.contractDetails : []
        let contractDetails = await buildContractDetailRows(
          detailsData,
          sid,
          contractNumbers,
          info,
        )

        const shipmentDeliveredKg = shipmentStoredQtyKg(parseApiNumber(info.quantity_delivered))
        const shipmentReceiveKg = shipmentStoredQtyKg(parseApiNumber(info.actual_vessel_qty_receive))
        contractDetails = mergeShipmentQtyOverridesOnContractRows(
          contractDetails,
          shipmentDeliveredKg,
          shipmentReceiveKg,
        )

        setDetailRows(contractDetails)
        setPlanQtyEdits(
          Object.fromEntries(
            contractDetails.map((detailRow) => [detailRow.rowKey, detailRow.shipment_plan_qty ?? 0]),
          ),
        )

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

        const loadingPortRows = ports
          .filter((p) => !p.is_discharge_port)
          .slice()
          .sort((a, b) => (a.port_sequence ?? 0) - (b.port_sequence ?? 0))

        const resolveValidPortLabel = (value: unknown): string => {
          const text = String(value ?? '').trim()
          return text && text !== '0.00' ? text : ''
        }
        const pol =
          resolveValidPortLabel(loadingPortRows[0]?.port_name) ||
          resolveValidPortLabel(info.vessel_loading_port_1) ||
          resolveValidPortLabel(row.port_of_loading)
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

        const dischargeEta = dischargeEtaFromInfo(info, row)
        setDischargeEtaFields(dischargeEta)

        const poLabels = contractDetails.map((d) => d.po_number || d.contract_number).filter(Boolean)
        const multiPort = loadingPortRows.length > 1
        setIsMultiPortLoading(multiPort)
        setEtaSectionEditing(false)

        if (multiPort) {
          const blocks: EtaBlock[] = loadingPortRows.map((portRow) => ({
            id: portRow.id || `port-${portRow.port_sequence ?? 1}`,
            portId: portRow.id,
            portSequence: portRow.port_sequence ?? 1,
            status: 'active' as const,
            loadingPort: resolveValidPortLabel(portRow.port_name) || `Loading Port ${portRow.port_sequence ?? 1}`,
            contractLabels: poLabels,
            fields: loadingEtaFromPortRow(portRow, info, row),
            isEditing: false,
          }))
          setEtaBlocks(blocks)
          setEtaBaseline(
            buildShipmentEtaBaseline({
              isMultiPortLoading: true,
              dischargeEta,
              etaBlocks: blocks,
            }),
          )
        } else {
          const loadingPortRow = loadingPortRows[0]

          const etaFields: EditEtaFields = {
            ...loadingEtaFromPortRow(loadingPortRow, info, row),
            ...dischargeEta,
          }

          const blocks: EtaBlock[] = [
            {
              id: `eta-active-${Date.now()}`,
              portId: loadingPortRow?.id,
              portSequence: loadingPortRow?.port_sequence ?? 1,
              status: 'active',
              loadingPort: pol,
              contractLabels: poLabels,
              fields: etaFields,
              isEditing: false,
            },
          ]
          setEtaBlocks(blocks)
          setEtaBaseline(
            buildShipmentEtaBaseline({
              isMultiPortLoading: false,
              dischargeEta,
              etaBlocks: blocks,
            }),
          )
        }
        setEditRemark('')

        const plantCode = String(row.plant_code ?? '').trim()
        const groupPlant = String(row.plant_site ?? '').trim()
        if (groupPlant && groupPlant !== 'Blank') {
          setPlantSiteName(groupPlant)
        } else if (plantCode) {
          setPlantSiteName(plantCode)
          void api
            .get('/master-plants', { params: { search: plantCode, limit: 20 } })
            .then((plantsRes) => {
              const items: Array<{ plant_code?: string; plant_name?: string; group_plant?: string }> =
                plantsRes?.data?.data?.items ?? []
              const match = items.find(
                (p) => String(p.plant_code ?? '').trim().toUpperCase() === plantCode.toUpperCase(),
              )
              const resolved =
                match?.group_plant?.trim() || match?.plant_name?.trim() || ''
              if (resolved) setPlantSiteName(resolved)
            })
            .catch(() => {})
        } else {
          setPlantSiteName('')
        }

        void (async () => {
          if (readOnly) {
            await loadShipmentDocuments(sid)
          } else {
            await hydrateQuantityDocs(sid)
          }
          void loadActivityLog(sid)
          void loadShipmentRemarks(sid)
        })()
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to load shipment'
        setNotification({ type: 'error', message: msg })
      } finally {
        setLoading(false)
      }
    },
    [hydrateQuantityDocs, loadActivityLog, loadShipmentRemarks, loadShipmentDocuments, editContractNumbers, readOnly],
  )

  const handleAddPo = useCallback(async () => {
    if (!shipmentId || !selectedAddPoOption) {
      setNotification({ type: 'error', message: 'Select a PO to add.' })
      return
    }

    setAddingPo(true)
    setNotification(null)
    try {
      await attachPurchaseOrderToShipment({
        shipmentId,
        contractRowId: selectedAddPoOption.key,
        stoQtyAssignedKg: 0,
      })
      setNotification({ type: 'success', message: 'PO added — set Shipment Plan Qty and save changes.' })
      const contractId = editContractId?.trim()
      const directId = editShipmentIdProp?.trim()
      const sto = editStoNumber?.trim()
      if (directId) {
        await loadShipment(contractId || directId, directId, sto)
      } else if (contractId) {
        await loadShipment(contractId, null, sto)
      }
      onShipmentChanged?.()
    } catch (error: unknown) {
      const axiosErr = error as {
        response?: { data?: { error?: { message?: string } } }
        message?: string
      }
      const msg =
        axiosErr.response?.data?.error?.message || axiosErr.message || 'Failed to add PO to shipment'
      setNotification({ type: 'error', message: msg })
    } finally {
      setAddingPo(false)
    }
  }, [
    editContractId,
    editShipmentIdProp,
    editStoNumber,
    loadShipment,
    onShipmentChanged,
    selectedAddPoOption,
    shipmentId,
  ])

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
    const activeBlock = isMultiPortLoading
      ? etaBlocks.find((b) => b.portSequence === 1) ?? etaBlocks[0]
      : etaBlocks.find((b) => b.status === 'active')
    if (!activeBlock) {
      setNotification({ type: 'error', message: 'No active Estimation block to save.' })
      return
    }

    const saveActiveEta: EditEtaFields = isMultiPortLoading
      ? {
          ...activeBlock.fields,
          ...dischargeEtaFields,
        }
      : activeBlock.fields

    if (requiresEditRemark && !editRemark.trim()) {
      setNotification({
        type: 'error',
        message: 'Remark is required when editing Estimation, Quantity Delivered, or Quantity Receive.',
      })
      return
    }

    setSaving(true)
    setNotification(null)
    try {
      if (!planQtyReadOnly && detailRows.length > 0) {
        await batchSaveShipmentPoPlanQty({
          shipmentId,
          rows: detailRows.map((row) => ({
            contractNumber: row.contract_number,
            poNumber: row.po_number || null,
            shipmentPlanQtyKg: planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0,
          })),
        })
      }

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
        activeEta: saveActiveEta,
        isMultiPortLoading,
        loadingPortEtas: isMultiPortLoading
          ? etaBlocks.map((block) => ({
              portId: block.portId,
              portSequence: block.portSequence,
              portName: block.loadingPort,
              fields: {
                etaVesselArrivalAtLoadingPort: block.fields.etaVesselArrivalAtLoadingPort,
                etaVesselBerthedAtLoadingPort: block.fields.etaVesselBerthedAtLoadingPort,
                etaVesselStartLoading: block.fields.etaVesselStartLoading,
                etaVesselCompletedLoading: block.fields.etaVesselCompletedLoading,
                etaVesselSailedFromLoadingPort: block.fields.etaVesselSailedFromLoadingPort,
              },
            }))
          : undefined,
        dischargeEta: isMultiPortLoading ? dischargeEtaFields : undefined,
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

      if (requiresEditRemark) {
        await saveShipmentEditRemark(shipmentId, editRemark)
      }

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
        eta_arrival: toApiDateOnly(saveActiveEta.etaVesselArrivalAtLoadingPort),
        eta_berthed: toApiDateOnly(saveActiveEta.etaVesselBerthedAtLoadingPort),
        eta_loading_start: toApiDateOnly(saveActiveEta.etaVesselStartLoading),
        eta_loading_complete: toApiDateOnly(saveActiveEta.etaVesselCompletedLoading),
        eta_sailed: toApiDateOnly(saveActiveEta.etaVesselSailedFromLoadingPort),
        eta_discharge_arrival: toApiDateOnly(saveActiveEta.etaVesselArriveAtDischargePort),
        eta_discharge_berthed: toApiDateOnly(saveActiveEta.etaVesselBerthedAtDischargePort),
        eta_discharge_start: toApiDateOnly(saveActiveEta.etaVesselStartDischarging),
        eta_discharge_complete: toApiDateOnly(saveActiveEta.etaVesselCompleteDischarge),
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
    if (isMultiPortLoading) return
    setEtaBlocks((prev) => {
      const active = prev.find((b) => b.status === 'active')
      if (!active || active.isDraft) return prev
      const historical = { ...active, status: 'historical' as const, isEditing: false, isDraft: false }
      const newActive: EtaBlock = {
        id: `eta-${Date.now()}`,
        portId: active.portId,
        portSequence: active.portSequence,
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

  const updateMultiPortEtaField = (blockId: string, key: keyof EditEtaFields, value: string) => {
    setEtaBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, fields: { ...b.fields, [key]: value } } : b)),
    )
  }

  const updateDischargeEtaField = (key: keyof DischargeEtaFields, value: string) => {
    setDischargeEtaFields((prev) => ({ ...prev, [key]: value }))
  }

  const openContractDetailFromPoRow = async (row: ShipmentDetailRow) => {
    const po = String(row.po_number || '').trim()
    const contractNumber = String(row.contract_number || '').trim()
    if (!po && !contractNumber) return
    setContractDetailLoading(true)
    try {
      const contract = await fetchContractForDetailModalByPo(po || contractNumber, contractNumber)
      if (contract) {
        setContractDetailTarget(contract)
      } else {
        setNotification({
          type: 'error',
          message: 'Contract details not found for this PO.',
        })
      }
    } finally {
      setContractDetailLoading(false)
    }
  }

  if (!open) return null

  const activeEtaBlock = etaBlocks.find((b) => b.status === 'active')
  const historicalEtaBlocks = etaBlocks.filter((b) => b.status === 'historical')

  return (
    <>
    <div
      className={
        stacked
          ? 'fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4'
          : VESSEL_MODAL_OVERLAY_CLASS
      }
    >
      <div className={VESSEL_MODAL_PANEL_CLASS}>
        <div className={VESSEL_MODAL_HEADER_CLASS}>
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">
                <Ship className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {readOnly ? 'View Shipment' : 'Edit Shipment'}
                  </h3>
                  {readOnly && (
                    <Badge className={shipmentStatusBadgeClass(shipmentStatus)}>
                      {formatShipmentStatusLabel(shipmentStatus)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {readOnly
                    ? stoNumber
                      ? `STO ${stoNumber} — read-only shipment execution details`
                      : 'Read-only view of shipment execution details'
                    : stoNumber
                      ? `STO ${stoNumber} — edit Estimation schedule and manual ATA (SAP reference preserved)`
                      : 'Update vessel, quantities, Estimation schedule, and manual ATA'}
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
                <ReadOnlyInfoField
                  className="md:col-span-2 lg:col-span-3"
                  label="Vessel Name"
                  value={vesselName}
                />
                {[
                  ['Vessel Code', vesselMeta.vessel_code],
                  ['Vessel Owner', vesselMeta.vessel_owner],
                  ['Vessel Capacity (MT)', vesselMeta.vessel_capacity],
                  ['Vessel Draft', vesselMeta.vessel_draft],
                  ['Hull Type', vesselMeta.vessel_hull_type],
                  ['Charter Type', vesselMeta.charter_type],
                  ['Discharge Port', vesselMeta.port_of_discharge],
                  ['Plant / Site', plantSiteName],
                ].map(([label, value]) => (
                  <ReadOnlyInfoField key={String(label)} label={String(label)} value={value} />
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ReadOnlyInfoField
                    label="STO Number"
                    value={formatSapDisplayValue(stoNumber)}
                  />
                  <ReadOnlyInfoField
                    label="Operation ID"
                    value={formatSapDisplayValue(operationId)}
                  />
                  {readOnly && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Shipment Status
                      </label>
                      <Badge className={shipmentStatusBadgeClass(shipmentStatus)}>
                        {formatShipmentStatusLabel(shipmentStatus)}
                      </Badge>
                    </div>
                  )}
                </div>

                {readOnly ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-600" />
                      <h5 className="text-sm font-semibold text-gray-800">Uploaded Documents</h5>
                    </div>
                    {docsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading documents…
                      </div>
                    ) : shipmentDocuments.length === 0 ? (
                      <p className="text-sm text-gray-500">No documents uploaded for this shipment.</p>
                    ) : (
                      <ul className="space-y-2">
                        {shipmentDocuments.map((doc) => (
                          <li
                            key={doc.id}
                            className="flex flex-col gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="text-[10px]">
                                  {doc.document_type || 'DOC'}
                                </Badge>
                                <span className="truncate text-sm font-medium text-gray-800">
                                  {doc.file_name}
                                </span>
                              </div>
                              {doc.created_at && (
                                <p className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                                  Uploaded {formatDateTimeDMY(doc.created_at)}
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 shrink-0 text-xs"
                              onClick={() => void handleDownloadDocument(doc.id, doc.file_name)}
                            >
                              <Download className="mr-1 h-3.5 w-3.5" />
                              Download
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
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
                )}
                {!readOnly && !isQuantityUnlocked && (
                  <p className="text-[11px] text-amber-800/80">
                    Delivered / Receive quantities stay locked until at least one of SLD or SDD is uploaded.
                  </p>
                )}

                {planQtyReadOnly && !readOnly && (
                  <p className="text-xs italic text-gray-500">
                    SAP STO shipment — Shipment Plan Qty is read-only. PO can still be added when global OS Qty (Plan) &gt; 0.
                  </p>
                )}

                {canAddPoOnEdit && shipmentId && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-gray-700">Add PO to shipment</label>
                      <span className="text-[10px] text-gray-500">Global OS Qty (Plan) &gt; 0</span>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          PO Number
                        </label>
                        <ShipmentPoSearchCombobox
                          shipmentId={shipmentId}
                          selected={selectedAddPoOption}
                          onSelect={setSelectedAddPoOption}
                          disabled={addingPo}
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 shrink-0 bg-blue-600 px-4 text-white hover:bg-blue-700"
                        disabled={!selectedAddPoOption || addingPo}
                        onClick={() => void handleAddPo()}
                      >
                        {addingPo ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Add PO
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs italic text-gray-500">
                      Search by PO, contract, supplier, or product (min. 2 characters). Set Shipment Plan Qty in the table, then Save Changes.
                    </p>
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>PO</TableHead>
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>Supplier</TableHead>
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>Product</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="Metric tons (1 MT = 1,000 kg)">Contract Qty (MT)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="SAP STO quantity">STO Qty (MT)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="Contract qty minus STO-scoped SAP receive/delivery (incoterm-aware) — same as Shipping Performance">OS Qty (MT)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="Global per PO — contract − SAP STO − all plans">OS Qty (Plan) (MT)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="KLIP plan on this STO">Shipment Plan Qty (MT)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Delivered Qty (MT)</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Receive Qty (MT)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailRows.map((row) => {
                        const qtyRow = qtyTableRows.find((r) => r.rowKey === row.rowKey)!
                        const deliveredKg = resolveRowQty(qtyRow, 'quantity_delivered')
                        const receiveKg = resolveRowQty(qtyRow, 'quantity_receive')
                        const planKg = planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0
                        return (
                          <TableRow key={row.rowKey}>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {String(row.po_number || row.contract_number || '').trim() ? (
                                <button
                                  type="button"
                                  className="text-left font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                  title="View contract details"
                                  disabled={contractDetailLoading}
                                  onClick={() => void openContractDetailFromPoRow(row)}
                                >
                                  {formatSapDisplayValue(row.po_number || row.contract_number)}
                                </button>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <span className="line-clamp-2 text-gray-600">{row.supplier || '—'}</span>
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <span className="line-clamp-2 text-gray-600">{row.product || '—'}</span>
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.contract_qty} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.sap_sto_qty} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.outstanding_qty_actual} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.outstanding_qty_planning} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {readOnly ? (
                                <MtQtyReadOnly valueKg={planKg} />
                              ) : (
                                <MtQtyInput
                                  valueKg={planKg}
                                  disabled={!canModifyShipment || planQtyReadOnly}
                                  onChange={(kg) =>
                                    setPlanQtyEdits((p) => ({ ...p, [row.rowKey]: kg ?? 0 }))
                                  }
                                />
                              )}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {readOnly ? (
                                <MtQtyReadOnly valueKg={deliveredKg} />
                              ) : (
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
                              )}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {readOnly ? (
                                <MtQtyReadOnly valueKg={receiveKg} />
                              ) : (
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
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow className={VESSEL_MODAL_TABLE_FOOTER_CLASS}>
                        <TableCell colSpan={3} className={VESSEL_MODAL_COMPACT_TD}>
                          Grand Total
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.contractQty} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.stoQty} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.osQty} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.osPlanQty} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={totalShipmentPlanKg} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={qtyTotals.quantity_delivered} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={qtyTotals.quantity_receive} />
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>

                {vesselCapacityMt != null && vesselCapacityMt > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-1 flex justify-between text-xs text-gray-600">
                      <span>Total Shipment Plan Qty vs vessel capacity</span>
                      <span className="tabular-nums">
                        {formatNumber(totalShipmentPlanKg / 1000)} / {formatNumber(vesselCapacityMt)} MT
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${Math.min(100, capacityPct)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {canModifyShipment ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">SFAL Qty (MT)</label>
                        <MtQtyInput valueKg={sfalQty} onChange={setSfalQty} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">SFBD Qty (MT)</label>
                        <MtQtyInput valueKg={sfbdQty} onChange={setSfbdQty} />
                      </div>
                    </>
                  ) : (
                    <>
                      <ReadOnlyInfoField
                        label="SFAL Qty (MT)"
                        value={sfalQty === null ? null : formatQtyMtFromKg(sfalQty)}
                      />
                      <ReadOnlyInfoField
                        label="SFBD Qty (MT)"
                        value={sfbdQty === null ? null : formatQtyMtFromKg(sfbdQty)}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: ETA + Loading Port */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={`${VESSEL_MODAL_SECTION_HEADER_CLASS} justify-between gap-2`}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100">
                    <Clock className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800">3. Estimation + Loading Port</h4>
                </div>
                {isMultiPortLoading && canModifyShipment && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEtaSectionEditing((v) => !v)}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    {etaSectionEditing ? 'Lock' : 'Edit'}
                  </Button>
                )}
              </div>
              <div className="space-y-4 p-4">
                {isMultiPortLoading ? (
                  <>
                    {etaBlocks.map((block) => (
                      <div key={block.id} className="rounded-lg border border-blue-100 bg-white p-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge className="bg-blue-600 text-white text-[10px]">
                            Loading Port {block.portSequence}
                          </Badge>
                          <span className="text-xs text-gray-600">{block.loadingPort || '—'}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                          {LOADING_ETA_FIELD_ROWS.map(({ key, label }) => (
                            <div key={`${block.id}-${key}`}>
                              <label className="mb-1 block text-[10px] font-medium text-gray-600">
                                {label}
                              </label>
                              {etaSectionEditing && canModifyShipment ? (
                                <DateInputDdMmYyyy
                                  valueIso={block.fields[key]}
                                  onChangeIso={(iso) => updateMultiPortEtaField(block.id, key, iso)}
                                  className="h-8 text-xs"
                                />
                              ) : (
                                <div className={`flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`}>
                                  {formatDateDMY(block.fields[key]) || '—'}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                      <div className="mb-3 flex items-center gap-2">
                        <Badge variant="outline" className="border-indigo-300 text-[10px] text-indigo-700">
                          Shared discharge Estimation
                        </Badge>
                        <span className="text-xs text-gray-600">
                          One vessel timeline — unloading is the same for all loading ports
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {DISCHARGE_ETA_FIELD_ROWS.map(({ key, label }) => (
                          <div key={key}>
                            <label className="mb-1 block text-[10px] font-medium text-gray-600">
                              {label}
                            </label>
                            {etaSectionEditing && canModifyShipment ? (
                              <DateInputDdMmYyyy
                                valueIso={dischargeEtaFields[key]}
                                onChangeIso={(iso) => updateDischargeEtaField(key, iso)}
                                className="h-8 text-xs"
                              />
                            ) : (
                              <div className={`flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`}>
                                {formatDateDMY(dischargeEtaFields[key]) || '—'}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
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
                        {activeEtaBlock.isDraft ? 'New Estimation' : 'Active Estimation'}
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
                        {activeEtaBlock.isEditing && canModifyShipment ? (
                          <Input
                            value={activeEtaBlock.loadingPort}
                            onChange={(e) =>
                              setEtaBlocks((prev) =>
                                prev.map((b) =>
                                  b.status === 'active' ? { ...b, loadingPort: e.target.value } : b,
                                ),
                              )
                            }
                            className="h-9 text-sm"
                          />
                        ) : (
                          <div className={`flex min-h-9 items-center ${ETA_INFO_VALUE_CLASS}`}>
                            {formatInfoDisplayValue(activeEtaBlock.loadingPort)}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Apply to PO</label>
                        <div className={`flex min-h-9 items-center ${ETA_INFO_VALUE_CLASS}`}>
                          {formatInfoDisplayValue(activeEtaBlock.contractLabels.join(', '))}
                        </div>
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
                        Previous Estimation (historical)
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
                  </>
                )}
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
              <div className="space-y-4 p-4">
                {isMultiPortLoading ? (
                  <>
                    {loadingPortRows.map((portRow) => {
                      const portAta = loadingAtaFromPortRow(portRow, shipmentInfo)
                      return (
                        <div
                          key={portRow.id || `ata-port-${portRow.port_sequence ?? 1}`}
                          className="rounded-lg border border-emerald-100 bg-white p-3"
                        >
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <Badge className="bg-emerald-600 text-white text-[10px]">
                              Loading Port {portRow.port_sequence ?? 1}
                            </Badge>
                            <span className="text-xs text-gray-600">{portRow.port_name || '—'}</span>
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {LOADING_ATA_FIELD_ROWS.map(({ key, label }) => (
                              <ReadOnlyInfoField
                                key={`${portRow.id ?? portRow.port_sequence}-${key}`}
                                compact
                                label={`ATA ${label}`}
                                value={formatDateDMY(
                                  portAta[key as keyof ReturnType<typeof loadingAtaFromPortRow>],
                                )}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    <div className="rounded-lg border border-emerald-100 bg-white p-3">
                      <p className="mb-3 text-[10px] font-medium text-gray-600">Discharge Port</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {DISCHARGE_ATA_FIELD_ROWS.map(({ key, label }) => {
                          const sapRef = ataSapReference[key]
                          const hasOverride = Boolean(
                            ataFields[key] && sapRef && ataFields[key] !== sapRef,
                          )
                          return (
                            <div key={key}>
                              {ataIsEditing && canModifyShipment ? (
                                <>
                                  <label className="mb-1 block text-[10px] font-medium text-gray-600">
                                    ATA {label}
                                  </label>
                                  <DateInputDdMmYyyy
                                    valueIso={ataFields[key]}
                                    onChangeIso={(iso) =>
                                      setAtaFields((prev) => ({ ...prev, [key]: iso }))
                                    }
                                    className="h-8 text-xs"
                                  />
                                </>
                              ) : (
                                <ReadOnlyInfoField
                                  compact
                                  label={`ATA ${label}`}
                                  value={formatDateDMY(ataFields[key])}
                                />
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
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {ATA_FIELD_ROWS.map(({ key, label }) => {
                      const sapRef = ataSapReference[key]
                      const hasOverride = Boolean(ataFields[key] && sapRef && ataFields[key] !== sapRef)
                      return (
                        <div key={key}>
                          {ataIsEditing && canModifyShipment ? (
                            <>
                              <label className="mb-1 block text-[10px] font-medium text-gray-600">
                                ATA {label}
                              </label>
                              <DateInputDdMmYyyy
                                valueIso={ataFields[key]}
                                onChangeIso={(iso) =>
                                  setAtaFields((prev) => ({ ...prev, [key]: iso }))
                                }
                                className="h-8 text-xs"
                              />
                            </>
                          ) : (
                            <ReadOnlyInfoField
                              compact
                              label={`ATA ${label}`}
                              value={formatDateDMY(ataFields[key])}
                            />
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
                )}
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
                {loadingPortRows.map((portRow) => (
                  <div
                    key={portRow.id || `quality-loading-${portRow.port_sequence ?? 1}`}
                    className="rounded-lg border border-violet-100 bg-white p-3"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {isMultiPortLoading ? (
                        <Badge className="bg-violet-600 text-white text-[10px]">
                          Loading Port {portRow.port_sequence ?? 1}
                        </Badge>
                      ) : null}
                      <span className="text-[10px] font-medium text-gray-600">Quality at Loading</span>
                      {isMultiPortLoading ? (
                        <span className="text-xs text-gray-600">{portRow.port_name || '—'}</span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {QUALITY_METRICS.map(({ portKey, label }) => (
                        <ReadOnlyInfoField
                          key={`${portRow.id ?? portRow.port_sequence}-${portKey}`}
                          compact
                          label={label}
                          value={formatNumber(
                            qualityMetricFromPort(
                              portRow,
                              portKey,
                              shipmentInfo,
                              `quality_at_loading_loc_${portRow.port_sequence ?? 1}_${portKey.replace('quality_', '')}`,
                            ),
                          )}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-violet-100 bg-white p-3">
                  <p className="mb-3 text-[10px] font-medium text-gray-600">Quality at Discharge</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {QUALITY_METRICS.map(({ portKey, label }) => (
                      <ReadOnlyInfoField
                        key={`discharge-${portKey}`}
                        compact
                        label={label}
                        value={formatNumber(
                          qualityMetricFromPort(
                            dischargePortRow,
                            portKey,
                            shipmentInfo,
                            `quality_at_discharge_loc_1_${portKey.replace('quality_', '')}`,
                          ),
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 6: Remarks */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100">
                  <MessageSquare className="h-3.5 w-3.5 text-amber-700" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">6. Remarks</h4>
              </div>
              <div className="p-4">
                {shipmentRemarksLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading remarks…
                  </div>
                ) : shipmentRemarks.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {readOnly
                      ? 'No remarks recorded for this shipment yet.'
                      : 'No remarks yet. A remark is required when you change Estimation, Quantity Delivered, or Quantity Receive.'}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {shipmentRemarks.map((remark) => (
                      <li
                        key={remark.id}
                        className="rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2.5"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">
                              {formatShipmentRemarkAuthor(remark)}
                            </span>
                            {formatShipmentRemarkCategory(remark.category) ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                                {formatShipmentRemarkCategory(remark.category)}
                              </span>
                            ) : null}
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums">
                            {remark.created_at ? formatDateTimeDMY(remark.created_at) : '—'}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">
                          {remark.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Section 7: Activity History */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={VESSEL_MODAL_SECTION_HEADER_CLASS}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100">
                  <History className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">7. Activity History</h4>
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

        <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4 flex flex-col gap-3 rounded-b-lg">
          {requiresEditRemark && canModifyShipment ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <label htmlFor="edit-shipment-remark" className="mb-1 block text-xs font-semibold text-amber-900">
                Remark <span className="text-red-600">*</span>
              </label>
              <textarea
                id="edit-shipment-remark"
                rows={2}
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                placeholder="Explain why Estimation or quantities were changed…"
                className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
              <p className="mt-1 text-[11px] text-amber-800">
                Required when changing Estimation, Quantity Delivered, or Quantity Receive.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly ? (
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => void handleSave()}
              disabled={saving || loading || !shipmentId || !canModifyShipment || editRemarkMissing}
              title={
                editRemarkMissing
                  ? 'Enter a remark before saving Estimation or quantity changes'
                  : undefined
              }
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
          ) : null}
          </div>
        </div>
      </div>
    </div>

    <ContractDetailModal
      contract={contractDetailTarget}
      onClose={() => setContractDetailTarget(null)}
      stacked
    />
    </>
  )
}
