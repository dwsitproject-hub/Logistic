'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlantSiteCombobox } from '@/components/PlantSiteCombobox'
import { SupplierMillsCombobox } from '@/components/SupplierMillsCombobox'
import { GroupPlantCombobox } from '@/components/GroupPlantCombobox'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  History,
  Info,
  Loader2,
  Truck,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { FAST_ENTRY_ROOT_ATTR } from '@/lib/fastEntryFocus'
import { formatDateTimeDMY } from '@/lib/dateFormat'

const fmtIsoDate = (iso: string) => {
  const d = (iso || '').slice(0, 10)
  if (d.length < 10) return iso
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const READONLY_FIELD_CLASS = 'bg-gray-50 cursor-not-allowed text-gray-600'

function sliceIsoDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

import {
  formatQtyKgAsMt,
  formatSapQtyMtOrDash,
  filterActualRowsForSto,
  normalizeDailyActualRows,
  normalizePlanningDeliverableRows,
  normalizeStoActuals,
  resolveWbActualsDisplayMode,
  sumActualDeliveryKg,
  sumActualReceiveKg,
  sumPlanningDeliveryKg,
  type TruckingModalActualRow,
  type TruckingModalPlanningRow,
  type TruckingModalStoActual,
} from '@/lib/truckingModalDailyTables'
import { isContractRecordClosed } from '@/lib/contractDeliveryStatus'
import {
  ContractDetailModal,
  fetchContractForDetailModalByPo,
  type ContractDetailModalContract,
} from '@/components/contracts/ContractDetailModal'

export const CreateTruckingOperationModal = memo(function CreateTruckingOperationModal({
  open,
  onClose,
  onCreated,
  initialContractExtNo,
  initialContractId,
  initialPoNumber,
  editTruckingOperationId,
  /** Existing SAP trucking row — show Add UI but save planning via PUT (Unplanned rows). */
  plotOperationId,
  mode = 'add',
  readOnly = false,
  stacked = false,
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
  /** When set (Trucking table edit), load this operation directly instead of first match by contract. */
  editTruckingOperationId?: string | null
  plotOperationId?: string | null
  /** `edit` locks all fields except Start/End Date (Planning) */
  mode?: 'add' | 'edit'
  /** Read-only view (e.g. opened from Contract Detail STO link). */
  readOnly?: boolean
  /** Raise z-index when opened above contract detail modal. */
  stacked?: boolean
}) {
  const isPlotMode = Boolean(plotOperationId?.trim())
  const isEditMode = mode === 'edit' && !isPlotMode
  const [creating, setCreating] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [editOperationId, setEditOperationId] = useState<string | null>(null)
  const [contractDetailTarget, setContractDetailTarget] =
    useState<ContractDetailModalContract | null>(null)
  const [contractDetailLoading, setContractDetailLoading] = useState(false)
  const [activityLog, setActivityLog] = useState<
    Array<{
      id: string
      action: string
      entity_type: string
      timestamp: string
      username?: string
      full_name?: string
    }>
  >([])
  const [activityLoading, setActivityLoading] = useState(false)
  const initSessionRef = useRef<string | null>(null)

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

  const [planningRows, setPlanningRows] = useState<TruckingModalPlanningRow[]>([])
  const [actualRows, setActualRows] = useState<TruckingModalActualRow[]>([])
  const [stoActuals, setStoActuals] = useState<TruckingModalStoActual[]>([])
  const [contractDueDates, setContractDueDates] = useState({
    delivery_start_date: '',
    delivery_end_date: '',
  })

  const [sapReceiveDates, setSapReceiveDates] = useState({
    start_receive_date: '',
    last_receive_date: '',
  })
  const [sapQty, setSapQty] = useState<{
    qty_delivery: number | null
    qty_receive: number | null
  }>({ qty_delivery: null, qty_receive: null })

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

  const [poNumber, setPoNumber] = useState('')
  const [poSuggestions, setPoSuggestions] = useState<any[]>([])
  const [showPoSuggestions, setShowPoSuggestions] = useState(false)
  const poSuggestTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  type ContractLookupMode = 'po' | 'contract'

  const validateContractLookup = useCallback(async (term: string, mode: ContractLookupMode = 'po') => {
    const trimmed = term.trim()
    if (!trimmed) {
      setContractValidation({ checking: false, exists: false, contractData: null, message: '' })
      return null
    }
    setContractValidation((prev) => ({ ...prev, checking: true }))
    try {
      const param =
        mode === 'po'
          ? `po_number=${encodeURIComponent(trimmed)}`
          : `contract_number=${encodeURIComponent(trimmed)}`
      const response = await api.get(`/trucking/validate/contract?${param}`)
      if (response.data.success) {
        if (response.data.exists) {
          const cd = response.data.data
          setContractValidation({
            checking: false,
            exists: true,
            contractData: cd,
            message: 'Contract found',
          })
          if (String(cd.po_number ?? '').trim()) {
            setPoNumber(String(cd.po_number).trim())
          }
          setContractDueDates({
            delivery_start_date: sliceIsoDate(cd.delivery_start_date),
            delivery_end_date: sliceIsoDate(cd.delivery_end_date),
          })
          const plantLabel = cd.plant_name || ''
          const sapLoading = String(cd.sap_loading_location ?? cd.supplier ?? '').trim()
          const supplierMills = String(cd.supplier_mills_suggestion ?? '').trim()
          // B2B origin: prefer child-PO Buyer (Contract Reff PO); else origin buyer / group plant.
          const b2bChildBuyer = String(cd.b2b_child_buyer ?? '').trim()
          const unloadingSuggestion = String(cd.unloading_location_suggestion ?? '').trim()
          const buyerLabel = String(cd.buyer ?? '').trim()
          const groupPlant = String(cd.group_plant_suggestion ?? '').trim()
          const unloadingDefault = b2bChildBuyer || unloadingSuggestion || buyerLabel || groupPlant || ''
          setNewOperation((prev) => ({
            ...prev,
            location: plantLabel || prev.location,
            loading_location: sapLoading || supplierMills || '',
            unloading_location: unloadingDefault,
          }))
          const cargoReady = cd.cargo_readiness_date ? String(cd.cargo_readiness_date).slice(0, 10) : ''
          if (cargoReady) {
            setNewOperation((prev) => ({ ...prev, cargo_readiness_date: cargoReady }))
          }
          const nextStoActuals = normalizeStoActuals(cd.sto_actuals)
          setStoActuals(nextStoActuals)
          if (nextStoActuals.length === 1) {
            const only = nextStoActuals[0]
            setSapReceiveDates({
              start_receive_date: only.start_receive_date,
              last_receive_date: only.last_receive_date,
            })
            setSapQty({
              qty_delivery: only.qty_delivery,
              qty_receive: only.qty_receive,
            })
          } else if (nextStoActuals.length === 0) {
            setSapReceiveDates({ start_receive_date: '', last_receive_date: '' })
            setSapQty({ qty_delivery: null, qty_receive: null })
          }
          return cd
        } else {
          setContractValidation({
            checking: false,
            exists: false,
            contractData: null,
            message:
              response.data.message ||
              (mode === 'po' ? 'PO Number does not exist' : 'Contract does not exist'),
          })
          return null
        }
      }
      return null
    } catch (error) {
      console.error('Error validating contract lookup:', error)
      setContractValidation({
        checking: false,
        exists: false,
        contractData: null,
        message: mode === 'po' ? 'Error validating PO Number' : 'Error validating contract',
      })
      return null
    }
  }, [])

  const fetchPoSuggestions = useCallback(async (term: string) => {
    const q = term.trim()
    if (q.length < 2) {
      setPoSuggestions([])
      setShowPoSuggestions(false)
      return
    }
    try {
      const res = await api.get(`/trucking/contracts/suggestions?q=${encodeURIComponent(q)}`)
      if (res.data?.success) {
        setPoSuggestions(res.data.data || [])
        setShowPoSuggestions(true)
      }
    } catch (e) {
      console.error('Failed to fetch PO suggestions:', e)
      setPoSuggestions([])
      setShowPoSuggestions(false)
    }
  }, [])

  const handlePoNumberChange = (value: string) => {
    setPoNumber(value)
    if (validationTimeoutRef.current) clearTimeout(validationTimeoutRef.current)
    if (poSuggestTimeoutRef.current) clearTimeout(poSuggestTimeoutRef.current)
    poSuggestTimeoutRef.current = setTimeout(() => fetchPoSuggestions(value), 200)
    validationTimeoutRef.current = setTimeout(() => validateContractLookup(value, 'po'), 500)
  }

  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) clearTimeout(validationTimeoutRef.current)
      if (poSuggestTimeoutRef.current) clearTimeout(poSuggestTimeoutRef.current)
    }
  }, [])

  const handleSelectPoSuggestion = async (c: any) => {
    const po = String(c.po_number || '').trim()
    setPoNumber(po)
    setShowPoSuggestions(false)
    setPoSuggestions([])
    if (po) {
      await validateContractLookup(po, 'po')
    }
  }

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!contractValidation.exists) errors.po_number = 'PO Number is required and must be valid'
    setFormErrors(errors)
    return errors
  }

  const resetForm = () => {
    setNewOperation({
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
    setPlanningRows([])
    setActualRows([])
    setStoActuals([])
    setContractDueDates({ delivery_start_date: '', delivery_end_date: '' })
    setSapReceiveDates({ start_receive_date: '', last_receive_date: '' })
    setSapQty({ qty_delivery: null, qty_receive: null })
    setContractValidation({ checking: false, exists: false, contractData: null, message: '' })
    setPoNumber('')
    setPoSuggestions([])
    setShowPoSuggestions(false)
    setFormErrors({})
    setEditOperationId(null)
    setLoadingEdit(false)
    setActivityLog([])
  }

  const formatActivityLabel = (log: {
    action: string
    entity_type: string
    full_name?: string
    username?: string
  }): string => {
    const user = log.full_name?.trim() || log.username?.trim() || 'Unknown User'
    const action = log.action?.toUpperCase() ?? 'UPDATE'
    if (action === 'UPDATE') return `Updated Trucking Operation — ${user}`
    if (action === 'CREATE') return `Created Trucking Operation — ${user}`
    return `${action} ${log.entity_type?.replace(/_/g, ' ') ?? 'Record'} — ${user}`
  }

  const loadActivityLog = useCallback(async (operationId: string) => {
    setActivityLoading(true)
    try {
      const res = await api.get(`/trucking/${operationId}/activity-log`)
      setActivityLog(res.data?.data ?? [])
    } catch {
      setActivityLog([])
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const resolveEditContractLookup = useCallback(
    async (op: Record<string, unknown>, listRow: Record<string, unknown>) => {
      const po = String(op.po_number ?? listRow.po_number ?? initialPoNumber ?? '').trim()
      if (po) {
        setPoNumber(po)
        return validateContractLookup(po, 'po')
      }
      const contractKey = String(
        op.contract_number
          ?? listRow.contract_number
          ?? initialContractId
          ?? initialContractExtNo
          ?? '',
      ).trim()
      if (contractKey) {
        return validateContractLookup(contractKey, 'contract')
      }
      return null
    },
    [initialContractExtNo, initialContractId, initialPoNumber, validateContractLookup],
  )

  const hydrateTruckingEditForm = useCallback(
    async (operationId: string, op: Record<string, unknown>, listRow: Record<string, unknown>, _contractId: string) => {
      setEditOperationId(operationId)

      const validated = await resolveEditContractLookup(op, listRow)

      const b2bChildBuyer = String(validated?.b2b_child_buyer ?? '').trim()
      const unloadingSuggestion = String(
        validated?.unloading_location_suggestion ?? validated?.buyer ?? '',
      ).trim()
      const storedUnloading = String(op.unloading_location ?? '').trim()
      // Prefer live contract Buyer / B2B child buyer over stale stored plant labels
      // (e.g. "PLANT EUP KUMAI" vs correct "EUP BIOMASS KUMAI").
      const unloadingForEdit = b2bChildBuyer || unloadingSuggestion || storedUnloading

      setNewOperation((prev) => ({
        ...prev,
        operation_id: String(op.operation_id ?? ''),
        location: String(op.location ?? ''),
        loading_location: String(op.loading_location ?? ''),
        unloading_location: unloadingForEdit,
        trucking_owner: String(op.trucking_owner ?? ''),
        cargo_readiness_date:
          sliceIsoDate(op.cargo_readiness_date as string | undefined) ||
          sliceIsoDate(op.contract_cargo_readiness_date as string | undefined),
        quantity_sent: op.quantity_sent != null ? String(op.quantity_sent) : '',
        quantity_delivered: op.quantity_delivered != null ? String(op.quantity_delivered) : '',
        status: String(op.status ?? 'PLANNED'),
      }))

      setContractDueDates({
        delivery_start_date:
          sliceIsoDate(op.delivery_start_date as string | undefined) ||
          sliceIsoDate(listRow.delivery_start_date as string | undefined),
        delivery_end_date:
          sliceIsoDate(op.delivery_end_date as string | undefined) ||
          sliceIsoDate(listRow.delivery_end_date as string | undefined),
      })

      setPlanningRows(normalizePlanningDeliverableRows(op.daily_deliverables))

      const detailActuals = op.daily_actuals
      if (Array.isArray(detailActuals) && detailActuals.length > 0) {
        setActualRows(normalizeDailyActualRows(detailActuals))
      } else {
        try {
          const realizationRes = await api.get(`/trucking/${operationId}/realization`)
          setActualRows(normalizeDailyActualRows(realizationRes.data?.data?.daily_actuals))
        } catch {
          setActualRows([])
        }
      }

      setSapReceiveDates({
        start_receive_date: sliceIsoDate(op.sap_trucking_start_receive_date as string | undefined),
        last_receive_date: sliceIsoDate(op.sap_trucking_last_receive_date as string | undefined),
      })

      const toNullableNumber = (v: unknown): number | null => {
        if (v == null || v === '') return null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }
      setSapQty({
        qty_delivery: toNullableNumber(op.sap_qty_delivery),
        qty_receive: toNullableNumber(op.sap_qty_receive),
      })

      const fromDetail = normalizeStoActuals(op.sto_actuals)
      const fromValidated = normalizeStoActuals(validated?.sto_actuals)
      setStoActuals(fromDetail.length > 0 ? fromDetail : fromValidated)

      if (isEditMode) {
        void loadActivityLog(operationId)
      }
    },
    [isEditMode, loadActivityLog, resolveEditContractLookup],
  )

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
        const detailRes = await api.get(`/trucking/${operationId}`)
        const op = (detailRes.data?.data ?? listRow) as Record<string, unknown>
        await hydrateTruckingEditForm(operationId, op, listRow, contractId)
      } catch (error) {
        console.error('Failed to load trucking operation for edit:', error)
        showNotification('error', 'Failed to load trucking operation details')
      } finally {
        setLoadingEdit(false)
      }
    },
    [hydrateTruckingEditForm, showNotification],
  )

  const loadTruckingForEditById = useCallback(
    async (operationId: string, contractIdFallback: string) => {
      setLoadingEdit(true)
      setEditOperationId(null)
      try {
        const detailRes = await api.get(`/trucking/${operationId}`)
        const op = (detailRes.data?.data ?? {}) as Record<string, unknown>
        if (!op?.id && !detailRes.data?.success) {
          showNotification('error', 'Trucking operation not found')
          return
        }
        const listRow = { ...op, id: operationId }
        await hydrateTruckingEditForm(operationId, op, listRow, contractIdFallback)
      } catch (error) {
        console.error('Failed to load trucking operation for edit:', error)
        showNotification('error', 'Failed to load trucking operation details')
      } finally {
        setLoadingEdit(false)
      }
    },
    [hydrateTruckingEditForm, showNotification],
  )

  useEffect(() => {
    if (!open) {
      initSessionRef.current = null
      return
    }
    const sessionKey = [
      isEditMode ? 'edit' : isPlotMode ? 'plot' : 'add',
      initialPoNumber ?? '',
      initialContractId ?? '',
      editTruckingOperationId ?? '',
      plotOperationId ?? '',
    ].join(':')
    if (initSessionRef.current === sessionKey) return
    initSessionRef.current = sessionKey

    resetForm()
    const displayPo = initialPoNumber?.trim()
    const validateKey = initialContractId?.trim()
    const directOpId = editTruckingOperationId?.trim()
    if (isEditMode && directOpId) {
      void loadTruckingForEditById(directOpId, validateKey || directOpId)
      return
    }
    if (!displayPo && !validateKey) return
    if (isEditMode && validateKey) {
      void loadTruckingForEdit(validateKey)
      return
    }
    if (displayPo) {
      setPoNumber(displayPo)
      void validateContractLookup(displayPo, 'po')
    } else if (validateKey) {
      void validateContractLookup(validateKey, 'contract')
    }
  }, [
    open,
    initialPoNumber,
    initialContractId,
    editTruckingOperationId,
    plotOperationId,
    isEditMode,
    isPlotMode,
    validateContractLookup,
    loadTruckingForEdit,
    loadTruckingForEditById,
  ])

  const handleCreateOperation = async () => {
    if (isEditMode || isPlotMode) {
      showNotification('error', 'Planning and actuals are managed via Daily Planning / WB upload.')
      return
    }
    if (isContractRecordClosed(contractValidation.contractData)) {
      showNotification('error', 'Cannot create trucking: contract status is Close.')
      return
    }
    const validationErrors = validateForm()
    if (Object.keys(validationErrors).length > 0) return

    const contractIdForSubmit = String(contractValidation.contractData?.contract_id ?? '').trim()
    if (!contractIdForSubmit) {
      showNotification('error', 'Valid PO Number with contract data is required')
      return
    }

    setCreating(true)
    try {
      const payload = {
        contract_number: contractIdForSubmit,
        operation_id: newOperation.operation_id || undefined,
        location: newOperation.location || null,
        loading_location: newOperation.loading_location || null,
        unloading_location: newOperation.unloading_location || null,
        trucking_owner: newOperation.trucking_owner || null,
        cargo_readiness_date: newOperation.cargo_readiness_date || null,
        status: newOperation.status || 'UNPLANNED',
        daily_deliverables: [],
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

  const cd = contractValidation.contractData
  const isContractClosedEditLocked = isEditMode && isContractRecordClosed(cd)
  const isViewOnly = readOnly || isContractClosedEditLocked
  /** Save only in Add mode — planning/actuals come from uploads; edit is display + log. */
  const canSave = !isViewOnly && !isEditMode && !isPlotMode

  const step1Done = contractValidation.exists
  const step2Done = Boolean(newOperation.location || newOperation.loading_location || newOperation.unloading_location)
  const step3Done = Boolean(
    contractDueDates.delivery_start_date ||
      contractDueDates.delivery_end_date ||
      planningRows.length > 0 ||
      cd?.delivery_start_date,
  )
  const step4Done = Boolean(
    stoActuals.length > 0 ||
      sapReceiveDates.start_receive_date ||
      sapReceiveDates.last_receive_date ||
      actualRows.length > 0 ||
      sapQty.qty_delivery != null ||
      sapQty.qty_receive != null,
  )
  const poDisplay = (cd?.po_number || initialPoNumber || '').trim() || '—'
  const poIsClickable = poDisplay !== '—' && Boolean(cd?.contract_id || cd?.po_number)

  const openContractDetailFromPo = async () => {
    if (!cd) return
    const po = String(cd.po_number ?? initialPoNumber ?? '').trim()
    const contractNumber = String(cd.contract_id ?? '').trim()
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

  const dueStartDisplay =
    contractDueDates.delivery_start_date || sliceIsoDate(cd?.delivery_start_date) || ''
  const dueEndDisplay =
    contractDueDates.delivery_end_date || sliceIsoDate(cd?.delivery_end_date) || ''
  const planningTotalKg = sumPlanningDeliveryKg(planningRows)
  const wbDisplayMode = resolveWbActualsDisplayMode(actualRows, stoActuals)
  const singleStoFallback =
    stoActuals.length === 1
      ? stoActuals[0]
      : null

  const renderDailyActualsTable = (rows: TruckingModalActualRow[]) => {
    const deliveryTotal = sumActualDeliveryKg(rows)
    const receiveTotal = sumActualReceiveKg(rows)
    return (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-700">Daily Actuals (WB)</p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            From Upload WB — Qty Delivery = Netto PKS, Qty Receive = Netto EUP
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Qty Delivery (MT)</th>
                <th className="px-3 py-2 text-right font-semibold">Qty Receive (MT)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-400 italic">
                    No WB actuals uploaded yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={`${row.sto_number || '_'}::${row.date}`}
                    className="border-t border-gray-100"
                  >
                    <td className="px-3 py-2 tabular-nums text-gray-800">{fmtIsoDate(row.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                      {formatQtyKgAsMt(row.quantity_delivery_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                      {row.quantity_receive_kg == null
                        ? '-'
                        : formatQtyKgAsMt(row.quantity_receive_kg)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td className="px-3 py-2 text-xs font-semibold text-gray-700">Total</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-gray-800">
                    {formatQtyKgAsMt(deliveryTotal)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-gray-800">
                    {formatQtyKgAsMt(receiveTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  const renderSapActualFields = (block: {
    start_receive_date: string
    last_receive_date: string
    qty_delivery: number | null
    qty_receive: number | null
  }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Trucking Start Receive Date (SAP)
        </label>
        <DateInputDdMmYyyy
          valueIso={block.start_receive_date}
          onChangeIso={() => {}}
          disabled
          className="bg-gray-100 cursor-not-allowed"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Trucking Last Receive Date (SAP)
        </label>
        <DateInputDdMmYyyy
          valueIso={block.last_receive_date}
          onChangeIso={() => {}}
          disabled
          className="bg-gray-100 cursor-not-allowed"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Qty Delivery (SAP)
        </label>
        <Input
          value={formatSapQtyMtOrDash(
            Number.isFinite(block.qty_delivery as number) ? block.qty_delivery : null,
          )}
          readOnly
          disabled
          className={`h-9 ${READONLY_FIELD_CLASS}`}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Qty Receive (SAP)
        </label>
        <Input
          value={formatSapQtyMtOrDash(
            Number.isFinite(block.qty_receive as number) ? block.qty_receive : null,
          )}
          readOnly
          disabled
          className={`h-9 ${READONLY_FIELD_CLASS}`}
        />
      </div>
    </div>
  )

  const cargoReadinessDisplay =
    newOperation.cargo_readiness_date ||
    (cd?.cargo_readiness_date ? String(cd.cargo_readiness_date).slice(0, 10) : '')

  return (
    <>
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/40 p-4 ${
        stacked ? 'z-[80]' : 'z-[60]'
      }`}
    >
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
                  {isViewOnly ? 'View Trucking' : isEditMode ? 'Edit Trucking' : 'Add New Trucking'}
                </h3>
                <p className="text-xs text-gray-500">
                  {isContractClosedEditLocked
                    ? 'Contract is Close — read-only view'
                    : readOnly || isEditMode
                      ? 'Read-only planning & actuals (from Daily Planning / WB upload)'
                      : isPlotMode
                        ? 'Planning is managed via Daily Planning upload'
                        : 'Fill in contract and truck details — planning via upload'}
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
              { num: 3, label: 'Truck Planning', done: step3Done },
              { num: 4, label: 'Truck Actual', done: step4Done },
            ].map((step, i, arr) => (
              <div key={step.num} className="flex items-center">
                <div className="flex items-center gap-1.5">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${step.done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {step.done ? <Check className="h-3.5 w-3.5" /> : step.num}
                  </div>
                  <span className={`text-xs font-medium ${step.done ? 'text-green-700' : 'text-gray-500'}`}>{step.label}</span>
                </div>
                {i < arr.length - 1 && <ChevronRight className="mx-3 h-3.5 w-3.5 text-gray-300 shrink-0" />}
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

          {isContractClosedEditLocked && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">Contract status is Close</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  This trucking operation is read-only. You can review the details but cannot save changes.
                </p>
              </div>
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
                  <span><strong>Required:</strong> PO Number &nbsp;•&nbsp; Location, Loading, and Unloading will be filled automatically from the contract</span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-700">
                      PO Number <span className="text-red-500">*</span>
                    </label>
                    {!initialPoNumber && !isEditMode && (
                      <span className="text-[10px] text-gray-400">Type to search PO</span>
                    )}
                  </div>
                  <div className="relative">
                    <div className="flex gap-2 items-center">
                      <Input
                        value={poNumber}
                        onChange={(e) => handlePoNumberChange(e.target.value)}
                        onBlur={() => {
                          if (isEditMode) {
                            const po = poNumber.trim()
                            if (po) {
                              void validateContractLookup(po, 'po')
                              return
                            }
                            const key = String(
                              contractValidation.contractData?.contract_id
                                || initialContractId
                                || initialContractExtNo
                                || '',
                            ).trim()
                            if (key) void validateContractLookup(key, 'contract')
                            return
                          }
                          void validateContractLookup(poNumber, 'po')
                        }}
                        onFocus={() => {
                          if (!isEditMode && poSuggestions.length > 0) setShowPoSuggestions(true)
                          if (!isEditMode && poNumber.trim().length >= 2) fetchPoSuggestions(poNumber)
                        }}
                        readOnly={!!initialPoNumber || isEditMode}
                        disabled={isEditMode}
                        className={`flex-1 h-9 ${initialPoNumber || isEditMode ? READONLY_FIELD_CLASS : ''} ${
                          contractValidation.exists ? 'border-green-500 focus-visible:ring-green-400'
                          : contractValidation.message && !contractValidation.checking ? 'border-red-500 focus-visible:ring-red-400'
                          : ''
                        }`}
                        placeholder="Enter PO Number..."
                      />
                      {contractValidation.checking && <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />}
                      {!contractValidation.checking && contractValidation.exists && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      {!contractValidation.checking && contractValidation.message && !contractValidation.exists && <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    </div>

                    {!isEditMode && showPoSuggestions && poSuggestions.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {poSuggestions.map((c) => (
                          <button
                            key={c.contract_id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelectPoSuggestion(c)}
                          >
                            <div className="font-semibold text-sm text-gray-900">{c.po_number || '—'}</div>
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <span className="font-mono text-gray-400">{c.contract_ext_no || c.contract_id}</span>
                              <span className="text-gray-300">•</span>
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
                  {formErrors.po_number && !contractValidation.message && (
                    <p className="text-xs mt-1 text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />{formErrors.po_number}
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
                      ].map((f) => (
                        <div key={f.label} className="px-3 py-2">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-green-600">{f.label}</div>
                          <div className="text-xs font-semibold text-gray-800 mt-0.5 truncate">{f.value}</div>
                        </div>
                      ))}
                      <div className="px-3 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-green-600">PO</div>
                        {poIsClickable ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-blue-600 hover:underline mt-0.5 truncate max-w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
                            title="View contract details"
                            disabled={contractDetailLoading}
                            onClick={() => void openContractDetailFromPo()}
                          >
                            {poDisplay}
                          </button>
                        ) : (
                          <div className="text-xs font-semibold text-gray-800 mt-0.5 truncate">{poDisplay}</div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-green-100 px-0">
                      <div className="px-3 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-green-600">STO Number</div>
                        <div className="text-xs font-semibold text-gray-800 mt-0.5 whitespace-pre-line break-words">
                          {(cd.sto_numbers || cd.sto_number || '—')
                            .split(/,\s*/)
                            .filter(Boolean)
                            .join('\n') || '—'}
                        </div>
                      </div>
                      {[
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
                    <SupplierMillsCombobox
                      value={newOperation.loading_location}
                      supplierName={cd?.supplier}
                      onChange={(val) => {
                        setNewOperation((prev) => ({ ...prev, loading_location: val }))
                        clearFieldError('loading_location')
                      }}
                      disabled={isEditMode}
                      className={`h-9 ${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.loading_location ? 'border-red-500' : ''}`}
                      placeholder="SAP supplier location or search mills..."
                    />
                    {formErrors.loading_location && <p className="text-xs mt-1 text-red-600">{formErrors.loading_location}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Unloading Location</label>
                    <GroupPlantCombobox
                      value={newOperation.unloading_location}
                      hint={cd?.b2b_child_buyer || cd?.buyer || cd?.plant_code}
                      onChange={(val) => {
                        setNewOperation((prev) => ({ ...prev, unloading_location: val }))
                        clearFieldError('unloading_location')
                      }}
                      disabled={isEditMode}
                      className={`h-9 ${isEditMode ? READONLY_FIELD_CLASS : ''} ${formErrors.unloading_location ? 'border-red-500' : ''}`}
                      placeholder={cd?.is_b2b_origin ? 'B2B child buyer / group plant...' : 'Buyer atau search group plant...'}
                    />
                    {formErrors.unloading_location && <p className="text-xs mt-1 text-red-600">{formErrors.unloading_location}</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3 — Truck Planning (read-only from daily planning upload) */}
            <div className="rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-violet-50 to-white px-4 py-2.5 rounded-t-xl">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 shrink-0">
                  <Clock className="h-3.5 w-3.5 text-violet-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">3. Truck Planning</h4>
                {step3Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Due Date Delivery Start
                      <span className="ml-1 font-normal text-gray-400">(from contract)</span>
                    </label>
                    <DateInputDdMmYyyy
                      valueIso={dueStartDisplay}
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
                      valueIso={dueEndDisplay}
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
                      className="bg-gray-100 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-700">Daily Planning Deliverables</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">From Daily Planning upload — read only</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Date</th>
                          <th className="px-3 py-2 text-right font-semibold">Qty Delivery (MT)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planningRows.length === 0 ? (
                          <tr>
                            <td colSpan={2} className="px-3 py-4 text-center text-gray-400 italic">
                              No daily planning uploaded yet.
                            </td>
                          </tr>
                        ) : (
                          planningRows.map((row) => (
                            <tr key={row.date} className="border-t border-gray-100">
                              <td className="px-3 py-2 tabular-nums text-gray-800">{fmtIsoDate(row.date)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                                {formatQtyKgAsMt(row.quantity_delivery_kg)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {planningRows.length > 0 && (
                        <tfoot>
                          <tr className="border-t border-gray-200 bg-gray-50">
                            <td className="px-3 py-2 text-xs font-semibold text-gray-700">Total</td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-gray-800">
                              {formatQtyKgAsMt(planningTotalKg)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4 — Truck Actual (SAP + WB upload) */}
            <div className="rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-2.5 rounded-t-xl">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 shrink-0">
                  <Truck className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">4. Truck Actual</h4>
                {step4Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="p-4 space-y-4">
                {wbDisplayMode === 'perSto' ? (
                  stoActuals.map((sto) => {
                    const stoRows = filterActualRowsForSto(actualRows, sto.sto_number, {
                      includeLegacyEmpty: false,
                    })
                    return (
                      <div
                        key={sto.sto_number}
                        className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3 space-y-3"
                      >
                        <p className="text-xs font-semibold text-emerald-900">
                          STO {sto.sto_number}
                        </p>
                        {renderSapActualFields(sto)}
                        {renderDailyActualsTable(stoRows)}
                      </div>
                    )
                  })
                ) : wbDisplayMode === 'poLevelMultiSto' ? (
                  <>
                    {stoActuals.map((sto) => (
                      <div
                        key={sto.sto_number}
                        className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3 space-y-3"
                      >
                        <p className="text-xs font-semibold text-emerald-900">
                          STO {sto.sto_number}
                        </p>
                        {renderSapActualFields(sto)}
                      </div>
                    ))}
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 italic">
                        WB uploaded at PO level — not split by STO
                      </p>
                      {renderDailyActualsTable(actualRows)}
                    </div>
                  </>
                ) : (
                  <>
                    {renderSapActualFields(
                      singleStoFallback
                        ? singleStoFallback
                        : {
                            start_receive_date: sapReceiveDates.start_receive_date,
                            last_receive_date: sapReceiveDates.last_receive_date,
                            qty_delivery: sapQty.qty_delivery,
                            qty_receive: sapQty.qty_receive,
                          },
                    )}
                    {renderDailyActualsTable(
                      singleStoFallback
                        ? filterActualRowsForSto(actualRows, singleStoFallback.sto_number, {
                            includeLegacyEmpty: true,
                          })
                        : actualRows,
                    )}
                  </>
                )}
              </div>
            </div>

            {isEditMode && (
              <div className="rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-r from-slate-50 to-white px-4 py-2.5 rounded-t-xl">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 shrink-0">
                    <History className="h-3.5 w-3.5 text-slate-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800">5. Log Activity</h4>
                </div>
                <div className="p-4">
                  {activityLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading activity…
                    </div>
                  ) : activityLog.length === 0 ? (
                    <p className="text-sm text-gray-500">No edit history recorded for this trucking operation yet.</p>
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
            )}

            {/* Footer action bar */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  {contractValidation.exists && (
                    <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-blue-700 font-medium">
                      <FileText className="h-3 w-3" />
                      {cd?.po_number || poNumber}
                    </span>
                  )}
                  {newOperation.location && (
                    <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-orange-700 font-medium">
                      <Truck className="h-3 w-3" />
                      {newOperation.location}
                    </span>
                  )}
                  {planningRows.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-violet-700 font-medium">
                      {planningRows.length} planning day{planningRows.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {!contractValidation.exists && (
                    <span className="italic text-gray-400">Enter PO Number to continue</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" className="h-9" onClick={() => { resetForm(); onClose() }} disabled={creating || loadingEdit}>
                    {isViewOnly ? 'Close' : 'Cancel'}
                  </Button>
                  {canSave && (
                    <Button
                      onClick={handleCreateOperation}
                      disabled={creating || loadingEdit || !contractValidation.exists}
                      className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                    >
                      {creating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Truck className="h-4 w-4 mr-2" />
                          Create Trucking
                        </>
                      )}
                    </Button>
                  )}
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
})
