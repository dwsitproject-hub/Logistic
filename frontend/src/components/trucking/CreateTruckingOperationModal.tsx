'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Loader2, Plus, Check } from 'lucide-react'
import api from '@/lib/api'

export const CreateTruckingOperationModal = memo(function CreateTruckingOperationModal({
  open,
  onClose,
  onCreated,
  initialContractExtNo,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** When opening from Contracts page, prefill Contract Ext No and validate */
  initialContractExtNo?: string | null
}) {
  const [creating, setCreating] = useState(false)
  type DailyDeliverableDraft = { date: string; quantity: string }
  const [newOperation, setNewOperation] = useState({
    contract_number: '',
    operation_id: '',
    location: '',
    loading_location: '',
    unloading_location: '',
    trucking_owner: '',
    cargo_readiness_date: '',
    quantity_sent: '',
    quantity_delivered: '',
    gain_loss_percentage: '',
    gain_loss_amount: '',
    oa_budget: '',
    oa_actual: '',
    status: 'PLANNED',
    daily_deliverables: [] as DailyDeliverableDraft[],
  })

  const [contractValidation, setContractValidation] = useState<{
    checking: boolean
    exists: boolean
    contractData: any
    message: string
  }>({
    checking: false,
    exists: false,
    contractData: null,
    message: '',
  })

  const [contractSearchTerm, setContractSearchTerm] = useState('')
  const [contractSuggestions, setContractSuggestions] = useState<any[]>([])
  const [showContractSuggestions, setShowContractSuggestions] = useState(false)
  const contractSuggestTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const validateContractNumber = useCallback(async (contractNumber: string) => {
    if (!contractNumber || contractNumber.trim() === '') {
      setContractValidation({ checking: false, exists: false, contractData: null, message: '' })
      return
    }
    setContractValidation((prev) => ({ ...prev, checking: true }))
    try {
      const response = await api.get(`/trucking/validate/contract?contract_number=${encodeURIComponent(contractNumber)}`)
      if (response.data.success) {
        if (response.data.exists) {
          setContractValidation({
            checking: false,
            exists: true,
            contractData: response.data.data,
            message: 'Contract found',
          })
        } else {
          setContractValidation({
            checking: false,
            exists: false,
            contractData: null,
            message: 'Contract number does not exist',
          })
        }
      }
    } catch (error) {
      console.error('Error validating contract:', error)
      setContractValidation({
        checking: false,
        exists: false,
        contractData: null,
        message: 'Error validating contract number',
      })
    }
  }, [])

  const fetchContractSuggestions = useCallback(async (term: string) => {
    const q = term.trim()
    if (q.length < 2) {
      setContractSuggestions([])
      setShowContractSuggestions(false)
      return
    }
    try {
      const res = await api.get(`/trucking/contracts/suggestions?q=${encodeURIComponent(q)}`)
      if (res.data?.success) {
        setContractSuggestions(res.data.data || [])
        setShowContractSuggestions(true)
      }
    } catch (e) {
      console.error('Failed to fetch contract suggestions:', e)
      setContractSuggestions([])
      setShowContractSuggestions(false)
    }
  }, [])

  const handleContractNumberChange = (value: string) => {
    setNewOperation((prev) => ({ ...prev, contract_number: value }))
    setContractSearchTerm(value)
    if (validationTimeoutRef.current) clearTimeout(validationTimeoutRef.current)
    if (contractSuggestTimeoutRef.current) clearTimeout(contractSuggestTimeoutRef.current)
    contractSuggestTimeoutRef.current = setTimeout(() => fetchContractSuggestions(value), 200)
    validationTimeoutRef.current = setTimeout(() => validateContractNumber(value), 500)
  }

  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) clearTimeout(validationTimeoutRef.current)
      if (contractSuggestTimeoutRef.current) clearTimeout(contractSuggestTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const raw = initialContractExtNo?.trim()
    if (!raw) return
    setNewOperation((prev) => ({ ...prev, contract_number: raw }))
    setContractSearchTerm(raw)
    void validateContractNumber(raw)
  }, [open, initialContractExtNo, validateContractNumber])

  const handleSelectContractSuggestion = async (c: any) => {
    const label = c.contract_ext_no || c.contract_id
    setNewOperation((prev) => ({ ...prev, contract_number: String(label || '').trim() }))
    setContractSearchTerm(String(label || '').trim())
    setShowContractSuggestions(false)
    setContractSuggestions([])
    await validateContractNumber(String(label || '').trim())
  }

  const resetForm = () => {
    setNewOperation({
      contract_number: '',
      operation_id: '',
      location: '',
      loading_location: '',
      unloading_location: '',
      trucking_owner: '',
      cargo_readiness_date: '',
      quantity_sent: '',
      quantity_delivered: '',
      gain_loss_percentage: '',
      gain_loss_amount: '',
      oa_budget: '',
      oa_actual: '',
      status: 'PLANNED',
      daily_deliverables: [],
    })
    setContractValidation({ checking: false, exists: false, contractData: null, message: '' })
    setContractSearchTerm('')
    setContractSuggestions([])
    setShowContractSuggestions(false)
  }

  const handleCreateOperation = async () => {
    if (!newOperation.contract_number || !contractValidation.exists) {
      alert('Please enter a valid contract')
      return
    }

    const start = (contractValidation.contractData?.delivery_start_date || '').trim()
    const end = (contractValidation.contractData?.delivery_end_date || '').trim()
    const maxQty = newOperation.quantity_delivered
      ? parseFloat(String(newOperation.quantity_delivered).replace(/,/g, '').trim())
      : NaN
    const rows = newOperation.daily_deliverables || []
    if (rows.length > 0) {
      if (!start || !end) {
        alert('Due Date Delivery Start and Due Date Delivery End are required when daily deliverables are provided.')
        return
      }
      if (!Number.isFinite(maxQty)) {
        alert('Quantity Delivered (Kg) is required when daily deliverables are provided.')
        return
      }
      let sum = 0
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const d = (r.date || '').trim()
        const qn = r.quantity ? parseFloat(String(r.quantity).replace(/,/g, '').trim()) : NaN
        if (!d) return alert(`Daily deliverables row ${i + 1}: Date is required`)
        if (!Number.isFinite(qn) || qn < 0) return alert(`Daily deliverables row ${i + 1}: Quantity must be a valid number`)
        if (d < start) return alert(`Daily deliverables row ${i + 1}: Date cannot be before Due Date Delivery Start`)
        if (d > end) return alert(`Daily deliverables row ${i + 1}: Date cannot be after Due Date Delivery End`)
        if (qn > maxQty) return alert(`Daily deliverables row ${i + 1}: Quantity cannot exceed Quantity Delivered (Kg)`)
        sum += qn
        if (sum > maxQty) return alert('Sum of daily deliverables quantity cannot exceed Quantity Delivered (Kg)')
      }
    }

    setCreating(true)
    try {
      const payload = {
        ...newOperation,
        quantity_sent: newOperation.quantity_sent ? parseFloat(newOperation.quantity_sent) : null,
        quantity_delivered: newOperation.quantity_delivered ? parseFloat(newOperation.quantity_delivered) : null,
        gain_loss_percentage: newOperation.gain_loss_percentage ? parseFloat(newOperation.gain_loss_percentage) : null,
        gain_loss_amount: newOperation.gain_loss_amount ? parseFloat(newOperation.gain_loss_amount) : null,
        oa_budget: newOperation.oa_budget ? parseFloat(newOperation.oa_budget) : null,
        oa_actual: newOperation.oa_actual ? parseFloat(newOperation.oa_actual) : null,
        daily_deliverables: (newOperation.daily_deliverables || [])
          .filter((r) => (r.date || '').trim() !== '' && (r.quantity || '').trim() !== '')
          .map((r) => ({
            date: String(r.date).slice(0, 10),
            quantity_delivered: parseFloat(String(r.quantity).replace(/,/g, '').trim()),
          })),
      }

      const response = await api.post('/trucking', payload)
      if (response.data.success) {
        alert('Trucking operation created successfully!')
        resetForm()
        onClose()
        onCreated()
      }
    } catch (error: any) {
      console.error('Create trucking operation error:', error)
      const errorMessage = error.response?.data?.error?.message || 'Failed to create trucking operation'
      alert(errorMessage)
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  const maxQty = newOperation.quantity_delivered
    ? parseFloat(String(newOperation.quantity_delivered).replace(/,/g, '').trim())
    : NaN
  const sumQty = (newOperation.daily_deliverables || []).reduce((s, r) => {
    const n = r.quantity ? parseFloat(String(r.quantity).replace(/,/g, '').trim()) : NaN
    return s + (Number.isFinite(n) ? n : 0)
  }, 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white w-full max-w-4xl rounded-lg shadow-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Create New Trucking Operation</h3>
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

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contract Ext No <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="flex gap-2">
                <Input
                  value={newOperation.contract_number}
                  onChange={(e) => handleContractNumberChange(e.target.value)}
                  onBlur={() => validateContractNumber(newOperation.contract_number)}
                  onFocus={() => {
                    if (contractSuggestions.length > 0) setShowContractSuggestions(true)
                    if (contractSearchTerm.trim().length >= 2) fetchContractSuggestions(contractSearchTerm)
                  }}
                  className={`flex-1 ${
                    contractValidation.exists
                      ? 'border-green-500'
                      : contractValidation.message && !contractValidation.checking
                        ? 'border-red-500'
                        : ''
                  }`}
                  placeholder="Enter Contract Ext No"
                />
                {contractValidation.checking && (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400 self-center" />
                )}
                {!contractValidation.checking && contractValidation.exists && (
                  <Check className="h-5 w-5 text-green-500 self-center" />
                )}
                {!contractValidation.checking && contractValidation.message && !contractValidation.exists && (
                  <X className="h-5 w-5 text-red-500 self-center" />
                )}
              </div>

              {showContractSuggestions && contractSuggestions.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {contractSuggestions.map((c) => (
                    <button
                      key={c.contract_id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectContractSuggestion(c)}
                    >
                      <div className="font-medium text-sm">{c.contract_ext_no || c.contract_id}</div>
                      <div className="text-xs text-gray-500">
                        {c.contract_ext_no ? <span className="text-gray-400">{c.contract_id} • </span> : null}
                        {c.supplier} • {c.product}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {contractValidation.message && (
              <p className={`text-xs mt-1 ${contractValidation.exists ? 'text-green-600' : 'text-red-600'}`}>
                {contractValidation.message}
              </p>
            )}
            {contractValidation.exists && contractValidation.contractData && (
              <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                <div className="grid grid-cols-2 gap-2">
                  {contractValidation.contractData.contract_ext_no ? (
                    <div>
                      <span className="font-semibold">Contract Ext No:</span>{' '}
                      {contractValidation.contractData.contract_ext_no}
                    </div>
                  ) : null}
                  <div>
                    <span className="font-semibold">Contract ID:</span> {contractValidation.contractData.contract_id || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">STO Number:</span> {contractValidation.contractData.sto_number || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">Supplier:</span> {contractValidation.contractData.supplier || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">Product:</span> {contractValidation.contractData.product || '-'}
                  </div>
                  <div>
                    <span className="font-semibold">Group:</span> {contractValidation.contractData.group_name || '-'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Operation ID (optional)</label>
              <Input
                value={newOperation.operation_id}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, operation_id: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={newOperation.status}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full h-10 px-3 border border-gray-300 rounded-md"
              >
                <option value="PLANNED">Planned</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="LOADING">Loading</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="UNLOADING">Unloading</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant/Site</label>
              <Input
                value={newOperation.location}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, location: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Loading Location</label>
              <Input
                value={newOperation.loading_location}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, loading_location: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unloading Location</label>
              <Input
                value={newOperation.unloading_location}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, unloading_location: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trucking Owner</label>
              <Input
                value={newOperation.trucking_owner}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, trucking_owner: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Sent (Kg)</label>
              <Input
                inputMode="decimal"
                value={newOperation.quantity_sent}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, quantity_sent: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Delivered (Kg)</label>
              <Input
                inputMode="decimal"
                value={newOperation.quantity_delivered}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, quantity_delivered: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cargo Readiness Date</label>
              <Input
                type="date"
                value={newOperation.cargo_readiness_date}
                onChange={(e) => setNewOperation((prev) => ({ ...prev, cargo_readiness_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date Delivery Start</label>
              <Input type="date" value={contractValidation.contractData?.delivery_start_date || ''} disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date Delivery End</label>
              <Input type="date" value={contractValidation.contractData?.delivery_end_date || ''} disabled />
            </div>
          </div>

          <div className="border rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold text-sm text-gray-900">Daily planning deliverables</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Add daily delivered quantities (validated against Start/Last receive date and total Quantity Delivered).
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setNewOperation((prev) => ({
                    ...prev,
                    daily_deliverables: [...(prev.daily_deliverables || []), { date: '', quantity: '' }],
                  }))
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                Add day
              </Button>
            </div>

            {(newOperation.daily_deliverables || []).length === 0 ? (
              <div className="text-sm text-gray-500 mt-3">No daily deliverables added.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {(newOperation.daily_deliverables || []).map((row, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Date</label>
                        <Input
                          type="date"
                          value={row.date}
                          onChange={(e) =>
                            setNewOperation((prev) => ({
                              ...prev,
                              daily_deliverables: (prev.daily_deliverables || []).map((r, i) =>
                                i === idx ? { ...r, date: e.target.value } : r,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Quantity Delivered (Kg)</label>
                        <Input
                          inputMode="decimal"
                          value={row.quantity}
                          onChange={(e) =>
                            setNewOperation((prev) => ({
                              ...prev,
                              daily_deliverables: (prev.daily_deliverables || []).map((r, i) =>
                                i === idx ? { ...r, quantity: e.target.value } : r,
                              ),
                            }))
                          }
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setNewOperation((prev) => ({
                          ...prev,
                          daily_deliverables: (prev.daily_deliverables || []).filter((_, i) => i !== idx),
                        }))
                      }
                      className="mt-5 text-gray-500 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <div className="pt-2 text-xs text-gray-600">
                  {contractValidation.contractData?.delivery_start_date &&
                  contractValidation.contractData?.delivery_end_date ? (
                    <div>
                      Allowed date range: {contractValidation.contractData.delivery_start_date} to{' '}
                      {contractValidation.contractData.delivery_end_date}
                    </div>
                  ) : (
                    <div>Due Date Delivery Start/End are required to validate date range.</div>
                  )}
                  <div className="mt-1">
                    Sum qty: {sumQty}
                    {Number.isFinite(maxQty) ? ` / ${maxQty}` : ''}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { resetForm(); onClose(); }} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateOperation}
              disabled={creating || !contractValidation.exists}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Operation
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})
