'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlantSiteCombobox } from '@/components/PlantSiteCombobox'
// import { BuyerCombobox } from '@/components/BuyerCombobox' // restore when master unloading locations are ready
// PlantSiteCombobox for loading_location — restore when master loading locations are ready
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Info,
  Loader2,
  Plus,
  Truck,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  FAST_ENTRY_ROOT_ATTR,
  TRUCKING_PLANNING_FAST_ENTRY_GROUP,
  fastEntryFieldProps,
} from '@/lib/fastEntryFocus'
import { isIsoOutsideAllowedRange, outsideAllowedDateRangeMessage } from '@/lib/dateFormat'

const fmtIsoDate = (iso: string) => {
  const d = (iso || '').slice(0, 10)
  if (d.length < 10) return iso
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const fmtQty = (val: string | number) => {
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return String(val)
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: true })
}

/** Daily planning quantities in MT — fixed 2 decimal display. */
const fmtQtyMt = (val: string | number) => {
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return '0.00'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
}

/** Legacy per-day UI — restore when manual daily rows are needed again */
const LEGACY_DAILY_DELIVERABLES_UI = false
const READONLY_FIELD_CLASS = 'bg-gray-50 cursor-not-allowed text-gray-600'

function sliceIsoDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

const TRUCKING_DELIVERY_START_BUFFER_DAYS = 60
const TRUCKING_DELIVERY_END_BUFFER_DAYS = 60

function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatPlanningAllowedRangeMessage(range: { minIso: string; maxIso: string }): string {
  return `Date must be between ${fmtIsoDate(range.minIso)} (due delivery start − ${TRUCKING_DELIVERY_START_BUFFER_DAYS} days) and ${fmtIsoDate(range.maxIso)} (due delivery end + ${TRUCKING_DELIVERY_END_BUFFER_DAYS} days)`
}

function parseDailyDeliverables(
  raw: unknown,
): Array<{ date?: string; quantity_delivered?: number }> {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

const enumerateInclusiveDates = (startIso: string, endIso: string): string[] => {
  const startParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso)
  const endParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endIso)
  if (!startParts || !endParts) return []
  const start = new Date(Number(startParts[1]), Number(startParts[2]) - 1, Number(startParts[3]))
  const end = new Date(Number(endParts[1]), Number(endParts[2]) - 1, Number(endParts[3]))
  if (start.getTime() > end.getTime()) return []
  const dates: string[] = []
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    dates.push(`${yyyy}-${mm}-${dd}`)
  }
  return dates
}

/** Distributes total MT evenly across inclusive date range; payload quantities are in Kg (calendar unit). */
const buildDailyDeliverablesFromPlanning = (
  startIso: string,
  endIso: string,
  totalMt: number,
): Array<{ date: string; quantity_delivered: number }> => {
  const dates = enumerateInclusiveDates(startIso, endIso)
  if (dates.length === 0 || !Number.isFinite(totalMt) || totalMt <= 0) return []
  const totalKg = totalMt * 1000
  const numDays = dates.length
  const perDay = Math.round((totalKg / numDays) * 100) / 100
  let allocated = 0
  return dates.map((date, idx) => {
    if (idx === numDays - 1) {
      const last = Math.round((totalKg - allocated) * 100) / 100
      return { date, quantity_delivered: last }
    }
    allocated += perDay
    return { date, quantity_delivered: perDay }
  })
}

