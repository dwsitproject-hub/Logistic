'use client'

import { useEffect, useState, useMemo, useRef, useCallback, Suspense, memo } from 'react'
import { useSearchParams } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Filter, X, Truck, Package, Save, Loader2, Download, Upload, Edit2, Plus, Minus, SlidersHorizontal, ChevronRight, ChevronDown, ArrowUp, ArrowDown, Check, ArrowLeft, ArrowRight } from 'lucide-react'
import api from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY, formatDateTimeDMY } from '@/lib/dateFormat'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Aligns with list `formatNumber` / `formatKg`: comma thousands, period decimals. */
function formatTruckingQtyPlain(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: true })
}

interface TruckingOperation {
  id: string
  operation_id: string
  contract_id: string
  contract_number: string
  po_number?: string
  sto_number: string
  sto_quantity?: number
  contract_qty?: number
  delivery_start_date?: string
  delivery_end_date?: string
  location: string
  loading_location?: string
  unloading_location?: string
  trucking_owner: string
  cargo_readiness_date: string
  trucking_start_date: string
  trucking_completion_date: string
  quantity_sent: number
  quantity_delivered: number
  quantity_receive?: number
  gain_loss_percentage: number
  gain_loss_amount: number
  oa_budget: number
  oa_actual: number
  estimated_km?: number
  status: string
  // ETA dates removed from UI (kept in DB/backend)
  created_at: string
  supplier: string
  buyer: string
  product: string
  group_name: string
  contract_ext_no?: string
  daily_deliverables?: Array<{ date: string; quantity_delivered: number }>
}

type TruckingCalendarRow = {
  id: string
  operation_id: string
  contract_number: string
  contract_ext_no?: string
  sto_number?: string
  po_number?: string
  supplier?: string
  product?: string
  group_name?: string
  source_type?: string
  lt_spot?: string
  outstanding_quantity?: number
  loading_location?: string
  unloading_location?: string
  trucking_owner?: string
  delivery_start_date?: string
  delivery_end_date?: string
  trucking_start_date?: string
  trucking_completion_date?: string
  quantity_sent?: number
  quantity_delivered?: number
  quantity_receive?: number
  daily_deliverables?: Array<{ date: string; quantity_delivered: number }>
}

interface DocumentItem {
  id: string
  document_type?: string
  file_name: string
  file_path?: string
  mime_type?: string
  file_size?: number
  trucking_operation_id?: string
  created_at?: string
}

