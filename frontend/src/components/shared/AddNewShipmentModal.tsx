'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MasterVesselCombobox, type MasterVesselOption } from '@/components/MasterVesselCombobox'
import {
  AlertCircle,
  AlertTriangle,
  Anchor,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Info,
  Loader2,
  Plus,
  Ship,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import {
  areAllSelectionKeysCif,
  blockSelectionKeysAllCif,
  etaDetailHasAllRequiredDates as etaBlockHasAllRequiredDates,
  etaDetailHasAnyDate as etaBlockHasAnyDate,
  isEtaScheduleCompleteForCreate as isCreateEtaScheduleComplete,
} from '@/lib/addNewShipmentEtaRules'
import { formatDateDMY, toApiDateOnly, isIsoOutsideAllowedRange, OUTSIDE_ALLOWED_DATE_RANGE_MESSAGE } from '@/lib/dateFormat'
import { FAST_ENTRY_ROOT_ATTR, SHIPMENT_ETA_FAST_ENTRY_GROUP } from '@/lib/fastEntryFocus'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  usePermissions,
  canCreatePermission,
  canEditPermission,
} from '@/components/PermissionsContext'
import type {
  AddNewShipmentSubmitPayload,
  PrefilledVesselSnapshot,
  ShipmentPoOption,
  StoSapPreview,
} from '@/components/shared/addNewShipmentTypes'
import {
  fetchStoLinkedPurchaseOrderOptions,
  fetchStoSapPreview,
  formatPoPlantLabel,
  resolvePlotStoLookupKey,
  resolvePoPlantCode,
  buildQuantityDeliveredByContractKg,
} from '@/components/shared/addNewShipmentTypes'
import { EditShipmentModal } from '@/components/shared/EditShipmentModal'
import { ViewShipmentModal } from '@/components/shared/ViewShipmentModal'
import {
  ContractDetailModal,
  fetchContractForDetailModalByPo,
  type ContractDetailModalContract,
} from '@/components/contracts/ContractDetailModal'
import { AiKlipAgentButton } from '@/components/shared/AiKlipAgentButton'
import {
  suggestShipmentEta,
  suggestShipmentVessel,
} from '@/lib/shipmentAiPlanner'
import { classifyShipmentTransportMode } from '@/lib/shipmentTransportMode'
import {
  VESSEL_MODAL_BODY_CLASS,
  VESSEL_MODAL_FOOTER_CARD_CLASS,
  VESSEL_MODAL_HEADER_CLASS,
  VESSEL_MODAL_PANEL_CLASS,
  VESSEL_MODAL_STEP_STRIP_CLASS,
} from '@/lib/vesselModalUi'
import { charterTypeFromMasterTerms } from '@/lib/masterVesselTerms'
import {
  DECIMAL_DOT_HINT,
  blockCommaDecimalKeyDown,
  sanitizeDecimalDotInput,
} from '@/lib/decimalDotInput'

type EtaDetailFields = {
  loadingPort: string
  etaVesselArrivalAtLoadingPort: string
  etaVesselBerthedAtLoadingPort: string
  etaVesselStartLoading: string
  etaVesselCompletedLoading: string
  etaVesselSailedFromLoadingPort: string
  etaVesselArriveAtDischargePort: string
  etaVesselBerthedAtDischargePort: string
  etaVesselStartDischarging: string
  etaVesselCompleteDischarge: string
}

type ShipmentEtaDetail = { id: string; contractIds: string[] } & EtaDetailFields