export const CreateTruckingOperationModal = memo(function CreateTruckingOperationModal({
  open,
  onClose,
  onCreated,
  initialContractExtNo,
  initialContractId,
  initialPoNumber,
  mode = 'add',
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** When opening from Contracts page, prefill Contract Ext No and validate */
  initialContractExtNo?: string | null
  /** Business contract_id for validation when ext no differs from contract_id */
  initialContractId?: string | null
  /** PO from Contracts page — shown in Section 1 before / alongside validation */
  initialPoNumber?: string | null
  /** `edit` locks all fields except Start/End Date (Planning) */
  mode?: 'add' | 'edit'
}) {
  const isEditMode = mode === 'edit'
  const [creating, setCreating] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [editOperationId, setEditOperationId] = useState<string | null>(null)

  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'warning'
    message: string
    detail?: string
  } | null>(null)
  const notifTimerRef = useRef<NodeJS.Timeout | null>(null)
  const showNotification = useCallback(
    (type: 'success' | 'error' | 'warning', message: string, detail?: string) => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current)
      setNotification({ type, message, detail })
      notifTimerRef.current = setTimeout(() => setNotification(null), 6000)
    },
    [],
  )

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

  const [planning, setPlanning] = useState({
    start_date: '',
    end_date: '',
    total_quantity_mt: '',
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

  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const clearFieldError = (field: string) =>
    setFormErrors((prev) => { const next = { ...prev }; delete next[field]; return next })

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
          const cd = response.data.data
          setContractValidation({
            checking: false,
            exists: true,
            contractData: cd,
            message: 'Contract found',
          })
          const plantLabel = cd.plant_name || ''
          if (plantLabel) {
            setNewOperation((prev) => ({ ...prev, location: plantLabel }))
          }
          const buyerLabel = (cd.buyer || '').trim()
          if (buyerLabel) {
            setNewOperation((prev) => ({ ...prev, unloading_location: buyerLabel }))
          }
          const cargoReady = cd.cargo_readiness_date ? String(cd.cargo_readiness_date).slice(0, 10) : ''
          if (cargoReady) {
            setNewOperation((prev) => ({ ...prev, cargo_readiness_date: cargoReady }))
          }
        } else {
          setContractValidation({
            checking: false,
            exists: false,
            contractData: null,
            message: response.data.message || 'Contract Ext No does not exist',
          })
        }
      }
    } catch (error) {
      console.error('Error validating contract:', error)
      setContractValidation({
        checking: false,
        exists: false,
        contractData: null,
        message: 'Error validating Contract Ext No',
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

  const handleSelectContractSuggestion = async (c: any) => {
    const label = c.contract_ext_no || c.contract_id
    const contractId = String(c.contract_id || '').trim()
    setNewOperation((prev) => ({ ...prev, contract_number: String(label || '').trim() }))
    setContractSearchTerm(String(label || '').trim())
    setShowContractSuggestions(false)
    setContractSuggestions([])
    await validateContractNumber(contractId || String(label || '').trim())
  }

  const truckingDateRange = useMemo(() => {
    const deliveryStart = sliceIsoDate(contractValidation.contractData?.delivery_start_date)
    const deliveryEnd = sliceIsoDate(contractValidation.contractData?.delivery_end_date)
    if (!deliveryStart || !deliveryEnd) return null
    const minIso = shiftIsoDate(deliveryStart, -TRUCKING_DELIVERY_START_BUFFER_DAYS)
    const maxIso = shiftIsoDate(deliveryEnd, TRUCKING_DELIVERY_END_BUFFER_DAYS)
    if (minIso > maxIso) return null
    return { minIso, maxIso }
  }, [
    contractValidation.contractData?.delivery_start_date,
    contractValidation.contractData?.delivery_end_date,
  ])

  const checkPlanningDateInRange = (
    errors: Record<string, string>,
    iso: string,
    field: 'planning_start_date' | 'planning_end_date',
  ) => {
    if (!iso || !truckingDateRange) return
    const { minIso, maxIso } = truckingDateRange
    if (iso < minIso || iso > maxIso) {
      errors[field] = formatPlanningAllowedRangeMessage(truckingDateRange)
    }
  }

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {}

    if (isEditMode) {
      if (!planning.start_date) errors.planning_start_date = 'Start Date (Planning) is required'
      if (!planning.end_date) errors.planning_end_date = 'End Date (Planning) is required'
      if (planning.start_date && planning.end_date && planning.end_date < planning.start_date) {
        errors.planning_end_date = 'End Date cannot be before Start Date'
      }
      checkPlanningDateInRange(errors, planning.start_date, 'planning_start_date')
      checkPlanningDateInRange(errors, planning.end_date, 'planning_end_date')
      setFormErrors(errors)
      return Object.keys(errors).length === 0
    }

    if (!contractValidation.exists) errors.contract_number = 'Contract Ext No is required and must be valid'

    if (truckingDateRange) {
      const rangeMsg = formatPlanningAllowedRangeMessage(truckingDateRange)
      if (newOperation.cargo_readiness_date) {
        const { minIso, maxIso } = truckingDateRange
        if (newOperation.cargo_readiness_date < minIso || newOperation.cargo_readiness_date > maxIso)
          errors.cargo_readiness_date = rangeMsg
      }
    }

    if (!planning.start_date) errors.planning_start_date = 'Start Date (Planning) is required'
    if (!planning.end_date) errors.planning_end_date = 'End Date (Planning) is required'
    if (planning.start_date && planning.end_date && planning.end_date < planning.start_date) {
      errors.planning_end_date = 'End Date cannot be before Start Date'
    }
    checkPlanningDateInRange(errors, planning.start_date, 'planning_start_date')
    checkPlanningDateInRange(errors, planning.end_date, 'planning_end_date')
    const totalMt = planning.total_quantity_mt
      ? parseFloat(String(planning.total_quantity_mt).replace(/,/g, '').trim())
      : NaN
    if (!Number.isFinite(totalMt) || totalMt <= 0) {
      errors.planning_total_quantity_mt = 'Total Quantity must be greater than 0'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
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
    setPlanning({ start_date: '', end_date: '', total_quantity_mt: '' })
    setContractValidation({ checking: false, exists: false, contractData: null, message: '' })
    setContractSearchTerm('')
    setContractSuggestions([])
    setShowContractSuggestions(false)
    setFormErrors({})
    setEditOperationId(null)
    setLoadingEdit(false)
  }

  const loadTruckingForEdit = useCallback(
    async (contractId: string) => {
      setLoadingEdit(true)
      setEditOperationId(null)
      try {
        const listRes = await api.get('/trucking', {
          params: { contract: contractId, limit: 100, page: 1 },
        })
        const ops: Array<Record<string, unknown>> = listRes.data?.data?.truckingOperations ?? []
        const listRow = ops[0]
        if (!listRow?.id) {
          showNotification('error', 'No trucking operation found for this contract')
          return
        }
        const operationId = String(listRow.id)
        setEditOperationId(operationId)

        const detailRes = await api.get(`/trucking/${operationId}`)
        const op = (detailRes.data?.data ?? listRow) as Record<string, unknown>

        const validateKey = initialContractId?.trim() || contractId
        const display = String(
          op.contract_ext_no || op.contract_number || listRow.contract_ext_no || listRow.contract_number || initialContractExtNo || '',
        ).trim()
        if (display) {
          setNewOperation((prev) => ({ ...prev, contract_number: display }))
          setContractSearchTerm(display)
        }
        await validateContractNumber(validateKey)

        setNewOperation((prev) => ({
          ...prev,
          operation_id: String(op.operation_id ?? ''),
          location: String(op.location ?? ''),
          loading_location: String(op.loading_location ?? ''),
          unloading_location: String(op.unloading_location ?? ''),
          trucking_owner: String(op.trucking_owner ?? ''),
          cargo_readiness_date: sliceIsoDate(op.cargo_readiness_date as string | undefined),
          quantity_sent: op.quantity_sent != null ? String(op.quantity_sent) : '',
          quantity_delivered: op.quantity_delivered != null ? String(op.quantity_delivered) : '',
          status: String(op.status ?? 'PLANNED'),
        }))

        const dailyRows = parseDailyDeliverables(op.daily_deliverables)
        const sortedDates = dailyRows
          .map((r) => sliceIsoDate(r.date))
          .filter(Boolean)
          .sort()
        const totalKg =
          dailyRows.reduce((sum, r) => sum + (Number(r.quantity_delivered) || 0), 0) ||
          Number(op.quantity_delivered) ||
          Number(listRow.quantity_delivered) ||
          0
        const startDate =
          sliceIsoDate(op.trucking_start_date as string | undefined) ||
          sortedDates[0] ||
          ''
        const endDate =
          sliceIsoDate(op.trucking_completion_date as string | undefined) ||
          sortedDates[sortedDates.length - 1] ||
          startDate

        setPlanning({
          start_date: startDate,
          end_date: endDate,
          total_quantity_mt: fmtQtyMt(totalKg / 1000),
        })
      } catch (error) {
        console.error('Failed to load trucking operation for edit:', error)
        showNotification('error', 'Failed to load trucking operation details')
      } finally {
        setLoadingEdit(false)
      }
    },
    [initialContractExtNo, initialContractId, showNotification, validateContractNumber],
  )

  useEffect(() => {
    if (!open) return
    resetForm()
    const display = initialContractExtNo?.trim()
    const validateKey = initialContractId?.trim() || display
    if (!display && !validateKey) return
    if (isEditMode && validateKey) {
      void loadTruckingForEdit(validateKey)
      return
    }
    if (display) {
      setNewOperation((prev) => ({ ...prev, contract_number: display }))
      setContractSearchTerm(display)
    }
    if (validateKey) void validateContractNumber(validateKey)
  }, [open, initialContractExtNo, initialContractId, isEditMode, validateContractNumber, loadTruckingForEdit])

  const handleCreateOperation = async () => {
    if (isEditMode && !editOperationId) {
      showNotification('error', 'Trucking operation not loaded')
      return
    }
    if (!validateForm()) return

    if (isEditMode) {
      const totalMt = parseFloat(String(planning.total_quantity_mt).replace(/,/g, '').trim())
      const generatedDaily = buildDailyDeliverablesFromPlanning(
        planning.start_date,
        planning.end_date,
        totalMt,
      )
      if (generatedDaily.length === 0) {
        showNotification('error', 'Invalid planning date range')
        return
      }

      setCreating(true)
      try {
        const response = await api.put(`/trucking/${editOperationId}`, {
          daily_deliverables: generatedDaily,
          trucking_start_date: planning.start_date || null,
          trucking_completion_date: planning.end_date || null,
        })
        if (response.data.success) {
          showNotification('success', 'Trucking operation updated successfully!')
          resetForm()
          onClose()
          onCreated()
        }
      } catch (error: any) {
        console.error('Update trucking operation error:', error)
        const errorMessage = error.response?.data?.error?.message || 'Failed to update trucking operation'
        showNotification('error', errorMessage)
      } finally {
        setCreating(false)
      }
      return
    }

    const totalMt = parseFloat(String(planning.total_quantity_mt).replace(/,/g, '').trim())
    const generatedDaily = buildDailyDeliverablesFromPlanning(
      planning.start_date,
      planning.end_date,
      totalMt,
    )
    if (generatedDaily.length === 0) {
      showNotification('error', 'Invalid planning date range')
      return
    }

    const totalKg = totalMt * 1000

    setCreating(true)
    try {
      const payload = {
        ...newOperation,
        trucking_start_date: planning.start_date || null,
        trucking_completion_date: planning.end_date || null,
        quantity_sent: newOperation.quantity_sent ? parseFloat(newOperation.quantity_sent) : null,
        quantity_delivered: totalKg,
        gain_loss_percentage: newOperation.gain_loss_percentage ? parseFloat(newOperation.gain_loss_percentage) : null,
        gain_loss_amount: newOperation.gain_loss_amount ? parseFloat(newOperation.gain_loss_amount) : null,
        oa_budget: newOperation.oa_budget ? parseFloat(newOperation.oa_budget) : null,
        oa_actual: newOperation.oa_actual ? parseFloat(newOperation.oa_actual) : null,
        daily_deliverables: generatedDaily,
      }

      const response = await api.post('/trucking', payload)
      if (response.data.success) {
        showNotification('success', 'Trucking operation created successfully!')
        resetForm()
        onClose()
        onCreated()
      }
    } catch (error: any) {
      console.error('Create trucking operation error:', error)
      const errorMessage = error.response?.data?.error?.message || 'Failed to create trucking operation'
      showNotification('error', errorMessage)
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  const planningDayCount =
    planning.start_date && planning.end_date && planning.end_date >= planning.start_date
      ? enumerateInclusiveDates(planning.start_date, planning.end_date).length
      : 0

  const planningPerDayMt = (() => {
    const totalMt = parseFloat(String(planning.total_quantity_mt || '').replace(/,/g, '').trim())
    if (!Number.isFinite(totalMt) || planningDayCount <= 0) return null
    return Math.round((totalMt / planningDayCount) * 100) / 100
  })()

  const step1Done = contractValidation.exists
  const step2Done = Boolean(newOperation.location || newOperation.loading_location || newOperation.unloading_location)
  const step3Done = Boolean(contractValidation.contractData?.delivery_start_date)
  const cd = contractValidation.contractData
  const poDisplay = (cd?.po_number || initialPoNumber || '').trim() || '—'
  const cargoReadinessDisplay =
    newOperation.cargo_readiness_date ||
    (cd?.cargo_readiness_date ? String(cd.cargo_readiness_date).slice(0, 10) : '')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="shrink-0 rounded-t-xl border-b border-gray-200">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white shrink-0">
                <Truck className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {isEditMode ? 'Edit Trucking' : 'Add New Trucking'}
                </h3>
                <p className="text-xs text-gray-500">
                  {isEditMode
                    ? 'Only planning start and end dates can be changed'
                    : 'Fill in contract, truck, and delivery details'}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-gray-400 hover:text-gray-600"
              aria-label="Close"
              onClick={() => { resetForm(); onClose() }}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          {/* Step progress */}
          <div className="flex items-center px-6 py-2 bg-gray-50/80 border-t border-gray-100">
            {[
              { num: 1, label: 'Contract', done: step1Done },
              { num: 2, label: 'Truck Detail', done: step2Done },
              { num: 3, label: 'Shipment Detail', done: step3Done },
            ].map((s, i) => (
              <div key={s.num} className="flex items-center">
                <div className="flex items-center gap-1.5">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${s.done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {s.done ? <Check className="h-3.5 w-3.5" /> : s.num}
                  </div>
                  <span className={`text-xs font-medium ${s.done ? 'text-green-700' : 'text-gray-500'}`}>{s.label}</span>
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
              Loading trucking operation…
            </div>
          )}

          {/* Notification banner */}
          {notification && (
            <div className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm ${
              notification.type === 'success' ? 'border-green-200 bg-green-50 text-green-800'
              : notification.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              <div className="mt-0.5 shrink-0">
                {notification.type === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                  : notification.type === 'error' ? <AlertCircle className="h-4 w-4 text-red-600" />
                  : <AlertTriangle className="h-4 w-4 text-amber-600" />}
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

            {/* Section 1 — Contract Detail */}
            <div className="rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white px-4 py-2.5 rounded-t-xl">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 shrink-0">
                  <FileText className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">1. Contract Detail</h4>
                {step1Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <span><strong>Required:</strong> Contract Ext No &nbsp;•&nbsp; Location, Loading, and Unloading will be filled automatically from the contract</span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-700">
                      Contract Ext No <span className="text-red-500">*</span>
                    </label>
                    {!initialContractExtNo && !isEditMode && (
                      <span className="text-[10px] text-gray-400">Type to search contract</span>
                    )}
                  </div>
                  <div className="relative">
                    <div className="flex gap-2 items-center">
                      <Input
                        value={newOperation.contract_number}
                        onChange={(e) => handleContractNumberChange(e.target.value)}
                        onBlur={() => validateContractNumber(newOperation.contract_number)}
                        onFocus={() => {
                          if (!isEditMode && contractSuggestions.length > 0) setShowContractSuggestions(true)
                          if (!isEditMode && contractSearchTerm.trim().length >= 2) fetchContractSuggestions(contractSearchTerm)
                        }}
                        readOnly={!!initialContractExtNo || isEditMode}
                        disabled={isEditMode}
                        className={`flex-1 h-9 ${initialContractExtNo || isEditMode ? READONLY_FIELD_CLASS : ''} ${
                          contractValidation.exists ? 'border-green-500 focus-visible:ring-green-400'
                          : contractValidation.message && !contractValidation.checking ? 'border-red-500 focus-visible:ring-red-400'
                          : ''
                        }`}
                        placeholder="Enter Contract Ext No..."
                      />
                      {contractValidation.checking && <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />}
                      {!contractValidation.checking && contractValidation.exists && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      {!contractValidation.checking && contractValidation.message && !contractValidation.exists && <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    </div>

                    {!isEditMode && showContractSuggestions && contractSuggestions.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {contractSuggestions.map((c) => (
                          <button
                            key={c.contract_id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectContractSuggestion(c)}
                          >
                            <div className="font-semibold text-sm text-gray-900">{c.contract_ext_no || c.contract_id}</div>
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              {c.contract_ext_no && <><span className="font-mono text-gray-400">{c.contract_id}</span><span className="text-gray-300">•</span></>}
                              <span>{c.supplier}</span>
                              <span className="text-gray-300">•</span>
                              <span>{c.product}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {contractValidation.message && (
                    <p className={`text-xs mt-1.5 flex items-center gap-1 ${contractValidation.exists ? 'text-green-600' : 'text-red-600'}`}>
                      {contractValidation.exists
                        ? <CheckCircle2 className="h-3 w-3" />
                        : <AlertCircle className="h-3 w-3" />}
                      {contractValidation.message}
                    </p>
                  )}
                  {formErrors.contract_number && !contractValidation.message && (
                    <p className="text-xs mt-1 text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />{formErrors.contract_number}
                    </p>
                  )}
                </div>

                {/* Contract Data Card */}
                {contractValidation.exists && cd && (
                  <div className="rounded-lg border border-green-200 bg-green-50 overflow-hidden">
                    <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-green-100 border-b border-green-100">
                      {[
                        { label: 'Contract Ext No', value: cd.contract_ext_no || cd.contract_id },
                        { label: 'Contract ID', value: cd.contract_id || '—' },
                        { label: 'PO', value: poDisplay },
                      ].map((f) => (
                        <div key={f.label} className="px-3 py-2">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-green-600">{f.label}</div>
                          <div className="text-xs font-semibold text-gray-800 mt-0.5 truncate">{f.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-green-100 px-0">
                      {[
                        { label: 'STO Number', value: cd.sto_number || '—' },
                        { label: 'Supplier', value: cd.supplier || '—' },
                        { label: 'Buyer', value: cd.buyer || '—' },
                        { label: 'Product', value: cd.product || '—' },
                        { label: 'Group', value: cd.group_name || '—' },
                      ].map((f) => (
                        <div key={f.label} className="px-3 py-2">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-green-600">{f.label}</div>
                          <div className="text-xs font-semibold text-gray-800 mt-0.5 truncate">{f.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section 2 — Truck Detail */}
            <div className="rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-white px-4 py-2.5 rounded-t-xl">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 shrink-0">
                  <Truck className="h-3.5 w-3.5 text-orange-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">2. Truck Detail</h4>
                {step2Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Plant/Site</label>
                    <PlantSiteCombobox
                      value={newOperation.location}
                      onChange={(val) => { setNewOperation((prev) => ({ ...prev, location: val })); clearFieldError('location') }}
                      className={`${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.location ? 'border-red-500' : ''}`}
                      placeholder="Search plant/site..."
                      valueField="plant_name"
                      disabled={contractValidation.exists || isEditMode}
                    />
                    {formErrors.location && <p className="text-xs mt-1 text-red-600">{formErrors.location}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Loading Location</label>
                    <Input
                      value={newOperation.loading_location}
                      onChange={(e) => {
                        setNewOperation((prev) => ({ ...prev, loading_location: e.target.value }))
                        clearFieldError('loading_location')
                      }}
                      readOnly={isEditMode}
                      disabled={isEditMode}
                      className={`h-9 ${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.loading_location ? 'border-red-500' : ''}`}
                      placeholder="Enter loading location..."
                    />
                    {formErrors.loading_location && <p className="text-xs mt-1 text-red-600">{formErrors.loading_location}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Unloading Location</label>
                    <Input
                      value={newOperation.unloading_location}
                      onChange={(e) => {
                        setNewOperation((prev) => ({ ...prev, unloading_location: e.target.value }))
                        clearFieldError('unloading_location')
                      }}
                      readOnly={isEditMode}
                      disabled={isEditMode}
                      className={`h-9 ${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.unloading_location ? 'border-red-500' : ''}`}
                      placeholder="Enter unloading location..."
                    />
                    {formErrors.unloading_location && <p className="text-xs mt-1 text-red-600">{formErrors.unloading_location}</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3 — Shipment Detail */}
            <div className="rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-violet-50 to-white px-4 py-2.5 rounded-t-xl">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 shrink-0">
                  <Clock className="h-3.5 w-3.5 text-violet-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">3. Trucking Detail</h4>
                {step3Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="p-4 space-y-4">
                {cd?.delivery_start_date && cd?.delivery_end_date ? (
                  <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <p>
                      Start Date (Planning) may be up to {TRUCKING_DELIVERY_START_BUFFER_DAYS} days before Due Date
                      Delivery (Start). End Date (Planning) may be up to {TRUCKING_DELIVERY_END_BUFFER_DAYS} days after
                      Due Date Delivery (End).
                      {truckingDateRange ? (
                        <span className="block mt-1 font-medium text-blue-900">
                          Allowed: {fmtIsoDate(truckingDateRange.minIso)} – {fmtIsoDate(truckingDateRange.maxIso)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Due Date Delivery Start
                      <span className="ml-1 font-normal text-gray-400">(from contract)</span>
                    </label>
                    <DateInputDdMmYyyy
                      valueIso={cd?.delivery_start_date || ''}
                      onChangeIso={() => {}}
                      disabled
                      className="bg-gray-100 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Due Date Delivery End
                      <span className="ml-1 font-normal text-gray-400">(from contract)</span>
                    </label>
                    <DateInputDdMmYyyy
                      valueIso={cd?.delivery_end_date || ''}
                      onChangeIso={() => {}}
                      disabled
                      className="bg-gray-100 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Cargo Readiness Date
                      <span className="ml-1 font-normal text-gray-400">(from contract)</span>
                    </label>
                    <DateInputDdMmYyyy
                      valueIso={cargoReadinessDisplay}
                      onChangeIso={() => {}}
                      disabled
                      className={`bg-gray-100 cursor-not-allowed ${formErrors.cargo_readiness_date ? 'border-red-500' : ''}`}
                    />
                    {formErrors.cargo_readiness_date && (
                      <p className="text-xs mt-1 text-red-600">{formErrors.cargo_readiness_date}</p>
                    )}
                  </div>
                </div>

                {/* Simplified planning — auto-distributes to daily_deliverables on submit */}
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">Daily Planning Deliverables</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Total quantity split evenly per day between Start and End Date
                      </p>
                      {cd && Number.isFinite(Number(cd.outstanding_quantity)) && (
                        <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                          Outstanding Qty: {fmtQty(Number(cd.outstanding_quantity))} Kg
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                          Start Date (Planning)
                        </label>
                        <DateInputDdMmYyyy
                          valueIso={planning.start_date}
                          minIso={truckingDateRange?.minIso}
                          maxIso={truckingDateRange?.maxIso}
                          fastEntryGroup={TRUCKING_PLANNING_FAST_ENTRY_GROUP}
                          onChangeIso={(iso) => {
                            setPlanning((prev) => ({ ...prev, start_date: iso }))
                            if (
                              truckingDateRange &&
                              iso &&
                              isIsoOutsideAllowedRange(
                                iso,
                                truckingDateRange.minIso,
                                truckingDateRange.maxIso,
                              )
                            ) {
                              setFormErrors((prev) => ({
                                ...prev,
                                planning_start_date: outsideAllowedDateRangeMessage(
                                  truckingDateRange.minIso,
                                  truckingDateRange.maxIso,
                                ),
                              }))
                            } else {
                              clearFieldError('planning_start_date')
                            }
                          }}
                          className={`mt-1 ${formErrors.planning_start_date ? 'border-red-500' : ''}`}
                        />
                        {formErrors.planning_start_date && (
                          <p className="text-xs mt-0.5 text-red-600">{formErrors.planning_start_date}</p>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                          End Date (Planning)
                        </label>
                        <DateInputDdMmYyyy
                          valueIso={planning.end_date}
                          minIso={truckingDateRange?.minIso}
                          maxIso={truckingDateRange?.maxIso}
                          fastEntryGroup={TRUCKING_PLANNING_FAST_ENTRY_GROUP}
                          onChangeIso={(iso) => {
                            setPlanning((prev) => ({ ...prev, end_date: iso }))
                            if (
                              truckingDateRange &&
                              iso &&
                              isIsoOutsideAllowedRange(
                                iso,
                                truckingDateRange.minIso,
                                truckingDateRange.maxIso,
                              )
                            ) {
                              setFormErrors((prev) => ({
                                ...prev,
                                planning_end_date: outsideAllowedDateRangeMessage(
                                  truckingDateRange.minIso,
                                  truckingDateRange.maxIso,
                                ),
                              }))
                            } else {
                              clearFieldError('planning_end_date')
                            }
                          }}
                          className={`mt-1 ${formErrors.planning_end_date ? 'border-red-500' : ''}`}
                        />
                        {formErrors.planning_end_date && (
                          <p className="text-xs mt-0.5 text-red-600">{formErrors.planning_end_date}</p>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                          Total Quantity Delivered (MT)
                        </label>
                        <Input
                          inputMode="decimal"
                          value={planning.total_quantity_mt}
                          {...fastEntryFieldProps(TRUCKING_PLANNING_FAST_ENTRY_GROUP)}
                          onChange={(e) => {
                            setPlanning((prev) => ({ ...prev, total_quantity_mt: e.target.value }))
                            clearFieldError('planning_total_quantity_mt')
                          }}
                          onBlur={() => {
                            const raw = String(planning.total_quantity_mt || '').replace(/,/g, '').trim()
                            const n = parseFloat(raw)
                            if (Number.isFinite(n)) {
                              setPlanning((prev) => ({ ...prev, total_quantity_mt: fmtQtyMt(n) }))
                            }
                          }}
                          onFocus={() => {
                            const raw = String(planning.total_quantity_mt || '').replace(/,/g, '').trim()
                            setPlanning((prev) => ({ ...prev, total_quantity_mt: raw }))
                          }}
                          readOnly={isEditMode}
                          disabled={isEditMode}
                          placeholder="0"
                          className={`mt-1 h-9 ${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.planning_total_quantity_mt ? 'border-red-500' : ''}`}
                        />
                        {formErrors.planning_total_quantity_mt && (
                          <p className="text-xs mt-0.5 text-red-600">{formErrors.planning_total_quantity_mt}</p>
                        )}
                      </div>
                    </div>
                    {planningDayCount > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                        <span className="text-gray-500">
                          {planningDayCount} days — daily qty split evenly on submit
                          {planningPerDayMt != null ? (
                            <span className="ml-1 font-medium tabular-nums text-gray-700">
                              (~{fmtQtyMt(planningPerDayMt)} MT/day)
                            </span>
                          ) : null}
                        </span>
                        <span className="font-semibold tabular-nums text-gray-700">
                          Total:{' '}
                          {fmtQtyMt(
                            parseFloat(String(planning.total_quantity_mt || '').replace(/,/g, '').trim()) || 0,
                          )}{' '}
                          MT
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Legacy Daily Deliverables — restore with LEGACY_DAILY_DELIVERABLES_UI */}
                {LEGACY_DAILY_DELIVERABLES_UI && (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">Daily Planning Deliverables</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Opsional — validasi terhadap total Qty Delivered</p>
                      {cd && Number.isFinite(Number(cd.outstanding_quantity)) && (
                        <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                          Outstanding Qty: {fmtQty(Number(cd.outstanding_quantity))} Kg
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                      onClick={() =>
                        setNewOperation((prev) => ({
                          ...prev,
                          daily_deliverables: [...(prev.daily_deliverables || []), { date: '', quantity: '' }],
                        }))
                      }
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Day
                    </Button>
                  </div>

                  <div className="p-4">
                    {(newOperation.daily_deliverables || []).length === 0 ? (
                      <div className="text-center py-4 text-sm text-gray-400 italic">
                        No daily deliverables yet. Click &ldquo;Add Day&rdquo; to add one.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(newOperation.daily_deliverables || []).map((row, idx) => (
                          <div key={idx} className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-600 shrink-0 mt-1">
                              {idx + 1}
                            </div>
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Date</label>
                                <DateInputDdMmYyyy
                                  valueIso={row.date}
                                  onChangeIso={(iso) => {
                                    setNewOperation((prev) => ({
                                      ...prev,
                                      daily_deliverables: (prev.daily_deliverables || []).map((r, i) =>
                                        i === idx ? { ...r, date: iso } : r,
                                      ),
                                    }))
                                    clearFieldError(`dailyDate_${idx}`)
                                  }}
                                  className={`mt-1 ${formErrors[`dailyDate_${idx}`] ? 'border-red-500' : ''}`}
                                />
                                {formErrors[`dailyDate_${idx}`] && (
                                  <p className="text-xs mt-0.5 text-red-600">{formErrors[`dailyDate_${idx}`]}</p>
                                )}
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Quantity Delivered (Kg)</label>
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
                                  onBlur={() => {
                                    const raw = String(row.quantity || '').replace(/,/g, '').trim()
                                    const n = parseFloat(raw)
                                    if (Number.isFinite(n)) {
                                      setNewOperation((prev) => ({
                                        ...prev,
                                        daily_deliverables: (prev.daily_deliverables || []).map((r, i) =>
                                          i === idx ? { ...r, quantity: fmtQty(n) } : r,
                                        ),
                                      }))
                                    }
                                  }}
                                  onFocus={() => {
                                    const raw = String(row.quantity || '').replace(/,/g, '').trim()
                                    setNewOperation((prev) => ({
                                      ...prev,
                                      daily_deliverables: (prev.daily_deliverables || []).map((r, i) =>
                                        i === idx ? { ...r, quantity: raw } : r,
                                      ),
                                    }))
                                  }}
                                  placeholder="0"
                                  className="mt-1 h-9"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              className="mt-1 shrink-0 text-gray-300 hover:text-red-500 transition-colors p-1 rounded"
                              onClick={() =>
                                setNewOperation((prev) => ({
                                  ...prev,
                                  daily_deliverables: (prev.daily_deliverables || []).filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}

                        {/* Qty summary */}
                        <div className="flex items-center justify-between mt-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                          <span className="text-gray-500">Date is not restricted by Due Date range</span>
                          <span className="font-semibold tabular-nums text-gray-700">
                            Total: {fmtQty(
                              (newOperation.daily_deliverables || []).reduce((s, r) => {
                                const n = r.quantity ? parseFloat(String(r.quantity).replace(/,/g, '').trim()) : NaN
                                return s + (Number.isFinite(n) ? n : 0)
                              }, 0),
                            )} Kg
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )}
              </div>
            </div>

            {/* Footer action bar */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  {contractValidation.exists && (
                    <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-blue-700 font-medium">
                      <FileText className="h-3 w-3" />
                      {cd?.contract_ext_no || newOperation.contract_number}
                    </span>
                  )}
                  {newOperation.location && (
                    <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-orange-700 font-medium">
                      <Truck className="h-3 w-3" />
                      {newOperation.location}
                    </span>
                  )}
                  {planningDayCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-violet-700 font-medium">
                      {planningDayCount} days planned
                    </span>
                  )}
                  {!contractValidation.exists && (
                    <span className="italic text-gray-400">Enter Contract Ext No to continue</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" className="h-9" onClick={() => { resetForm(); onClose() }} disabled={creating || loadingEdit}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateOperation}
                    disabled={creating || loadingEdit || (!isEditMode && !contractValidation.exists)}
                    className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {isEditMode ? 'Saving...' : 'Creating...'}
                      </>
                    ) : (
                      <>
                        <Truck className="h-4 w-4 mr-2" />
                        {isEditMode ? 'Save Changes' : 'Create Trucking'}
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
})