const CreateTruckingOperationModal = memo(function CreateTruckingOperationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
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
    message: ''
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
    setContractValidation(prev => ({ ...prev, checking: true }))
    try {
      const response = await api.get(`/trucking/validate/contract?contract_number=${encodeURIComponent(contractNumber)}`)
      if (response.data.success) {
        if (response.data.exists) {
          setContractValidation({ checking: false, exists: true, contractData: response.data.data, message: 'Contract found' })
        } else {
          setContractValidation({ checking: false, exists: false, contractData: null, message: 'Contract number does not exist' })
        }
      }
    } catch (error) {
      console.error('Error validating contract:', error)
      setContractValidation({ checking: false, exists: false, contractData: null, message: 'Error validating contract number' })
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
    setNewOperation(prev => ({ ...prev, contract_number: value }))
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

  const handleSelectContractSuggestion = async (c: any) => {
    const label = c.contract_ext_no || c.contract_id
    setNewOperation(prev => ({ ...prev, contract_number: String(label || '').trim() }))
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

    // Validate daily deliverables draft
    // Use due delivery dates (contract) as the allowable window since trucking ETA dates are removed from UI.
    const start = (contractValidation.contractData?.delivery_start_date || '').trim()
    const end = (contractValidation.contractData?.delivery_end_date || '').trim()
    const maxQty = newOperation.quantity_delivered ? parseFloat(String(newOperation.quantity_delivered).replace(/,/g, '').trim()) : NaN
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

  const maxQty = newOperation.quantity_delivered ? parseFloat(String(newOperation.quantity_delivered).replace(/,/g, '').trim()) : NaN
  const sumQty = (newOperation.daily_deliverables || []).reduce((s, r) => {
    const n = r.quantity ? parseFloat(String(r.quantity).replace(/,/g, '').trim()) : NaN
    return s + (Number.isFinite(n) ? n : 0)
  }, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
          {/* Contract Ext No with Validation */}
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
                {contractValidation.checking && <Loader2 className="h-5 w-5 animate-spin text-gray-400 self-center" />}
                {!contractValidation.checking && contractValidation.exists && <Check className="h-5 w-5 text-green-500 self-center" />}
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
                    <div><span className="font-semibold">Contract Ext No:</span> {contractValidation.contractData.contract_ext_no}</div>
                  ) : null}
                  <div><span className="font-semibold">Contract ID:</span> {contractValidation.contractData.contract_id || '-'}</div>
                  <div><span className="font-semibold">STO Number:</span> {contractValidation.contractData.sto_number || '-'}</div>
                  <div><span className="font-semibold">Supplier:</span> {contractValidation.contractData.supplier || '-'}</div>
                  <div><span className="font-semibold">Product:</span> {contractValidation.contractData.product || '-'}</div>
                  <div><span className="font-semibold">Group:</span> {contractValidation.contractData.group_name || '-'}</div>
                </div>
              </div>
            )}
          </div>

          {/* Basic Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Operation ID (optional)</label>
              <Input value={newOperation.operation_id} onChange={(e) => setNewOperation(prev => ({ ...prev, operation_id: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={newOperation.status}
                onChange={(e) => setNewOperation(prev => ({ ...prev, status: e.target.value }))}
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

          {/* Locations */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plant/Site</label>
              <Input value={newOperation.location} onChange={(e) => setNewOperation(prev => ({ ...prev, location: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Loading Location</label>
              <Input value={newOperation.loading_location} onChange={(e) => setNewOperation(prev => ({ ...prev, loading_location: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unloading Location</label>
              <Input value={newOperation.unloading_location} onChange={(e) => setNewOperation(prev => ({ ...prev, unloading_location: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trucking Owner</label>
              <Input value={newOperation.trucking_owner} onChange={(e) => setNewOperation(prev => ({ ...prev, trucking_owner: e.target.value }))} />
            </div>
          </div>

          {/* Quantities */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Sent (Kg)</label>
              <Input inputMode="decimal" value={newOperation.quantity_sent} onChange={(e) => setNewOperation(prev => ({ ...prev, quantity_sent: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Delivered (Kg)</label>
              <Input inputMode="decimal" value={newOperation.quantity_delivered} onChange={(e) => setNewOperation(prev => ({ ...prev, quantity_delivered: e.target.value }))} />
            </div>
          </div>

          {/* Date Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cargo Readiness Date</label>
              <Input type="date" value={newOperation.cargo_readiness_date} onChange={(e) => setNewOperation(prev => ({ ...prev, cargo_readiness_date: e.target.value }))} />
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

          {/* Daily planning deliverables */}
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
                onClick={() => setNewOperation((prev) => ({ ...prev, daily_deliverables: [...(prev.daily_deliverables || []), { date: '', quantity: '' }] }))}
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
                          onChange={(e) => setNewOperation((prev) => ({
                            ...prev,
                            daily_deliverables: (prev.daily_deliverables || []).map((r, i) => (i === idx ? { ...r, date: e.target.value } : r)),
                          }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Quantity Delivered (Kg)</label>
                        <Input
                          inputMode="decimal"
                          value={row.quantity}
                          onChange={(e) => setNewOperation((prev) => ({
                            ...prev,
                            daily_deliverables: (prev.daily_deliverables || []).map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)),
                          }))}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setNewOperation((prev) => ({ ...prev, daily_deliverables: (prev.daily_deliverables || []).filter((_, i) => i !== idx) }))}
                      className="mt-5 text-gray-500 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <div className="pt-2 text-xs text-gray-600">
                  {contractValidation.contractData?.delivery_start_date && contractValidation.contractData?.delivery_end_date ? (
                    <div>
                      Allowed date range: {contractValidation.contractData.delivery_start_date} to {contractValidation.contractData.delivery_end_date}
                    </div>
                  ) : (
                    <div>Due Date Delivery Start/End are required to validate date range.</div>
                  )}
                  <div className="mt-1">Sum qty: {sumQty}{Number.isFinite(maxQty) ? ` / ${maxQty}` : ''}</div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { resetForm(); onClose(); }} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreateOperation} disabled={creating || !contractValidation.exists} className="bg-blue-600 hover:bg-blue-700">
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

function CalendarDeliverablesTable({
  month,
  rows,
  loading,
  savingKey,
  editing,
  editValue,
  formatQty,
  visibleMetaCols,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditCommit,
}: {
  month: Date
  rows: TruckingCalendarRow[]
  loading: boolean
  savingKey: string | null
  editing: { id: string; date: string } | null
  editValue: string
  formatQty: (n: number) => string
  visibleMetaCols: Set<string>
  onEditStart: (id: string, date: string, initial: string) => void
  onEditChange: (v: string) => void
  onEditCancel: () => void
  onEditCommit: (id: string, date: string, value: string) => Promise<void>
}) {
  const yyyy = month.getFullYear()
  const mm = month.getMonth()
  const daysInMonth = new Date(yyyy, mm + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const operationColW = 220
  const contractColW = 300
  const opShown = visibleMetaCols.has('operation_id')
  const contractShown = visibleMetaCols.has('contract_block')
  const contractLeft = opShown ? operationColW : 0
  const scrollTopRef = useRef<HTMLDivElement | null>(null)
  const scrollBottomRef = useRef<HTMLDivElement | null>(null)
  const isSyncing = useRef(false)
  const dayIso = (day: number) => {
    const m = String(mm + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${yyyy}-${m}-${d}`
  }
  const getQty = (r: TruckingCalendarRow, date: string) => {
    const hit = (r.daily_deliverables || []).find((x) => (x?.date || '').slice(0, 10) === date)
    return hit ? Number(hit.quantity_delivered || 0) : 0
  }

  const sumPlannedQty = (r: TruckingCalendarRow) =>
    (r.daily_deliverables || []).reduce((s, x) => s + Number(x?.quantity_delivered || 0), 0)

  useEffect(() => {
    const top = scrollTopRef.current
    const bottom = scrollBottomRef.current
    if (!top || !bottom) return
    const onTop = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      bottom.scrollLeft = top.scrollLeft
      isSyncing.current = false
    }
    const onBottom = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      top.scrollLeft = bottom.scrollLeft
      isSyncing.current = false
    }
    top.addEventListener('scroll', onTop)
    bottom.addEventListener('scroll', onBottom)
    return () => {
      top.removeEventListener('scroll', onTop)
      bottom.removeEventListener('scroll', onBottom)
    }
  }, [rows.length, daysInMonth, opShown, contractShown, visibleMetaCols])

  return (
    <div>
      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No trucking operations in this month window</div>
      ) : (
        <>
        <div ref={scrollTopRef} className="overflow-x-auto border rounded-md bg-white">
          <div className="h-3" style={{ width: `${2000 + daysInMonth * 48}px` }} />
        </div>
        <div ref={scrollBottomRef} className="overflow-x-auto mt-2">
        <table className="min-w-[2000px] w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100">
              {opShown ? (
                <th
                  className="sticky z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200"
                  style={{ left: 0, minWidth: operationColW, maxWidth: operationColW }}
                >
                  Operation ID
                </th>
              ) : null}
              {contractShown ? (
                <th
                  className="sticky z-20 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200"
                  style={{ left: contractLeft, minWidth: contractColW }}
                >
                  Contract Ext No / STO / Supplier
                </th>
              ) : null}
              {visibleMetaCols.has('owner') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Owner</th>
              ) : null}
              {visibleMetaCols.has('due_start') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Due Start</th>
              ) : null}
              {visibleMetaCols.has('due_end') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Due End</th>
              ) : null}
              {visibleMetaCols.has('source_type') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Source Type</th>
              ) : null}
              {visibleMetaCols.has('lt_spot') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">LT/SPOT</th>
              ) : null}
              {visibleMetaCols.has('product') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Product</th>
              ) : null}
              {visibleMetaCols.has('group_name') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Group Name</th>
              ) : null}
              {visibleMetaCols.has('supplier') ? (
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">Supplier</th>
              ) : null}
              {visibleMetaCols.has('outstanding_quantity') ? (
                <th className="px-3 py-2 text-right font-semibold text-gray-700 border-b border-gray-200">Outstanding Qty</th>
              ) : null}
              {visibleMetaCols.has('qty_sent') ? (
                <th className="px-3 py-2 text-right font-semibold text-gray-700 border-b border-gray-200">Qty Sent</th>
              ) : null}
              {visibleMetaCols.has('qty_sent_planning') ? (
                <th className="px-3 py-2 text-right font-semibold text-gray-700 border-b border-gray-200">QTY Sent (planning)</th>
              ) : null}
              {visibleMetaCols.has('qty_delivered') ? (
                <th className="px-3 py-2 text-right font-semibold text-gray-700 border-b border-gray-200">Qty Delivered</th>
              ) : null}
              {visibleMetaCols.has('qty_received') ? (
                <th className="px-3 py-2 text-right font-semibold text-gray-700 border-b border-gray-200">Qty Received</th>
              ) : null}
              {days.map((d) => (
                <th key={d} className="px-2 py-2 text-right font-semibold text-gray-700 border-b border-gray-200 tabular-nums">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {rows.map((r) => {
              const opLabel = r.operation_id || '-'
              const contractLabel = (r.contract_ext_no || r.contract_number || '-') as string
              const stoLabel = r.sto_number || '-'
              const supplierLabel = r.supplier || '-'
              const dueStart = r.delivery_start_date
                ? formatDateDMY(r.delivery_start_date || '')
                : '-'
              const dueEnd = r.delivery_end_date
                ? formatDateDMY(r.delivery_end_date || '')
                : '-'
              const qtySent = Number(r.quantity_sent || 0)
              const qtyDel = Number(r.quantity_delivered || 0)
              const qtyRecv = Number(r.quantity_receive ?? 0)
              const plannedSum = sumPlannedQty(r)
              const outQty = Number((r as any).outstanding_quantity ?? 0)
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  {opShown ? (
                    <td
                      className="sticky z-10 bg-white px-3 py-2 border-b border-gray-100 align-top"
                      style={{ left: 0, minWidth: operationColW, maxWidth: operationColW }}
                    >
                      <div className="font-semibold text-gray-900 truncate" title={opLabel}>{opLabel}</div>
                      <div className="text-[10px] text-gray-500 truncate" title={`${r.loading_location || ''} → ${r.unloading_location || ''}`}>
                        {(r.loading_location || '-')} → {(r.unloading_location || '-')}
                      </div>
                    </td>
                  ) : null}
                  {contractShown ? (
                    <td
                      className="sticky z-10 bg-white px-3 py-2 border-b border-gray-100 align-top"
                      style={{ left: contractLeft, minWidth: contractColW, maxWidth: 'min(360px,40vw)' }}
                    >
                      <div className="font-medium text-gray-900 whitespace-normal break-words leading-snug" title={contractLabel}>{contractLabel}</div>
                      <div className="text-[10px] text-gray-500 whitespace-normal break-words mt-0.5" title={`STO: ${stoLabel}`}>STO: {stoLabel}</div>
                      <div className="text-[10px] text-gray-500 whitespace-normal break-words" title={supplierLabel}>{supplierLabel}</div>
                    </td>
                  ) : null}
                  {visibleMetaCols.has('owner') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 align-top">{r.trucking_owner || '-'}</td>
                  ) : null}
                  {visibleMetaCols.has('due_start') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 tabular-nums align-top">{dueStart}</td>
                  ) : null}
                  {visibleMetaCols.has('due_end') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 tabular-nums align-top">{dueEnd}</td>
                  ) : null}
                  {visibleMetaCols.has('source_type') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 align-top whitespace-nowrap">
                      {(r as any).source_type || '—'}
                    </td>
                  ) : null}
                  {visibleMetaCols.has('lt_spot') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 align-top whitespace-nowrap">
                      {(r as any).lt_spot || '—'}
                    </td>
                  ) : null}
                  {visibleMetaCols.has('product') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 align-top">
                      {r.product || '—'}
                    </td>
                  ) : null}
                  {visibleMetaCols.has('group_name') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 align-top">
                      {r.group_name || '—'}
                    </td>
                  ) : null}
                  {visibleMetaCols.has('supplier') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-gray-700 align-top">
                      {r.supplier || '—'}
                    </td>
                  ) : null}
                  {visibleMetaCols.has('outstanding_quantity') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-right tabular-nums align-top">
                      {outQty ? formatQty(outQty) : '—'}
                    </td>
                  ) : null}
                  {visibleMetaCols.has('qty_sent') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-right tabular-nums align-top">{qtySent ? formatQty(qtySent) : '-'}</td>
                  ) : null}
                  {visibleMetaCols.has('qty_sent_planning') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-right tabular-nums align-top">{plannedSum ? formatQty(plannedSum) : '—'}</td>
                  ) : null}
                  {visibleMetaCols.has('qty_delivered') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-right tabular-nums font-semibold align-top">{qtyDel != null && Number.isFinite(qtyDel) ? formatQty(qtyDel) : '—'}</td>
                  ) : null}
                  {visibleMetaCols.has('qty_received') ? (
                    <td className="px-3 py-2 border-b border-gray-100 text-right tabular-nums align-top">{qtyRecv != null && Number.isFinite(qtyRecv) ? formatQty(qtyRecv) : '—'}</td>
                  ) : null}
                  {days.map((d) => {
                    const date = dayIso(d)
                    const qty = getQty(r, date)
                    const key = `${r.id}:${date}`
                    const isEditing = editing?.id === r.id && editing?.date === date
                    const isSaving = savingKey === key
                    return (
                      <td
                        key={date}
                        className={`px-2 py-1.5 border-b border-gray-100 text-right tabular-nums ${isEditing ? 'bg-amber-50' : ''}`}
                        onClick={() => {
                          if (isSaving) return
                          onEditStart(r.id, date, qty ? String(qty) : '')
                        }}
                      >
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => onEditChange(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') onEditCancel()
                                if (e.key === 'Enter') onEditCommit(r.id, date, editValue)
                              }}
                              onBlur={() => onEditCommit(r.id, date, editValue)}
                              className="w-[64px] h-7 px-2 rounded border bg-white text-right text-xs"
                              placeholder="0"
                            />
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" /> : null}
                          </div>
                        ) : qty ? (
                          <span className="font-medium text-slate-900">{formatQty(qty)}</span>
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
        </div>
        </>
      )}
    </div>
  )
}

function TruckingPageContent() {
  const searchParams = useSearchParams()
  const [truckingOperations, setTruckingOperations] = useState<TruckingOperation[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedData, setEditedData] = useState<Partial<TruckingOperation>>({})
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [lateIndicatorFilter, setLateIndicatorFilter] = useState<string>('ALL')
  const [loadingLocationFilter, setLoadingLocationFilter] = useState('')
  const [unloadingLocationFilter, setUnloadingLocationFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Date filters: keep draft values so typing/selecting doesn't auto-refresh until Apply
  const [dateFromDraft, setDateFromDraft] = useState(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    return `${yyyy}-01-01`
  })
  const [dateToDraft, setDateToDraft] = useState(() => {
    const now = new Date()
    const yyyy = now.getFullYear()
    return `${yyyy}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
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
  const [page, setPage] = useState<number>(1)
  const pageSize = 50
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [truckingSummary, setTruckingSummary] = useState<any>(null)

  // View tabs
  const [activeTab, setActiveTab] = useState<'list' | 'calendar'>('list')

  // Calendar tab state (Daily Planning Deliverables)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [calendarRows, setCalendarRows] = useState<TruckingCalendarRow[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarSavingKey, setCalendarSavingKey] = useState<string | null>(null)
  const [calendarEditing, setCalendarEditing] = useState<{ id: string; date: string } | null>(null)
  const [calendarEditValue, setCalendarEditValue] = useState<string>('')
  const [planningUploadOpen, setPlanningUploadOpen] = useState(false)
  const [planningUploading, setPlanningUploading] = useState(false)
  const [planningUploadSummary, setPlanningUploadSummary] = useState<{
    processedRows: number
    succeededOperations: number
    failedOperations: number
    succeededRows: number
    rowLevelIssues: number
    operationLevelFailures: number
    rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[]
    operationFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string; operation_ids?: string[] }[]
  } | null>(null)
  const planningFileInputRef = useRef<HTMLInputElement | null>(null)
  const [calendarColumnsOpen, setCalendarColumnsOpen] = useState(false)
  const calendarColumnsRef = useRef<HTMLDivElement | null>(null)
  const [calendarVisibleMetaCols, setCalendarVisibleMetaCols] = useState<Set<string>>(
    () =>
      new Set([
        'operation_id',
        'contract_block',
        'owner',
        'due_start',
        'due_end',
        'qty_sent',
        'qty_sent_planning',
        'qty_delivered',
        'qty_received',
        'source_type',
        'lt_spot',
        'product',
        'group_name',
        'supplier',
        'outstanding_quantity',
      ]),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onMouseDown = (e: MouseEvent) => {
      if (!calendarColumnsOpen) return
      const el = calendarColumnsRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setCalendarColumnsOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [calendarColumnsOpen])

  const iso = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const fetchCalendarRows = useCallback(async () => {
    setCalendarLoading(true)
    try {
      const from = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
      const to = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0)
      const params = new URLSearchParams()
      params.set('from', iso(from))
      params.set('to', iso(to))
      const searchTrim = searchTerm.trim()
      if (searchTrim.length >= 2) params.set('search', searchTrim)
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter)
      if (loadingLocationFilter.trim()) params.set('loadingLocation', loadingLocationFilter.trim())
      if (unloadingLocationFilter.trim()) params.set('unloadingLocation', unloadingLocationFilter.trim())
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (lateIndicatorFilter && lateIndicatorFilter !== 'ALL') params.set('lateIndicator', lateIndicatorFilter)

      const res = await api.get(`/trucking/daily-planning-deliverables?${params.toString()}`)
      setCalendarRows((res.data?.data || []) as TruckingCalendarRow[])
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to load calendar deliverables'
      alert(msg)
      setCalendarRows([])
    } finally {
      setCalendarLoading(false)
    }
  }, [
    calendarMonth,
    searchTerm,
    statusFilter,
    loadingLocationFilter,
    unloadingLocationFilter,
    dateFrom,
    dateTo,
    lateIndicatorFilter,
  ])

  useEffect(() => {
    if (activeTab !== 'calendar') return
    fetchCalendarRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchCalendarRows])

  const downloadDailyPlanningTemplate = async () => {
    try {
      const res = await api.get('/trucking/daily-planning-deliverables/template', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'daily_planning_deliverables_template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || e?.message || 'Failed to download template')
    }
  }

  const handleDailyPlanningFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPlanningUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/trucking/daily-planning-deliverables/bulk-upload', fd)
      const data = res.data?.data
      if (data) {
        setPlanningUploadSummary(data)
        setPlanningUploadOpen(true)
      }
      await fetchCalendarRows()
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err?.message || 'Upload failed')
    } finally {
      setPlanningUploading(false)
    }
  }

  const planningYearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 18 }, (_, i) => y - 8 + i)
  }, [])
  
  // Documents state
  const [selectedOperation, setSelectedOperation] = useState<TruckingOperation | null>(null)
  const [operationDocs, setOperationDocs] = useState<DocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [showDocs, setShowDocs] = useState(false)

  // Create new trucking operation modal
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Compact/Expand view state
  const [expandedOperationIds, setExpandedOperationIds] = useState<Set<string>>(() => new Set())
  const [showColumnsMenu, setShowColumnsMenu] = useState(false)
  const [sortKey, setSortKey] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<string>>(() => new Set())

  // Desktop table horizontal scroll sync
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bottomScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState<number>(0)
  const isSyncingScroll = useRef(false)

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

  useEffect(() => {
    // Read URL parameters
    const statusParam = searchParams.get('status')
    if (statusParam) {
      setStatusFilter(statusParam)
    }
    setPage(1)
    setTruckingOperations([])
    setHasMore(true)
  }, [searchParams])

  useEffect(() => {
    fetchTruckingOperations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, loadingLocationFilter, unloadingLocationFilter, searchParams, sortKey, sortDir])

  const isFirstLateIndicatorEffect = useRef(true)
  useEffect(() => {
    if (isFirstLateIndicatorEffect.current) {
      isFirstLateIndicatorEffect.current = false
      return
    }
    setPage(1)
    fetchTruckingOperations(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lateIndicatorFilter])

  const isFirstSearchRender = useRef(true)
  useEffect(() => {
    if (isFirstSearchRender.current) {
      isFirstSearchRender.current = false
      return
    }
    const t = setTimeout(() => {
      setPage(1)
      fetchTruckingOperations(1)
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])

  const isFirstColumnFilterRender = useRef(true)
  useEffect(() => {
    if (isFirstColumnFilterRender.current) {
      isFirstColumnFilterRender.current = false
      return
    }
    const t = setTimeout(() => {
      setPage(1)
      fetchTruckingOperations(1)
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters])

  const fetchTruckingOperations = async (forcedPage?: number) => {
    try {
      setLoading(true)
      const effectivePage = forcedPage ?? page
      const params = new URLSearchParams()
      params.append('limit', String(pageSize))
      params.append('page', String(effectivePage))
      params.append('sortKey', sortKey)
      params.append('sortDir', sortDir)
      if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter)
      }
      if (loadingLocationFilter) {
        params.append('loadingLocation', loadingLocationFilter)
      }
      if (unloadingLocationFilter) {
        params.append('unloadingLocation', unloadingLocationFilter)
      }
      if (dateFrom) params.append('dateFrom', dateFrom)
      if (dateTo) params.append('dateTo', dateTo)
      const searchTrim = searchTerm.trim()
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
      
      const response = await api.get(`/trucking?${params.toString()}`)
      const items = response.data.data.truckingOperations || []
      setTruckingOperations((prev) => (effectivePage === 1 ? items : [...prev, ...items]))
      setTruckingSummary(response.data.data.summary || null)
      const total = Number(response.data.data.pagination?.total ?? 0)
      const totalPages = Number(response.data.data.pagination?.totalPages || 1)
      setTotalCount(total)
      setHasMore(effectivePage < totalPages)
    } catch (error) {
      console.error('Failed to fetch trucking operations:', error)
      alert('Failed to load trucking operations. Please refresh the page.')
      setTruckingSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (operation: TruckingOperation) => {
    setEditingId(operation.id)
    setEditedData({ ...operation })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditedData({})
  }

  const handleSave = async (operationId: string) => {
    setSaving(true)
    try {
      const response = await api.put(`/trucking/${operationId}`, editedData)
      
      if (response.data.success) {
        setTruckingOperations(prev => prev.map(operation => 
          operation.id === operationId 
            ? { ...operation, ...response.data.data }
            : operation
        ))
        setEditingId(null)
        setEditedData({})
        alert('Trucking operation updated successfully!')
      }
    } catch (error: any) {
      console.error('Update trucking operation error:', error)
      const msg = error?.response?.data?.error?.message || 'Failed to update trucking operation. Please try again.'
      const detail = error?.response?.data?.error?.details || error?.response?.data?.error?.detail
      alert(detail ? `${msg}\n\nDetails: ${detail}` : msg)
    } finally {
      setSaving(false)
    }
  }

  const handleFieldChange = (field: keyof TruckingOperation, value: any) => {
    setEditedData(prev => ({ ...prev, [field]: value }))
  }

  const handleCreated = () => {
    setPage(1)
    setTruckingOperations([])
    setHasMore(true)
  }

  const downloadTemplate = async () => {
    const headers = [
      'Operation ID','Status','Location','Trucking Owner',
      'Cargo Readiness Date at Starting Location (YYYY-MM-DD)',
      'Trucking Start Receive Date (YYYY-MM-DD)','Trucking Last Receive Date (YYYY-MM-DD)',
      // ETA trucking dates removed from UI
      'Due Date Delivery Start (YYYY-MM-DD)','Due Date Delivery End (YYYY-MM-DD)',
      'Contract Qty (Kg)','Late Indicator',
      'Quantity Sent via Trucking (Based on Surat Jalan) (Kg)','Quantity Delivered via Trucking (Kg)','Gain/Loss %','Gain/Loss Amount (Kg)','Trucking OA Budget at Starting Location','Trucking OA Actual at Starting Location',
      'Contract Number','STO Number','Supplier','Product','Group'
    ]

    const rows: string[] = []
    const data = truckingOperations.filter(op =>
      (searchTerm === '' || op.operation_id?.toLowerCase().includes(searchTerm.toLowerCase()) || op.trucking_owner?.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    for (const t of data) {
      rows.push([
        t.operation_id, t.status, t.location, t.trucking_owner,
        t.cargo_readiness_date?.substring(0,10) || '',
        t.trucking_start_date?.substring(0,10) || '', t.trucking_completion_date?.substring(0,10) || '',
        // ETA trucking dates removed from UI
        t.delivery_start_date?.substring(0,10) || '', t.delivery_end_date?.substring(0,10) || '',
        toKg(t.contract_qty ?? ''), getLateIndicator(t).text,
        toKg(t.quantity_sent ?? ''), toKg(t.quantity_delivered ?? ''), t.gain_loss_percentage ?? '', toKg(t.gain_loss_amount ?? ''), t.oa_budget ?? '', t.oa_actual ?? '',
        t.contract_number || '', t.sto_number || '', t.supplier || '', t.product || '', t.group_name || ''
      ].join(','))
    }

    const csvContent = [headers.join(','), ...(rows.length ? rows : [
      'TRUCK001,PLANNED,Starting Location,Truck Owner 1,2025-01-01,2025-01-02,2025-01-03,2025-01-02,2025-01-03,2025-01-01,2025-01-31,1000,On Time,1000,1000,0,0,5000,4500,CTR001,STO001,Supplier A,CPKO,Group X'
    ])].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'Trucking_Export.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLANNED': return 'bg-blue-100 text-blue-800'
      case 'IN_PROGRESS': return 'bg-yellow-100 text-yellow-800'
      case 'LOADING': return 'bg-orange-100 text-orange-800'
      case 'IN_TRANSIT': return 'bg-purple-100 text-purple-800'
      case 'UNLOADING': return 'bg-indigo-100 text-indigo-800'
      case 'COMPLETED': return 'bg-green-100 text-green-800'
      case 'CANCELLED': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  // Document functions
  const handleUploadFileChange = async (operation: TruckingOperation, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const allowed = ['application/pdf', 'image/png', 'image/jpeg']
    if (!allowed.includes(file.type)) {
      alert('Only PDF, PNG, or JPEG files are allowed.')
      e.target.value = ''
      return
    }

    setUploadingId(operation.id)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', 'OTHER')
      form.append('trucking_operation_id', operation.id)

      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.data?.success) {
        alert('Document uploaded successfully!')
        if (selectedOperation && selectedOperation.id === operation.id) {
          await fetchOperationDocuments(operation.id)
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

  const fetchOperationDocuments = async (operationInternalId: string) => {
    try {
      setDocsLoading(true)
      const params = new URLSearchParams()
      params.append('truckingOperationId', operationInternalId)
      const res = await api.get(`/documents?${params.toString()}`)
      const docs: DocumentItem[] = res.data?.data || []
      setOperationDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setOperationDocs([])
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

  const handleViewDocuments = async (operation: TruckingOperation) => {
    setSelectedOperation(operation)
    setShowDocs(true)
    await fetchOperationDocuments(operation.id)
  }

  const formatNumber = (num: number | string) => {
    if (num === null || num === undefined || num === '') return '-'
    const raw = typeof num === 'string' ? num : String(num)
    const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '')
    const number = typeof num === 'string' ? parseFloat(cleaned) : num
    if (isNaN(number)) return '-'
    if (number === 0) return '0'
    return number.toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 2,
      useGrouping: true
    })
  }

  const toKg = (mt: number | string | null | undefined) => {
    if (mt === null || mt === undefined || mt === '') return null
    const raw = typeof mt === 'string' ? mt : String(mt)
    const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '')
    const n = typeof mt === 'string' ? parseFloat(cleaned) : (mt as number)
    if (!Number.isFinite(n)) return null
    return n
  }

  const formatKg = (mt: number | string | null | undefined) => {
    const n = toKg(mt)
    if (n === null) return '-'
    return `${formatNumber(n)} Kg`
  }

  const formatDate = (dateStr: string) => formatDateDMY(dateStr)

  const formatShortDate = (dateStr: string) => formatDateDMY(dateStr)

  // Helper function to calculate late indicator
  const getLateIndicator = (operation: TruckingOperation): { color: string; text: string } => {
    if (!operation.delivery_end_date) {
      return { color: 'bg-gray-100 text-gray-800', text: '-' }
    }
    
    const deliveryEnd = new Date(operation.delivery_end_date).getTime()
    const actualCompletion = operation.trucking_completion_date ? new Date(operation.trucking_completion_date).getTime() : null
    
    // If completion date is null, cannot determine
    if (actualCompletion === null) {
      return { color: 'bg-gray-100 text-gray-800', text: '-' }
    }
    
    // Green if delivery_end >= actual completion; red otherwise
    const isOnTime = deliveryEnd >= actualCompletion
    
    if (isOnTime) {
      return { color: 'bg-green-100 text-green-800', text: 'On Time' }
    } else {
      return { color: 'bg-red-100 text-red-800', text: 'Late' }
    }
  }

  const handleFilterChange = () => {
    setDateFrom(dateFromDraft)
    setDateTo(dateToDraft)
    setPage(1)
    fetchTruckingOperations(1)
  }

  // Excel-like filtering helpers
  const getFilterTypeForColumn = (colId: string): ColumnFilter['type'] => {
    if (colId === 'contract_qty' || colId === 'sto_quantity' || colId === 'quantity_sent' || colId === 'quantity_delivered' || colId === 'quantity_receive' || colId === 'oa_budget' || colId === 'oa_actual' || colId === 'estimated_km' || colId === 'gain_loss_percentage' || colId === 'gain_loss_amount') return 'number'
    if (colId === 'cargo_readiness_date' || colId === 'trucking_start_date' || colId === 'trucking_completion_date' || colId === 'delivery_start_date' || colId === 'delivery_end_date' || colId === 'created_at') return 'date'
    return 'text'
  }

  const getColumnRawValue = (o: TruckingOperation, colId: string): string | number | null => {
    switch (colId) {
      case 'operation_id': return o.operation_id || ''
      case 'contract_number': return o.contract_number || ''
      case 'po_number': return o.po_number || ''
      case 'sto_number': return o.sto_number || ''
      case 'status': return o.status || ''
      case 'location': return o.location || ''
      case 'loading_location': return o.loading_location || o.location || ''
      case 'unloading_location': return o.unloading_location || ''
      case 'trucking_owner': return o.trucking_owner || ''
      case 'supplier': return o.supplier || ''
      case 'product': return o.product || ''
      case 'buyer': return o.buyer || ''
      case 'group_name': return o.group_name || ''
      case 'contract_qty': return typeof o.contract_qty === 'number' ? o.contract_qty : null
      case 'sto_quantity': return typeof o.sto_quantity === 'number' ? o.sto_quantity : null
      case 'quantity_sent': return typeof o.quantity_sent === 'number' ? o.quantity_sent : null
      case 'quantity_delivered': return typeof o.quantity_delivered === 'number' ? o.quantity_delivered : null
      case 'quantity_receive': return typeof o.quantity_receive === 'number' ? o.quantity_receive : (typeof o.quantity_delivered === 'number' ? o.quantity_delivered : null)
      case 'oa_budget': return typeof o.oa_budget === 'number' ? o.oa_budget : null
      case 'oa_actual': return typeof o.oa_actual === 'number' ? o.oa_actual : null
      case 'estimated_km': return typeof o.estimated_km === 'number' ? o.estimated_km : null
      case 'gain_loss_percentage': return typeof o.gain_loss_percentage === 'number' ? o.gain_loss_percentage : null
      case 'gain_loss_amount': return typeof o.gain_loss_amount === 'number' ? o.gain_loss_amount : null
      case 'cargo_readiness_date': return o.cargo_readiness_date || ''
      case 'trucking_start_date': return o.trucking_start_date || ''
      case 'trucking_completion_date': return o.trucking_completion_date || ''
      case 'delivery_start_date': return o.delivery_start_date || ''
      case 'delivery_end_date': return o.delivery_end_date || ''
      case 'created_at': return o.created_at || ''
      case 'late_indicator': return getLateIndicator(o).text
      default: return (o as any)[colId] ?? ''
    }
  }

  // Search, column filters, and late indicator are applied on the server across the full dataset.
  const filteredOperations = truckingOperations

  // Compact columns definition
  interface CompactColumn {
    id: string
    label: string
    defaultVisible: boolean
    sortable: boolean
    formulaHelp?: string
    getSortValue?: (o: TruckingOperation) => string | number
    render: (o: TruckingOperation) => React.ReactNode
    className?: string
    headerClassName?: string
  }

  const compactColumns: CompactColumn[] = useMemo(() => [
    {
      id: 'late_indicator',
      label: 'Late Indicator',
      formulaHelp: FIELD_HELP.lateIndicator,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => {
        const indicator = getLateIndicator(o)
        return indicator.text
      },
      render: (o) => {
        const indicator = getLateIndicator(o)
        return <Badge className={indicator.color}>{indicator.text}</Badge>
      }
    },
    {
      id: 'operation_id',
      label: 'Operation ID',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.operation_id || '',
      render: (o) => (
        <div className="min-w-0 break-words">
          <div className="font-semibold break-words">{o.operation_id}</div>
          <div className="text-xs text-gray-600 break-words">{o.location || '-'} • {o.trucking_owner || '-'}</div>
        </div>
      )
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.status || '',
      render: (o) => (
        <Badge className={getStatusColor(o.status)}>
          {o.status}
        </Badge>
      )
    },
    {
      id: 'contract_number',
      label: 'Contract Ext No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_ext_no || o.contract_number || '',
      render: (o) => (
        <span className="text-sm break-words block" title={(o.contract_ext_no || o.contract_number || '') as string}>
          {o.contract_ext_no || o.contract_number || '-'}
        </span>
      )
    },
    {
      id: 'po_number',
      label: 'PO No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.po_number || '',
      render: (o) => (
        <span className="text-sm break-words block" title={o.po_number || ''}>
          {o.po_number || '-'}
        </span>
      )
    },
    {
      id: 'sto_number',
      label: 'STO No',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.sto_number || '',
      render: (o) => (
        <span className="text-sm break-words block" title={o.sto_number || ''}>
          {o.sto_number || '-'}
        </span>
      )
    },
    {
      id: 'sto_quantity',
      label: 'STO Quantity',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.sto_quantity || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.sto_quantity || 0)}
        </span>
      )
    },
    {
      id: 'location',
      label: 'Location',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.location || '',
      render: (o) => <span className="text-sm break-words">{o.location || '-'}</span>
    },
    {
      id: 'loading_location',
      label: 'Truck Loading Location',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.loading_location || o.location || '',
      render: (o) => <span className="text-sm break-words">{o.loading_location || o.location || '-'}</span>
    },
    {
      id: 'unloading_location',
      label: 'Truck Discharge Location',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.unloading_location || '',
      render: (o) => <span className="text-sm break-words">{o.unloading_location || '-'}</span>
    },
    {
      id: 'trucking_owner',
      label: 'Trucking Owner',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_owner || '',
      render: (o) => <span className="text-sm break-words">{o.trucking_owner || '-'}</span>
    },
    {
      id: 'supplier',
      label: 'Supplier',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.supplier || '',
      render: (o) => <span className="text-sm break-words">{o.supplier || '-'}</span>
    },
    {
      id: 'product',
      label: 'Product',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.product || '',
      render: (o) => <span className="text-sm break-words">{o.product || '-'}</span>
    },
    {
      id: 'quantity_sent',
      label: 'Qty Sent (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.quantity_sent || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_sent)}
        </span>
      )
    },
    {
      id: 'quantity_delivered',
      label: 'Quantity Delivery (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.quantity_delivered || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_delivered)}
        </span>
      )
    },
    {
      id: 'quantity_receive',
      label: 'Quantity Receive (Kg)',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.quantity_receive || o.quantity_delivered || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.quantity_receive || o.quantity_delivered)}
        </span>
      )
    },
    {
      id: 'gain_loss_percentage',
      label: 'Gain/Loss %',
      formulaHelp: FIELD_HELP.gainLossPct,
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.gain_loss_percentage || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatNumber(o.gain_loss_percentage)}%
        </span>
      )
    },
    {
      id: 'gain_loss_amount',
      label: 'Gain/Loss Amount (Kg)',
      formulaHelp: FIELD_HELP.gainLossAmount,
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.gain_loss_amount || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.gain_loss_amount)}
        </span>
      )
    },
    {
      id: 'oa_budget',
      label: 'Trucking OA Budget',
      formulaHelp: FIELD_HELP.truckingOaBudget,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.oa_budget || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatNumber(o.oa_budget)}
        </span>
      )
    },
    {
      id: 'oa_actual',
      label: 'Trucking OA Actual',
      formulaHelp: FIELD_HELP.truckingOaActual,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.oa_actual || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatNumber(o.oa_actual)}
        </span>
      )
    },
    {
      id: 'estimated_km',
      label: 'Estimated KM',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.estimated_km || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {o.estimated_km ? `${formatNumber(o.estimated_km)} km` : '-'}
        </span>
      )
    },
    {
      id: 'cargo_readiness_date',
      label: 'Cargo Readiness',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.cargo_readiness_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.cargo_readiness_date)}</span>
    },
    {
      id: 'trucking_start_date',
      label: 'Trucking Start Receive Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_start_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.trucking_start_date)}</span>
    },
    {
      id: 'trucking_completion_date',
      label: 'Trucking Last Receive Date',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.trucking_completion_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.trucking_completion_date)}</span>
    },
    // ETA date columns removed from UI
    {
      id: 'delivery_start_date',
      label: 'Due Date Delivery Start',
      formulaHelp: FIELD_HELP.etaVsDueDelivery,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.delivery_start_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.delivery_start_date || '')}</span>
    },
    {
      id: 'delivery_end_date',
      label: 'Due Date Delivery End',
      formulaHelp: FIELD_HELP.etaVsDueDelivery,
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.delivery_end_date || '',
      render: (o) => <span className="text-sm">{formatShortDate(o.delivery_end_date || '')}</span>
    },
    {
      id: 'contract_qty',
      label: 'Contract Qty',
      defaultVisible: true,
      sortable: true,
      getSortValue: (o) => o.contract_qty || 0,
      render: (o) => (
        <span className="text-sm break-words">
          {formatKg(o.contract_qty || 0)}
        </span>
      )
    },
    {
      id: 'buyer',
      label: 'Buyer',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.buyer || '',
      render: (o) => <span className="text-sm break-words">{o.buyer || '-'}</span>
    },
    {
      id: 'group_name',
      label: 'Group',
      defaultVisible: false,
      sortable: true,
      getSortValue: (o) => o.group_name || '',
      render: (o) => <span className="text-sm break-words">{o.group_name || '-'}</span>
    }
  ], [])

  const defaultVisibleColumnIds = useMemo(() => {
    return compactColumns
      .filter(c => c.defaultVisible && c.render)
      .map(c => c.id)
  }, [compactColumns])

  useEffect(() => {
    if (visibleColumnIds.size === 0) {
      setVisibleColumnIds(new Set(defaultVisibleColumnIds))
    }
  }, [defaultVisibleColumnIds, visibleColumnIds.size])

  const visibleColumns = useMemo(() => {
    const visible = compactColumns.filter(c => visibleColumnIds.has(c.id))
    const statusCol = compactColumns.find(c => c.id === 'status')
    const hasStatus = visible.some(c => c.id === 'status')
    const visibleWithStatus = hasStatus ? visible : (statusCol ? [...visible, statusCol] : visible)
    
    const ordered = [
      ...visibleWithStatus.filter(c => c.id === 'late_indicator'),
      ...visibleWithStatus.filter(c => c.id === 'operation_id'),
      ...visibleWithStatus.filter(c => c.id === 'status'),
      ...visibleWithStatus.filter(c => c.id !== 'late_indicator' && c.id !== 'operation_id' && c.id !== 'status')
    ]
    return ordered
  }, [compactColumns, visibleColumnIds, editingId])

  const sortedOperations = useMemo(() => {
    const col = compactColumns.find(c => c.id === sortKey)
    if (!col?.sortable || !col.getSortValue) return filteredOperations

    const sorted = [...filteredOperations].sort((a, b) => {
      const aVal = col.getSortValue!(a)
      const bVal = col.getSortValue!(b)
      const dirMul = sortDir === 'asc' ? 1 : -1

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dirMul
      }
      return String(aVal).localeCompare(String(bVal)) * dirMul
    })

    return sorted
  }, [compactColumns, filteredOperations, sortDir, sortKey])

  const allVisibleIds = useMemo(() => sortedOperations.map(o => o.id), [sortedOperations])
  const expandedCount = expandedOperationIds.size
  const allExpanded = expandedCount > 0 && expandedCount === allVisibleIds.length

  const toggleExpand = (id: string) => {
    setExpandedOperationIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const expandAll = (ids: string[]) => {
    setExpandedOperationIds(new Set(ids))
  }

  const collapseAll = () => {
    setExpandedOperationIds(new Set())
  }

  const toggleColumn = (colId: string) => {
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

  const getColumnWidth = (colId: string): string => {
    const widths: { [key: string]: string } = {
      'late_indicator': '130px',
      'operation_id': '180px',
      'status': '120px',
      'contract_number': '160px',
      'po_number': '120px',
      'sto_number': '120px',
      'sto_quantity': '130px',
      'location': '150px',
      'loading_location': '170px',
      'unloading_location': '180px',
      'trucking_owner': '150px',
      'supplier': '150px',
      'product': '120px',
      'quantity_sent': '130px',
      'quantity_delivered': '150px',
      'quantity_receive': '150px',
      'gain_loss_percentage': '120px',
      'gain_loss_amount': '150px',
      'oa_budget': '150px',
      'oa_actual': '150px',
      'estimated_km': '130px',
      'cargo_readiness_date': '140px',
      'trucking_start_date': '180px',
      'trucking_completion_date': '200px',
      'delivery_start_date': '180px',
      'delivery_end_date': '180px',
      'contract_qty': '130px',
      'buyer': '150px',
      'group_name': '120px'
    }
    return widths[colId] || '120px'
  }

  // Calculate table scroll width
  useEffect(() => {
    const calculateWidth = () => {
      const bottom = bottomScrollRef.current
      if (bottom) {
        setTableScrollWidth(bottom.scrollWidth)
      }
    }
    calculateWidth()
    window.addEventListener('resize', calculateWidth)
    return () => window.removeEventListener('resize', calculateWidth)
  }, [visibleColumns, sortedOperations])

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Trucking Operations</h1>
            <p className="text-gray-600 mt-1">
              Manage and track all trucking operations - {totalCount || filteredOperations.length} total
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowCreateForm(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".csv"
                onChange={() => alert('CSV upload feature coming soon!')}
                className="hidden"
                disabled={uploading}
              />
              <Button
                disabled={uploading}
                className="bg-blue-600 hover:bg-blue-700 cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  const input = e.currentTarget.parentElement?.querySelector('input[type="file"]') as HTMLInputElement
                  input?.click()
                }}
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
            </label>
          </div>
        </div>

        {/* Filters (list + daily planning) */}
        <>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex-1 min-w-[280px] relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search by Operation ID, Contract, Contract Ext No, STO, Truck Loading/Discharge, Owner, or Supplier..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="shrink-0 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Status</option>
                <option value="PLANNED">Planned</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="LOADING">Loading</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="UNLOADING">Unloading</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <select
                value={lateIndicatorFilter}
                onChange={(e) => setLateIndicatorFilter(e.target.value)}
                className="shrink-0 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Late Indicator</option>
                <option value="ON_TIME">On Time</option>
                <option value="LATE">Late</option>
                <option value="NA">N/A</option>
              </select>
              <Input
                placeholder="Truck Loading Location"
                value={loadingLocationFilter}
                onChange={(e) => setLoadingLocationFilter(e.target.value)}
                className="shrink-0 w-48"
              />
              <Input
                placeholder="Truck Discharge Location"
                value={unloadingLocationFilter}
                onChange={(e) => setUnloadingLocationFilter(e.target.value)}
                className="shrink-0 w-48"
              />
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm text-gray-600">Contract Date:</span>
                <Input type="date" value={dateFromDraft} onChange={(e) => setDateFromDraft(e.target.value)} className="w-40" />
                <span className="text-gray-500">to</span>
                <Input type="date" value={dateToDraft} onChange={(e) => setDateToDraft(e.target.value)} className="w-40" />
              </div>
              <Button onClick={handleFilterChange} variant="outline" size="sm" className="shrink-0">
                <Filter className="h-4 w-4 mr-1" />
                Apply
              </Button>
              {(statusFilter !== 'ALL' || lateIndicatorFilter !== 'ALL' || loadingLocationFilter || unloadingLocationFilter || dateFromDraft || dateToDraft) && (
                <Button 
                  onClick={() => {
                    setStatusFilter('ALL')
                    setLateIndicatorFilter('ALL')
                    setLoadingLocationFilter('')
                    setUnloadingLocationFilter('')
                    const now = new Date()
                    const yyyy = now.getFullYear()
                    const to = `${yyyy}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                    setDateFromDraft(`${yyyy}-01-01`)
                    setDateToDraft(to)
                    setDateFrom(`${yyyy}-01-01`)
                    setDateTo(to)
                    setPage(1)
                    fetchTruckingOperations(1)
                  }}
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-gray-500"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        </>

        {/* Calendar is rendered in the main section below (replaces All Trucking Operations on that tab). */}

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center gap-3 md:gap-6 overflow-x-auto overflow-y-visible pt-4 pb-4 px-6">
              {[
                { status: 'PLANNED', label: 'Planned', color: 'bg-blue-100', textColor: 'text-blue-800', badgeColor: 'bg-blue-600' },
                { status: 'IN_PROGRESS', label: 'In Progress', color: 'bg-yellow-100', textColor: 'text-yellow-800', badgeColor: 'bg-yellow-600' },
                { status: 'LOADING', label: 'Loading', color: 'bg-orange-100', textColor: 'text-orange-800', badgeColor: 'bg-orange-600' },
                { status: 'IN_TRANSIT', label: 'In Transit', color: 'bg-purple-100', textColor: 'text-purple-800', badgeColor: 'bg-purple-600' },
                { status: 'UNLOADING', label: 'Unloading', color: 'bg-indigo-100', textColor: 'text-indigo-800', badgeColor: 'bg-indigo-600' },
                { status: 'COMPLETED', label: 'Completed', color: 'bg-green-100', textColor: 'text-green-800', badgeColor: 'bg-green-600' },
                { status: 'CANCELLED', label: 'Cancelled', color: 'bg-red-100', textColor: 'text-red-800', badgeColor: 'bg-red-600' }
              ].map((statusInfo, index, array) => {
                const s = truckingSummary?.status
                const count =
                  statusInfo.status === 'PLANNED' ? Number(s?.planned ?? 0)
                    : statusInfo.status === 'IN_PROGRESS' ? Number(s?.inProgress ?? 0)
                      : statusInfo.status === 'LOADING' ? Number(s?.loading ?? 0)
                        : statusInfo.status === 'IN_TRANSIT' ? Number(s?.inTransit ?? 0)
                          : statusInfo.status === 'UNLOADING' ? Number(s?.unloading ?? 0)
                            : statusInfo.status === 'COMPLETED' ? Number(s?.completed ?? 0)
                              : statusInfo.status === 'CANCELLED' ? Number(s?.cancelled ?? 0)
                                : 0
                return (
                  <div key={statusInfo.status} className="flex items-center flex-shrink-0">
                    <div className="relative overflow-visible">
                      {/* Status Circle */}
                      <div className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full ${statusInfo.color} flex items-center justify-center border-2 border-white shadow-lg hover:shadow-xl transition-shadow`}>
                        {/* Count Badge */}
                        <div className={`absolute -top-2 -right-2 ${statusInfo.badgeColor} text-white text-xs md:text-sm font-bold rounded-full w-7 h-7 md:w-8 md:h-8 flex items-center justify-center shadow-lg z-10`}>
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

        {/* View: List vs Daily Planning Deliverables — above main table/calendar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-gray-700">View</div>
          <div className="inline-flex rounded-lg border bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'calendar' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Daily Planning Deliverables
            </button>
          </div>
          {activeTab === 'calendar' ? (
            <div className="text-xs text-slate-500 w-full sm:w-auto sm:text-right">
              Click a cell to edit daily deliverables.
            </div>
          ) : null}
        </div>

        {activeTab === 'calendar' && (
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
                    Shows operations that overlap the selected month (due delivery / trucking dates). Edit cells or upload CSV/Excel (Contract Ext No, date, quantity) — same validation as the website (due date range, quantity caps).
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative" ref={calendarColumnsRef}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCalendarColumnsOpen((v) => !v)}
                    >
                      <SlidersHorizontal className="h-4 w-4 mr-1" />
                      Columns
                    </Button>
                    {calendarColumnsOpen ? (
                      <div className="absolute right-0 mt-2 w-72 rounded-md border bg-white shadow-md z-50 p-3">
                        <div className="text-xs font-semibold text-gray-600 mb-2">Visible columns (Daily Planning)</div>
                        <div className="space-y-2 max-h-72 overflow-auto pr-1">
                          {[
                            { id: 'operation_id', label: 'Operation ID' },
                            { id: 'contract_block', label: 'Contract Ext No / STO / Supplier' },
                            { id: 'owner', label: 'Owner' },
                            { id: 'due_start', label: 'Due Start' },
                            { id: 'due_end', label: 'Due End' },
                            { id: 'qty_sent', label: 'Qty Sent' },
                            { id: 'qty_sent_planning', label: 'Qty Sent (planning)' },
                            { id: 'qty_delivered', label: 'Qty Delivered' },
                            { id: 'qty_received', label: 'Qty Received' },
                            { id: 'source_type', label: 'Source Type' },
                            { id: 'lt_spot', label: 'LT/SPOT' },
                            { id: 'product', label: 'Product' },
                            { id: 'group_name', label: 'Group Name' },
                            { id: 'supplier', label: 'Supplier' },
                            { id: 'outstanding_quantity', label: 'Outstanding Quantity' },
                          ].map((c) => (
                            <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                              <Checkbox
                                checked={calendarVisibleMetaCols.has(c.id)}
                                onCheckedChange={() => {
                                  setCalendarVisibleMetaCols((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(c.id)) next.delete(c.id)
                                    else next.add(c.id)
                                    return next
                                  })
                                }}
                              />
                              <span>{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={downloadDailyPlanningTemplate}>
                    <Download className="h-4 w-4 mr-1" />
                    Template
                  </Button>
                  <input
                    ref={planningFileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    className="hidden"
                    onChange={handleDailyPlanningFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={planningUploading}
                    onClick={() => planningFileInputRef.current?.click()}
                  >
                    {planningUploading ? (
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
                  onClick={() => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
                  value={calendarMonth.getMonth()}
                  onChange={(e) => {
                    const m = Number(e.target.value)
                    setCalendarMonth(new Date(calendarMonth.getFullYear(), m, 1))
                  }}
                  aria-label="Month"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>
                      {format(new Date(2000, i, 1), 'MMMM')}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[88px]"
                  value={calendarMonth.getFullYear()}
                  onChange={(e) => {
                    const y = Number(e.target.value)
                    setCalendarMonth(new Date(y, calendarMonth.getMonth(), 1))
                  }}
                  aria-label="Year"
                >
                  {planningYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                >
                  Next <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date()
                    setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                  }}
                >
                  Today
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <CalendarDeliverablesTable
                month={calendarMonth}
                rows={calendarRows}
                loading={calendarLoading}
                savingKey={calendarSavingKey}
                editing={calendarEditing}
                editValue={calendarEditValue}
                formatQty={formatTruckingQtyPlain}
                visibleMetaCols={calendarVisibleMetaCols}
                onEditStart={(id, date, initial) => {
                  setCalendarEditing({ id, date })
                  setCalendarEditValue(initial)
                }}
                onEditChange={setCalendarEditValue}
                onEditCancel={() => {
                  setCalendarEditing(null)
                  setCalendarEditValue('')
                }}
                onEditCommit={async (id, date, rawValue) => {
                  const key = `${id}:${date}`
                  setCalendarSavingKey(key)
                  try {
                    const q = rawValue.trim() === '' ? null : Number(String(rawValue).replace(/,/g, ''))
                    if (q != null && (!Number.isFinite(q) || q < 0)) {
                      alert('Quantity must be a valid number (>= 0)')
                      return
                    }
                    const row = calendarRows.find((r) => r.id === id)
                    if (!row) return
                    const existing = (row.daily_deliverables || []).slice()
                    const next = existing.filter((x) => (x?.date || '').slice(0, 10) !== date)
                    if (q != null && q !== 0) {
                      next.push({ date, quantity_delivered: q })
                      next.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                    }
                    const res = await api.put(`/trucking/${id}/daily-planning-deliverables`, { daily_deliverables: next })
                    if (res.data?.success) {
                      setCalendarRows((prev) => prev.map((r) => (r.id === id ? { ...r, daily_deliverables: res.data.data.daily_deliverables || next } : r)))
                      setCalendarEditing(null)
                      setCalendarEditValue('')
                    }
                  } catch (e: any) {
                    const msg = e?.response?.data?.error?.message || e?.message || 'Failed to update daily deliverables'
                    alert(msg)
                  } finally {
                    setCalendarSavingKey(null)
                  }
                }}
              />
            </CardContent>
          </Card>

          <Dialog open={planningUploadOpen} onOpenChange={setPlanningUploadOpen}>
            <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Daily planning upload result</DialogTitle>
              </DialogHeader>
              {planningUploadSummary ? (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Rows processed</div>
                      <div className="text-lg font-semibold tabular-nums">{planningUploadSummary.processedRows}</div>
                    </div>
                    <div className="rounded-md border bg-green-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Operations succeeded</div>
                      <div className="text-lg font-semibold tabular-nums text-green-800">{planningUploadSummary.succeededOperations}</div>
                    </div>
                    <div className="rounded-md border bg-red-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Operations failed</div>
                      <div className="text-lg font-semibold tabular-nums text-red-800">{planningUploadSummary.failedOperations}</div>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Rows applied (success)</div>
                      <div className="text-lg font-semibold tabular-nums">{planningUploadSummary.succeededRows}</div>
                    </div>
                    <div className="rounded-md border bg-amber-50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Row-level issues</div>
                      <div className="text-lg font-semibold tabular-nums text-amber-900">{planningUploadSummary.rowLevelIssues}</div>
                    </div>
                  </div>
                  {(planningUploadSummary.rowParseFailures?.length ?? 0) > 0 ? (
                    <div>
                      <div className="font-medium text-gray-900 mb-2">Row issues (file line #)</div>
                      <ul className="max-h-40 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                        {planningUploadSummary.rowParseFailures.map((f, i) => (
                          <li key={`rpf-${i}`} className="text-gray-800">
                            <span className="font-mono">Line {f.rowNumber}</span>
                            {f.contract_ext_no ? ` · ${f.contract_ext_no}` : ''}: {f.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(planningUploadSummary.operationFailures?.length ?? 0) > 0 ? (
                    <div>
                      <div className="font-medium text-gray-900 mb-2">Operation failures</div>
                      <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-2 p-2">
                        {planningUploadSummary.operationFailures.map((f, i) => (
                          <li key={`of-${i}`} className="text-gray-800">
                            <span className="font-semibold">{f.contract_ext_no}</span>
                            {f.rowNumbers?.length ? (
                              <span className="text-gray-600"> (rows {f.rowNumbers.join(', ')})</span>
                            ) : null}
                            {f.operation_ids?.length ? (
                              <span className="text-gray-600"> · Operation IDs: {f.operation_ids.join(', ')}</span>
                            ) : null}
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

        {/* Trucking Operations List */}
        {activeTab === 'list' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>All Trucking Operations</CardTitle>
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
                          .filter(c => c.id !== 'operation_id' && c.id !== 'status')
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
                  disabled={loading || sortedOperations.length === 0}
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
            {showCreateForm ? (
              <div className="text-center py-8 text-gray-500">
                Create form is open. Close it to view the trucking list.
              </div>
            ) : loading ? (
              <div className="text-center py-8">Loading trucking operations...</div>
            ) : sortedOperations.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Truck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p>No trucking operations found</p>
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
                                      if (sortKey === col.id) {
                                        setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                                      } else {
                                        setSortKey(col.id)
                                        setSortDir('asc')
                                      }
                                      setPage(1)
                                      fetchTruckingOperations(1)
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
                                      Clear
                                    </button>
                                    <div className="text-[11px] text-gray-500">
                                      {filterActive ? 'Filtered' : 'No filter'}
                                    </div>
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
                        {sortedOperations.map((operation, idx) => {
                          const isEditing = editingId === operation.id
                          return (
                            <div key={operation.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <div className="px-3 py-2">
                                <div
                                  className="grid gap-3 items-center"
                                  style={{
                                    gridTemplateColumns: `28px ${visibleColumns.map(c => getColumnWidth(c.id)).join(' ')} 320px`
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(operation.id)}
                                    className="p-1 text-gray-500 hover:text-gray-800"
                                    title={expandedOperationIds.has(operation.id) ? 'Collapse' : 'Expand'}
                                  >
                                    {expandedOperationIds.has(operation.id) ? (
                                      <ChevronDown className="h-5 w-5" />
                                    ) : (
                                      <ChevronRight className="h-5 w-5" />
                                    )}
                                  </button>

                                  {visibleColumns.map(col => (
                                    <div key={col.id} className="min-w-0">
                                      {col.id === 'status' && isEditing ? (
                                        <select
                                          value={editedData.status ?? operation.status ?? ''}
                                          onChange={(e) => handleFieldChange('status', e.target.value)}
                                          className="h-8 text-sm px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-full bg-white"
                                        >
                                          <option value="">Select Status</option>
                                          <option value="PLANNED">PLANNED</option>
                                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                                          <option value="LOADING">LOADING</option>
                                          <option value="IN_TRANSIT">IN_TRANSIT</option>
                                          <option value="UNLOADING">UNLOADING</option>
                                          <option value="COMPLETED">COMPLETED</option>
                                          <option value="CANCELLED">CANCELLED</option>
                                        </select>
                                      ) : (
                                        col.render(operation)
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
                                          onClick={() => handleSave(operation.id)}
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
                                          onClick={() => handleEdit(operation)}
                                          className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                        >
                                          <Edit2 className="h-4 w-4 mr-1" />
                                          Edit
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleViewDocuments(operation)}
                                          className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                        >
                                          <Package className="h-4 w-4 mr-1" />
                                          Docs
                                        </Button>
                                        <input
                                          id={`trucking-file-${operation.id}`}
                                          type="file"
                                          accept="application/pdf,image/png,image/jpeg"
                                          className="hidden"
                                          onChange={(e) => handleUploadFileChange(operation, e)}
                                        />
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => document.getElementById(`trucking-file-${operation.id}`)?.click()}
                                          disabled={uploadingId === operation.id}
                                          className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                                        >
                                          {uploadingId === operation.id ? (
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
                                {expandedOperationIds.has(operation.id) && (
                                  <div className="mt-3 p-3 border rounded bg-white">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3 pb-3 border-b">
                                      <div>
                                        <div className="text-gray-500">Buyer</div>
                                        <div className="font-medium">{operation.buyer || '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Group Name</div>
                                        <div className="font-medium">{operation.group_name || '-'}</div>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3 pb-3 border-b">
                                      <div>
                                        <div className="text-gray-500">Truck Loading Location</div>
                                        <div className="font-medium">{operation.loading_location || operation.location || '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Truck Discharge Location</div>
                                        <div className="font-medium">{operation.unloading_location || '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Quantity Delivery (Kg)</div>
                                        <div className="font-medium">{formatKg(operation.quantity_delivered)}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Quantity Receive (Kg)</div>
                                        <div className="font-medium">{formatKg(operation.quantity_receive || operation.quantity_delivered)}</div>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3 pb-3 border-b">
                                      <div>
                                        <div className="text-gray-500">Trucking OA Budget</div>
                                        <div className="font-medium">{formatNumber(operation.oa_budget)}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Trucking OA Actual</div>
                                        <div className="font-medium">{formatNumber(operation.oa_actual)}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Estimated KM</div>
                                        <div className="font-medium">{operation.estimated_km ? `${formatNumber(operation.estimated_km)} km` : '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Gain/Loss %</div>
                                        <div className="font-medium">{formatNumber(operation.gain_loss_percentage)}%</div>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3 pb-3 border-b">
                                      <div>
                                        <div className="text-gray-500">Gain/Loss Amount (Kg)</div>
                                        {isEditing ? (
                                          <Input
                                            type="number"
                                            step="0.01"
                                            value={editedData.gain_loss_amount ?? operation.gain_loss_amount ?? ''}
                                            onChange={(e) => handleFieldChange('gain_loss_amount', parseFloat(e.target.value) || 0)}
                                            className="h-8 text-sm mt-1"
                                          />
                                        ) : (
                                          <div className="font-medium">{formatKg(operation.gain_loss_amount)}</div>
                                        )}
                                      </div>
                                      <div>
                                        <div className="text-gray-500">Cargo Readiness Date</div>
                                        {isEditing ? (
                                          <Input
                                            type="date"
                                            value={editedData.cargo_readiness_date ? editedData.cargo_readiness_date.split('T')[0] : (operation.cargo_readiness_date ? operation.cargo_readiness_date.split('T')[0] : '')}
                                            onChange={(e) => handleFieldChange('cargo_readiness_date', e.target.value)}
                                            className="h-8 text-sm mt-1"
                                          />
                                        ) : (
                                          <div className="font-medium">{formatDate(operation.cargo_readiness_date)}</div>
                                        )}
                                      </div>
                                    </div>
                                    {/* Removed Due Date Delivery Start/End and Late Indicator from expanded view as requested */}
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

                {/* Mobile card view */}
                <div className="lg:hidden space-y-4">
                  {sortedOperations.map((operation) => {
                  const isEditing = editingId === operation.id
                  const currentData = isEditing ? editedData : operation

                  return (
                    <div
                      key={operation.id}
                      className={`border rounded-lg transition-colors ${isEditing ? 'border-blue-300 bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="p-4">
                        {/* Header Row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold text-lg">{operation.operation_id}</h3>
                            {isEditing ? (
                              <select
                                value={currentData.status}
                                onChange={(e) => handleFieldChange('status', e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option value="PLANNED">Planned</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="LOADING">Loading</option>
                                <option value="IN_TRANSIT">In Transit</option>
                                <option value="UNLOADING">Unloading</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="CANCELLED">Cancelled</option>
                              </select>
                            ) : (
                              <Badge className={getStatusColor(operation.status)}>
                                {operation.status}
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-2">
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
                                  onClick={() => handleSave(operation.id)}
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
                                  onClick={() => handleEdit(operation)}
                                  className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                                >
                                  <Edit2 className="h-4 w-4 mr-1" />
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewDocuments(operation)}
                                  className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                                >
                                  <Package className="h-4 w-4 mr-1" />
                                  Documents
                                </Button>
                                {/* Upload Document */}
                                <input
                                  id={`trucking-file-${operation.id}`}
                                  type="file"
                                  accept="application/pdf,image/png,image/jpeg"
                                  className="hidden"
                                  onChange={(e) => handleUploadFileChange(operation, e)}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => document.getElementById(`trucking-file-${operation.id}`)?.click()}
                                  disabled={uploadingId === operation.id}
                                  className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                                >
                                  {uploadingId === operation.id ? (
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

                        {/* Contract Info (Read-only) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3 pb-3 border-b">
                          <div>
                            <div className="text-gray-500">Contract Number</div>
                            <div className="font-medium">{operation.contract_number || '-'}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Supplier</div>
                            <div className="font-medium">{operation.supplier || '-'}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Product</div>
                            <div className="font-medium">{operation.product || '-'}</div>
                          </div>
                          <div>
                            <div className="text-gray-500">Group</div>
                            <div className="font-medium">{operation.group_name || '-'}</div>
                          </div>
                        </div>

                        {/* Location & Owner (Editable) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <div className="text-gray-500 mb-1">Location</div>
                            {isEditing ? (
                              <Input
                                value={currentData.location || ''}
                                onChange={(e) => handleFieldChange('location', e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{operation.location || '-'}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Trucking Owner</div>
                            {isEditing ? (
                              <Input
                                value={currentData.trucking_owner || ''}
                                onChange={(e) => handleFieldChange('trucking_owner', e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{operation.trucking_owner || '-'}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Quantity Sent (Kg)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.quantity_sent || ''}
                                onChange={(e) => handleFieldChange('quantity_sent', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.quantity_sent)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Quantity Delivered (Kg)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.quantity_delivered || ''}
                                onChange={(e) => handleFieldChange('quantity_delivered', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.quantity_delivered)}</div>
                            )}
                          </div>
                        </div>

                        {/* Additional Fields (Editable) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <div className="text-gray-500 mb-1">Gain/Loss %</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.gain_loss_percentage || ''}
                                onChange={(e) => handleFieldChange('gain_loss_percentage', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.gain_loss_percentage)}%</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Gain/Loss Amount (Kg)</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.gain_loss_amount || ''}
                                onChange={(e) => handleFieldChange('gain_loss_amount', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.gain_loss_amount)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">OA Budget</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.oa_budget || ''}
                                onChange={(e) => handleFieldChange('oa_budget', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.oa_budget)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">OA Actual</div>
                            {isEditing ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentData.oa_actual || ''}
                                onChange={(e) => handleFieldChange('oa_actual', parseFloat(e.target.value))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatNumber(operation.oa_actual)}</div>
                            )}
                          </div>
                        </div>

                        {/* Dates */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm pt-3 border-t">
                          <div>
                            <div className="text-gray-500 mb-1">Cargo Readiness at Starting Location</div>
                            {isEditing ? (
                              <Input
                                type="date"
                                value={currentData.cargo_readiness_date ? currentData.cargo_readiness_date.split('T')[0] : ''}
                                onChange={(e) => handleFieldChange('cargo_readiness_date', e.target.value)}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="font-medium">{formatDate(operation.cargo_readiness_date)}</div>
                            )}
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Trucking Last Receive Date</div>
                            <div className="font-medium">{formatDate(operation.trucking_completion_date)}</div>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Due Date Delivery Start</div>
                            <div className="font-medium">{formatDate(operation.delivery_start_date || '')}</div>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">Due Date Delivery End</div>
                            <div className="font-medium">{formatDate(operation.delivery_end_date || '')}</div>
                          </div>
                        </div>

                        {/* ETA fields removed */}
                      </div>
                    </div>
                  )
                })}
              </div>

                {hasMore && (
                  <div className="flex justify-center pt-6">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {loading ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                )}
                </>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Documents Modal */}
      {showDocs && selectedOperation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Documents — {selectedOperation.operation_id}</h3>
              <Button variant="ghost" onClick={() => setShowDocs(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {docsLoading ? (
              <div className="text-sm text-gray-500 py-8 text-center">Loading documents...</div>
            ) : operationDocs.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">No documents uploaded for this operation.</div>
            ) : (
              <div className="space-y-2">
                {operationDocs.map((doc) => (
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
      )}

      <CreateTruckingOperationModal open={showCreateForm} onClose={() => setShowCreateForm(false)} onCreated={handleCreated} />
    </Layout>
  )
}

export default function TruckingPage() {
  return (
    <Suspense fallback={<Layout><div className="flex items-center justify-center p-8"><div className="text-gray-500">Loading...</div></div></Layout>}>
      <TruckingPageContent />
    </Suspense>
  )
}
