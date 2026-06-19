'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MasterLoadingPortCombobox } from '@/components/MasterLoadingPortCombobox'
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
  ShipmentPoOption,
} from '@/components/shared/addNewShipmentTypes'
import { EditShipmentModal } from '@/components/shared/EditShipmentModal'

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
  { key: 'etaVesselArrivalAtLoadingPort', label: 'ETA Vessel Arrival at Loading Port', shortLabel: 'Arr. @ LP', errorSuffix: 'arrival' },
  { key: 'etaVesselBerthedAtLoadingPort', label: 'ETA Vessel Berthed at Loading Port', shortLabel: 'Berthed LP', errorSuffix: 'berthed' },
  { key: 'etaVesselStartLoading', label: 'ETA Vessel Start Loading', shortLabel: 'Start Load', errorSuffix: 'startLoading' },
  { key: 'etaVesselCompletedLoading', label: 'ETA Vessel Completed Loading', shortLabel: 'Done Load', errorSuffix: 'completedLoading' },
  { key: 'etaVesselSailedFromLoadingPort', label: 'ETA Vessel Sailed from Loading Port', shortLabel: 'Sail LP', errorSuffix: 'sailed' },
  { key: 'etaVesselArriveAtDischargePort', label: 'ETA Vessel Arrive at Discharge Port', shortLabel: 'Arr. @ DP', errorSuffix: 'arriveDischarge' },
  { key: 'etaVesselBerthedAtDischargePort', label: 'ETA Vessel Berthed at Discharge Port', shortLabel: 'Berthed DP', errorSuffix: 'berthedDischarge' },
  { key: 'etaVesselStartDischarging', label: 'ETA Vessel Start Discharging', shortLabel: 'Start Disch', errorSuffix: 'startDischarging' },
  { key: 'etaVesselCompleteDischarge', label: 'ETA Vessel Complete Discharge', shortLabel: 'Done Disch', errorSuffix: 'completeDischarge' },
]

function etaDetailHasAnyDate(d: EtaDetailFields): boolean {
  return ETA_FIELD_ROWS.some(({ key }) => Boolean(String(d[key] ?? '').trim()))
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
const ETA_DELIVERY_END_BUFFER_DAYS = 60

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
  availablePOs?: ShipmentPoOption[] | null
  editContractId?: string | null
  /** When set (Shipments table edit), load this shipment directly instead of first match by contract. */
  editShipmentId?: string | null
  mode?: 'add' | 'edit'
}