function emptyEtaFields(): EtaDetailFields {
  return {
    loadingPort: '',
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

function createShipmentEtaDetail(contractIds: string[] = []): ShipmentEtaDetail {
  return {
    id: `eta-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    contractIds: [...contractIds],
    ...emptyEtaFields(),
  }
}

/** contractId → ETA block id that currently owns the PO selection */
function buildGlobalSelectedPoOwnerMap(etaDetails: ShipmentEtaDetail[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of etaDetails) {
    for (const cid of block.contractIds) {
      map.set(cid, block.id)
    }
  }
  return map
}

function getAvailablePosForEtaBlock(
  allContractIds: string[],
  blockId: string,
  etaDetails: ShipmentEtaDetail[],
): string[] {
  return allContractIds.filter(
    (cid) => !etaDetails.some((b) => b.id !== blockId && b.contractIds.includes(cid)),
  )
}

function etaDetailToApiPayload(d: EtaDetailFields) {
  return {
    port_of_loading: d.loadingPort || null,
    eta_arrival: d.etaVesselArrivalAtLoadingPort || null,
    eta_berthed: d.etaVesselBerthedAtLoadingPort || null,
    eta_loading_start: d.etaVesselStartLoading || null,
    eta_loading_complete: d.etaVesselCompletedLoading || null,
    eta_sailed: d.etaVesselSailedFromLoadingPort || null,
    eta_discharge_arrival: d.etaVesselArriveAtDischargePort || null,
    eta_discharge_berthed: d.etaVesselBerthedAtDischargePort || null,
    eta_discharge_start: d.etaVesselStartDischarging || null,
    eta_discharge_complete: d.etaVesselCompleteDischarge || null,
  }
}

const AUTOCOMPLETE_PANEL_CLASS =
  'absolute left-0 right-0 top-full z-[110] mt-1 max-h-52 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-xl ring-1 ring-black/5'

const ETA_FIELD_ROWS: {
  key: keyof EtaDetailFields
  label: string
  shortLabel: string
  errorSuffix: string
}[] = [
  { key: 'etaVesselArrivalAtLoadingPort', label: 'Estimation Vessel Arrival at Loading Port', shortLabel: 'Arr. @ LP', errorSuffix: 'arrival' },
  { key: 'etaVesselBerthedAtLoadingPort', label: 'Estimation Vessel Berthed at Loading Port', shortLabel: 'Berthed LP', errorSuffix: 'berthed' },
  { key: 'etaVesselStartLoading', label: 'Estimation Vessel Start Loading', shortLabel: 'Start Load', errorSuffix: 'startLoading' },
  { key: 'etaVesselCompletedLoading', label: 'Estimation Vessel Completed Loading', shortLabel: 'Done Load', errorSuffix: 'completedLoading' },
  { key: 'etaVesselSailedFromLoadingPort', label: 'Estimation Vessel Sailed from Loading Port', shortLabel: 'Sail LP', errorSuffix: 'sailed' },
  { key: 'etaVesselArriveAtDischargePort', label: 'Estimation Vessel Arrive at Discharge Port', shortLabel: 'Arr. @ DP', errorSuffix: 'arriveDischarge' },
  { key: 'etaVesselBerthedAtDischargePort', label: 'Estimation Vessel Berthed at Discharge Port', shortLabel: 'Berthed DP', errorSuffix: 'berthedDischarge' },
  { key: 'etaVesselStartDischarging', label: 'Estimation Vessel Start Discharging', shortLabel: 'Start Disch', errorSuffix: 'startDischarging' },
  { key: 'etaVesselCompleteDischarge', label: 'Estimation Vessel Complete Discharge', shortLabel: 'Done Disch', errorSuffix: 'completeDischarge' },
]

const ETA_FIELD_KEYS = ETA_FIELD_ROWS.map(({ key }) => key)

function etaDetailHasAnyDate(d: EtaDetailFields): boolean {
  return etaBlockHasAnyDate(d, ETA_FIELD_KEYS)
}

function etaDetailHasAllRequiredDates(d: EtaDetailFields): boolean {
  return etaBlockHasAllRequiredDates(d, ETA_FIELD_KEYS)
}

function isEtaScheduleCompleteForCreate(
  contractIds: string[],
  etaBlocks: ShipmentEtaDetail[],
  getIncoterm: (selectionKey: string) => string,
): boolean {
  return isCreateEtaScheduleComplete({
    contractIds,
    etaBlocks,
    etaFieldKeys: ETA_FIELD_KEYS,
    getIncoterm,
  })
}

const COMPACT_TH = 'h-8 px-2 py-1 text-[11px] font-semibold text-gray-600 whitespace-nowrap'
const COMPACT_TD = 'px-2 py-1.5 text-xs align-middle'
const COMPACT_DATE_INPUT = 'h-8 text-xs min-w-[7.25rem]'
const READONLY_FIELD_CLASS = 'bg-gray-50 cursor-not-allowed text-gray-600'

function sliceIsoDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

const ETA_DELIVERY_START_BUFFER_DAYS = 60
/** Allowed ETA/ATA dates may run up to this many days after due delivery end. */
const ETA_DELIVERY_END_BUFFER_DAYS = 180

function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatEtaAllowedRangeMessage(range: { minIso: string; maxIso: string }): string {
  return `Date must be between ${formatDateDMY(range.minIso)} (due delivery start − ${ETA_DELIVERY_START_BUFFER_DAYS} days) and ${formatDateDMY(range.maxIso)} (due delivery end + ${ETA_DELIVERY_END_BUFFER_DAYS} days)`
}

type VesselLoadingPortRow = {
  port_name?: string
  port_sequence?: number
  is_discharge_port?: boolean
  contract_number?: string
  eta_vessel_arrival?: string | null
  eta_vessel_berthed_at_loading_port?: string | null
  eta_vessel_berthed?: string | null
  eta_loading_start?: string | null
  eta_loading_completed?: string | null
  eta_vessel_sailed?: string | null
  eta_vessel_arrive_at_discharge_port?: string | null
  eta_vessel_berthed_at_discharge_port?: string | null
  eta_vessel_start_discharging?: string | null
  eta_vessel_complete_discharge?: string | null
}

function buildEtaDetailsFromGroupLoadingPorts(
  contractIds: string[],
  shipment: Record<string, unknown>,
  listRow: Record<string, unknown>,
  ports: VesselLoadingPortRow[],
): ShipmentEtaDetail[] {
  const loadingPorts = ports.filter((p) => p.is_discharge_port !== true)
  const portsByContract = new Map<string, VesselLoadingPortRow>()
  for (const port of loadingPorts) {
    const contractId = String(port.contract_number ?? '').trim()
    if (contractId) portsByContract.set(contractId, port)
  }

  if (portsByContract.size > 1 && contractIds.length > 1) {
    return contractIds.map((contractId) => {
      const block = createShipmentEtaDetail([contractId])
      applyShipmentEtaToBlock(
        block,
        shipment,
        listRow,
        portsByContract.get(contractId) ??
          loadingPorts.find((p) => !p.contract_number) ??
          loadingPorts[0] ??
          null,
      )
      return block
    })
  }

  const loadingPortRow =
    loadingPorts.find((p) => p.port_sequence === 1) ?? loadingPorts[0] ?? null
  const block = createShipmentEtaDetail([...contractIds])
  applyShipmentEtaToBlock(block, shipment, listRow, loadingPortRow)
  return [block]
}

function applyShipmentEtaToBlock(
  block: ShipmentEtaDetail,
  shipment: Record<string, unknown>,
  listRow: Record<string, unknown>,
  loadingPort?: VesselLoadingPortRow | null,
) {
  block.loadingPort = String(
    loadingPort?.port_name ?? shipment.port_of_loading ?? listRow.port_of_loading ?? block.loadingPort,
  )
  block.etaVesselArrivalAtLoadingPort =
    sliceIsoDate(loadingPort?.eta_vessel_arrival) ||
    sliceIsoDate((shipment.eta_arrival ?? listRow.eta_arrival) as string | undefined)
  block.etaVesselBerthedAtLoadingPort =
    sliceIsoDate(loadingPort?.eta_vessel_berthed_at_loading_port ?? loadingPort?.eta_vessel_berthed) ||
    sliceIsoDate((shipment.eta_berthed ?? listRow.eta_berthed) as string | undefined)
  block.etaVesselStartLoading =
    sliceIsoDate(loadingPort?.eta_loading_start) ||
    sliceIsoDate((shipment.eta_loading_start ?? listRow.eta_loading_start) as string | undefined)
  block.etaVesselCompletedLoading =
    sliceIsoDate(loadingPort?.eta_loading_completed) ||
    sliceIsoDate((shipment.eta_loading_complete ?? listRow.eta_loading_complete) as string | undefined)
  block.etaVesselSailedFromLoadingPort =
    sliceIsoDate(loadingPort?.eta_vessel_sailed) ||
    sliceIsoDate((shipment.eta_sailed ?? listRow.eta_sailed) as string | undefined)
  block.etaVesselArriveAtDischargePort =
    sliceIsoDate(loadingPort?.eta_vessel_arrive_at_discharge_port) ||
    sliceIsoDate((shipment.eta_discharge_arrival ?? listRow.eta_discharge_arrival) as string | undefined)
  block.etaVesselBerthedAtDischargePort =
    sliceIsoDate(loadingPort?.eta_vessel_berthed_at_discharge_port) ||
    sliceIsoDate((shipment.eta_discharge_berthed ?? listRow.eta_discharge_berthed) as string | undefined)
  block.etaVesselStartDischarging =
    sliceIsoDate(loadingPort?.eta_vessel_start_discharging) ||
    sliceIsoDate((shipment.eta_discharge_start ?? listRow.eta_discharge_start) as string | undefined)
  block.etaVesselCompleteDischarge =
    sliceIsoDate(loadingPort?.eta_vessel_complete_discharge) ||
    sliceIsoDate((shipment.eta_discharge_complete ?? listRow.eta_discharge_complete) as string | undefined)
}

const emptyShipment = () => ({
  operationId: '',
  stoNumber: '',
  contractNumbers: [] as string[],
  vesselName: '',
  vesselCode: '',
  vesselOwner: '',
  vesselDraft: '',
  vesselCapacity: '',
  vesselHullType: '',
  charterType: '',
  portOfLoading: '',
  portOfDischarge: '',
})

function applyPrefilledVesselToForm(
  base: ReturnType<typeof emptyShipment>,
  prefilled: PrefilledVesselSnapshot | null | undefined,
): ReturnType<typeof emptyShipment> {
  if (!prefilled) return base
  const capacity =
    prefilled.vesselCapacity != null && Number.isFinite(Number(prefilled.vesselCapacity))
      ? String(prefilled.vesselCapacity)
      : ''
  return {
    ...base,
    vesselName: prefilled.vesselName?.trim() || base.vesselName,
    vesselCode: prefilled.vesselCode?.trim() || base.vesselCode,
    vesselOwner: prefilled.vesselOwner?.trim() || base.vesselOwner,
    vesselCapacity: capacity || base.vesselCapacity,
    charterType: prefilled.charterType?.trim() || base.charterType,
    portOfLoading: prefilled.portOfLoading?.trim() || base.portOfLoading,
    portOfDischarge: prefilled.portOfDischarge?.trim() || base.portOfDischarge,
  }
}

function formatNumber(num: number | string) {
  if (num === null || num === undefined || num === '') return '-'
  const number = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(number)) return '-'
  if (number === 0) return '0'
  return number.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
}

/** DD/MM/YYYY for SAP delivery reference; explicit fallback when SAP has no date. */
function formatSapDeliveryDate(dateStr: string | null | undefined): string {
  if (dateStr == null || String(dateStr).trim() === '') return 'Not specified in SAP'
  const formatted = formatDateDMY(dateStr)
  return formatted === '-' ? 'Not specified in SAP' : formatted
}

function generateOperationId(contractId: string): string {
  return `OP-${contractId}-${Date.now().toString().slice(-8)}`
}

export type AddNewShipmentModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (payload: AddNewShipmentSubmitPayload) => Promise<void>
  prefilledPOs?: ShipmentPoOption[] | null
  /** STO from SAP when opening Add modal from an existing STO row (read-only display). */
  prefilledStoNumber?: string | null
  /** Contract numbers linked to the STO row (for async PO load inside modal). */
  prefilledContractNumbers?: string[] | null
  availablePOs?: ShipmentPoOption[] | null
  editContractId?: string | null
  /** When set (Shipments table edit), load this shipment directly instead of first match by contract. */
  editShipmentId?: string | null
  /** STO No shown on the Shipments table row — keeps modal aligned with grouped list display. */
  editStoNumber?: string | null
  /** Comma-separated contract numbers from grouped Shipments list row. */
  editContractNumbers?: string | null
  mode?: 'add' | 'edit'
  /** Unplanned SAP execution row — preload shipment shell and save via create/upsert. */
  plotShipmentId?: string | null
  /** Read-only edit/view (Shipments table — Cancelled rows). */
  readOnly?: boolean
  /** Raise z-index when opened above Contract Detail (z-50 / z-70). */
  stacked?: boolean
  /** Refresh Shipments list after Edit modal attaches a PO (without closing modal). */
  onShipmentChanged?: () => void
  /** When accepting a pre-planned group, link group on shipment create. */
  prePlannedGroupId?: string | null
  /** Vessel fields pre-filled when opening from Vessel Idle row action. */
  prefilledVessel?: PrefilledVesselSnapshot | null
}

export function AddNewShipmentModal({
  open,
  onClose,
  onSubmit,
  prefilledPOs = null,
  prefilledStoNumber = null,
  prefilledContractNumbers = null,
  availablePOs = null,
  editContractId = null,
  editShipmentId: editShipmentIdProp = null,
  editStoNumber = null,
  editContractNumbers = null,
  mode = 'add',
  plotShipmentId = null,
  readOnly = false,
  stacked = false,
  onShipmentChanged,
  prePlannedGroupId = null,
  prefilledVessel = null,
}: AddNewShipmentModalProps) {
  const perms = usePermissions()
  const canAddShipment = canCreatePermission(perms, 'data.shipments')
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canOpenAddShipmentModal = canAddShipment || canEditShipment
  const isEditMode = mode === 'edit'
  const isPlotMode = Boolean(plotShipmentId?.trim()) && !isEditMode
  const isContractScoped = !isEditMode && Array.isArray(availablePOs) && availablePOs.length > 0
  const openedFromContracts = isContractScoped || isEditMode

  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'warning'
    message: string
    detail?: string
  } | null>(null)
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notificationBannerRef = useRef<HTMLDivElement | null>(null)
  const showNotification = useCallback(
    (type: 'success' | 'error' | 'warning', message: string, detail?: string) => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current)
      setNotification({ type, message, detail })
      requestAnimationFrame(() => {
        notificationBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
      notifTimerRef.current = setTimeout(() => setNotification(null), 6000)
    },
    [],
  )

  const [saving, setSaving] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [loadingInitialData, setLoadingInitialData] = useState(false)
  const [internalPrefilledPOs, setInternalPrefilledPOs] = useState<ShipmentPoOption[] | null>(null)
  const [sapStoPreview, setSapStoPreview] = useState<StoSapPreview | null>(null)
  const [editShipmentId, setEditShipmentId] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [newShipment, setNewShipment] = useState(emptyShipment)
  const [qtyDeliveryKlipMtByKey, setQtyDeliveryKlipMtByKey] = useState<Record<string, string>>({})
  const [contractSuggestions, setContractSuggestions] = useState<any[]>([])
  const [contractSearchTerm, setContractSearchTerm] = useState('')
  const [showContractSuggestions, setShowContractSuggestions] = useState(false)
  const poNumberInputRef = useRef<HTMLInputElement>(null)
  const contractNumbersRef = useRef<string[]>([])
  const stoPrefillLoadedRef = useRef<string | null>(null)
  const initSessionRef = useRef<string | null>(null)
  const [contractValidations, setContractValidations] = useState<{
    [contractId: string]: {
      checking: boolean
      exists: boolean
      contractData: any
      message: string
    }
  }>({})
  const [etaDetails, setEtaDetails] = useState<ShipmentEtaDetail[]>([])
  const [aiVesselLoading, setAiVesselLoading] = useState(false)
  const [aiAppliedPatternContext, setAiAppliedPatternContext] = useState<{
    supplier: string
    buyer: string
    product: string
    incoterm: string
  } | null>(null)
  const [contractDetailTarget, setContractDetailTarget] =
    useState<ContractDetailModalContract | null>(null)
  const [contractDetailLoading, setContractDetailLoading] = useState(false)

  useEffect(() => {
    contractNumbersRef.current = newShipment.contractNumbers
  }, [newShipment.contractNumbers])

  const availablePoByKey = useMemo(() => {
    const map = new Map<string, ShipmentPoOption>()
    const source = prefilledPOs?.length ? prefilledPOs : internalPrefilledPOs ?? []
    for (const po of source) {
      map.set(po.key, po)
    }
    for (const po of availablePOs ?? []) {
      map.set(po.key, po)
    }
    return map
  }, [availablePOs, internalPrefilledPOs, prefilledPOs])

  const resolvedPrefilledPOs = useMemo(() => {
    if (prefilledPOs?.length) return prefilledPOs
    if (internalPrefilledPOs?.length) return internalPrefilledPOs
    return null
  }, [internalPrefilledPOs, prefilledPOs])

  const resolvedStoNumber = useMemo(
    () => newShipment.stoNumber.trim() || String(prefilledStoNumber ?? '').trim(),
    [newShipment.stoNumber, prefilledStoNumber],
  )

  const hasSapSto = useMemo(() => {
    if (sapStoPreview?.has_sap_sto) return true
    return Boolean(resolvedStoNumber) && /^\d+$/.test(resolvedStoNumber)
  }, [resolvedStoNumber, sapStoPreview?.has_sap_sto])

  const remainingContractScopedPos = useMemo(() => {
    if (!isContractScoped || !availablePOs) return []
    const added = new Set(newShipment.contractNumbers)
    return availablePOs.filter((po) => !added.has(po.key))
  }, [isContractScoped, availablePOs, newShipment.contractNumbers])

  const [vesselPickedFromMaster, setVesselPickedFromMaster] = useState(false)
  const [mappedPlantSiteName, setMappedPlantSiteName] = useState('')

  const formatShortDate = (dateStr: string) => formatDateDMY(dateStr)

  const resolveContractIdForKey = useCallback(
    (selectionKey: string): string => {
      const scoped = availablePoByKey.get(selectionKey)
      if (scoped) return scoped.contractId
      const data = contractValidations[selectionKey]?.contractData
      return String(data?.contract_id ?? selectionKey).trim()
    },
    [availablePoByKey, contractValidations],
  )

  const seedPoValidation = useCallback((option: ShipmentPoOption) => {
    setContractValidations((prev) => ({
      ...prev,
      [option.key]: {
        checking: false,
        exists: true,
        contractData: option.contractData ?? {
          contract_id: option.contractId,
          po_number: option.poNumber,
          plant_code: option.plantCode,
        },
        message: 'Contract found',
      },
    }))
  }, [])

  type ContractValidationResult = {
    selectionKey: string
    contractData: Record<string, unknown>
  }

  const validateContractNumber = useCallback(async (term: string): Promise<ContractValidationResult | null> => {
    if (!term || term.trim() === '') {
      setContractValidations((prev) => {
        const next = { ...prev }
        delete next[term]
        return next
      })
      return null
    }

    setContractValidations((prev) => {
      const next = { ...prev }
      next[term] = {
        checking: true,
        exists: false,
        contractData: null,
        message: 'Validating...',
      }
      return next
    })

    try {
      const response = await api.get(
        `/shipments/contracts/validate?contract_number=${encodeURIComponent(term)}`,
      )
      if (response.data.success) {
        if (response.data.exists) {
          const data = response.data.data
          const resolvedContractId = String(data?.contract_id || '').trim()
          if (!resolvedContractId) {
            setContractValidations((prev) => ({
              ...prev,
              [term]: {
                checking: false,
                exists: false,
                contractData: null,
                message: 'Contract not found',
              },
            }))
            return null
          }

          let selectionKey = resolvedContractId
          if (isContractScoped && availablePOs?.length) {
            const poNum = String(data?.po_number ?? term).trim()
            const scopedMatch =
              availablePOs.find((o) => o.key === resolvedContractId) ??
              availablePOs.find((o) => o.poNumber && o.poNumber === poNum) ??
              availablePOs.find((o) => o.contractId === resolvedContractId && (!poNum || o.poNumber === poNum))
            if (!scopedMatch) {
              setContractValidations((prev) => ({
                ...prev,
                [term]: {
                  checking: false,
                  exists: false,
                  contractData: null,
                  message: 'PO is not part of this contract',
                },
              }))
              return null
            }
            selectionKey = scopedMatch.key
            data.plant_code = data.plant_code ?? scopedMatch.plantCode
          }

          setContractValidations((prev) => {
            const next = { ...prev }
            if (term !== selectionKey) delete next[term]
            next[selectionKey] = {
              checking: false,
              exists: true,
              contractData: data,
              message: 'Contract found',
            }
            return next
          })
          setNewShipment((prev) => ({
            ...prev,
            portOfLoading: prev.portOfLoading || data.port_of_loading || '',
            portOfDischarge: prev.portOfDischarge || data.port_of_discharge || '',
          }))
          return { selectionKey, contractData: data as Record<string, unknown> }
        } else {
          setContractValidations((prev) => ({
            ...prev,
            [term]: {
              checking: false,
              exists: false,
              contractData: null,
              message: 'Contract number does not exist',
            },
          }))
          return null
        }
      }
    } catch (error) {
      console.error('Error validating contract:', error)
      setContractValidations((prev) => ({
        ...prev,
        [term]: {
          checking: false,
          exists: false,
          contractData: null,
          message: 'Error validating contract number',
        },
      }))
      return null
    }
    return null
  }, [isContractScoped, availablePOs])

  const handleContractSearch = async (searchTerm: string) => {
    setContractSearchTerm(searchTerm)

    if (isContractScoped && availablePOs) {
      const q = searchTerm.trim().toLowerCase()
      if (q.length < 1) {
        setContractSuggestions([])
        setShowContractSuggestions(false)
        return
      }
      const added = new Set(newShipment.contractNumbers)
      const filtered = availablePOs
        .filter((po) => !added.has(po.key))
        .filter(
          (po) =>
            po.label.toLowerCase().includes(q) ||
            String(po.poNumber ?? '').toLowerCase().includes(q) ||
            po.contractId.toLowerCase().includes(q),
        )
      setContractSuggestions(
        filtered.map((po) => ({
          contract_id: po.contractId,
          po_number: po.poNumber,
          supplier: po.contractData?.supplier,
          product: po.contractData?.product,
          _poKey: po.key,
        })),
      )
      setShowContractSuggestions(filtered.length > 0)
      return
    }

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

  const handleAddContract = async (contract: any) => {
    if (isContractScoped) {
      const poKey = String(contract._poKey ?? '').trim()
      const option = poKey ? availablePoByKey.get(poKey) : undefined
      if (option) {
        void addPoFromOption(option)
        return
      }
    }

    const contractId = String(contract.contract_id || contract).trim()
    if (!contractId) return

    const validated = await validateContractNumber(contractId)
    if (!validated) return

    addPoSelectionKey(
      validated.selectionKey,
      availablePoByKey.get(validated.selectionKey)?.contractId ?? validated.selectionKey,
    )
  }

  const handleAddContractManually = async () => {
    const term = contractSearchTerm.trim()
    if (!term) return

    const validated = await validateContractNumber(term)
    if (!validated) return

    addPoSelectionKey(
      validated.selectionKey,
      availablePoByKey.get(validated.selectionKey)?.contractId ?? validated.selectionKey,
    )
  }

  const handleRemoveContract = (contractId: string) => {
    setNewShipment((prev) => ({
      ...prev,
      contractNumbers: prev.contractNumbers.filter((id) => id !== contractId),
      operationId: prev.contractNumbers.filter((id) => id !== contractId).length > 0 ? prev.operationId : '',
    }))
    setQtyDeliveryKlipMtByKey((prev) => {
      const next = { ...prev }
      delete next[contractId]
      return next
    })
    setContractValidations((prev) => {
      const next = { ...prev }
      delete next[contractId]
      return next
    })
    setEtaDetails((prev) =>
      prev.map((b) => ({
        ...b,
        contractIds: b.contractIds.filter((id) => id !== contractId),
      })),
    )
  }

  const getPoLabel = useCallback(
    (selectionKey: string) => {
      const scoped = availablePoByKey.get(selectionKey)
      if (scoped) {
        return formatPoPlantLabel(
          String(scoped.poNumber || scoped.contractId || selectionKey),
          scoped.plantCode,
        )
      }
      const data = contractValidations[selectionKey]?.contractData
      const poNumber = String(data?.po_number || selectionKey)
      return formatPoPlantLabel(poNumber, resolvePoPlantCode(data ?? {}))
    },
    [availablePoByKey, contractValidations],
  )

  const getEtaDateRangeForContract = useCallback(
    (contractId: string) => {
      const data = contractValidations[contractId]?.contractData
      const deliveryStart = sliceIsoDate(data?.delivery_start_date as string | undefined)
      const deliveryEnd = sliceIsoDate(data?.delivery_end_date as string | undefined)
      if (!deliveryStart || !deliveryEnd) return null
      const minIso = shiftIsoDate(deliveryStart, -ETA_DELIVERY_START_BUFFER_DAYS)
      const maxIso = shiftIsoDate(deliveryEnd, ETA_DELIVERY_END_BUFFER_DAYS)
      if (minIso > maxIso) return null
      return { minIso, maxIso }
    },
    [contractValidations],
  )

  const getEtaDateRangeForContractIds = useCallback(
    (contractIds: string[]) => {
      let minIso: string | null = null
      let maxIso: string | null = null
      for (const cid of contractIds) {
        const r = getEtaDateRangeForContract(cid)
        if (!r) continue
        if (!minIso || r.minIso > minIso) minIso = r.minIso
        if (!maxIso || r.maxIso < maxIso) maxIso = r.maxIso
      }
      if (minIso && maxIso && minIso > maxIso) return null
      return minIso && maxIso ? { minIso, maxIso } : null
    },
    [getEtaDateRangeForContract],
  )

  const globalSelectedPoOwner = useMemo(
    () => buildGlobalSelectedPoOwnerMap(etaDetails),
    [etaDetails],
  )

  const addEtaDetailBlock = () => {
    setEtaDetails((prev) => [...prev, createShipmentEtaDetail()])
  }

  const togglePoForEtaBlock = (blockId: string, contractId: string) => {
    setEtaDetails((prev) => {
      const block = prev.find((b) => b.id === blockId)
      if (!block) return prev
      const selected = block.contractIds.includes(contractId)
      if (!selected) {
        const takenElsewhere = prev.some(
          (b) => b.id !== blockId && b.contractIds.includes(contractId),
        )
        if (takenElsewhere) return prev
      }
      return prev.map((b) => {
        if (b.id !== blockId) return b
        return {
          ...b,
          contractIds: selected
            ? b.contractIds.filter((id) => id !== contractId)
            : [...b.contractIds, contractId],
        }
      })
    })
    clearFieldError(`eta_${blockId}_contract`)
  }

  const setAllPosForEtaBlock = (blockId: string, selectAll: boolean) => {
    setEtaDetails((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b
        if (!selectAll) return { ...b, contractIds: [] }
        return {
          ...b,
          contractIds: getAvailablePosForEtaBlock(newShipment.contractNumbers, blockId, prev),
        }
      }),
    )
    clearFieldError(`eta_${blockId}_contract`)
  }

  const removeEtaDetailBlock = (id: string) => {
    setEtaDetails((prev) => prev.filter((b) => b.id !== id))
  }

  const updateEtaDetailBlock = (id: string, patch: Partial<ShipmentEtaDetail>) => {
    setEtaDetails((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  const applyMasterVessel = useCallback((v: MasterVesselOption) => {
    const charterFromTerms = charterTypeFromMasterTerms(v.terms)
    setNewShipment((prev) => ({
      ...prev,
      vesselName: v.vessel_name,
      vesselCode: v.vessel_code ?? '',
      vesselOwner: v.vessel_owner ?? '',
      vesselCapacity: v.vessel_capacity_mt != null ? String(v.vessel_capacity_mt) : '',
      vesselHullType: v.vessel_type ?? v.hull_type ?? '',
      charterType: charterFromTerms,
    }))
    setVesselPickedFromMaster(true)
    setFormErrors((prev) => {
      const next = { ...prev }
      delete next.vesselName
      if (charterFromTerms) delete next.charterType
      return next
    })
  }, [])

  const trySelectMasterVesselByName = useCallback(
    async (name: string): Promise<boolean> => {
      const wanted = name.trim().toUpperCase()
      if (wanted.length < 2) return false
      try {
        const res = await api.get('/master-vessels', { params: { search: name.trim(), limit: 20 } })
        const items = (res.data?.data?.items ?? []) as MasterVesselOption[]
        const match = items.find((item) => String(item.vessel_name ?? '').trim().toUpperCase() === wanted)
        if (!match) return false
        applyMasterVessel(match)
        return true
      } catch {
        return false
      }
    },
    [applyMasterVessel],
  )

  const resolveContractDataForSelectionKey = useCallback(
    (selectionKey: string) => {
      const direct = contractValidations[selectionKey]?.contractData
      if (direct) return direct

      const scoped = availablePoByKey.get(selectionKey)?.contractData
      if (scoped) return scoped

      const keyTrim = String(selectionKey).trim()
      for (const validation of Object.values(contractValidations)) {
        const data = validation?.contractData
        if (!data) continue
        const contractId = String(data.contract_id ?? '').trim()
        const poNumber = String(data.po_number ?? '').trim()
        if (contractId === keyTrim || poNumber === keyTrim) return data
      }

      return null
    },
    [availablePoByKey, contractValidations],
  )

  const firstSapPortFromKeys = useCallback(
    (keys: string[], field: 'port_of_loading' | 'port_of_discharge'): string => {
      for (const key of keys) {
        const value = String(resolveContractDataForSelectionKey(key)?.[field] ?? '').trim()
        if (value) return value
      }
      return ''
    },
    [resolveContractDataForSelectionKey],
  )

  const resolveSelectionIncoterm = useCallback(
    (selectionKey: string) =>
      String(resolveContractDataForSelectionKey(selectionKey)?.incoterm ?? '').trim().toUpperCase(),
    [resolveContractDataForSelectionKey],
  )

  const allSelectedPoCif = useMemo(
    () => areAllSelectionKeysCif(newShipment.contractNumbers, resolveSelectionIncoterm),
    [newShipment.contractNumbers, resolveSelectionIncoterm],
  )

  /**
   * SEA / MIX → show Estimation (ETA) fields.
   * LAND → hide (trucking module).
   * Missing transport_mode with PO(s) already selected → default SEA (same as shipment SQL COALESCE).
   */
  const selectedTransportMode = useMemo(() => {
    const modes = newShipment.contractNumbers
      .map((id) =>
        classifyShipmentTransportMode(
          resolveContractDataForSelectionKey(id)?.transport_mode as string | null | undefined,
        ),
      )
      .filter((m): m is 'land' | 'sea' | 'mixed' => m != null)
    if (modes.length === 0) {
      // Backend shipment eligibility defaults blank transport_mode to SEA.
      return newShipment.contractNumbers.length > 0 ? 'sea' : null
    }
    if (modes.every((m) => m === 'land')) return 'land'
    if (modes.every((m) => m === 'sea')) return 'sea'
    return 'mixed'
  }, [newShipment.contractNumbers, resolveContractDataForSelectionKey])

  const getPoContractExtNo = useCallback(
    (selectionKey: string) => {
      const data = resolveContractDataForSelectionKey(selectionKey)
      return String(data?.contract_ext_no ?? '').trim()
    },
    [resolveContractDataForSelectionKey],
  )

  const resolvedPlantCode = useMemo(() => {
    for (const selectionKey of newShipment.contractNumbers) {
      const data = resolveContractDataForSelectionKey(selectionKey)
      const plantCode = String(data?.plant_code ?? '').trim()
      if (plantCode) return plantCode

      const scopedPlant = String(availablePoByKey.get(selectionKey)?.plantCode ?? '').trim()
      if (scopedPlant) return scopedPlant
    }
    return ''
  }, [availablePoByKey, newShipment.contractNumbers, resolveContractDataForSelectionKey])

  const resolvedPlantSiteLabel = useMemo(() => {
    for (const selectionKey of newShipment.contractNumbers) {
      const data = resolveContractDataForSelectionKey(selectionKey)
      const site = String(data?.plant_site ?? '').trim()
      if (site && site !== 'Blank') return site
    }
    return ''
  }, [newShipment.contractNumbers, resolveContractDataForSelectionKey])

  useEffect(() => {
    if (resolvedPlantSiteLabel) {
      setMappedPlantSiteName(resolvedPlantSiteLabel)
      return
    }
    if (!resolvedPlantCode) {
      setMappedPlantSiteName('')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get('/master-plants', { params: { search: resolvedPlantCode, limit: 50 } })
        const items: Array<{ plant_code?: string; group_plant?: string | null }> =
          res.data?.data?.items ?? []
        const codeUpper = resolvedPlantCode.toUpperCase()
        const match = items.find((p) => String(p.plant_code ?? '').trim().toUpperCase() === codeUpper)
        const groupPlant = String(match?.group_plant ?? '').trim()
        if (!cancelled) {
          setMappedPlantSiteName(groupPlant && groupPlant !== 'Blank' ? groupPlant : '')
        }
      } catch {
        if (!cancelled) setMappedPlantSiteName('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolvedPlantCode, resolvedPlantSiteLabel])

  const clearFieldError = (field: string) =>
    setFormErrors((prev) => { const next = { ...prev }; delete next[field]; return next })

  const fetchContractDetailsByTerm = useCallback(async (term: string) => {
    const trimmed = String(term ?? '').trim()
    if (!trimmed) return null
    try {
      const response = await api.get(
        `/shipments/contracts/validate?contract_number=${encodeURIComponent(trimmed)}`,
      )
      if (response.data?.success && response.data?.exists) {
        return response.data.data as Record<string, unknown>
      }
    } catch (error) {
      console.error('Error fetching contract details for AI planner:', error)
    }
    return null
  }, [])

  const resolvePrimaryContractData = useCallback(() => {
    for (const key of newShipment.contractNumbers) {
      const data = resolveContractDataForSelectionKey(key)
      if (data?.supplier && data?.buyer && data?.product) return data
    }
    const firstKey = newShipment.contractNumbers[0]
    return firstKey ? resolveContractDataForSelectionKey(firstKey) : null
  }, [newShipment.contractNumbers, resolveContractDataForSelectionKey])

  const aiPlannerContextLabel = useMemo(() => {
    const data = resolvePrimaryContractData()
    if (!data) return null
    const supplier = String(data.supplier ?? '').trim()
    const buyer = String(data.buyer ?? '').trim()
    const product = String(data.product ?? '').trim()
    const incoterm = String(data.incoterm ?? '').trim()
    if (!supplier && !buyer && !product) return null
    return { supplier, buyer, product, incoterm }
  }, [newShipment.contractNumbers, resolvePrimaryContractData, contractValidations, availablePoByKey])

  const renderAiPatternDimensionList = (
    ctx: { supplier: string; buyer: string; product: string; incoterm: string },
  ) => {
    const items: Array<{ label: string; value: string }> = [
      { label: 'Buyer', value: ctx.buyer },
      { label: 'Product', value: ctx.product },
      { label: 'Supplier', value: ctx.supplier },
      { label: 'Incoterm', value: ctx.incoterm },
    ].filter((item) => item.value)

    if (items.length === 0) return null

    return (
      <>
        {items.map((item, index) => (
          <span key={item.label}>
            {index > 0 && (index === items.length - 1 ? ', and ' : ', ')}
            {item.label}{' '}
            <span className="font-medium text-gray-800">{item.value}</span>
          </span>
        ))}
      </>
    )
  }

  const resolveAiPlannerDimensions = useCallback(
    async (contractData: Record<string, unknown> | null, selectionKey?: string) => {
      const pick = (...keys: string[]) => {
        for (const key of keys) {
          const value = contractData?.[key]
          if (value != null && String(value).trim() !== '') return String(value).trim()
        }
        return ''
      }

      let supplier = pick('supplier')
      let buyer = pick('buyer')
      let product = pick('product')
      let incoterm = pick('incoterm')

      if (!supplier || !buyer || !product) {
        const scopedPo = selectionKey ? availablePoByKey.get(selectionKey) : undefined
        const lookupTerm =
          pick('po_number', 'contract_id') ||
          String(scopedPo?.poNumber ?? '').trim() ||
          String(scopedPo?.contractId ?? '').trim() ||
          (selectionKey ? String(selectionKey).trim() : '') ||
          newShipment.contractNumbers[0] ||
          ''
        const enriched = lookupTerm ? await fetchContractDetailsByTerm(lookupTerm) : null
        if (enriched) {
          supplier = supplier || String(enriched.supplier ?? '').trim()
          buyer = buyer || String(enriched.buyer ?? '').trim()
          product = product || String(enriched.product ?? '').trim()
          incoterm = incoterm || String(enriched.incoterm ?? '').trim()
        }
      }

      return { supplier, buyer, product, incoterm }
    },
    [availablePoByKey, fetchContractDetailsByTerm, newShipment.contractNumbers],
  )

  const handleAiSuggestVessel = useCallback(async () => {
    const firstKey = newShipment.contractNumbers[0]
    if (!firstKey) {
      showNotification('warning', 'Add a contract first', 'Add at least one PO in Section 1.')
      return
    }

    const contractData = resolvePrimaryContractData()
    const { supplier, buyer, product, incoterm } = await resolveAiPlannerDimensions(
      contractData as Record<string, unknown> | null,
      firstKey,
    )

    if (!supplier || !buyer || !product) {
      showNotification(
        'warning',
        'Contract details incomplete',
        'Could not resolve supplier, buyer, and product for the selected PO. Try removing and re-adding the PO.',
      )
      return
    }

    setAiVesselLoading(true)
    try {
      const vesselResult = await suggestShipmentVessel({
        supplier_id: supplier,
        buyer_id: buyer,
        product_id: product,
        incoterm,
      })

      const loadingPort = String(contractData?.port_of_loading ?? '').trim() || newShipment.portOfLoading.trim()
      const dischargePort =
        String(contractData?.port_of_discharge ?? '').trim() || newShipment.portOfDischarge.trim()
      const vesselName = (vesselResult.suggested_vessel_name || '').trim()
      setNewShipment((prev) => ({
        ...prev,
        portOfDischarge: dischargePort || prev.portOfDischarge,
        portOfLoading: loadingPort || prev.portOfLoading,
      }))
      if (vesselName) {
        const matched = await trySelectMasterVesselByName(vesselName)
        if (!matched) {
          setVesselPickedFromMaster(false)
        }
      }
      clearFieldError('charterType')
      clearFieldError('portOfDischarge')

      const appliedPattern = { supplier, buyer, product, incoterm }
      setAiAppliedPatternContext(appliedPattern)

      const vesselSourceLabel =
        vesselResult.source === 'SAP_HISTORICAL' ? 'SAP history' : 'Claude AI'
      const vesselCached = vesselResult.cached ? ' (cached)' : ''
      const charterPart = newShipment.charterType
        ? ` Charter type: ${newShipment.charterType}.`
        : ''

      const blocksToUpdate =
        etaDetails.length > 0
          ? etaDetails
          : [createShipmentEtaDetail([...newShipment.contractNumbers])]

      if (etaDetails.length === 0) {
        setEtaDetails(blocksToUpdate)
      }

      const finalVesselName = vesselName || newShipment.vesselName.trim()
      const finalLoadingPort = loadingPort
      const finalDischargePort = dischargePort || newShipment.portOfDischarge.trim()

      if (!finalVesselName || !finalLoadingPort || !finalDischargePort) {
        showNotification(
          'success',
          'Partial AI suggestion applied',
          `${vesselSourceLabel}${vesselCached}.${charterPart} Vessel and ports updated where available; complete missing ports to calculate Estimation.`,
        )
        return
      }

      let etaApplied = 0
      let etaSourceLabel: string | null = null
      let transitDays: number | null = null
      let etaErrorMessage: string | null = null

      for (const block of blocksToUpdate) {
        const loadingDate =
          toApiDateOnly(block.etaVesselArrivalAtLoadingPort) ||
          sliceIsoDate(contractData?.delivery_start_date as string | undefined) ||
          new Date().toISOString().slice(0, 10)

        try {
          const etaResult = await suggestShipmentEta({
            vessel_name: finalVesselName,
            loading_port: finalLoadingPort,
            discharge_port: finalDischargePort,
            loading_date: loadingDate,
          })
          updateEtaDetailBlock(block.id, {
            loadingPort: finalLoadingPort,
            ...etaResult.milestones,
          })
          const prefix = `eta_${block.id}`
          clearFieldError(`${prefix}_loadingPort`)
          clearFieldError(`${prefix}_arrival`)
          clearFieldError(`${prefix}_berthed`)
          clearFieldError(`${prefix}_startLoading`)
          clearFieldError(`${prefix}_completedLoading`)
          clearFieldError(`${prefix}_sailed`)
          clearFieldError(`${prefix}_arriveDischarge`)
          clearFieldError(`${prefix}_berthedDischarge`)
          clearFieldError(`${prefix}_startDischarging`)
          clearFieldError(`${prefix}_completeDischarge`)
          etaApplied += 1
          etaSourceLabel = etaResult.source === 'SAP_HISTORICAL' ? 'SAP history' : 'Claude AI'
          transitDays = etaResult.avg_transit_days
        } catch (error) {
          updateEtaDetailBlock(block.id, { loadingPort: finalLoadingPort })
          clearFieldError(`eta_${block.id}_loadingPort`)
          etaErrorMessage =
            error instanceof Error ? error.message : 'AI Estimation suggestion failed'
        }
      }

      if (etaApplied > 0) {
        const etaPart =
          transitDays != null
            ? ` Estimation from ${etaSourceLabel} (~${transitDays} days transit) applied to ${etaApplied} schedule(s).`
            : ` Estimation applied to ${etaApplied} schedule(s).`
        showNotification(
          'success',
          'AI shipment plan applied',
          `Vessel from ${vesselSourceLabel}${vesselCached};${charterPart} loading & discharge ports from SAP.${etaPart}`,
        )
      } else if (etaErrorMessage) {
        showNotification(
          'warning',
          'Vessel applied; Estimation unavailable',
          `${vesselSourceLabel}${vesselCached}. Loading port set but Estimation could not be calculated: ${etaErrorMessage}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI suggestion failed'
      showNotification('warning', 'AI suggestion unavailable', `${message}. Please fill fields manually.`)
    } finally {
      setAiVesselLoading(false)
    }
  }, [
    etaDetails,
    newShipment.contractNumbers,
    newShipment.portOfDischarge,
    newShipment.portOfLoading,
    newShipment.vesselName,
    resolveAiPlannerDimensions,
    resolvePrimaryContractData,
    showNotification,
    trySelectMasterVesselByName,
    updateEtaDetailBlock,
  ])

  const clearPoNumberField = useCallback(() => {
    setContractSearchTerm('')
    setContractSuggestions([])
    setShowContractSuggestions(false)
    requestAnimationFrame(() => {
      poNumberInputRef.current?.focus()
    })
  }, [])

  const addPoSelectionKey = useCallback(
    (selectionKey: string, contractIdForOp: string): boolean => {
      if (contractNumbersRef.current.includes(selectionKey)) {
        showNotification('warning', 'This PO has already been added.')
        setShowContractSuggestions(false)
        return false
      }

      setNewShipment((prev) => {
        const isFirstContract = prev.contractNumbers.length === 0
        return {
          ...prev,
          contractNumbers: [...prev.contractNumbers, selectionKey],
          operationId: isFirstContract ? generateOperationId(contractIdForOp) : prev.operationId,
        }
      })

      clearFieldError('contractNumbers')
      clearPoNumberField()
      setShowContractSuggestions(false)
      return true
    },
    [clearPoNumberField, showNotification],
  )

  const addPoFromOption = useCallback(
    async (option: ShipmentPoOption): Promise<boolean> => {
      const term = String(option.poNumber || option.contractId || '').trim()
      if (term) {
        const validated = await validateContractNumber(term)
        if (validated) {
          setContractValidations((prev) => ({
            ...prev,
            [option.key]: {
              checking: false,
              exists: true,
              contractData: {
                ...validated.contractData,
                plant_code: validated.contractData.plant_code ?? option.plantCode,
              },
              message: 'Contract found',
            },
          }))
        } else {
          seedPoValidation(option)
        }
      } else {
        seedPoValidation(option)
      }
      return addPoSelectionKey(option.key, option.contractId)
    },
    [addPoSelectionKey, seedPoValidation, validateContractNumber],
  )

  const resetForm = useCallback(() => {
    setNewShipment(emptyShipment())
    contractNumbersRef.current = []
    setContractValidations({})
    setQtyDeliveryKlipMtByKey({})
    setEtaDetails([])
    setContractSearchTerm('')
    setContractSuggestions([])
    setShowContractSuggestions(false)
    setVesselPickedFromMaster(false)
    setMappedPlantSiteName('')
    setAiAppliedPatternContext(null)
    setFormErrors({})
    setEditShipmentId(null)
    setLoadingEdit(false)
    setLoadingInitialData(false)
    setInternalPrefilledPOs(null)
    setSapStoPreview(null)
  }, [])

  const hydrateShipmentEditForm = useCallback(
    async (
      shipmentId: string,
      row: Record<string, unknown>,
      contractIdFallback: string,
    ) => {
      setEditShipmentId(shipmentId)

      const detailRes = await api.get(`/shipments/${shipmentId}`)
      const shipment = (detailRes.data?.data ?? row) as Record<string, unknown>

      /*
       * Edit Shipment is a STO-level view, not a contract-level one.
       *
       * The seed below is whatever the caller happened to have: opened from a list row it is that
       * row's `contract_numbers` (the whole STO group), but opened by id it is the detail
       * endpoint's `contract_number` - a SINGLE contract, because getShipmentById returns one.
       * The form then listed the POs of that one contract while the view table listed the STO's,
       * which is the mismatch users reported.
       *
       * So the STO decides. /shipments/contracts/details?sto= already answers exactly that
       * question. Its contract numbers are merged into the list the form renders, so the same
       * STO yields the same POs however the modal was opened. The seed is kept ahead of them
       * so an explicitly passed group keeps its order.
       */
      const contractNumbersRaw = String(
        row.contract_numbers ?? shipment.contract_number ?? contractIdFallback,
      )
      const seededContractIds = contractNumbersRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const assignmentKey =
        String(shipment.sto_number ?? row.sto_number ?? '').trim() ||
        String(shipment.operation_id ?? row.operation_id ?? '').trim()

      const stoContractIds: string[] = []

      if (assignmentKey) {
        try {
          const detailsRes = await api.get('/shipments/contracts/details', {
            params: {
              sto: assignmentKey,
              contractNumbers: '',
            },
          })
          if (detailsRes.data?.success && Array.isArray(detailsRes.data.data)) {
            for (const detail of detailsRes.data.data as Array<{
              contract_number?: string
            }>) {
              const cn = String(detail.contract_number ?? '').trim()
              if (cn) stoContractIds.push(cn)
            }
          }
        } catch {
          // Read-only display fallback: keep the seeded contracts if the STO lookup fails.
        }
      }

      const mergedContractIds = Array.from(new Set([...seededContractIds, ...stoContractIds]))
      const uniqueContractIds =
        mergedContractIds.length > 0 ? mergedContractIds : [contractIdFallback]

      for (const cid of uniqueContractIds) {
        await validateContractNumber(cid)
      }

      let loadingPorts: VesselLoadingPortRow[] = []
      try {
        const portsRes = await api.get(`/shipments/${shipmentId}/loading-ports`)
        loadingPorts = portsRes.data?.data?.ports ?? []
      } catch {
        // Shipment-level ETA fields are used when loading ports are unavailable
      }

      setNewShipment({
        operationId: String(shipment.operation_id ?? row.operation_id ?? ''),
        stoNumber: String(shipment.sto_number ?? row.sto_number ?? ''),
        contractNumbers: uniqueContractIds,
        vesselName: String(shipment.vessel_name ?? row.vessel_name ?? ''),
        vesselCode: String(shipment.vessel_code ?? row.vessel_code ?? ''),
        vesselOwner: String(shipment.vessel_owner ?? row.vessel_owner ?? ''),
        vesselDraft: String(shipment.vessel_draft ?? row.vessel_draft ?? ''),
        vesselCapacity: String(shipment.vessel_capacity ?? row.vessel_capacity ?? ''),
        vesselHullType: String(shipment.vessel_hull_type ?? row.vessel_hull_type ?? ''),
        charterType: String(shipment.charter_type ?? row.charter_type ?? ''),
        portOfLoading: String(shipment.port_of_loading ?? row.port_of_loading ?? ''),
        portOfDischarge: String(shipment.port_of_discharge ?? row.port_of_discharge ?? ''),
      })

      setEtaDetails(
        buildEtaDetailsFromGroupLoadingPorts(uniqueContractIds, shipment, row, loadingPorts),
      )
      return { assignmentKey }
    },
    [validateContractNumber],
  )

  const applyStoLinkedPoOptionsToForm = useCallback(
    (
      poSource: ShipmentPoOption[],
      opts?: {
        preserveOperationId?: boolean
      },
    ) => {
      const seenPoKeys = new Set<string>()
      const uniquePrefilled = poSource.filter((po) => {
        const dedupeKey = `${po.contractId}::${po.poNumber ?? ''}`
        if (seenPoKeys.has(dedupeKey)) return false
        seenPoKeys.add(dedupeKey)
        return true
      })
      if (uniquePrefilled.length === 0) return

      const keys = uniquePrefilled.map((po) => po.key)
      const validations: typeof contractValidations = {}

      for (const po of uniquePrefilled) {
        validations[po.key] = {
          checking: false,
          exists: true,
          contractData: po.contractData ?? {
            contract_id: po.contractId,
            po_number: po.poNumber,
            plant_code: po.plantCode,
          },
          message: 'Contract found',
        }
      }

      setContractValidations(validations)
      contractNumbersRef.current = keys
      setNewShipment((prev) => ({
        ...prev,
        contractNumbers: keys,
        operationId: opts?.preserveOperationId
          ? prev.operationId
          : prev.operationId || generateOperationId(uniquePrefilled[0].contractId),
        stoNumber: String(prefilledStoNumber ?? prev.stoNumber ?? '').trim() || prev.stoNumber,
        portOfDischarge: prev.portOfDischarge.trim() || sapStoPreview?.port_of_discharge || '',
      }))
      setEtaDetails([createShipmentEtaDetail([...keys])])
    },
    [prefilledStoNumber, sapStoPreview?.port_of_discharge, sapStoPreview?.vessel_name],
  )

  const loadShipmentForEdit = useCallback(
    async (contractId: string) => {
      setLoadingEdit(true)
      setEditShipmentId(null)
      try {
        const listRes = await api.get('/shipments', {
          params: { contract: contractId, limit: 100, page: 1, compact: 'true' },
        })
        const shipments: Array<Record<string, unknown>> = listRes.data?.data?.shipments ?? []
        const row = shipments[0]
        if (!row?.id) {
          showNotification('error', 'No shipment found for this contract')
          return
        }
        await hydrateShipmentEditForm(String(row.id), row, contractId)
      } catch (error) {
        console.error('Failed to load shipment for edit:', error)
        showNotification('error', 'Failed to load shipment details')
      } finally {
        setLoadingEdit(false)
      }
    },
    [hydrateShipmentEditForm, showNotification],
  )

  const loadShipmentForEditById = useCallback(
    async (shipmentId: string, contractIdFallback: string) => {
      setLoadingEdit(true)
      setEditShipmentId(null)
      try {
        const detailRes = await api.get(`/shipments/${shipmentId}`)
        const shipment = (detailRes.data?.data ?? {}) as Record<string, unknown>
        if (!shipment?.id && !detailRes.data?.success) {
          showNotification('error', 'Shipment not found')
          return
        }
        const row = { ...shipment, id: shipmentId }
        await hydrateShipmentEditForm(shipmentId, row, contractIdFallback)
      } catch (error) {
        console.error('Failed to load shipment for edit:', error)
        showNotification('error', 'Failed to load shipment details')
      } finally {
        setLoadingEdit(false)
      }
    },
    [hydrateShipmentEditForm, showNotification],
  )

  const loadShipmentForPlot = useCallback(
    async (shipmentId: string) => {
      setLoadingEdit(true)
      setEditShipmentId(null)
      try {
        // Prefer STO from the Shipments list row (SAP group key). getShipmentById may return
        // contracts.sto_number for a single child PO, which can differ from the list STO and
        // would under-load sibling POs (e.g. 1 of 3).
        const [detailRes, portsRes] = await Promise.all([
          api.get(`/shipments/${shipmentId}`),
          api.get(`/shipments/${shipmentId}/loading-ports`).catch(() => null),
        ])
        const shipment = (detailRes.data?.data ?? {}) as Record<string, unknown>
        if (!shipment?.id && !detailRes.data?.success) {
          showNotification('error', 'Shipment not found')
          return
        }
        const row = { ...shipment, id: shipmentId } as Record<string, unknown>
        const sto = resolvePlotStoLookupKey({
          listSto: prefilledStoNumber,
          editStoNumber,
          apiStoNumber: shipment.sto_number as string | null | undefined,
          shipmentId: shipment.shipment_id as string | null | undefined,
          operationId: shipment.operation_id as string | null | undefined,
        })
        const contractList = (prefilledContractNumbers ?? []).filter(Boolean)

        const [allPos, preview] = await Promise.all([
          sto ? fetchStoLinkedPurchaseOrderOptions(sto, contractList) : Promise.resolve([]),
          sto
            ? fetchStoSapPreview(sto)
            : Promise.resolve({ has_sap_sto: false, vessel_name: null, port_of_discharge: null }),
        ])

        if (preview.has_sap_sto) {
          setSapStoPreview(preview)
        }

        let loadingPorts: VesselLoadingPortRow[] = []
        if (portsRes?.data?.data?.ports) {
          loadingPorts = portsRes.data.data.ports ?? []
        }

        if (allPos.length > 0) {
          applyStoLinkedPoOptionsToForm(allPos, {
            preserveOperationId: true,
          })
        } else {
          const contractIdFallback =
            String(shipment.contract_number ?? prefilledContractNumbers?.[0] ?? '').trim() || shipmentId
          await hydrateShipmentEditForm(shipmentId, row, contractIdFallback)
          setEditShipmentId(null)
          return
        }

        setNewShipment((prev) => ({
          ...prev,
          operationId: String(shipment.operation_id ?? row.operation_id ?? prev.operationId),
          stoNumber: sto || prev.stoNumber,
          vesselName:
            String(shipment.vessel_name ?? row.vessel_name ?? '').trim() ||
            prev.vesselName.trim() ||
            '',
          vesselCode: String(shipment.vessel_code ?? row.vessel_code ?? prev.vesselCode),
          vesselOwner: String(shipment.vessel_owner ?? row.vessel_owner ?? prev.vesselOwner),
          vesselDraft: String(shipment.vessel_draft ?? row.vessel_draft ?? prev.vesselDraft),
          vesselCapacity: String(shipment.vessel_capacity ?? row.vessel_capacity ?? prev.vesselCapacity),
          vesselHullType: String(shipment.vessel_hull_type ?? row.vessel_hull_type ?? prev.vesselHullType),
          charterType: String(shipment.charter_type ?? row.charter_type ?? prev.charterType),
          portOfLoading: String(shipment.port_of_loading ?? row.port_of_loading ?? prev.portOfLoading),
          portOfDischarge:
            String(shipment.port_of_discharge ?? row.port_of_discharge ?? '').trim() ||
            prev.portOfDischarge.trim() ||
            preview.port_of_discharge ||
            '',
        }))

        const contractIds = allPos.map((po) => po.contractId)
        setEtaDetails(
          buildEtaDetailsFromGroupLoadingPorts(contractIds, shipment, row, loadingPorts),
        )
        setEditShipmentId(null)
        const plotVessel = String(shipment.vessel_name ?? row.vessel_name ?? '').trim()
        if (plotVessel) {
          const matched = await trySelectMasterVesselByName(plotVessel)
          if (!matched) setVesselPickedFromMaster(false)
        }
      } catch (error) {
        console.error('Failed to load shipment for plot:', error)
        showNotification('error', 'Failed to load shipment details')
      } finally {
        setLoadingEdit(false)
      }
    },
    [
      applyStoLinkedPoOptionsToForm,
      editStoNumber,
      hydrateShipmentEditForm,
      prefilledContractNumbers,
      prefilledStoNumber,
      showNotification,
      trySelectMasterVesselByName,
    ],
  )

  useEffect(() => {
    setAiAppliedPatternContext(null)
  }, [newShipment.contractNumbers])

  /** Load STO-linked PO lines + SAP vessel/discharge when parent opens modal (add mode only). */
  useEffect(() => {
    if (!open) {
      stoPrefillLoadedRef.current = null
      return
    }
    if (isEditMode || isPlotMode) return
    const sto = String(prefilledStoNumber ?? '').trim()
    if (!sto) return
    if (prefilledPOs?.length) return

    const stoLoadKey = `${sto}::${(prefilledContractNumbers ?? []).filter(Boolean).join(',')}`
    if (stoPrefillLoadedRef.current === stoLoadKey) return

    let cancelled = false
    setLoadingInitialData(true)
    if (stoPrefillLoadedRef.current !== null) {
      setInternalPrefilledPOs(null)
      setSapStoPreview(null)
    }

    void (async () => {
      try {
        const contractList = (prefilledContractNumbers ?? []).filter(Boolean)
        const [pos, preview] = await Promise.all([
          fetchStoLinkedPurchaseOrderOptions(sto, contractList),
          fetchStoSapPreview(sto),
        ])
        if (cancelled) return
        stoPrefillLoadedRef.current = stoLoadKey
        setInternalPrefilledPOs(pos)
        setSapStoPreview(preview)
        if (preview.has_sap_sto) {
          setNewShipment((prev) => ({
            ...prev,
            stoNumber: sto,
            portOfDischarge: prev.portOfDischarge.trim() || preview.port_of_discharge || '',
          }))
        }
      } catch (error) {
        console.error('Failed to load SAP STO prefill:', error)
        if (!cancelled) {
          showNotification('error', 'Failed to load SAP STO data', 'PO lines and vessel fields may be incomplete.')
        }
      } finally {
        if (!cancelled) setLoadingInitialData(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    open,
    isEditMode,
    prefilledStoNumber,
    prefilledPOs,
    prefilledContractNumbers,
    showNotification,
    isPlotMode,
  ])

  useEffect(() => {
    if (!open) {
      initSessionRef.current = null
      return
    }

    const poSource = resolvedPrefilledPOs
    const sessionKey = [
      isEditMode ? 'edit' : isPlotMode ? 'plot' : 'add',
      editContractId ?? '',
      editShipmentIdProp ?? '',
      plotShipmentId ?? '',
      isPlotMode ? '' : (poSource?.map((p) => p.key).join('|') ?? ''),
      prefilledStoNumber ?? '',
      prefilledVessel?.vesselCode ?? '',
      prefilledVessel?.vesselName ?? '',
    ].join(':')
    if (initSessionRef.current === sessionKey) return

    const isInitialShell = initSessionRef.current === null
    initSessionRef.current = sessionKey

    const directShipmentId = editShipmentIdProp?.trim()
    const plotId = plotShipmentId?.trim()
    const editId = editContractId?.trim()
    if (isEditMode && directShipmentId) {
      if (isInitialShell) resetForm()
      void loadShipmentForEditById(directShipmentId, editId || directShipmentId)
      return
    }
    if (isEditMode && editId) {
      if (isInitialShell) resetForm()
      void loadShipmentForEdit(editId)
      return
    }
    if (isPlotMode && plotId) {
      if (isInitialShell) resetForm()
      void loadShipmentForPlot(plotId)
      return
    }

    if (isInitialShell) resetForm()

    if (!isEditMode && !isPlotMode && prefilledVessel) {
      if (!isInitialShell) resetForm()
      setNewShipment(applyPrefilledVesselToForm(emptyShipment(), prefilledVessel))
    }

    if (poSource?.length) {
      applyStoLinkedPoOptionsToForm(poSource)
    }
  }, [
    open,
    editContractId,
    editShipmentIdProp,
    plotShipmentId,
    isEditMode,
    isPlotMode,
    resolvedPrefilledPOs,
    prefilledStoNumber,
    prefilledVessel,
    sapStoPreview?.port_of_discharge,
    sapStoPreview?.vessel_name,
    resetForm,
    applyStoLinkedPoOptionsToForm,
    loadShipmentForEdit,
    loadShipmentForEditById,
    loadShipmentForPlot,
  ])

  /** Auto-show one ETA row when ≥1 PO is on the shipment (sea / mixed). */
  useEffect(() => {
    if (!open || isEditMode || loadingEdit) return
    const contractIds = newShipment.contractNumbers
    if (contractIds.length === 0) {
      setEtaDetails([])
      return
    }
    if (selectedTransportMode !== 'sea' && selectedTransportMode !== 'mixed') return

    setEtaDetails((prev) => {
      if (prev.length === 0) {
        return [createShipmentEtaDetail([...contractIds])]
      }
      const ownerMap = buildGlobalSelectedPoOwnerMap(prev)
      return prev.map((block, index) => {
        const kept = block.contractIds.filter((id) => contractIds.includes(id))
        if (index !== 0) return { ...block, contractIds: kept }
        const newlyAdded = contractIds.filter((id) => {
          if (kept.includes(id)) return false
          const owner = ownerMap.get(id)
          return owner == null || owner === block.id
        })
        return { ...block, contractIds: [...kept, ...newlyAdded] }
      })
    })
  }, [open, isEditMode, loadingEdit, newShipment.contractNumbers, selectedTransportMode])

  /** Loading / discharge ports are SAP-only on Add New (readonly). */
  useEffect(() => {
    if (!open || isEditMode || loadingEdit) return
    const keys = newShipment.contractNumbers
    const sapLoading = firstSapPortFromKeys(keys, 'port_of_loading')
    const sapDischarge =
      firstSapPortFromKeys(keys, 'port_of_discharge') || String(sapStoPreview?.port_of_discharge ?? '').trim()
    setNewShipment((prev) => {
      if (prev.portOfLoading === sapLoading && prev.portOfDischarge === sapDischarge) return prev
      return { ...prev, portOfLoading: sapLoading, portOfDischarge: sapDischarge }
    })
    setEtaDetails((prev) =>
      prev.map((block) => {
        const fromBlock = firstSapPortFromKeys(block.contractIds, 'port_of_loading') || sapLoading
        if (block.loadingPort === fromBlock) return block
        return { ...block, loadingPort: fromBlock }
      }),
    )
    setFormErrors((prev) => {
      if (!prev.portOfDischarge && !Object.keys(prev).some((k) => k.endsWith('_loadingPort'))) return prev
      const next = { ...prev }
      if (sapDischarge) delete next.portOfDischarge
      return next
    })
  }, [
    open,
    isEditMode,
    loadingEdit,
    newShipment.contractNumbers,
    sapStoPreview?.port_of_discharge,
    firstSapPortFromKeys,
  ])

  const validateShipmentForm = (transportMode: string | null): boolean => {
    const errors: Record<string, string> = {}

    if (isEditMode) {
      for (const block of etaDetails) {
        const prefix = `eta_${block.id}`
        const hasDates = etaDetailHasAnyDate(block)
        if (!hasDates) continue
        const range = getEtaDateRangeForContractIds(block.contractIds)
        if (!range) {
          errors[`${prefix}_contract`] =
            'Selected POs are missing due delivery dates or have incompatible delivery windows; split into separate shipment details.'
        } else {
          const rangeMsg = formatEtaAllowedRangeMessage(range)
          const checkEta = (iso: string, key: string) => {
            if (iso && (iso < range.minIso || iso > range.maxIso)) errors[key] = rangeMsg
          }
          checkEta(block.etaVesselArrivalAtLoadingPort, `${prefix}_arrival`)
          checkEta(block.etaVesselBerthedAtLoadingPort, `${prefix}_berthed`)
          checkEta(block.etaVesselStartLoading, `${prefix}_startLoading`)
          checkEta(block.etaVesselCompletedLoading, `${prefix}_completedLoading`)
          checkEta(block.etaVesselSailedFromLoadingPort, `${prefix}_sailed`)
          checkEta(block.etaVesselArriveAtDischargePort, `${prefix}_arriveDischarge`)
          checkEta(block.etaVesselBerthedAtDischargePort, `${prefix}_berthedDischarge`)
          checkEta(block.etaVesselStartDischarging, `${prefix}_startDischarging`)
          checkEta(block.etaVesselCompleteDischarge, `${prefix}_completeDischarge`)
        }
      }
      setFormErrors(errors)
      return Object.keys(errors).length === 0
    }

    if (newShipment.contractNumbers.length === 0)
      errors.contractNumbers = openedFromContracts
        ? 'Contract is required'
        : 'At least one PO Number is required'
    const invalidContracts = newShipment.contractNumbers.filter((id) => !contractValidations[id]?.exists)
    if (invalidContracts.length > 0)
      errors.contractNumbers = `Invalid contract(s): ${invalidContracts.join(', ')}`
    if (transportMode === 'sea' || transportMode === 'mixed') {
      if (!newShipment.vesselName.trim() || !vesselPickedFromMaster) {
        errors.vesselName = 'Select a vessel from Master Vessel'
      }
      if (!newShipment.charterType) {
        errors.charterType = 'Master Vessel has no Charter Type (T/C, V/C, or CIF)'
      }
      if (!allSelectedPoCif && !newShipment.portOfDischarge.trim()) {
        errors.portOfDischarge = 'SAP Vessel Discharge Port is empty for the selected PO'
      }
    }

    const requiresCompleteEta =
      (transportMode === 'sea' || transportMode === 'mixed') &&
      newShipment.contractNumbers.length > 0 &&
      !allSelectedPoCif

    const usedContractIds = new Set<string>()
    const coveredContractIds = new Set<string>()
    for (const block of etaDetails) {
      const prefix = `eta_${block.id}`
      const hasDates = etaDetailHasAnyDate(block)
      const selectedIds = block.contractIds.filter(Boolean)
      const blockAllCif = blockSelectionKeysAllCif(selectedIds, resolveSelectionIncoterm)

      if ((transportMode === 'sea' || transportMode === 'mixed') && newShipment.contractNumbers.length > 0) {
        if (!blockAllCif && !block.loadingPort.trim()) {
          errors[`${prefix}_loadingPort`] = 'SAP Vessel Loading Port is empty'
        }
      }

      if (requiresCompleteEta && selectedIds.length > 0 && !blockAllCif) {
        for (const { key, errorSuffix, shortLabel } of ETA_FIELD_ROWS) {
          if (!String(block[key] ?? '').trim()) {
            errors[`${prefix}_${errorSuffix}`] = `${shortLabel} is required`
          }
        }
      }

      if (!requiresCompleteEta && hasDates && selectedIds.length === 0) {
        errors[`${prefix}_contract`] = 'Select at least one PO for this shipment detail'
      }

      for (const cid of selectedIds) {
        if (!newShipment.contractNumbers.includes(cid)) {
          errors[`${prefix}_contract`] = 'One or more selected POs are not in the contract list above'
          break
        }
        const shouldTrackDuplicate = requiresCompleteEta || hasDates
        if (shouldTrackDuplicate) {
          if (usedContractIds.has(cid)) {
            errors[`${prefix}_contract`] =
              'A PO cannot appear in more than one shipment detail block. Adjust selections.'
            break
          }
          usedContractIds.add(cid)
          coveredContractIds.add(cid)
        }
      }

      const shouldValidateRange =
        selectedIds.length > 0 && (requiresCompleteEta || hasDates)
      if (shouldValidateRange) {
        const range = getEtaDateRangeForContractIds(selectedIds)
        if (!range) {
          errors[`${prefix}_contract`] =
            'Selected POs are missing due delivery dates or have incompatible delivery windows; split into separate shipment details.'
        } else {
          const rangeMsg = formatEtaAllowedRangeMessage(range)
          const checkEta = (iso: string, key: string) => {
            if (iso && (iso < range.minIso || iso > range.maxIso)) errors[key] = rangeMsg
          }
          checkEta(block.etaVesselArrivalAtLoadingPort, `${prefix}_arrival`)
          checkEta(block.etaVesselBerthedAtLoadingPort, `${prefix}_berthed`)
          checkEta(block.etaVesselStartLoading, `${prefix}_startLoading`)
          checkEta(block.etaVesselCompletedLoading, `${prefix}_completedLoading`)
          checkEta(block.etaVesselSailedFromLoadingPort, `${prefix}_sailed`)
          checkEta(block.etaVesselArriveAtDischargePort, `${prefix}_arriveDischarge`)
          checkEta(block.etaVesselBerthedAtDischargePort, `${prefix}_berthedDischarge`)
          checkEta(block.etaVesselStartDischarging, `${prefix}_startDischarging`)
          checkEta(block.etaVesselCompleteDischarge, `${prefix}_completeDischarge`)
        }
      }
    }

    if (requiresCompleteEta) {
      for (const cid of newShipment.contractNumbers) {
        if (!coveredContractIds.has(cid)) {
          const firstBlock = etaDetails[0]
          const contractErrorKey = firstBlock ? `eta_${firstBlock.id}_contract` : 'contractNumbers'
          if (!errors[contractErrorKey]) {
            errors[contractErrorKey] =
              'Assign all POs and complete every Estimation milestone in Section 3'
          }
        }
      }
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreateShipment = async () => {
    if (perms.loaded && !canOpenAddShipmentModal) {
      showNotification(
        'error',
        'Permission denied',
        'You need Create or Edit permission on Shipments (data.shipments). Ask an admin to update your role.',
      )
      return
    }

    if (isEditMode && !editShipmentId) {
      showNotification('error', 'Shipment record not loaded')
      return
    }

    if (isPlotMode && !plotShipmentId?.trim()) {
      showNotification('error', 'Shipment record not loaded')
      return
    }

    if (!validateShipmentForm(selectedTransportMode)) return

    if (isEditMode) {
      try {
        setSaving(true)
        const primaryBlock = etaDetails[0]
        if (!primaryBlock) {
          showNotification('error', 'No Estimation details to save')
          return
        }
        await onSubmit({
          kind: 'update',
          shipmentId: editShipmentId!,
          eta_arrival: toApiDateOnly(primaryBlock.etaVesselArrivalAtLoadingPort),
          eta_berthed: toApiDateOnly(primaryBlock.etaVesselBerthedAtLoadingPort),
          eta_loading_start: toApiDateOnly(primaryBlock.etaVesselStartLoading),
          eta_loading_complete: toApiDateOnly(primaryBlock.etaVesselCompletedLoading),
          eta_sailed: toApiDateOnly(primaryBlock.etaVesselSailedFromLoadingPort),
          eta_discharge_arrival: toApiDateOnly(primaryBlock.etaVesselArriveAtDischargePort),
          eta_discharge_berthed: toApiDateOnly(primaryBlock.etaVesselBerthedAtDischargePort),
          eta_discharge_start: toApiDateOnly(primaryBlock.etaVesselStartDischarging),
          eta_discharge_complete: toApiDateOnly(primaryBlock.etaVesselCompleteDischarge),
        })
        showNotification('success', 'Shipment updated successfully!')
        resetForm()
        onClose()
      } catch (error: any) {
        console.error('Error updating shipment:', error)
        const errorMsg = error?.response?.data?.error?.message || error?.message || 'Failed to update shipment'
        showNotification('error', errorMsg)
      } finally {
        setSaving(false)
      }
      return
    }

    try {
      setSaving(true)

      const operationId = newShipment.operationId || generateOperationId(newShipment.contractNumbers[0])

      const etaByContract: Record<string, ReturnType<typeof etaDetailToApiPayload>> = {}
      for (const block of etaDetails) {
        if (block.contractIds.length === 0) continue
        const blockAllCif = blockSelectionKeysAllCif(block.contractIds, resolveSelectionIncoterm)
        if (!blockAllCif && !etaDetailHasAllRequiredDates(block)) continue
        const etaPayload = etaDetailToApiPayload(block)
        for (const selectionKey of block.contractIds) {
          etaByContract[resolveContractIdForKey(selectionKey)] = etaPayload
        }
      }

      const selectionKeys = newShipment.contractNumbers
      const contractNumbers = [...new Set(selectionKeys.map((k) => resolveContractIdForKey(k)))]
      const quantityDeliveredByContract = buildQuantityDeliveredByContractKg(
        selectionKeys,
        qtyDeliveryKlipMtByKey,
        resolveContractIdForKey,
      )

      await onSubmit({
        kind: 'create',
        operationId,
        stoNumber: newShipment.stoNumber.trim() || String(prefilledStoNumber ?? '').trim(),
        contractNumbers,
        ...(Object.keys(quantityDeliveredByContract).length > 0
          ? { quantityDeliveredByContract }
          : {}),
        vesselName: newShipment.vesselName,
        vesselCode: newShipment.vesselCode,
        vesselOwner: newShipment.vesselOwner,
        vesselDraft: newShipment.vesselDraft,
        vesselCapacity: newShipment.vesselCapacity,
        vesselHullType: newShipment.vesselHullType,
        charterType: newShipment.charterType,
        portOfLoading: newShipment.portOfLoading,
        portOfDischarge: newShipment.portOfDischarge,
        etaByContract,
        prePlannedGroupId: prePlannedGroupId ?? undefined,
      })

      showNotification(
        'success',
        isPlotMode ? 'Shipment planning saved successfully!' : 'Shipment created successfully!',
      )
      resetForm()
      onClose()
    } catch (error: any) {
      console.error('Error creating shipment:', error)
      const errorMsg = error.response?.data?.error?.message || 'Failed to create shipment'
      const errorDetails = error.response?.data?.error?.details
      showNotification('error', errorMsg, errorDetails)
    } finally {
      setSaving(false)
    }
  }

  const section2DropdownOpen = false

  const step1Done = newShipment.contractNumbers.length > 0 && newShipment.contractNumbers.every((id) => contractValidations[id]?.exists)
  const step2Done = Boolean(newShipment.vesselName.trim() || selectedTransportMode === 'land')
  const step3RequiresEta =
    (selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') &&
    newShipment.contractNumbers.length > 0
  const step3Done = step3RequiresEta
    ? isEtaScheduleCompleteForCreate(newShipment.contractNumbers, etaDetails, resolveSelectionIncoterm)
    : true

  const contractDeliveryReferences = useMemo(
    () =>
      newShipment.contractNumbers
        .map((contractId) => {
          const validation = contractValidations[contractId]
          const data = validation?.contractData
          if (!validation?.exists || !data) return null
          return {
            contractId,
            label: String(data.po_number || data.contract_id || contractId).trim(),
            deliveryStart: data.delivery_start_date as string | null | undefined,
            deliveryEnd: data.delivery_end_date as string | null | undefined,
          }
        })
        .filter((row): row is NonNullable<typeof row> => row != null),
    [newShipment.contractNumbers, contractValidations],
  )

  const openContractDetailFromPoRow = async (contractId: string) => {
    const validation = contractValidations[contractId]
    const data = validation?.contractData
    if (!validation?.exists || !data) return
    const po = String(data.po_number ?? '').trim()
    const contractNumber = String(data.contract_id ?? contractId).trim()
    if (!po && !contractNumber) return
    setContractDetailLoading(true)
    try {
      const contract = await fetchContractForDetailModalByPo(po || contractNumber, contractNumber)
      if (contract) {
        setContractDetailTarget(contract)
      } else {
        showNotification('error', 'Contract details not found for this PO.')
      }
    } finally {
      setContractDetailLoading(false)
    }
  }

  if (!open) return null

  if (isEditMode && readOnly) {
    return (
      <ViewShipmentModal
        open={open}
        onClose={() => {
          resetForm()
          onClose()
        }}
        stacked={stacked}
        editContractId={editContractId}
        editShipmentId={editShipmentIdProp}
        editStoNumber={editStoNumber}
        editContractNumbers={editContractNumbers}
        onSubmit={onSubmit}
        onShipmentChanged={onShipmentChanged}
      />
    )
  }

  if (isEditMode) {
    return (
      <EditShipmentModal
        open={open}
        onClose={() => {
          resetForm()
          onClose()
        }}
        onSubmit={onSubmit}
        stacked={stacked}
        editContractId={editContractId}
        editShipmentId={editShipmentIdProp}
        editStoNumber={editStoNumber}
        editContractNumbers={editContractNumbers}
        onShipmentChanged={onShipmentChanged}
      />
    )
  }

  return (
    <>
    <div className={`fixed inset-0 ${stacked ? 'z-[80]' : 'z-[60]'} flex items-center justify-center bg-black/40 p-4`}>
      <div className={VESSEL_MODAL_PANEL_CLASS}>
        {/* Header */}
        <div className={VESSEL_MODAL_HEADER_CLASS}>
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">
                <Ship className="h-4.5 w-4.5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {isEditMode ? 'Edit Shipment' : isPlotMode ? 'Plot Shipment Planning' : 'Add New Shipment'}
                </h3>
                <p className="text-xs text-gray-500">
                  {isEditMode
                    ? 'Only Estimation schedule dates can be changed'
                    : isPlotMode
                      ? 'Register vessel and Estimation planning for this SAP STO'
                      : 'Fill in contract, vessel, and Estimation details'}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-gray-400 hover:text-gray-600"
              aria-label="Close"
              onClick={() => {
                resetForm()
                onClose()
              }}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          {/* Step progress */}
          <div className={VESSEL_MODAL_STEP_STRIP_CLASS}>
            {[
              { num: 1, label: 'Contract & PO', done: step1Done, icon: <FileText className="h-3.5 w-3.5" /> },
              { num: 2, label: 'Vessel Detail', done: step2Done, icon: <Anchor className="h-3.5 w-3.5" /> },
              { num: 3, label: 'ETA / Estimation + Loading Port', done: step3Done, icon: <Clock className="h-3.5 w-3.5" /> },
            ].map((s, i) => (
              <div key={s.num} className="flex items-center">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                      s.done
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {s.done ? <Check className="h-3.5 w-3.5" /> : s.num}
                  </div>
                  <span className={`text-xs font-medium ${s.done ? 'text-green-700' : 'text-gray-500'}`}>
                    {s.label}
                  </span>
                </div>
                {i < 2 && <ChevronRight className="mx-3 h-3.5 w-3.5 text-gray-300 shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        <div className={`relative ${VESSEL_MODAL_BODY_CLASS}`} {...{ [FAST_ENTRY_ROOT_ATTR]: 'true' }}>
        {((loadingInitialData && !isPlotMode) || (isPlotMode && loadingEdit)) && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center rounded-b-xl bg-white/75 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
              <p className="text-sm font-medium text-gray-700">Loading shipment data…</p>
              <p className="text-xs text-gray-500">
                {isPlotMode
                  ? 'Fetching STO-linked PO lines and vessel details'
                  : 'Fetching SAP STO, PO lines, and vessel details'}
              </p>
            </div>
          </div>
        )}
        {loadingEdit && !isPlotMode && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading shipment details…
          </div>
        )}
        {/* Notification banner */}
        {notification && (
          <div
            ref={notificationBannerRef}
            className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm ${
              notification.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : notification.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {notification.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : notification.type === 'error' ? (
                <AlertCircle className="h-4 w-4 text-red-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{notification.message}</p>
              {notification.detail && <p className="mt-0.5 text-xs opacity-80">{notification.detail}</p>}
            </div>
            <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setNotification(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="space-y-5">

          {/* Section 1: Contract Detail */}
          <div className="relative z-30 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white px-4 py-2.5 rounded-t-xl">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100">
                <FileText className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <h4 className="text-sm font-semibold text-gray-800">1. Contract Detail</h4>
              {step1Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span>
                  <strong>Required:</strong> at least one PO &nbsp;•&nbsp; <strong>Optional:</strong> plant/site, Estimation &nbsp;•&nbsp;
                  <strong>Note:</strong> Operation ID is auto-generated; STO will be filled from SAP when available
                  {hasSapSto ? (
                    <>
                      {' '}
                      &nbsp;•&nbsp; <strong>SAP STO:</strong> loading and discharge ports are filled from SAP (read-only)
                    </>
                  ) : null}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Operation ID <span className="text-gray-400">(auto)</span>
                  </label>
                  <Input
                    value={
                      newShipment.operationId
                        ? newShipment.operationId
                        : 'Auto-generated when PO is added'
                    }
                    disabled
                    className="h-8 text-xs bg-gray-100 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    STO Number <span className="text-gray-400">(from SAP)</span>
                  </label>
                  <Input
                    value={
                      newShipment.stoNumber.trim() ||
                      String(editStoNumber ?? prefilledStoNumber ?? '').trim()
                    }
                    readOnly
                    disabled
                    placeholder="Will be filled from SAP import"
                    className="h-8 text-xs bg-gray-100 cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                {!isEditMode && (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-gray-700">PO Number <span className="text-red-500">*</span></label>
                      <span className="text-[10px] text-gray-400">
                        {isContractScoped
                          ? 'Add POs from this contract only'
                          : 'Type PO Number then press Enter or click Add PO'}
                      </span>
                    </div>
                    <div
                      className={`relative ${showContractSuggestions && contractSuggestions.length > 0 ? 'z-[100]' : 'z-0'}`}
                    >
                      <div className="flex gap-2">
                        <Input
                          ref={poNumberInputRef}
                          value={contractSearchTerm}
                          onChange={(e) => handleContractSearch(e.target.value)}
                          onFocus={() => setShowContractSuggestions(true)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.code === 'Space') return
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleAddContractManually()
                            }
                          }}
                          placeholder={isContractScoped ? 'Search POs for this contract...' : 'Search PO Number...'}
                          className="flex-1 h-9 text-sm"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleAddContractManually()}
                          className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add PO
                        </Button>
                      </div>
                      {showContractSuggestions && contractSuggestions.length > 0 && (
                        <div className={`${AUTOCOMPLETE_PANEL_CLASS} max-h-52`}>
                          {contractSuggestions.map((contract) => (
                            <div
                              key={String(contract._poKey ?? contract.contract_id)}
                              className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition-colors"
                              onClick={() => void handleAddContract(contract)}
                            >
                              <div className="font-semibold text-sm text-gray-900">{contract.po_number || contract.contract_id}</div>
                              <div className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                                {contract.po_number && (
                                  <span className="text-gray-400 font-mono">{contract.contract_id}</span>
                                )}
                                {contract.po_number && <span className="text-gray-300">•</span>}
                                <span>{contract.supplier}</span>
                                <span className="text-gray-300">•</span>
                                <span>{contract.product}</span>
                                {contract.sto_number && (
                                  <>
                                    <span className="text-gray-300">•</span>
                                    <span className="text-blue-600 font-medium">STO: {contract.sto_number}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {isContractScoped && remainingContractScopedPos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-gray-500 w-full">Quick add:</span>
                        {remainingContractScopedPos.map((po) => (
                          <button
                            key={po.key}
                            type="button"
                            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                            onClick={() => void addPoFromOption(po)}
                          >
                            <Plus className="h-3 w-3 mr-0.5" />
                            {po.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {Boolean(prefilledStoNumber?.trim()) &&
                  !isPlotMode &&
                  loadingInitialData &&
                  newShipment.contractNumbers.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading SAP STO &amp; PO lines…
                  </div>
                )}

                {isContractScoped && newShipment.contractNumbers.length === 0 && !resolvedPrefilledPOs?.length && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading contract PO lines…
                  </div>
                )}

                {openedFromContracts && !isContractScoped && newShipment.contractNumbers.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading contract details…
                  </div>
                )}

                {newShipment.contractNumbers.length > 0 && (
                  <div className="mt-2">
                    <div className="rounded-md border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50 hover:bg-gray-50">
                            <TableHead className={COMPACT_TH}>PO</TableHead>
                            <TableHead className={COMPACT_TH}>Supplier / Product</TableHead>
                            <TableHead className={`${COMPACT_TH} text-right`}>Contract Qty</TableHead>
                            <TableHead className={`${COMPACT_TH} text-right`}>OS Qty</TableHead>
                            <TableHead className={`${COMPACT_TH} text-right`}>Qty Delivery (Klip)</TableHead>
                            <TableHead className={COMPACT_TH}>Del. Start</TableHead>
                            <TableHead className={COMPACT_TH}>Del. End</TableHead>
                            {!isEditMode && <TableHead className={`${COMPACT_TH} w-8`} />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {newShipment.contractNumbers.map((contractId) => {
                            const validation = contractValidations[contractId]
                            const data = validation?.contractData
                            const label = getPoLabel(contractId)
                            const contractExtNo = getPoContractExtNo(contractId)
                            const contractQtyMt = (Number(data?.quantity_ordered) || 0) / 1000
                            const outstandingQtyMt = (Number(data?.outstanding_quantity) || 0) / 1000
                            return (
                              <TableRow key={contractId}>
                                <TableCell className={COMPACT_TD}>
                                  <div className="flex items-center gap-1 min-w-[5.5rem]">
                                    {validation?.exists ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 truncate max-w-[7rem]"
                                        title="View contract details"
                                        disabled={contractDetailLoading}
                                        onClick={() => void openContractDetailFromPoRow(contractId)}
                                      >
                                        {label}
                                      </button>
                                    ) : (
                                      <span className="font-medium truncate max-w-[7rem]" title={label}>
                                        {label}
                                      </span>
                                    )}
                                    {validation?.checking && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                                    {validation?.exists && <Check className="h-3 w-3 text-green-600 shrink-0" />}
                                    {validation?.exists === false && !validation?.checking && (
                                      <X className="h-3 w-3 text-red-600 shrink-0" />
                                    )}
                                  </div>
                                  {contractExtNo && (
                                    <div className="text-[10px] text-gray-400 truncate" title={contractExtNo}>
                                      {contractExtNo}
                                    </div>
                                  )}
                                  {validation?.message && !validation.exists && (
                                    <div className="text-[10px] text-red-600">{validation.message}</div>
                                  )}
                                </TableCell>
                                <TableCell className={`${COMPACT_TD} max-w-[10rem]`}>
                                  {validation?.exists && data ? (
                                    <span className="line-clamp-2 text-gray-600" title={`${data.supplier} • ${data.product}`}>
                                      {data.supplier} • {data.product}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">?</span>
                                  )}
                                </TableCell>
                                <TableCell className={`${COMPACT_TD} text-right tabular-nums`}>
                                  {validation?.exists ? formatNumber(contractQtyMt) : '—'}
                                </TableCell>
                                <TableCell className={`${COMPACT_TD} text-right tabular-nums`}>
                                  {validation?.exists ? formatNumber(outstandingQtyMt) : '—'}
                                </TableCell>
                                <TableCell className={`${COMPACT_TD} text-right`}>
                                  <div className="relative min-w-[5.5rem]">
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      autoComplete="off"
                                      value={qtyDeliveryKlipMtByKey[contractId] ?? ''}
                                      placeholder="—"
                                      title={DECIMAL_DOT_HINT}
                                      onKeyDown={blockCommaDecimalKeyDown}
                                      onChange={(e) => {
                                        const raw = e.target.value
                                        if (raw === '') {
                                          setQtyDeliveryKlipMtByKey((prev) => {
                                            const next = { ...prev }
                                            delete next[contractId]
                                            return next
                                          })
                                          return
                                        }
                                        if (sanitizeDecimalDotInput(raw) === null) return
                                        setQtyDeliveryKlipMtByKey((prev) => ({ ...prev, [contractId]: raw }))
                                      }}
                                      className="h-7 px-2 py-1 pr-8 text-right text-xs tabular-nums"
                                    />
                                    <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">
                                      MT
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className={COMPACT_TD}>
                                  {validation?.exists ? formatShortDate(data?.delivery_start_date || '') : '—'}
                                </TableCell>
                                <TableCell className={COMPACT_TD}>
                                  {validation?.exists ? formatShortDate(data?.delivery_end_date || '') : '—'}
                                </TableCell>
                                {!isEditMode && (
                                  <TableCell className={`${COMPACT_TD} text-center`}>
                                    <button
                                      type="button"
                                      className="text-gray-400 hover:text-gray-600"
                                      aria-label={`Remove PO ${label}`}
                                      onClick={() => handleRemoveContract(contractId)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </TableCell>
                                )}
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">{DECIMAL_DOT_HINT} Optional; blank keeps SAP as the source until filled.</p>
                  </div>
                )}
              </div>
              {formErrors.contractNumbers && (
                <p className="text-[11px] text-red-600">{formErrors.contractNumbers}</p>
              )}
            </div>
          </div>

          {/* Section 2: Vessel/Truck Detail */}
          <div className={`relative rounded-xl border border-gray-200 shadow-sm ${section2DropdownOpen ? 'z-[50]' : 'z-20'}`}>
            <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-cyan-50 to-white px-4 py-2.5 rounded-t-xl">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-100">
                <Anchor className="h-3.5 w-3.5 text-cyan-600" />
              </div>
              <h4 className="text-sm font-semibold text-gray-800">2. Vessel Detail</h4>
              {step2Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
            </div>
            <div className="p-4 space-y-3 overflow-visible">
              {hasSapSto && !isEditMode && (
                <div className="flex items-start gap-2 rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2.5 text-xs text-cyan-800">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600" />
                  <span>
                    Vessel name is pre-filled from SAP when available. Charter type comes from Master Vessel Terms.
                    Loading and discharge ports come from SAP and cannot be edited.
                  </span>
                </div>
              )}
              {!isEditMode && (selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                <div className="flex flex-col gap-3 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-3 sm:flex-row sm:items-start">
                  <AiKlipAgentButton
                    onClick={() => void handleAiSuggestVessel()}
                    loading={aiVesselLoading}
                    disabled={newShipment.contractNumbers.length === 0}
                    label="AI Klip Agent"
                    className="h-10 shrink-0 self-start"
                    title="Suggest vessel from Master Vessel and Estimation milestones. Charter type, loading port, and discharge port stay from master vessel / SAP."
                  />
                  <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed text-gray-600">
                    {aiAppliedPatternContext ? (
                      <>
                        <p className="text-sm font-medium text-violet-900">AI suggestion applied</p>
                        <p>
                          The values below were suggested because KLIP found similar past shipments
                          in the database for{' '}
                          {renderAiPatternDimensionList(aiAppliedPatternContext)}. Charter type stays
                          from Master Vessel; loading and discharge ports stay from SAP.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-violet-900">How does the AI suggestion work?</p>
                        <p>
                          The AI reviews historical KLIP shipments that match the{' '}
                          <span className="font-medium text-gray-800">
                            Supplier, Buyer, Product, and Incoterm
                          </span>{' '}
                          from the PO(s) you selected in Section 1. It then fills in the vessel
                          (Master Vessel) and Estimation schedule. Charter type comes from Master
                          Vessel Terms; loading and discharge ports come from SAP.
                        </p>
                        {newShipment.contractNumbers.length === 0 ? (
                          <p className="text-[11px] font-medium text-amber-700">
                            Add at least one PO in Section 1 to enable AI suggestions.
                          </p>
                        ) : aiPlannerContextLabel ? (
                          <p className="text-[11px] text-gray-500">
                            <span className="font-medium text-gray-700">Selected PO pattern:</span>{' '}
                            {renderAiPatternDimensionList(aiPlannerContextLabel)}
                          </p>
                        ) : (
                          <p className="text-[11px] text-gray-500">
                            Loading PO details… if this persists, try removing and re-adding the PO.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-visible">
                <div className="relative z-0 overflow-visible">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Name
                    {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                      <span className="text-red-500"> *</span>
                    )}
                  </label>
                  <MasterVesselCombobox
                    value={newShipment.vesselName}
                    onSelect={applyMasterVessel}
                    placeholder="Search and select from Master Vessel"
                    disabled={isEditMode}
                    className={`${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.vesselName ? 'border-red-500' : ''}`}
                  />
                  {formErrors.vesselName && (
                    <p className="text-xs mt-1 text-red-600">{formErrors.vesselName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Capacity (MT) <span className="text-gray-500 text-xs">(from Master Vessel)</span>
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-visible">
                <div className="relative z-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Charter Type
                    {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                      <span className="text-red-500"> *</span>
                    )}
                    <span className="ml-1 text-gray-500 text-xs">(from Master Vessel)</span>
                  </label>
                  <Input
                    value={newShipment.charterType}
                    readOnly
                    disabled
                    placeholder="Filled from Master Vessel Terms"
                    className={`bg-gray-100 cursor-not-allowed ${formErrors.charterType ? 'border-red-500' : ''}`}
                  />
                  {formErrors.charterType && <p className="text-xs mt-1 text-red-600">{formErrors.charterType}</p>}
                </div>
                <div className="relative z-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Discharge Port
                    {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                      <span className="text-red-500"> *</span>
                    )}
                    <span className="ml-1 text-gray-500 text-xs">(from SAP)</span>
                  </label>
                  <Input
                    value={newShipment.portOfDischarge}
                    readOnly
                    disabled
                    placeholder="Filled from SAP when a PO is added"
                    className={`bg-gray-100 cursor-not-allowed ${formErrors.portOfDischarge ? 'border-red-500' : ''}`}
                  />
                  {formErrors.portOfDischarge && (
                    <p className="text-xs mt-1 text-red-600">{formErrors.portOfDischarge}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-visible">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Plant/Site</label>
                  <Input
                    value={mappedPlantSiteName}
                    readOnly
                    disabled
                    placeholder={resolvedPlantCode ? 'Resolving group plant...' : 'Add a contract in Section 1'}
                    className="bg-gray-50 cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Shipment Detail */}
          <div className="relative z-10 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-violet-50 to-white px-4 py-2.5 rounded-t-xl">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100">
                <Clock className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <h4 className="text-sm font-semibold text-gray-800">3. ETA / Estimation Schedule + Loading Port</h4>
              {step3Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
            </div>
            <div className="p-4 space-y-3">
              {contractDeliveryReferences.length > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-medium text-blue-900">Official contract delivery timeframe (from SAP)</p>
                    <p className="text-blue-800/90">
                      Estimation from Arr. @ LP through Done Disch may be up to {ETA_DELIVERY_START_BUFFER_DAYS} days before
                      Due Date Delivery (Start) and up to {ETA_DELIVERY_END_BUFFER_DAYS} days after Due Date Delivery
                      (End).
                    </p>
                    {contractDeliveryReferences.map((ref) => (
                      <div key={ref.contractId} className="space-y-0.5">
                        {contractDeliveryReferences.length > 1 ? (
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700/80">
                            PO {ref.label}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                          <span>
                            <span className="font-semibold">Due Date Delivery (Start):</span>{' '}
                            {formatSapDeliveryDate(ref.deliveryStart)}
                          </span>
                          <span>
                            <span className="font-semibold">Due Date Delivery (End):</span>{' '}
                            {formatSapDeliveryDate(ref.deliveryEnd)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-500">
                  {allSelectedPoCif ? (
                    <>Estimation and Loading Port are optional for <span className="font-semibold">CIF</span> incoterm.</>
                  ) : (
                    <>
                      All Estimation milestones are required <span className="text-red-500">*</span> to create a shipment
                    </>
                  )}
                </p>
                {!isEditMode &&
                  (selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') &&
                  newShipment.contractNumbers.length > 0 && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addEtaDetailBlock}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Estimation row
                    </Button>
                  )}
              </div>

              {selectedTransportMode === null && (
                <p className="text-xs text-gray-400 italic">Add a contract in Section 1 to see ETA / Estimation fields.</p>
              )}

              {selectedTransportMode === 'land' && newShipment.contractNumbers.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                  This PO is LAND transport — vessel ETA fields are not used here. Create planning in Trucking instead.
                </p>
              )}

              {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                <>
                  {selectedTransportMode === 'mixed' && (
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                      Sea leg ETA (MIX contract)
                    </p>
                  )}

                  {newShipment.contractNumbers.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Add PO in Section 1 before adding Estimation.</p>
                  )}

                  <div className="space-y-2">
                    {etaDetails.map((block, index) => {
                      const prefix = `eta_${block.id}`
                      const range =
                        block.contractIds.length > 0 ? getEtaDateRangeForContractIds(block.contractIds) : null
                      const blockAllCif = blockSelectionKeysAllCif(block.contractIds, resolveSelectionIncoterm)
                      const etaFieldsRequired = !blockAllCif && !allSelectedPoCif
                      return (
                        <div key={block.id} className="rounded-md border border-gray-200 overflow-hidden text-xs">
                          <div className="flex items-center justify-between bg-gray-50 px-2 py-1 border-b">
                            <span className="font-semibold text-gray-600">Estimation #{index + 1}</span>
                            {!isEditMode && (
                              <button
                                type="button"
                                className="text-gray-400 hover:text-gray-600 p-0.5"
                                aria-label="Remove Estimation row"
                                onClick={() => removeEtaDetailBlock(block.id)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="px-2 py-1.5 border-b bg-white space-y-2">
                            <div className="relative overflow-visible z-0">
                              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                                Loading Port{etaFieldsRequired ? <span className="text-red-500"> *</span> : null}
                                <span className="ml-1 font-normal text-gray-500">(from SAP)</span>
                                {isEditMode && block.contractIds.length === 1 ? (
                                  <span className="ml-1 font-normal text-gray-500">
                                    (Contract {block.contractIds[0]})
                                  </span>
                                ) : null}
                              </label>
                              <Input
                                value={block.loadingPort}
                                readOnly
                                disabled
                                placeholder="Filled from SAP"
                                className={`h-8 text-xs w-full bg-gray-100 cursor-not-allowed ${formErrors[`${prefix}_loadingPort`] ? 'border-red-500' : ''}`}
                              />
                              {formErrors[`${prefix}_loadingPort`] && (
                                <p className="text-[11px] mt-1 text-red-600">{formErrors[`${prefix}_loadingPort`]}</p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                              <span className="text-gray-600 font-medium">
                                Apply to PO <span className="text-red-500">*</span>
                              </span>
                              {!isEditMode && (
                                <div className="flex gap-2 text-[11px]">
                                  <button type="button" className="text-blue-600 hover:underline" onClick={() => setAllPosForEtaBlock(block.id, true)}>
                                    All
                                  </button>
                                  <span className="text-gray-300">|</span>
                                  <button type="button" className="text-blue-600 hover:underline" onClick={() => setAllPosForEtaBlock(block.id, false)}>
                                    Clear
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {newShipment.contractNumbers.map((cid) => {
                                const checked = block.contractIds.includes(cid)
                                const ownerBlockId = globalSelectedPoOwner.get(cid)
                                const isSelectedElsewhere =
                                  ownerBlockId != null && ownerBlockId !== block.id
                                const poCheckboxDisabled = isEditMode || isSelectedElsewhere
                                return (
                                  <label
                                    key={cid}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                                      isEditMode
                                        ? 'cursor-not-allowed bg-gray-50 text-gray-500 border-gray-200'
                                        : isSelectedElsewhere
                                          ? 'cursor-not-allowed opacity-50 border-gray-200 bg-gray-100 text-gray-400'
                                          : checked
                                            ? 'cursor-pointer border-blue-300 bg-blue-50 text-blue-900'
                                            : 'cursor-pointer border-gray-200 hover:bg-gray-50'
                                    }`}
                                    title={
                                      isSelectedElsewhere
                                        ? 'This PO is already assigned to another Estimation block'
                                        : undefined
                                    }
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-3 w-3"
                                      checked={checked}
                                      disabled={poCheckboxDisabled}
                                      onChange={() => togglePoForEtaBlock(block.id, cid)}
                                    />
                                    <span className="font-medium">{getPoLabel(cid)}</span>
                                  </label>
                                )
                              })}
                            </div>
                            {formErrors[`${prefix}_contract`] && (
                              <p className="text-[11px] mt-1 text-red-600">{formErrors[`${prefix}_contract`]}</p>
                            )}
                          </div>

                          <div className="overflow-x-auto">
                            {range ? (
                              <p className="px-2 pt-2 text-[10px] text-gray-500">
                                Allowed: {formatDateDMY(range.minIso)} – {formatDateDMY(range.maxIso)}
                              </p>
                            ) : block.contractIds.length > 0 ? (
                              <p className="px-2 pt-2 text-[10px] text-amber-700">
                                Select POs with valid due delivery start/end dates to enable Estimation range limits.
                              </p>
                            ) : null}
                            <table className="w-full text-xs border-collapse min-w-[52rem]">
                              <thead>
                                <tr className="bg-gray-50 border-b">
                                  {ETA_FIELD_ROWS.map(({ shortLabel, label }) => (
                                    <th
                                      key={shortLabel}
                                      className="px-1.5 py-1 text-[10px] font-semibold text-gray-600 whitespace-nowrap text-left"
                                      title={label}
                                    >
                                      {shortLabel}
                                      {etaFieldsRequired ? <span className="text-red-500"> *</span> : null}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  {ETA_FIELD_ROWS.map(({ key, errorSuffix }) => (
                                    <td key={key} className="px-1 py-1 align-top border-t border-gray-100">
                                      <DateInputDdMmYyyy
                                        className={`${COMPACT_DATE_INPUT} ${formErrors[`${prefix}_${errorSuffix}`] ? 'border-red-500' : ''}`}
                                        minIso={range?.minIso}
                                        maxIso={range?.maxIso}
                                        fastEntryGroup={SHIPMENT_ETA_FAST_ENTRY_GROUP}
                                        valueIso={block[key]}
                                        onChangeIso={(iso) => {
                                          updateEtaDetailBlock(block.id, { [key]: iso })
                                          const fieldKey = `${prefix}_${errorSuffix}`
                                          if (
                                            range &&
                                            iso &&
                                            isIsoOutsideAllowedRange(iso, range.minIso, range.maxIso)
                                          ) {
                                            setFormErrors((prev) => ({
                                              ...prev,
                                              [fieldKey]: OUTSIDE_ALLOWED_DATE_RANGE_MESSAGE,
                                            }))
                                          } else {
                                            clearFieldError(fieldKey)
                                          }
                                        }}
                                      />
                                      {formErrors[`${prefix}_${errorSuffix}`] && (
                                        <p className="text-[10px] mt-0.5 text-red-600 leading-tight max-w-[7rem]">
                                          {formErrors[`${prefix}_${errorSuffix}`]}
                                        </p>
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer action bar */}
          <div className={VESSEL_MODAL_FOOTER_CARD_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                {newShipment.contractNumbers.length > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-blue-700 font-medium">
                    <FileText className="h-3 w-3" />
                    {newShipment.contractNumbers.length} PO{newShipment.contractNumbers.length > 1 ? 's' : ''}
                  </span>
                )}
                {newShipment.vesselName && (
                  <span className="flex items-center gap-1 rounded-full bg-cyan-100 px-2.5 py-1 text-cyan-700 font-medium">
                    <Ship className="h-3 w-3" />
                    {newShipment.vesselName}
                  </span>
                )}
                {newShipment.contractNumbers.length === 0 && (
                  <span className="italic text-gray-400">Add at least one PO to continue</span>
                )}
              </div>
              {/* Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => {
                    resetForm()
                    onClose()
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleCreateShipment()}
                  disabled={
                    saving ||
                    loadingEdit ||
                    (!isEditMode &&
                      (newShipment.contractNumbers.some((id) => !contractValidations[id]?.exists) ||
                        !step3Done))
                  }
                  className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isEditMode ? 'Saving changes...' : isPlotMode ? 'Saving planning...' : 'Creating shipment...'}
                    </>
                  ) : (
                    <>
                      <Ship className="h-4 w-4 mr-2" />
                      {isEditMode ? 'Save Changes' : isPlotMode ? 'Save Planning' : 'Create Shipment'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
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
