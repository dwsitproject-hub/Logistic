'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2, Plus, X } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY } from '@/lib/dateFormat'
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

  const validateContractNumber = useCallback(async (contractNumber: string) => {
    if (!contractNumber || contractNumber.trim() === '') {
      setContractValidations((prev) => {
        const next = { ...prev }
        delete next[contractNumber]
        return next
      })
      return
    }

    setContractValidations((prev) => ({
      ...prev,
      [contractNumber]: {
        checking: true,
        exists: false,
        contractData: null,
        message: 'Validating...',
      },
    }))

    try {
      const response = await api.get(
        `/shipments/contracts/validate?contract_number=${encodeURIComponent(contractNumber)}`,
      )
      if (response.data.success) {
        if (response.data.exists) {
          const data = response.data.data
          setContractValidations((prev) => ({
            ...prev,
            [contractNumber]: {
              checking: false,
              exists: true,
              contractData: data,
              message: 'Contract found',
            },
          }))
          setNewShipment((prev) => ({
            ...prev,
            portOfLoading: prev.portOfLoading || data.port_of_loading || '',
            portOfDischarge: prev.portOfDischarge || data.port_of_discharge || '',
          }))
        } else {
          setContractValidations((prev) => ({
            ...prev,
            [contractNumber]: {
              checking: false,
              exists: false,
              contractData: null,
              message: 'Contract number does not exist',
            },
          }))
        }
      }
    } catch (error) {
      console.error('Error validating contract:', error)
      setContractValidations((prev) => ({
        ...prev,
        [contractNumber]: {
          checking: false,
          exists: false,
          contractData: null,
          message: 'Error validating contract number',
        },
      }))
    }
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
    const contractId = contract.contract_id || contract
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
    const contractId = contractSearchTerm.trim()
    if (!contractId) return

    await validateContractNumber(contractId)

    if (!newShipment.contractNumbers.includes(contractId)) {
      setNewShipment((prev) => ({
        ...prev,
        contractNumbers: [...prev.contractNumbers, contractId],
      }))
      setContractQtyAssigned((prev) => ({ ...prev, [contractId]: prev[contractId] ?? '' }))
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
  }, [])

  useEffect(() => {
    if (!open) return
    resetForm()
    const cid = initialContractId?.trim()
    if (!cid) return
    void (async () => {
      setNewShipment((prev) => ({ ...prev, contractNumbers: [cid] }))
      setContractQtyAssigned((prev) => ({ ...prev, [cid]: prev[cid] ?? '' }))
      await validateContractNumber(cid)
    })()
  }, [open, initialContractId, resetForm, validateContractNumber])

  const handleCreateShipment = async () => {
    if (perms.loaded && !canOpenAddShipmentModal) {
      alert(
        'You need Create or Edit permission on Shipments (data.shipments) to add a shipment. Ask an admin to update your role.',
      )
      return
    }
    if (newShipment.contractNumbers.length === 0) {
      alert('Please add at least one Contract Number')
      return
    }

    const invalidContracts = newShipment.contractNumbers.filter((contractId) => !contractValidations[contractId]?.exists)

    if (invalidContracts.length > 0) {
      alert(`The following contract numbers are invalid or do not exist: ${invalidContracts.join(', ')}`)
      return
    }

    if (contractQtyAssignedExceedsCapacity) {
      alert('Sum of "Contract Qty assign to STO" cannot exceed Vessel Capacity (Kg).')
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

        <div className="space-y-6">
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
              {(contractValidations[newShipment.contractNumbers[0]]?.contractData?.contract_ext_no || newShipment.contractNumbers[0]) ||
                '{Contract Ext No}'}
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
                      void handleAddContractManually()
                    }
                  }}
                  placeholder="Search or enter Contract Ext No and press Enter"
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
                        {data?.contract_ext_no ? <span className="text-[11px] text-gray-400 truncate">({contractId})</span> : null}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Vessel Name</label>
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
                      <div className="text-xs text-gray-500">
                        {v.vessel_code} {v.vessel_owner ? ` • ${v.vessel_owner}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Vessel Code <span className="text-gray-500 text-xs">(from Master Vessel)</span>
              </label>
              <Input value={newShipment.vesselCode} disabled placeholder="Filled when vessel is selected" className="bg-gray-100 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Voyage No</label>
              <Input
                value={newShipment.voyageNo}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, voyageNo: e.target.value }))}
                placeholder="Enter voyage number"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Vessel Owner <span className="text-gray-500 text-xs">(from Master Vessel)</span>
              </label>
              <Input value={newShipment.vesselOwner} disabled placeholder="Filled when vessel is selected" className="bg-gray-100 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Vessel Draft (m)</label>
              <Input
                type="number"
                step="0.01"
                value={newShipment.vesselDraft}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, vesselDraft: e.target.value }))}
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
              <Input value={newShipment.vesselHullType} disabled placeholder="Filled when vessel is selected" className="bg-gray-100 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Charter Type</label>
              <Input
                value={newShipment.charterType}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, charterType: e.target.value }))}
                placeholder="Enter charter type"
              />
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
              <Input
                value={newShipment.portOfDischarge}
                onChange={(e) => setNewShipment((prev) => ({ ...prev, portOfDischarge: e.target.value }))}
                placeholder="Enter discharge port"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Contract Qty assign to STO (Kg)</label>
              <div
                className={`rounded-md border p-3 ${contractQtyAssignedExceedsCapacity ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
              >
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
                          onChange={(e) => setContractQtyAssigned((prev) => ({ ...prev, [contractId]: e.target.value }))}
                          className="h-8 text-sm w-40 bg-white"
                          placeholder="0"
                        />
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-sm pt-2 border-t">
                      <div className="text-gray-600">Total assigned</div>
                      <div className={`font-semibold ${contractQtyAssignedExceedsCapacity ? 'text-red-700' : 'text-gray-900'}`}>
                        {formatNumber(contractQtyAssignedSum)} Kg
                      </div>
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

          <div className="space-y-3 pt-2 border-t">
            <div className="text-sm font-medium text-gray-600">ETA (Optional)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Arrival at Loading Port</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselArrivalAtLoadingPort}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselArrivalAtLoadingPort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Berthed at Loading Port</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselBerthedAtLoadingPort}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselBerthedAtLoadingPort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Start Loading</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselStartLoading}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselStartLoading: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Completed Loading</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselCompletedLoading}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselCompletedLoading: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Sailed from Loading Port</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselSailedFromLoadingPort}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselSailedFromLoadingPort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Arrive at Discharge Port</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselArriveAtDischargePort}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselArriveAtDischargePort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Berthed at Discharge Port</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselBerthedAtDischargePort}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselBerthedAtDischargePort: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Start Discharging</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselStartDischarging}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselStartDischarging: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">ETA Vessel Complete Discharge</label>
                <Input
                  type="date"
                  value={newShipment.etaVesselCompleteDischarge}
                  onChange={(e) => setNewShipment((prev) => ({ ...prev, etaVesselCompleteDischarge: e.target.value }))}
                />
              </div>
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