export function AddNewShipmentModal({
  open,
  onClose,
  onSubmit,
  prefilledPOs = null,
  availablePOs = null,
  editContractId = null,
  editShipmentId: editShipmentIdProp = null,
  mode = 'add',
}: AddNewShipmentModalProps) {
  const perms = usePermissions()
  const canAddShipment = canCreatePermission(perms, 'data.shipments')
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canOpenAddShipmentModal = canAddShipment || canEditShipment
  const isEditMode = mode === 'edit'
  const isContractScoped = !isEditMode && Array.isArray(availablePOs) && availablePOs.length > 0
  const openedFromContracts = isContractScoped || isEditMode

  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'warning'
    message: string
    detail?: string
  } | null>(null)
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showNotification = useCallback(
    (type: 'success' | 'error' | 'warning', message: string, detail?: string) => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current)
      setNotification({ type, message, detail })
      notifTimerRef.current = setTimeout(() => setNotification(null), 6000)
    },
    [],
  )

  const [saving, setSaving] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [editShipmentId, setEditShipmentId] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [newShipment, setNewShipment] = useState(emptyShipment)
  const [contractQtyAssigned, setContractQtyAssigned] = useState<Record<string, string>>({})
  const [contractSuggestions, setContractSuggestions] = useState<any[]>([])
  const [contractSearchTerm, setContractSearchTerm] = useState('')
  const [showContractSuggestions, setShowContractSuggestions] = useState(false)
  const poNumberInputRef = useRef<HTMLInputElement>(null)
  const contractNumbersRef = useRef<string[]>([])
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

  useEffect(() => {
    contractNumbersRef.current = newShipment.contractNumbers
  }, [newShipment.contractNumbers])

  const availablePoByKey = useMemo(() => {
    const map = new Map<string, ShipmentPoOption>()
    for (const po of availablePOs ?? []) {
      map.set(po.key, po)
    }
    return map
  }, [availablePOs])

  const remainingContractScopedPos = useMemo(() => {
    if (!isContractScoped || !availablePOs) return []
    const added = new Set(newShipment.contractNumbers)
    return availablePOs.filter((po) => !added.has(po.key))
  }, [isContractScoped, availablePOs, newShipment.contractNumbers])

  const [vesselSuggestions, setVesselSuggestions] = useState<
    Array<{
      vessel_code: string
      vessel_name: string
      vessel_capacity_mt: number | null
      vessel_owner: string | null
      hull_type: string | null
    }>
  >([])
  const [showVesselSuggestions, setShowVesselSuggestions] = useState(false)
  const [mappedPlantSiteName, setMappedPlantSiteName] = useState('')
  const vesselSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const validateContractNumber = useCallback(async (term: string): Promise<string | null> => {
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
          return selectionKey
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
        addPoFromOption(option)
        return
      }
    }

    const contractId = String(contract.contract_id || contract).trim()
    if (!contractId) return

    const resolvedKey = await validateContractNumber(contractId)
    if (!resolvedKey) return

    addPoSelectionKey(resolvedKey, availablePoByKey.get(resolvedKey)?.contractId ?? resolvedKey)
  }

  const handleAddContractManually = async () => {
    const term = contractSearchTerm.trim()
    if (!term) return

    const resolvedKey = await validateContractNumber(term)
    if (!resolvedKey) return

    addPoSelectionKey(resolvedKey, availablePoByKey.get(resolvedKey)?.contractId ?? resolvedKey)
  }

  const handleRemoveContract = (contractId: string) => {
    setNewShipment((prev) => ({
      ...prev,
      contractNumbers: prev.contractNumbers.filter((id) => id !== contractId),
      operationId: prev.contractNumbers.filter((id) => id !== contractId).length > 0 ? prev.operationId : '',
    }))
    setContractQtyAssigned((prev) => {
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
      if (scoped) return scoped.label
      const data = contractValidations[selectionKey]?.contractData
      const poNumber = (data?.po_number || selectionKey) as string
      const plantCode = String(data?.plant_code ?? '').trim()
      return plantCode ? `${poNumber} - ${plantCode}` : poNumber
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

  const handleVesselNameChange = (value: string) => {
    setNewShipment((prev) => ({ ...prev, vesselName: value }))
    if (vesselSearchTimeoutRef.current) clearTimeout(vesselSearchTimeoutRef.current)
    vesselSearchTimeoutRef.current = setTimeout(() => fetchVesselSuggestions(value), 300)
  }

  const handleSelectVessel = (v: {
    vessel_code: string
    vessel_name: string
    vessel_capacity_mt: number | null
    vessel_owner: string | null
    hull_type: string | null
  }) => {
    setNewShipment((prev) => ({
      ...prev,
      vesselName: v.vessel_name,
      vesselCode: v.vessel_code ?? '',
      vesselOwner: v.vessel_owner ?? '',
      vesselCapacity: v.vessel_capacity_mt != null ? String(v.vessel_capacity_mt) : '',
      vesselHullType: v.hull_type ?? '',
    }))
    setShowVesselSuggestions(false)
    setVesselSuggestions([])
  }

  const vesselCapacityNum = newShipment.vesselCapacity ? parseFloat(String(newShipment.vesselCapacity)) : null
  const contractQtyAssignedSum = useMemo(() => {
    return Object.values(contractQtyAssigned).reduce((sum, v) => sum + (parseFloat(String(v)) || 0), 0)
  }, [contractQtyAssigned])
  const contractQtyAssignedExceedsCapacity =
    vesselCapacityNum != null && !Number.isNaN(vesselCapacityNum) && contractQtyAssignedSum > vesselCapacityNum

  const contractQtyAssignedExceedsOutstanding = useMemo(() => {
    const next: Record<string, { assignedMt: number; outstandingMt: number }> = {}
    for (const contractId of newShipment.contractNumbers) {
      const assignedMt = parseFloat(String(contractQtyAssigned[contractId] ?? '')) || 0
      const contractData = contractValidations[contractId]?.contractData
      // Outstanding from API is in Kg; Add Shipment UI uses MT
      const outstandingMt = (Number(contractData?.outstanding_quantity) || 0) / 1000
      if (assignedMt > outstandingMt) {
        next[contractId] = { assignedMt, outstandingMt }
      }
    }
    return next
  }, [contractQtyAssigned, contractValidations, newShipment.contractNumbers])

  const fillAssignQtyFromOutstanding = useCallback(
    (contractId: string) => {
      const validation = contractValidations[contractId]
      const data = validation?.contractData
      if (!validation?.exists || !data) return
      const outstandingMt = (Number(data.outstanding_quantity) || 0) / 1000
      if (outstandingMt <= 0) return
      setContractQtyAssigned((prev) => ({
        ...prev,
        [contractId]: String(outstandingMt),
      }))
      setFormErrors((prev) => {
        const next = { ...prev }
        delete next.contractQty
        return next
      })
    },
    [contractValidations]
  )

  const selectedTransportMode = useMemo(() => {
    const modes = newShipment.contractNumbers
      .map((id) => contractValidations[id]?.contractData?.transport_mode?.toLowerCase())
      .filter(Boolean) as string[]
    if (modes.length === 0) return null
    const isLand = modes.every((m) => m.includes('land') || m.includes('truck'))
    const isSea = modes.every((m) => m.includes('sea') || m.includes('vessel') || m.includes('ship'))
    if (isLand) return 'land'
    if (isSea) return 'sea'
    return 'mixed'
  }, [newShipment.contractNumbers, contractValidations])

  const resolvedPlantCode = useMemo(() => {
    const firstContractId = newShipment.contractNumbers[0]
    if (!firstContractId) return ''
    const data = contractValidations[firstContractId]?.contractData
    return String(data?.plant_code ?? '').trim()
  }, [newShipment.contractNumbers, contractValidations])

  useEffect(() => {
    if (!resolvedPlantCode) {
      setMappedPlantSiteName('')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get('/master-plants', { params: { search: resolvedPlantCode, limit: 50 } })
        const items: Array<{ plant_code?: string; plant_name?: string }> = res.data?.data?.items ?? []
        const codeUpper = resolvedPlantCode.toUpperCase()
        const match = items.find((p) => String(p.plant_code ?? '').trim().toUpperCase() === codeUpper)
        if (!cancelled) {
          setMappedPlantSiteName(match?.plant_name?.trim() || resolvedPlantCode)
        }
      } catch {
        if (!cancelled) setMappedPlantSiteName(resolvedPlantCode)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolvedPlantCode])

  const clearFieldError = (field: string) =>
    setFormErrors((prev) => { const next = { ...prev }; delete next[field]; return next })

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
      setContractQtyAssigned((prev) => ({ ...prev, [selectionKey]: prev[selectionKey] ?? '' }))
      clearPoNumberField()
      setShowContractSuggestions(false)
      return true
    },
    [clearPoNumberField, showNotification],
  )

  const addPoFromOption = useCallback(
    (option: ShipmentPoOption): boolean => {
      seedPoValidation(option)
      return addPoSelectionKey(option.key, option.contractId)
    },
    [addPoSelectionKey, seedPoValidation],
  )

  const resetForm = useCallback(() => {
    setNewShipment(emptyShipment())
    contractNumbersRef.current = []
    setContractQtyAssigned({})
    setContractValidations({})
    setEtaDetails([])
    setContractSearchTerm('')
    setContractSuggestions([])
    setShowContractSuggestions(false)
    setVesselSuggestions([])
    setShowVesselSuggestions(false)
    setMappedPlantSiteName('')
    setFormErrors({})
    setEditShipmentId(null)
    setLoadingEdit(false)
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

      const contractNumbersRaw = String(
        row.contract_numbers ?? shipment.contract_number ?? contractIdFallback,
      )
        const contractNumbers = contractNumbersRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      const uniqueContractIds = contractNumbers.length > 0 ? contractNumbers : [contractIdFallback]

      for (const cid of uniqueContractIds) {
        await validateContractNumber(cid)
      }

      const qtyAssigned: Record<string, string> = {}
      for (const cid of uniqueContractIds) {
        qtyAssigned[cid] = ''
      }

      const assignmentKey =
        String(shipment.sto_number ?? row.sto_number ?? '').trim() ||
        String(shipment.operation_id ?? row.operation_id ?? '').trim()
      if (assignmentKey) {
        try {
          const detailsRes = await api.get('/shipments/contracts/details', {
            params: {
              sto: assignmentKey,
              contractNumbers: uniqueContractIds.join(','),
            },
          })
          if (detailsRes.data?.success && Array.isArray(detailsRes.data.data)) {
            for (const detail of detailsRes.data.data as Array<{
              contract_number?: string
              sto_qty_assigned?: number | string
            }>) {
              const cn = String(detail.contract_number ?? '').trim()
              if (cn && detail.sto_qty_assigned != null && detail.sto_qty_assigned !== '') {
                qtyAssigned[cn] = String(detail.sto_qty_assigned)
              }
            }
          }
        } catch {
          // Read-only display fallback: keep empty if assignment lookup fails
        }
      }

      let loadingPortRow: VesselLoadingPortRow | null = null
      try {
        const portsRes = await api.get(`/shipments/${shipmentId}/loading-ports`)
        const ports: VesselLoadingPortRow[] = portsRes.data?.data?.ports ?? []
        loadingPortRow =
          ports.find((p) => !p.is_discharge_port && p.port_sequence === 1) ||
          ports.find((p) => !p.is_discharge_port) ||
          null
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
      setContractQtyAssigned(qtyAssigned)

      const etaBlock = createShipmentEtaDetail([...uniqueContractIds])
      applyShipmentEtaToBlock(etaBlock, shipment, row, loadingPortRow)
      setEtaDetails([etaBlock])
    },
    [validateContractNumber],
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

  useEffect(() => {
    if (!open) {
      initSessionRef.current = null
      return
    }

    const sessionKey = [
      isEditMode ? 'edit' : 'add',
      editContractId ?? '',
      editShipmentIdProp ?? '',
      prefilledPOs?.map((p) => p.key).join('|') ?? '',
    ].join(':')
    if (initSessionRef.current === sessionKey) return
    initSessionRef.current = sessionKey

    resetForm()

    const directShipmentId = editShipmentIdProp?.trim()
    const editId = editContractId?.trim()
    if (isEditMode && directShipmentId) {
      void loadShipmentForEditById(directShipmentId, editId || directShipmentId)
      return
    }
    if (isEditMode && editId) {
      void loadShipmentForEdit(editId)
      return
    }

    if (prefilledPOs?.length) {
      const keys = prefilledPOs.map((po) => po.key)
      const validations: typeof contractValidations = {}
      const qtySeed: Record<string, string> = {}
      for (const po of prefilledPOs) {
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
        qtySeed[po.key] = ''
      }
      setContractValidations(validations)
      setContractQtyAssigned(qtySeed)
      contractNumbersRef.current = keys
      setNewShipment((prev) => ({
        ...prev,
        contractNumbers: keys,
        operationId: generateOperationId(prefilledPOs[0].contractId),
      }))
      setEtaDetails([createShipmentEtaDetail([...keys])])
    }
  }, [
    open,
    editContractId,
    editShipmentIdProp,
    isEditMode,
    prefilledPOs,
    resetForm,
    loadShipmentForEdit,
    loadShipmentForEditById,
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
    const hasAnyQty = newShipment.contractNumbers.some((id) => parseFloat(contractQtyAssigned[id] ?? '') > 0)
    if (newShipment.contractNumbers.length > 0 && !hasAnyQty)
      errors.contractQty = 'Contract Qty assign to STO must be filled for at least one contract'
    if (transportMode === 'sea' || transportMode === 'mixed') {
      if (!newShipment.vesselName.trim()) errors.vesselName = 'Vessel Name is required for Sea contracts'
      if (!newShipment.charterType) errors.charterType = 'Charter Type is required for Sea contracts'
      if (!newShipment.portOfDischarge.trim()) errors.portOfDischarge = 'Discharge Port is required for Sea contracts'
    }

    const usedContractIds = new Set<string>()
    for (const block of etaDetails) {
      const prefix = `eta_${block.id}`
      const hasDates = etaDetailHasAnyDate(block)
      const selectedIds = block.contractIds.filter(Boolean)

      if ((transportMode === 'sea' || transportMode === 'mixed') && newShipment.contractNumbers.length > 0) {
        if (!block.loadingPort.trim()) {
          errors[`${prefix}_loadingPort`] = 'Loading Port is required'
        }
      }

      if (hasDates && selectedIds.length === 0) {
        errors[`${prefix}_contract`] = 'Select at least one PO for this shipment detail'
      }

      for (const cid of selectedIds) {
        if (!newShipment.contractNumbers.includes(cid)) {
          errors[`${prefix}_contract`] = 'One or more selected POs are not in the contract list above'
          break
        }
        if (hasDates) {
          if (usedContractIds.has(cid)) {
            errors[`${prefix}_contract`] =
              'A PO cannot appear in more than one shipment detail block. Adjust selections.'
            break
          }
          usedContractIds.add(cid)
        }
      }

      if (hasDates && selectedIds.length > 0) {
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

    if (!validateShipmentForm(selectedTransportMode)) return

    if (isEditMode) {
      try {
        setSaving(true)
        const primaryBlock = etaDetails[0]
        if (!primaryBlock) {
          showNotification('error', 'No ETA details to save')
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

    if (contractQtyAssignedExceedsCapacity) {
      showNotification('warning', 'Quantity exceeds vessel capacity', 'Sum of "Assign STO (MT)" cannot exceed Vessel Capacity.')
      return
    }
    if (Object.keys(contractQtyAssignedExceedsOutstanding).length > 0) {
      const first = Object.keys(contractQtyAssignedExceedsOutstanding)[0]
      const { assignedMt, outstandingMt } = contractQtyAssignedExceedsOutstanding[first]
      showNotification(
        'warning',
        `Assigned qty exceeds outstanding for ${first}`,
        `Assigned ${formatNumber(assignedMt)} MT, but outstanding is only ${formatNumber(outstandingMt)} MT.`,
      )
      return
    }

    try {
      setSaving(true)

      const operationId = newShipment.operationId || generateOperationId(newShipment.contractNumbers[0])

      const etaByContract: Record<string, ReturnType<typeof etaDetailToApiPayload>> = {}
      for (const block of etaDetails) {
        if (!etaDetailHasAnyDate(block) || block.contractIds.length === 0) continue
        const etaPayload = etaDetailToApiPayload(block)
        for (const selectionKey of block.contractIds) {
          etaByContract[resolveContractIdForKey(selectionKey)] = etaPayload
        }
      }

      const selectionKeys = newShipment.contractNumbers
      const contractNumbers = [...new Set(selectionKeys.map((k) => resolveContractIdForKey(k)))]

      const poQtyAssigned: Record<string, string> = {}
      const contractQtyAssignedPayload: Record<string, string> = {}
      if (isContractScoped) {
        for (const key of selectionKeys) {
          const qty = contractQtyAssigned[key]
          if (qty && parseFloat(String(qty)) > 0) poQtyAssigned[key] = String(qty)
        }
      } else {
        for (const key of selectionKeys) {
          const qty = contractQtyAssigned[key]
          if (qty !== undefined && qty !== '') contractQtyAssignedPayload[key] = String(qty)
        }
      }

      await onSubmit({
        kind: 'create',
        operationId,
        stoNumber: '',
        contractNumbers,
        contractQtyAssigned: contractQtyAssignedPayload,
        poQtyAssigned: Object.keys(poQtyAssigned).length > 0 ? poQtyAssigned : undefined,
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
      })

      showNotification('success', 'Shipment created successfully!')
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

  const vesselDropdownOpen = showVesselSuggestions && vesselSuggestions.length > 0
  const section2DropdownOpen = vesselDropdownOpen

  const step1Done = newShipment.contractNumbers.length > 0 && newShipment.contractNumbers.every((id) => contractValidations[id]?.exists)
  const step2Done = Boolean(newShipment.vesselName.trim() || selectedTransportMode === 'land')
  const step3Done = etaDetails.some((b) => etaDetailHasAnyDate(b))

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

  if (!open) return null

  if (isEditMode) {
    return (
      <EditShipmentModal
        open={open}
        onClose={() => {
          resetForm()
          onClose()
        }}
        onSubmit={onSubmit}
        editContractId={editContractId}
        editShipmentId={editShipmentIdProp}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 shrink-0 rounded-t-lg border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">
                <Ship className="h-4.5 w-4.5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {isEditMode ? 'Edit Shipment' : 'Add New Shipment'}
                </h3>
                <p className="text-xs text-gray-500">
                  {isEditMode
                    ? 'Only ETA schedule dates can be changed'
                    : 'Fill in contract, vessel, and ETA details'}
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
          <div className="flex items-center gap-0 border-t border-gray-100 px-6 py-2 bg-gray-50/80">
            {[
              { num: 1, label: 'Contract & PO', done: step1Done, icon: <FileText className="h-3.5 w-3.5" /> },
              { num: 2, label: 'Vessel Detail', done: step2Done, icon: <Anchor className="h-3.5 w-3.5" /> },
              { num: 3, label: 'ETA Schedule + Loading Port', done: step3Done, icon: <Clock className="h-3.5 w-3.5" /> },
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4" {...{ [FAST_ENTRY_ROOT_ATTR]: 'true' }}>
        {loadingEdit && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading shipment details…
          </div>
        )}
        {/* Notification banner */}
        {notification && (
          <div
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
                  <strong>Required:</strong> at least one PO &nbsp;•&nbsp; <strong>Optional:</strong> port, plant/site, ETA &nbsp;•&nbsp;
                  <strong>Note:</strong> Operation ID is auto-generated; STO will be filled from SAP when available
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
                    value=""
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
                            onClick={() => addPoFromOption(po)}
                          >
                            <Plus className="h-3 w-3 mr-0.5" />
                            {po.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {isContractScoped && newShipment.contractNumbers.length === 0 && !prefilledPOs?.length && (
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
                            <TableHead className={`${COMPACT_TH} text-right`}>Contract</TableHead>
                            <TableHead className={`${COMPACT_TH} text-right`}>Outstanding</TableHead>
                            <TableHead className={COMPACT_TH}>Del. Start</TableHead>
                            <TableHead className={COMPACT_TH}>Del. End</TableHead>
                            <TableHead className={`${COMPACT_TH} text-right w-36`}>Assign STO (MT)</TableHead>
                            {!isEditMode && <TableHead className={`${COMPACT_TH} w-8`} />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {newShipment.contractNumbers.map((contractId) => {
                            const validation = contractValidations[contractId]
                            const data = validation?.contractData
                            const label = getPoLabel(contractId)
                            const exceed = contractQtyAssignedExceedsOutstanding[contractId]
                            const rowError =
                              Boolean(exceed) || Boolean(formErrors.contractQty && validation?.exists)
                            const contractQtyMt = (Number(data?.quantity_ordered) || 0) / 1000
                            const outstandingQtyMt = (Number(data?.outstanding_quantity) || 0) / 1000
                            return (
                              <TableRow
                                key={contractId}
                                className={rowError ? 'bg-red-50/60 hover:bg-red-50/60' : undefined}
                              >
                                <TableCell className={COMPACT_TD}>
                                  <div className="flex items-center gap-1 min-w-[5.5rem]">
                                    <span className="font-medium truncate max-w-[7rem]" title={label}>
                                      {label}
                                    </span>
                                    {validation?.checking && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                                    {validation?.exists && <Check className="h-3 w-3 text-green-600 shrink-0" />}
                                    {validation?.exists === false && !validation?.checking && (
                                      <X className="h-3 w-3 text-red-600 shrink-0" />
                                    )}
                                  </div>
                                  {data?.po_number && (
                                    <div className="text-[10px] text-gray-400 truncate" title={contractId}>
                                      {contractId}
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
                                <TableCell className={COMPACT_TD}>
                                  {validation?.exists ? formatShortDate(data?.delivery_start_date || '') : '—'}
                                </TableCell>
                                <TableCell className={COMPACT_TD}>
                                  {validation?.exists ? formatShortDate(data?.delivery_end_date || '') : '—'}
                                </TableCell>
                                <TableCell className={COMPACT_TD}>
                                  {validation?.exists ? (
                                    <div className="flex flex-col gap-1 min-w-[11rem]">
                                      <div className="flex items-center gap-1.5">
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={contractQtyAssigned[contractId] ?? ''}
                                          onChange={(e) =>
                                            setContractQtyAssigned((prev) => ({
                                              ...prev,
                                              [contractId]: e.target.value,
                                            }))
                                          }
                                          readOnly={isEditMode}
                                          disabled={isEditMode}
                                          className={`h-8 text-xs w-24 text-right ${isEditMode ? READONLY_FIELD_CLASS : 'bg-white'} ${exceed ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                                          placeholder="0"
                                        />
                                        <button
                                          type="button"
                                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors shrink-0 ${
                                            outstandingQtyMt <= 0 || isEditMode
                                              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                                              : 'cursor-pointer border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300'
                                          }`}
                                          onClick={() => fillAssignQtyFromOutstanding(contractId)}
                                          disabled={outstandingQtyMt <= 0 || isEditMode}
                                          title={`Set to outstanding quantity: ${formatNumber(outstandingQtyMt)} MT`}
                                        >
                                          <Check className="h-2.5 w-2.5" />
                                          Use outstanding
                                        </button>
                                      </div>
                                      {exceed ? (
                                        <span className="text-[10px] text-red-600 leading-tight flex items-center gap-0.5">
                                          <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                                          Max {formatNumber(exceed.outstandingMt)} MT
                                        </span>
                                      ) : (
                                        outstandingQtyMt > 0 && (
                                          <span className="text-[10px] text-gray-400 leading-tight">
                                            Max {formatNumber(outstandingQtyMt)} MT
                                          </span>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400">?</span>
                                  )}
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
                        <TableFooter>
                          <TableRow
                            className={
                              contractQtyAssignedExceedsCapacity ||
                              Object.keys(contractQtyAssignedExceedsOutstanding).length > 0
                                ? 'bg-red-50 hover:bg-red-50'
                                : 'bg-gray-50/80 hover:bg-gray-50'
                            }
                          >
                            <TableCell colSpan={isEditMode ? 5 : 6} className={`${COMPACT_TD} font-medium text-gray-700`}>
                              <div className="flex flex-col gap-1">
                                <span>
                                  Total assigned
                                  {vesselCapacityNum != null && !Number.isNaN(vesselCapacityNum) && (
                                    <span className="font-normal text-gray-500 ml-1.5">
                                      / {formatNumber(vesselCapacityNum)} MT capacity
                                    </span>
                                  )}
                                </span>
                                {vesselCapacityNum != null && !Number.isNaN(vesselCapacityNum) && vesselCapacityNum > 0 && (
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden max-w-[10rem]">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          contractQtyAssignedExceedsCapacity ? 'bg-red-500' : 'bg-blue-500'
                                        }`}
                                        style={{ width: `${Math.min(100, (contractQtyAssignedSum / vesselCapacityNum) * 100)}%` }}
                                      />
                                    </div>
                                    <span className={`text-[10px] font-medium ${contractQtyAssignedExceedsCapacity ? 'text-red-600' : 'text-gray-500'}`}>
                                      {Math.round((contractQtyAssignedSum / vesselCapacityNum) * 100)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className={`${COMPACT_TD} text-right font-semibold tabular-nums ${contractQtyAssignedExceedsCapacity ? 'text-red-700' : 'text-gray-800'}`}>
                              {formatNumber(contractQtyAssignedSum)} MT
                            </TableCell>
                            {!isEditMode && <TableCell />}
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                    {contractQtyAssignedExceedsCapacity && (
                      <p className="text-[11px] text-red-700 mt-1">Total assigned cannot exceed Vessel Capacity (MT).</p>
                    )}
                    {formErrors.contractQty && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.contractQty}</p>
                    )}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-visible">
                <div
                  className={`relative overflow-visible ${vesselDropdownOpen ? 'z-[100]' : 'z-0'}`}
                >
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vessel Name
                    {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                      <span className="text-red-500"> *</span>
                    )}
                  </label>
                  <Input
                    value={newShipment.vesselName}
                    onChange={(e) => { handleVesselNameChange(e.target.value); clearFieldError('vesselName') }}
                    onFocus={() => !isEditMode && newShipment.vesselName.trim().length >= 2 && setShowVesselSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowVesselSuggestions(false), 200)}
                    placeholder="Type to search vessel name (from Master Vessel)"
                    readOnly={isEditMode}
                    disabled={isEditMode}
                    className={`${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.vesselName ? 'border-red-500' : ''}`}
                  />
                  {vesselDropdownOpen && (
                    <div className={AUTOCOMPLETE_PANEL_CLASS}>
                      {vesselSuggestions.map((v) => (
                        <div
                          key={v.vessel_code}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition-colors"
                          onMouseDown={() => handleSelectVessel(v)}
                        >
                          <div className="font-semibold text-sm text-gray-900">{v.vessel_name}</div>
                          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            <span className="font-mono">{v.vessel_code}</span>
                            {v.vessel_owner && <><span className="text-gray-300">•</span><span>{v.vessel_owner}</span></>}
                            {v.vessel_capacity_mt != null && <><span className="text-gray-300">•</span><span className="text-cyan-600 font-medium">{formatNumber(v.vessel_capacity_mt)} MT</span></>}
                            {v.hull_type && <><span className="text-gray-300">•</span><span>{v.hull_type}</span></>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
                <div className="relative z-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Charter Type
                    {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                      <span className="text-red-500"> *</span>
                    )}
                  </label>
                  <select
                    value={newShipment.charterType}
                    onChange={(e) => { setNewShipment((prev) => ({ ...prev, charterType: e.target.value })); clearFieldError('charterType') }}
                    disabled={isEditMode}
                    className={`w-full h-10 rounded-md border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${isEditMode ? READONLY_FIELD_CLASS : 'bg-background'} ${formErrors.charterType ? 'border-red-500' : 'border-input'}`}
                  >
                    <option value="">Select charter type</option>
                    <option value="CIF">CIF</option>
                    <option value="V/C">V/C</option>
                    <option value="T/C">T/C</option>
                  </select>
                  {formErrors.charterType && <p className="text-xs mt-1 text-red-600">{formErrors.charterType}</p>}
                </div>
                <div className="relative z-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Discharge Port
                    {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                      <span className="text-red-500"> *</span>
                    )}
                  </label>
                  <MasterLoadingPortCombobox
                    value={newShipment.portOfDischarge}
                    onChange={(val) => {
                      setNewShipment((prev) => ({ ...prev, portOfDischarge: val }))
                      clearFieldError('portOfDischarge')
                    }}
                    placeholder="Search port name..."
                    disabled={isEditMode}
                    className={`${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.portOfDischarge ? 'border-red-500' : ''}`}
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
                    placeholder={resolvedPlantCode ? 'Resolving plant name...' : 'Add a contract in Section 1'}
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
              <h4 className="text-sm font-semibold text-gray-800">3. ETA Schedule + Loading Port</h4>
              {step3Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
            </div>
            <div className="p-4 space-y-3">
              {contractDeliveryReferences.length > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-medium text-blue-900">Official contract delivery timeframe (from SAP)</p>
                    <p className="text-blue-800/90">
                      ETA from Arr. @ LP through Done Disch may be up to {ETA_DELIVERY_START_BUFFER_DAYS} days before
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
                <p className="text-xs font-medium text-gray-500">ETA dates are optional — fill in as available</p>
                {!isEditMode &&
                  (selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') &&
                  newShipment.contractNumbers.length > 0 && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addEtaDetailBlock}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add ETA row
                    </Button>
                  )}
              </div>

              {selectedTransportMode === null && (
                <p className="text-xs text-gray-400 italic">Add a contract in Section 1 to see ETA fields.</p>
              )}

              {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                <>
                  {selectedTransportMode === 'mixed' && (
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sea</p>
                  )}

                  {newShipment.contractNumbers.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Add PO in Section 1 before adding ETA.</p>
                  )}

                  <div className="space-y-2">
                    {etaDetails.map((block, index) => {
                      const prefix = `eta_${block.id}`
                      const range =
                        block.contractIds.length > 0 ? getEtaDateRangeForContractIds(block.contractIds) : null
                      return (
                        <div key={block.id} className="rounded-md border border-gray-200 overflow-hidden text-xs">
                          <div className="flex items-center justify-between bg-gray-50 px-2 py-1 border-b">
                            <span className="font-semibold text-gray-600">ETA #{index + 1}</span>
                            {!isEditMode && (
                              <button
                                type="button"
                                className="text-gray-400 hover:text-gray-600 p-0.5"
                                aria-label="Remove ETA row"
                                onClick={() => removeEtaDetailBlock(block.id)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="px-2 py-1.5 border-b bg-white space-y-2">
                            <div className="relative overflow-visible z-0">
                              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                                Loading Port <span className="text-red-500">*</span>
                              </label>
                              <MasterLoadingPortCombobox
                                value={block.loadingPort}
                                onChange={(val) => {
                                  updateEtaDetailBlock(block.id, { loadingPort: val })
                                  clearFieldError(`${prefix}_loadingPort`)
                                }}
                                placeholder="Search port name..."
                                disabled={isEditMode}
                                className={`h-8 text-xs ${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors[`${prefix}_loadingPort`] ? 'border-red-500' : ''}`}
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
                                        ? 'This PO is already assigned to another ETA block'
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
                                Select POs with valid due delivery start/end dates to enable ETA range limits.
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
          <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3">
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
                {contractQtyAssignedSum > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-green-700 font-medium">
                    {formatNumber(contractQtyAssignedSum)} MT assigned
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
                      (contractQtyAssignedExceedsCapacity ||
                        newShipment.contractNumbers.some((id) => !contractValidations[id]?.exists)))
                  }
                  className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isEditMode ? 'Saving changes...' : 'Creating shipment...'}
                    </>
                  ) : (
                    <>
                      <Ship className="h-4 w-4 mr-2" />
                      {isEditMode ? 'Save Changes' : 'Create Shipment'}
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
  )
}
