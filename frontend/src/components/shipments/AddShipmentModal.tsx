'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlantSiteCombobox } from '@/components/PlantSiteCombobox'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2, Plus, X } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY } from '@/lib/dateFormat'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  usePermissions,
  canCreatePermission,
  canEditPermission,
} from '@/components/PermissionsContext'

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
  etaVesselArrivalAtLoadingPort: '',
  etaVesselBerthedAtLoadingPort: '',
  etaVesselStartLoading: '',
  etaVesselCompletedLoading: '',
  etaVesselSailedFromLoadingPort: '',
  etaVesselArriveAtDischargePort: '',
  etaVesselBerthedAtDischargePort: '',
  etaVesselStartDischarging: '',
  etaVesselCompleteDischarge: '',
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
  /** When opening from Contracts, lock first contract chip to this ID */
  initialContractId?: string | null
}) {
  const perms = usePermissions()
  const canAddShipment = canCreatePermission(perms, 'data.shipments')
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canOpenAddShipmentModal = canAddShipment || canEditShipment

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

  const etaDateRange = useMemo(() => {
    const firstValidId = newShipment.contractNumbers.find((id) => contractValidations[id]?.exists)
    const contractDateStr = firstValidId ? contractValidations[firstValidId]?.contractData?.contract_date : null
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
  }, [newShipment.contractNumbers, contractValidations])

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

  const validateShipmentForm = (mode: string | null): boolean => {
    const errors: Record<string, string> = {}
    if (newShipment.contractNumbers.length === 0)
      errors.contractNumbers = 'At least one PO Number is required'
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

    // Date range validation: min = contract_date + 30 days, max = contract_date + 1 year
    const firstValidId = newShipment.contractNumbers.find((id) => contractValidations[id]?.exists)
    const contractDateStr = firstValidId ? contractValidations[firstValidId]?.contractData?.contract_date : null
    if (contractDateStr) {
      const contractDate = new Date(contractDateStr)
      const minDate = new Date(contractDate)
      minDate.setDate(minDate.getDate() - 30)
      const maxDate = new Date(contractDate)
      maxDate.setFullYear(maxDate.getFullYear() + 1)
      const minIso = minDate.toISOString().slice(0, 10)
      const maxIso = maxDate.toISOString().slice(0, 10)
      const rangeMsg = `Date must be between ${formatDateDMY(minIso)} (contract date − 30 days) and ${formatDateDMY(maxIso)} (contract date + 1 year)`
      const checkEta = (iso: string, key: string) => {
        if (iso && (iso < minIso || iso > maxIso)) errors[key] = rangeMsg
      }
      checkEta(newShipment.etaVesselArrivalAtLoadingPort, 'eta_arrival')
      checkEta(newShipment.etaVesselBerthedAtLoadingPort, 'eta_berthed')
      checkEta(newShipment.etaVesselStartLoading, 'eta_startLoading')
      checkEta(newShipment.etaVesselCompletedLoading, 'eta_completedLoading')
      checkEta(newShipment.etaVesselSailedFromLoadingPort, 'eta_sailed')
      checkEta(newShipment.etaVesselArriveAtDischargePort, 'eta_arriveDischarge')
      checkEta(newShipment.etaVesselBerthedAtDischargePort, 'eta_berthedDischarge')
      checkEta(newShipment.etaVesselStartDischarging, 'eta_startDischarging')
      checkEta(newShipment.etaVesselCompleteDischarge, 'eta_completeDischarge')
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreateShipment = async () => {
    if (perms.loaded && !canOpenAddShipmentModal) {
      alert(
        'You need Create or Edit permission on Shipments (data.shipments) to add a shipment. Ask an admin to update your role.',
      )
      return
    }

    if (!validateShipmentForm(selectedTransportMode)) return

    if (contractQtyAssignedExceedsCapacity) {
      alert('Sum of "Contract Qty assign to STO" cannot exceed Vessel Capacity (MT).')
      return
    }
    if (Object.keys(contractQtyAssignedExceedsOutstanding).length > 0) {
      const first = Object.keys(contractQtyAssignedExceedsOutstanding)[0]
      const { assignedMt, outstandingMt } = contractQtyAssignedExceedsOutstanding[first]
      alert(
        `"Contract Qty assign to STO" for contract ${first} (${formatNumber(assignedMt)} MT) cannot exceed Outstanding Qty (${formatNumber(outstandingMt)} MT).`,
      )
      return
    }

    try {
      setSaving(true)

      const operationId = `OP-${newShipment.contractNumbers[0]}-${Date.now().toString().slice(-8)}`

      const shipmentData = {
        ...newShipment,
        operationId,
        stoNumber: '',
        contractQtyAssigned,
        eta_arrival: newShipment.etaVesselArrivalAtLoadingPort || null,
        eta_berthed: newShipment.etaVesselBerthedAtLoadingPort || null,
        eta_loading_start: newShipment.etaVesselStartLoading || null,
        eta_loading_complete: newShipment.etaVesselCompletedLoading || null,
        eta_sailed: newShipment.etaVesselSailedFromLoadingPort || null,
        eta_discharge_arrival: newShipment.etaVesselArriveAtDischargePort || null,
        eta_discharge_berthed: newShipment.etaVesselBerthedAtDischargePort || null,
        eta_discharge_start: newShipment.etaVesselStartDischarging || null,
        eta_discharge_complete: newShipment.etaVesselCompleteDischarge || null,
      }
      const response = await api.post('/shipments', shipmentData)

      if (response.data.success) {
        alert('Shipment created successfully!')
        resetForm()
        onClose()
        onCreated()
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold">Add New Shipment</h3>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm()
              onClose()
            }}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-5">

          {/* Section 1 â€” Contract Detail */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <h4 className="text-sm font-semibold text-gray-700">1. Contract Detail</h4>
            </div>
            <div className="p-4 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Required:</strong> At least one Contract Number
                  <br />
                  <strong>Optional:</strong> Port of Loading, Plant/Site (Discharge Port), and ETA fields.
                  <br />
                  <strong>Note:</strong> Operation ID and STO Number are automatically generated and cannot be manually entered
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Operation ID <span className="text-gray-500 text-xs">(Auto-generated)</span>
                </label>
                <Input
                  value={
                    newShipment.contractNumbers.length > 0
                      ? `OP-${newShipment.contractNumbers[0]}-${Date.now().toString().slice(-8)}`
                      : 'Will be auto-generated when contract is added'
                  }
                  disabled
                  className="w-full bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Operation ID will be automatically generated as: OP-
                  {(contractValidations[newShipment.contractNumbers[0]]?.contractData?.po_number || newShipment.contractNumbers[0]) ||
                    '{PO Number}'}
                  -{'{timestamp}'}
                </p>
              </div>

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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PO Number
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
                          void handleAddContractManually()
                        }
                      }}
                      placeholder="Search or enter PO Number and press Enter"
                      className="flex-1"
                      disabled={Boolean(initialContractId?.trim() && newShipment.contractNumbers.includes(initialContractId.trim()))}
                    />
                    <Button type="button" onClick={() => void handleAddContractManually()} variant="outline">
                      Add
                    </Button>
                  </div>
                  {showContractSuggestions && contractSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {contractSuggestions.map((contract) => (
                        <div
                          key={contract.contract_id}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b"
                          onClick={() => void handleAddContract(contract)}
                        >
                          <div className="font-medium">{contract.po_number || contract.contract_id}</div>
                          <div className="text-sm text-gray-500">
                            {contract.po_number ? <span className="text-gray-400">{contract.contract_id} • </span> : null}
                            {contract.supplier} • {contract.product}
                            {contract.sto_number && ` • STO: ${contract.sto_number}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {newShipment.contractNumbers.length > 0 && (
                  <div className="mt-2 space-y-3">
                    {newShipment.contractNumbers.map((contractId) => {
                      const validation = contractValidations[contractId]
                      const data = validation?.contractData
                      const label = (data?.po_number || contractId) as string
                      // Quantities from contracts are stored in Kg; Add Shipment UI displays MT
                      const contractQtyMt = (Number(data?.quantity_ordered) || 0) / 1000
                      const outstandingQtyMt = (Number(data?.outstanding_quantity) || 0) / 1000
                      return (
                        <div key={contractId} className="border rounded-md px-2 py-2 bg-gray-50">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={validation?.exists ? 'default' : validation?.exists === false ? 'destructive' : 'secondary'}
                              className="flex items-center gap-1"
                            >
                              {label}
                              {validation?.checking && <Loader2 className="h-3 w-3 animate-spin" />}
                              {validation?.exists && <Check className="h-3 w-3" />}
                              {validation?.exists === false && !validation?.checking && <X className="h-3 w-3" />}
                              <X
                                className={`h-3 w-3 ${initialContractId?.trim() === contractId ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                                onClick={() => {
                                  if (initialContractId?.trim() === contractId) return
                                  handleRemoveContract(contractId)
                                }}
                              />
                            </Badge>
                            {data?.po_number ? <span className="text-[11px] text-gray-400 truncate">({contractId})</span> : null}
                            {validation?.message && (
                              <span className={`text-xs ${validation.exists ? 'text-green-600' : 'text-red-600'}`}>
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
                                  {formatNumber(contractQtyMt)} MT
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">Outstanding Qty</div>
                                <div className="font-medium">
                                  {formatNumber(outstandingQtyMt)} MT
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">Due Date Delivery Start</div>
                                <div className="font-medium">{formatShortDate(data.delivery_start_date || '')}</div>
                              </div>
                              <div>
                                <div className="text-gray-500">Due Date Delivery End</div>
                                <div className="font-medium">{formatShortDate(data.delivery_end_date || '')}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {formErrors.contractNumbers && (
                <p className="text-xs mt-1 text-red-600">{formErrors.contractNumbers}</p>
              )}
            </div>
          </div>

          {/* Section 2 â€” Vessel/Truck Detail */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <h4 className="text-sm font-semibold text-gray-700">2. Vessel Detail</h4>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract Qty assign to STO (MT) <span className="text-red-500">*</span>
                </label>
                <div
                  className={`rounded-md border p-3 ${
                    contractQtyAssignedExceedsCapacity || Object.keys(contractQtyAssignedExceedsOutstanding).length > 0
                      ? 'border-red-400 bg-red-50'
                      : formErrors.contractQty
                        ? 'border-red-400 bg-red-50'
                        : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  {newShipment.contractNumbers.length === 0 ? (
                    <div className="text-sm text-gray-500">Add contract numbers above to assign quantities.</div>
                  ) : (
                    <div className="space-y-2">
                      {newShipment.contractNumbers.map((contractId) => {
                        const exceed = contractQtyAssignedExceedsOutstanding[contractId]
                        return (
                          <div key={contractId} className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-gray-700 truncate">{contractId}</div>
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                value={contractQtyAssigned[contractId] ?? ''}
                                onChange={(e) => setContractQtyAssigned((prev) => ({ ...prev, [contractId]: e.target.value }))}
                                className={`h-8 text-sm w-40 bg-white ${exceed ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
                                placeholder="0"
                              />
                              {exceed && (
                                <div className="text-[11px] text-red-700">
                                  Cannot exceed Outstanding Qty ({formatNumber(exceed.outstandingMt)} MT)
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      <div className="flex items-center justify-between text-sm pt-2 border-t">
                        <div className="text-gray-600">Total assigned</div>
                        <div className={`font-semibold ${contractQtyAssignedExceedsCapacity ? 'text-red-700' : 'text-gray-900'}`}>
                          {formatNumber(contractQtyAssignedSum)} MT
                        </div>
                      </div>
                      {vesselCapacityNum != null && !Number.isNaN(vesselCapacityNum) && (
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <div>Vessel Capacity</div>
                          <div>{formatNumber(vesselCapacityNum)} MT</div>
                        </div>
                      )}
                      {contractQtyAssignedExceedsCapacity && (
                        <div className="text-xs text-red-700">Total assigned cannot exceed Vessel Capacity (MT).</div>
                      )}
                    </div>
                  )}
                </div>
                {formErrors.contractQty && (
                  <p className="text-xs mt-1 text-red-600">{formErrors.contractQty}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
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
                  {showVesselSuggestions && vesselSuggestions.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-52 overflow-y-auto">
                      {vesselSuggestions.map((v) => (
                        <div
                          key={v.vessel_code}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                          onMouseDown={() => handleSelectVessel(v)}
                        >
                          <div className="font-medium text-sm">{v.vessel_name}</div>
                          <div className="text-xs text-gray-500">
                            {v.vessel_code} {v.vessel_owner ? ` • ${v.vessel_owner}` : ''}
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
                <div>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-500 mb-2">Port of Loading (Optional)</label>
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
                  <label className="block text-sm font-medium text-gray-500 mb-2">Plant/Site (Discharge Port) (Optional)</label>
                  <PlantSiteCombobox
                    value={newShipment.portOfDischarge}
                    onChange={(val) => setNewShipment((prev) => ({ ...prev, portOfDischarge: val }))}
                    placeholder="Search plant/site..."
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3 â€” Shipment Detail */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <h4 className="text-sm font-semibold text-gray-700">3. Shipment Detail</h4>
            </div>
            <div className="p-4">
              <div className="text-sm font-medium text-gray-600 mb-3">ETA (Optional)</div>

              {selectedTransportMode === null && (
                <p className="text-sm text-gray-400 italic">Add a contract in Section 1 to see the relevant ETA fields.</p>
              )}

              {/* SEA ETA fields */}
              {(selectedTransportMode === 'sea' || selectedTransportMode === 'mixed') && (
                <>
                  {selectedTransportMode === 'mixed' && (
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sea</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Arrival at Loading Port</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselArrivalAtLoadingPort}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselArrivalAtLoadingPort: iso })); clearFieldError('eta_arrival') }}
                      />
                      {formErrors.eta_arrival && <p className="text-xs mt-1 text-red-600">{formErrors.eta_arrival}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Berthed at Loading Port</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselBerthedAtLoadingPort}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselBerthedAtLoadingPort: iso })); clearFieldError('eta_berthed') }}
                      />
                      {formErrors.eta_berthed && <p className="text-xs mt-1 text-red-600">{formErrors.eta_berthed}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Start Loading</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselStartLoading}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselStartLoading: iso })); clearFieldError('eta_startLoading') }}
                      />
                      {formErrors.eta_startLoading && <p className="text-xs mt-1 text-red-600">{formErrors.eta_startLoading}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Completed Loading</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselCompletedLoading}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselCompletedLoading: iso })); clearFieldError('eta_completedLoading') }}
                      />
                      {formErrors.eta_completedLoading && <p className="text-xs mt-1 text-red-600">{formErrors.eta_completedLoading}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Sailed from Loading Port</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselSailedFromLoadingPort}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselSailedFromLoadingPort: iso })); clearFieldError('eta_sailed') }}
                      />
                      {formErrors.eta_sailed && <p className="text-xs mt-1 text-red-600">{formErrors.eta_sailed}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Arrive at Discharge Port</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselArriveAtDischargePort}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselArriveAtDischargePort: iso })); clearFieldError('eta_arriveDischarge') }}
                      />
                      {formErrors.eta_arriveDischarge && <p className="text-xs mt-1 text-red-600">{formErrors.eta_arriveDischarge}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Berthed at Discharge Port</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselBerthedAtDischargePort}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselBerthedAtDischargePort: iso })); clearFieldError('eta_berthedDischarge') }}
                      />
                      {formErrors.eta_berthedDischarge && <p className="text-xs mt-1 text-red-600">{formErrors.eta_berthedDischarge}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Start Discharging</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselStartDischarging}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselStartDischarging: iso })); clearFieldError('eta_startDischarging') }}
                      />
                      {formErrors.eta_startDischarging && <p className="text-xs mt-1 text-red-600">{formErrors.eta_startDischarging}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">ETA Vessel Complete Discharge</label>
                      <DateInputDdMmYyyy
                        minIso={etaDateRange?.minIso}
                        maxIso={etaDateRange?.maxIso}
                        valueIso={newShipment.etaVesselCompleteDischarge}
                        onChangeIso={(iso) => { setNewShipment((prev) => ({ ...prev, etaVesselCompleteDischarge: iso })); clearFieldError('eta_completeDischarge') }}
                      />
                      {formErrors.eta_completeDischarge && <p className="text-xs mt-1 text-red-600">{formErrors.eta_completeDischarge}</p>}
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              variant="outline"
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
  )
}
