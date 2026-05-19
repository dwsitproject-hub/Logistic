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
import { PlantSiteCombobox } from '@/components/PlantSiteCombobox'
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
import { formatDateDMY } from '@/lib/dateFormat'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  usePermissions,
  canCreatePermission,
  canEditPermission,
} from '@/components/PermissionsContext'

type EtaDetailFields = {
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

function etaDetailToApiPayload(d: EtaDetailFields) {
  return {
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

export function AddShipmentModal({
  open,
  onClose,
  onCreated,
  initialContractId,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** When opening from Contracts: pre-load contract and hide PO Number search */
  initialContractId?: string | null
}) {
  const perms = usePermissions()
  const canAddShipment = canCreatePermission(perms, 'data.shipments')
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canOpenAddShipmentModal = canAddShipment || canEditShipment
  /** Opened from Contracts menu: contract is pre-selected; PO search is only on Shipments page */
  const openedFromContracts = Boolean(initialContractId?.trim())

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
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [newShipment, setNewShipment] = useState(emptyShipment)
  const [contractQtyAssigned, setContractQtyAssigned] = useState<Record<string, string>>({})
  const [contractSuggestions, setContractSuggestions] = useState<any[]>([])
  const [contractSearchTerm, setContractSearchTerm] = useState('')
  const [showContractSuggestions, setShowContractSuggestions] = useState(false)
  const [contractValidations, setContractValidations] = useState<{
    [contractId: string]: {
      checking: boolean
      exists: boolean
      contractData: any
      message: string
    }
  }>({})
  const [etaDetails, setEtaDetails] = useState<ShipmentEtaDetail[]>([])

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
  const [portSuggestions, setPortSuggestions] = useState<Array<{ port: string; region: string | null }>>([])
  const [showPortSuggestions, setShowPortSuggestions] = useState(false)
  const vesselSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const portSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const formatShortDate = (dateStr: string) => formatDateDMY(dateStr)

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
          setContractValidations((prev) => {
            const next = { ...prev }
            if (term !== resolvedContractId) delete next[term]
            next[resolvedContractId] = {
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
          return resolvedContractId
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
  }, [])

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

  const handleAddContract = async (contract: any) => {
    const contractId = String(contract.contract_id || contract).trim()
    if (!newShipment.contractNumbers.includes(contractId)) {
      await validateContractNumber(contractId)

      setNewShipment((prev) => ({
        ...prev,
        contractNumbers: [...prev.contractNumbers, contractId],
      }))
      setContractQtyAssigned((prev) => ({ ...prev, [contractId]: prev[contractId] ?? '' }))
    }
    setContractSearchTerm('')
    setShowContractSuggestions(false)
  }

  const handleAddContractManually = async () => {
    const term = contractSearchTerm.trim()
    if (!term) return

    const resolvedContractId = await validateContractNumber(term)
    if (!resolvedContractId) return

    if (!newShipment.contractNumbers.includes(resolvedContractId)) {
      setNewShipment((prev) => ({
        ...prev,
        contractNumbers: [...prev.contractNumbers, resolvedContractId],
      }))
      setContractQtyAssigned((prev) => ({ ...prev, [resolvedContractId]: prev[resolvedContractId] ?? '' }))
    }
    setContractSearchTerm('')
    setShowContractSuggestions(false)
  }

  const handleRemoveContract = (contractId: string) => {
    setNewShipment((prev) => ({
      ...prev,
      contractNumbers: prev.contractNumbers.filter((id) => id !== contractId),
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
    (contractId: string) => {
      const data = contractValidations[contractId]?.contractData
      return (data?.po_number || contractId) as string
    },
    [contractValidations],
  )

  const getEtaDateRangeForContract = useCallback(
    (contractId: string) => {
      const contractDateStr = contractValidations[contractId]?.contractData?.contract_date
      if (!contractDateStr) return null
      const contractDate = new Date(contractDateStr)
      const minDate = new Date(contractDate)
      minDate.setDate(minDate.getDate() - 30)
      const maxDate = new Date(contractDate)
      maxDate.setFullYear(maxDate.getFullYear() + 1)
      return {
        minIso: minDate.toISOString().slice(0, 10),
        maxIso: maxDate.toISOString().slice(0, 10),
      }
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

  const addEtaDetailBlock = () => {
    setEtaDetails((prev) => [...prev, createShipmentEtaDetail()])
  }

  const togglePoForEtaBlock = (blockId: string, contractId: string) => {
    setEtaDetails((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b
        const selected = b.contractIds.includes(contractId)
        return {
          ...b,
          contractIds: selected
            ? b.contractIds.filter((id) => id !== contractId)
            : [...b.contractIds, contractId],
        }
      }),
    )
    clearFieldError(`eta_${blockId}_contract`)
  }

  const setAllPosForEtaBlock = (blockId: string, selectAll: boolean) => {
    setEtaDetails((prev) =>
      prev.map((b) =>
        b.id === blockId
          ? { ...b, contractIds: selectAll ? [...newShipment.contractNumbers] : [] }
          : b,
      ),
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

  const handlePortOfLoadingChange = (value: string) => {
    setNewShipment((prev) => ({ ...prev, portOfLoading: value }))
    if (portSearchTimeoutRef.current) clearTimeout(portSearchTimeoutRef.current)
    portSearchTimeoutRef.current = setTimeout(() => fetchPortSuggestions(value), 300)
  }

  const handleSelectPort = (p: { port: string }) => {
    setNewShipment((prev) => ({ ...prev, portOfLoading: p.port }))
    setShowPortSuggestions(false)
    setPortSuggestions([])
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

  const clearFieldError = (field: string) =>
    setFormErrors((prev) => { const next = { ...prev }; delete next[field]; return next })

  const resetForm = useCallback(() => {
    setNewShipment(emptyShipment())
    setContractQtyAssigned({})
    setContractValidations({})
    setEtaDetails([])
    setContractSearchTerm('')
    setContractSuggestions([])
    setShowContractSuggestions(false)
    setVesselSuggestions([])
    setShowVesselSuggestions(false)
    setPortSuggestions([])
    setShowPortSuggestions(false)
    setFormErrors({})
  }, [])

  useEffect(() => {
    if (!open) return
    resetForm()
    const cid = initialContractId?.trim()
    if (!cid) return
    void (async () => {
      const resolved = await validateContractNumber(cid)
      if (!resolved) return
      setNewShipment((prev) => ({ ...prev, contractNumbers: [resolved] }))
      setContractQtyAssigned((prev) => ({ ...prev, [resolved]: prev[resolved] ?? '' }))
    })()
  }, [open, initialContractId, resetForm, validateContractNumber])

  /** Auto-show one ETA row when ≥1 PO is on the shipment (sea / mixed). */
  useEffect(() => {
    if (!open) return
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
      return prev.map((block, index) => {
        const kept = block.contractIds.filter((id) => contractIds.includes(id))
        if (index !== 0) return { ...block, contractIds: kept }
        const newlyAdded = contractIds.filter((id) => !kept.includes(id))
        return { ...block, contractIds: [...kept, ...newlyAdded] }
      })
    })
  }, [open, newShipment.contractNumbers, selectedTransportMode])

  const validateShipmentForm = (mode: string | null): boolean => {
    const errors: Record<string, string> = {}
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
    if (mode === 'sea' || mode === 'mixed') {
      if (!newShipment.vesselName.trim()) errors.vesselName = 'Vessel Name is required for Sea contracts'
      if (!newShipment.charterType) errors.charterType = 'Charter Type is required for Sea contracts'
    }

    const usedContractIds = new Set<string>()
    for (const block of etaDetails) {
      const prefix = `eta_${block.id}`
      const hasDates = etaDetailHasAnyDate(block)
      const selectedIds = block.contractIds.filter(Boolean)

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
            'Selected POs have incompatible contract date ranges; split into separate shipment details.'
        } else {
          const rangeMsg = `Date must be between ${formatDateDMY(range.minIso)} (contract date − 30 days) and ${formatDateDMY(range.maxIso)} (contract date + 1 year)`
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

    if (!validateShipmentForm(selectedTransportMode)) return

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

      const operationId = `OP-${newShipment.contractNumbers[0]}-${Date.now().toString().slice(-8)}`

      const etaByContract: Record<string, ReturnType<typeof etaDetailToApiPayload>> = {}
      for (const block of etaDetails) {
        if (!etaDetailHasAnyDate(block) || block.contractIds.length === 0) continue
        const payload = etaDetailToApiPayload(block)
        for (const cid of block.contractIds) {
          etaByContract[cid] = payload
        }
      }

      const shipmentData = {
        ...newShipment,
        operationId,
        stoNumber: '',
        contractQtyAssigned,
        etaByContract,
      }
      const response = await api.post('/shipments', shipmentData)

      if (response.data.success) {
        showNotification('success', 'Shipment created successfully!')
        resetForm()
        onClose()
        onCreated()
      } else {
        showNotification('error', response.data.error?.message || 'Failed to create shipment')
      }
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
  const portDropdownOpen = showPortSuggestions && portSuggestions.length > 0
  const section2DropdownOpen = vesselDropdownOpen || portDropdownOpen

  const step1Done = newShipment.contractNumbers.length > 0 && newShipment.contractNumbers.every((id) => contractValidations[id]?.exists)
  const step2Done = Boolean(newShipment.vesselName.trim() || selectedTransportMode === 'land')
  const step3Done = etaDetails.some((b) => etaDetailHasAnyDate(b))

  if (!open) return null

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
                <h3 className="text-lg font-semibold text-gray-900">Add New Shipment</h3>
                <p className="text-xs text-gray-500">Fill in contract, vessel, and ETA details</p>
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
              { num: 3, label: 'ETA Schedule', done: step3Done, icon: <Clock className="h-3.5 w-3.5" /> },
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
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
                      newShipment.contractNumbers.length > 0
                        ? `OP-${newShipment.contractNumbers[0]}-${Date.now().toString().slice(-8)}`
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
                {!openedFromContracts && (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-gray-700">PO Number <span className="text-red-500">*</span></label>
                      <span className="text-[10px] text-gray-400">Ketik PO Number lalu tekan Enter atau klik Add PO</span>
                    </div>
                    <div
                      className={`relative ${showContractSuggestions && contractSuggestions.length > 0 ? 'z-[100]' : 'z-0'}`}
                    >
                      <div className="flex gap-2">
                        <Input
                          value={contractSearchTerm}
                          onChange={(e) => handleContractSearch(e.target.value)}
                          onFocus={() => setShowContractSuggestions(true)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void handleAddContractManually()
                            }
                          }}
                          placeholder="Search PO Number..."
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
                              key={contract.contract_id}
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
                  </>
                )}

                {openedFromContracts && newShipment.contractNumbers.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading contract details…
                  </div>
                )}

                {newShipment.contractNumbers.length > 0 && (
                  <div className={openedFromContracts ? 'mt-0' : 'mt-2'}>
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
                            {!openedFromContracts && <TableHead className={`${COMPACT_TH} w-8`} />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {newShipment.contractNumbers.map((contractId) => {
                            const validation = contractValidations[contractId]
                            const data = validation?.contractData
                            const label = (data?.po_number || contractId) as string
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
                                          className={`h-8 text-xs w-24 text-right bg-white ${exceed ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                                          placeholder="0"
                                        />
                                        <button
                                          type="button"
                                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors shrink-0 ${
                                            outstandingQtyMt <= 0
                                              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                                              : 'cursor-pointer border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300'
                                          }`}
                                          onClick={() => fillAssignQtyFromOutstanding(contractId)}
                                          disabled={outstandingQtyMt <= 0}
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
                                {!openedFromContracts && (
                                  <TableCell className={`${COMPACT_TD} text-center`}>
                                    <button
                                      type="button"
                                      className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                      disabled={initialContractId?.trim() === contractId}
                                      aria-label={`Remove PO ${label}`}
                                      onClick={() => {
                                        if (initialContractId?.trim() === contractId) return
                                        handleRemoveContract(contractId)
                                      }}
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
                            <TableCell colSpan={openedFromContracts ? 5 : 6} className={`${COMPACT_TD} font-medium text-gray-700`}>
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
                            {!openedFromContracts && <TableCell />}
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
                    onFocus={() => newShipment.vesselName.trim().length >= 2 && setShowVesselSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowVesselSuggestions(false), 200)}
                    placeholder="Type to search vessel name (from Master Vessel)"
                    className={formErrors.vesselName ? 'border-red-500' : ''}
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
                    className={`w-full h-10 rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${formErrors.charterType ? 'border-red-500' : 'border-input'}`}
                  >
                    <option value="">Select charter type</option>
                    <option value="CIF">CIF</option>
                    <option value="V/C">V/C</option>
                    <option value="T/C">T/C</option>
                  </select>
                  {formErrors.charterType && <p className="text-xs mt-1 text-red-600">{formErrors.charterType}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-visible">
                <div
                  className={`relative overflow-visible ${portDropdownOpen ? 'z-[100]' : 'z-0'}`}
                >
                  <label className="block text-xs font-medium text-gray-500 mb-1">Port of Loading (Optional)</label>
                  <Input
                    value={newShipment.portOfLoading}
                    onChange={(e) => handlePortOfLoadingChange(e.target.value)}
                    onFocus={() => newShipment.portOfLoading.trim().length >= 2 && setShowPortSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowPortSuggestions(false), 200)}
                    placeholder="Type to search port (from Master Loading Port)"
                  />
                  {portDropdownOpen && (
                    <div className={AUTOCOMPLETE_PANEL_CLASS}>
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">Plant/Site (Discharge Port) (Optional)</label>
                  <PlantSiteCombobox
                    value={newShipment.portOfDischarge}
                    onChange={(val) => setNewShipment((prev) => ({ ...prev, portOfDischarge: val }))}
                    placeholder="Search plant/site..."
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
              <h4 className="text-sm font-semibold text-gray-800">3. ETA Schedule</h4>
              {step3Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-500">ETA dates are optional — fill in as available</p>
                {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') &&
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
                            <button
                              type="button"
                              className="text-gray-400 hover:text-gray-600 p-0.5"
                              aria-label="Remove ETA row"
                              onClick={() => removeEtaDetailBlock(block.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="px-2 py-1.5 border-b bg-white">
                            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                              <span className="text-gray-600 font-medium">
                                Apply to PO <span className="text-red-500">*</span>
                              </span>
                              <div className="flex gap-2 text-[11px]">
                                <button type="button" className="text-blue-600 hover:underline" onClick={() => setAllPosForEtaBlock(block.id, true)}>
                                  All
                                </button>
                                <span className="text-gray-300">|</span>
                                <button type="button" className="text-blue-600 hover:underline" onClick={() => setAllPosForEtaBlock(block.id, false)}>
                                  Clear
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {newShipment.contractNumbers.map((cid) => {
                                const checked = block.contractIds.includes(cid)
                                return (
                                  <label
                                    key={cid}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 cursor-pointer ${checked ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-200 hover:bg-gray-50'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-3 w-3"
                                      checked={checked}
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
                                        className={COMPACT_DATE_INPUT}
                                        minIso={range?.minIso}
                                        maxIso={range?.maxIso}
                                        valueIso={block[key]}
                                        onChangeIso={(iso) => {
                                          updateEtaDetailBlock(block.id, { [key]: iso })
                                          clearFieldError(`${prefix}_${errorSuffix}`)
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
                  disabled={saving || contractQtyAssignedExceedsCapacity || newShipment.contractNumbers.some((id) => !contractValidations[id]?.exists)}
                  className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating shipment...
                    </>
                  ) : (
                    <>
                      <Ship className="h-4 w-4 mr-2" />
                      Create Shipment
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
