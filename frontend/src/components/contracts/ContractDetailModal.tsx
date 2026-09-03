'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatOutstandingQtyMtFromKg, formatQtyMtFromKg, formatRupiah } from '@/lib/utils'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import {
  formatLogCycleDays,
  formatSignedCycleDays,
  logCycleDaysClass,
  signedCycleDaysClass,
} from '@/lib/cycleDaysDisplay'
import { formatDateDMY, toApiDateOnly } from '@/lib/dateFormat'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  SectionCancelButton,
  SectionEditButton,
} from '@/components/shared/ShipmentModalSectionActions'
import {
  buildCargoReadinessChangeRemark,
  cargoReadinessDatesEqual,
} from '@/lib/contractCargoReadinessRemark'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { formatContractDeliveryStatusLabel } from '@/lib/contractDeliveryStatus'
import { formatShipmentStatusLabel, shipmentStatusBadgeClass } from '@/lib/shipmentStatusDisplay'
import {
  canCreatePermission,
  canEditPermission,
  canViewPermission,
  usePermissions,
} from '@/components/PermissionsContext'
import { AddNewShipmentModal } from '@/components/shared/AddNewShipmentModal'
import type { ShipmentPoOption } from '@/components/shared/addNewShipmentTypes'
import { submitAddNewShipmentPayload } from '@/lib/addNewShipmentSubmit'
import { resolveShipmentTablePrimaryAction } from '@/lib/shipmentViewTableActions'
import { CreateTruckingOperationModal } from '@/components/trucking/CreateTruckingOperationModal'
import { stoOperationIdDisplay, stoOperationIdIsOpenable } from '@/lib/contractStoOperationLink'
import { ViewShipmentModal } from '@/components/shared/ViewShipmentModal'
import { ViewTruckingOperationModal } from '@/components/trucking/ViewTruckingOperationModal'

const CONTRACT_PAYMENT_INFO_PERMISSION = 'data.contract_payment_info'

/** Payment status → badge color (aligned with Finance page). */
const PAYMENT_STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PARTIAL: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
}

export type ContractDetailModalContract = {
  id: string
  contract_id: string
  buyer: string
  supplier: string
  product: string
  quantity_ordered: number
  quantity_delivery?: number
  quantity_receive?: number
  incoterm: string
  contract_date: string
  delivery_start_date: string
  delivery_end_date: string
  contract_value: number
  currency: string
  status: string
  group_name: string
  po_number: string
  po_numbers: string
  po_count: number
  sto_count: number
  total_sto_quantity: number
  outstanding_quantity: number
  source_type: string
  contract_type: string
  transport_mode: string
  unit_price: number
  b2b_flag?: string
  contract_reference_po?: string
  lt_spot?: string
  import_status?: string
  gr_po_status?: string | null
  gr_sto_status?: string | null
  due_date_payment?: string
  dp_date?: string
  payoff_date?: string
  dp_date_deviation_days?: number
  payoff_date_deviation_days?: number
  contract_ext_no?: string
  cargo_readiness_date?: string
  remarks_count?: number
  over_under_delivery_status?: string
  log_cycle_days?: number | null
  trade_cycle_days?: number | null
  cash_cycle_days?: number | null
  dp_cycle_days?: number | null
  payment_status?: string
  company_name?: string
}

export interface DocumentItem {
  id: string
  document_type?: string
  file_name: string
  file_path?: string
  mime_type?: string
  file_size?: number
  contract_id?: string
  created_at?: string
}

export interface StoInfoRow {
  type: 'shipment' | 'trucking'
  id?: string | null
  sto_number: string
  operation_id?: string | null
  late_indicator: string
  status: string
  sto_quantity: number
  quantity_delivered?: number
  quantity_receive?: number
  vessel_name?: string
  trucking_owner?: string
  eta_vessel_arrival_loading_port?: string | null
  eta_discharge_complete?: string | null
  ata_arrival_loading?: string | null
  ata_discharge_complete?: string | null
  eta_trucking_completion_date?: string | null
  trucking_start_date?: string | null
  trucking_completion_date?: string | null
  eta?: string | null
  etc?: string | null
  ata?: string | null
  atc?: string | null
}

export type B2bPartyRow = {
  contract_id: string
  contract_date?: string | null
  po_numbers?: string | null
  contract_ext_no?: string | null
  company_name?: string | null
  buyer?: string | null
  supplier?: string | null
  incoterm?: string | null
  certification?: string | null
  quantity_delivery?: number | null
  quantity_receive?: number | null
}

/** True when SAP B2B flag is set; do not use `contract_type || b2b_flag` (LT/SPOT lives in contract_type). */
export function isContractB2b(
  c: Pick<ContractDetailModalContract, 'b2b_flag' | 'contract_type'>,
): boolean {
  const contractType = String(c.contract_type || '').trim().toUpperCase()
  const b2bFlag = String(c.b2b_flag || '').trim().toUpperCase()
  return contractType === 'B2B' || b2bFlag === 'B2B'
}

function getStatusColor(status: string) {
  switch (status) {
    case 'Close':
    case 'CLOSE':
    case 'CLOSED':
    case 'Completed':
    case 'COMPLETED':
      return 'bg-red-100 text-red-800'
    case 'Open':
    case 'OPEN':
    case 'ACTIVE':
      return 'bg-green-100 text-green-800'
    case 'Cancelled':
    case 'CANCELLED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

function ContractStatusBadge({ status }: { status: string }) {
  const label = formatContractDeliveryStatusLabel(status) || formatSapDisplayValue(status)
  return <Badge className={getStatusColor(label)}>{label}</Badge>
}

function GrStatusValue({ status }: { status?: string | null }) {
  const normalized = String(status || '').trim()
  if (!normalized) return <span className="font-medium">-</span>
  return <ContractStatusBadge status={normalized} />
}

/**
 * B2B contracts: show Buyer in Parties the same as Company Name (display-only).
 */
export function partiesBuyerDisplay(
  c: Pick<ContractDetailModalContract, 'buyer' | 'company_name' | 'b2b_flag' | 'contract_type'>,
): string {
  const isB2b = isContractB2b(c)
  if (isB2b) {
    return formatSapDisplayValue(c.company_name || c.buyer)
  }
  return formatSapDisplayValue(c.buyer)
}

function formatDate(dateStr: string | null | undefined) {
  return formatDateDMY(dateStr)
}

const DETAIL_GRID = 'grid grid-cols-1 md:grid-cols-3 gap-4 text-sm'

function EmptyDetailField() {
  return <div className="hidden md:block" aria-hidden />
}

function stoListEta(row: StoInfoRow): string | null {
  if (row.type === 'shipment') {
    return row.eta || row.eta_vessel_arrival_loading_port || null
  }
  return row.eta || null
}

function stoListEtc(row: StoInfoRow): string | null {
  if (row.type === 'shipment') {
    return row.etc || row.eta_discharge_complete || null
  }
  return row.etc || null
}

function stoListAta(row: StoInfoRow): string | null {
  if (row.type === 'shipment') {
    return row.ata || row.ata_arrival_loading || null
  }
  return row.ata || null
}

function stoListAtc(row: StoInfoRow): string | null {
  if (row.type === 'shipment') {
    return row.atc || row.ata_discharge_complete || null
  }
  return row.atc || null
}

function formatStoDate(value: string | null | undefined) {
  return value ? formatDate(value) : '-'
}

function formatCurrency(amount: number | string, currency: string = 'USD') {
  if (amount === null || amount === undefined || amount === '') return '-'
  const number = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(number)) return '-'
  return formatRupiah(number)
}

function StoDetailSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">{children}</div>
    </div>
  )
}

function coalesceSapQtyKg(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function StoDetailField({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  const displayValue =
    typeof value === 'string' || typeof value === 'number' ? formatSapDisplayValue(value) : value
  return (
    <div className="p-3 bg-gray-50 rounded">
      <div className="text-gray-500">{label}</div>
      <div className="font-medium mt-1">{displayValue}</div>
    </div>
  )
}

export async function handleDownloadDocument(docId: string, fileName: string) {
  try {
    const response = await api.get(`/documents/${docId}/download`, {
      responseType: 'blob',
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

async function fetchDocumentsByContractId(contractInternalId: string): Promise<DocumentItem[]> {
  const params = new URLSearchParams()
  params.append('contractId', contractInternalId)
  const res = await api.get(`/documents?${params.toString()}`)
  return res.data?.data || []
}

function pickContractForDetailModal(
  contracts: ContractDetailModalContract[] | undefined,
  contractId: string,
): ContractDetailModalContract | null {
  if (!Array.isArray(contracts) || contracts.length === 0) return null
  const exact = contracts.find((c) => String(c.contract_id || '').trim() === contractId)
  return exact ?? contracts[0] ?? null
}

function contractMatchesPo(c: ContractDetailModalContract, poNumber: string): boolean {
  const needle = String(poNumber || '').trim().toLowerCase()
  if (!needle) return false
  if (String(c.po_number || '').trim().toLowerCase() === needle) return true
  return String(c.po_numbers || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes(needle)
}

/** Resolve contract detail row by PO (and optional contract id hint from shipment PO list). */
export async function fetchContractForDetailModalByPo(
  poNumber: string,
  contractNumber?: string | null,
): Promise<ContractDetailModalContract | null> {
  const po = String(poNumber || '').trim()
  const contractId = String(contractNumber || '').trim()

  if (contractId) {
    const byContract = await fetchContractForDetailModal(contractId)
    if (byContract && (!po || contractMatchesPo(byContract, po))) {
      return byContract
    }
  }

  if (!po) {
    return contractId ? fetchContractForDetailModal(contractId) : null
  }

  try {
    const bySearch = await api.get<{
      success: boolean
      data?: { contracts?: ContractDetailModalContract[] }
    }>('/contracts', { params: { search: po, limit: 25, page: 1 } })
    if (bySearch.data?.success) {
      const contracts = bySearch.data.data?.contracts ?? []
      const poMatch = contracts.find((c) => contractMatchesPo(c, po))
      if (poMatch) return poMatch
      if (contractId) {
        return contracts.find((c) => String(c.contract_id || '').trim() === contractId) ?? null
      }
    }
  } catch (err) {
    console.error('fetchContractForDetailModalByPo:', err)
  }

  return contractId ? fetchContractForDetailModal(contractId) : null
}

/** Load enriched contract row for ContractDetailModal (same source as Contracts list API). */
export async function fetchContractForDetailModal(
  contractNumber: string,
): Promise<ContractDetailModalContract | null> {
  const contractId = String(contractNumber || '').trim()
  if (!contractId) return null

  try {
    const byId = await api.get<{
      success: boolean
      data?: { contracts?: ContractDetailModalContract[] }
    }>('/contracts', { params: { contract_id: contractId, limit: 1, page: 1 } })
    if (byId.data?.success) {
      const found = pickContractForDetailModal(byId.data.data?.contracts, contractId)
      if (found) return found
    }

    if (contractId.length >= 2) {
      const bySearch = await api.get<{
        success: boolean
        data?: { contracts?: ContractDetailModalContract[] }
      }>('/contracts', { params: { search: contractId, limit: 10, page: 1 } })
      if (bySearch.data?.success) {
        return pickContractForDetailModal(bySearch.data.data?.contracts, contractId)
      }
    }
  } catch (err) {
    console.error('fetchContractForDetailModal:', err)
  }
  return null
}

function sliceIsoDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).trim().slice(0, 10)
}

export function ContractDetailModal({
  contract,
  onClose,
  onContractUpdated,
  showMonthDeliveryEnd = false,
  documentsRefreshKey = 0,
  stacked = false,
}: {
  contract: ContractDetailModalContract | null
  onClose: () => void
  /** Called after a successful in-modal contract field update (e.g. cargo readiness). */
  onContractUpdated?: (patch: Partial<ContractDetailModalContract> & { id: string }) => void
  showMonthDeliveryEnd?: boolean
  /** Increment to refetch documents while the modal stays open (e.g. after table upload). */
  documentsRefreshKey?: number
  /** Raise z-index when opened above vessel/shipment modals (z-[60]). */
  stacked?: boolean
}) {
  const cycleHelp = showMonthDeliveryEnd
    ? {
        outstanding: FIELD_HELP.contractPerfOutstandingQty,
        log: FIELD_HELP.contractPerfLogCycle,
        trade: FIELD_HELP.contractPerfTradeCycle,
        cash: FIELD_HELP.contractPerfCashCycle,
        dp: FIELD_HELP.contractPerfDpCycle,
      }
    : {
        outstanding: FIELD_HELP.outstandingQty,
        log: FIELD_HELP.logCycle,
        trade: FIELD_HELP.tradeCycle,
        cash: FIELD_HELP.cashCycle,
        dp: FIELD_HELP.dpCycle,
      }

  const perms = usePermissions()
  const canEditContract = canEditPermission(perms, 'data.contracts')
  const canViewContractPaymentInfo = canViewPermission(perms, CONTRACT_PAYMENT_INFO_PERMISSION)
  const canAddShipment = canCreatePermission(perms, 'data.shipments')
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canAddTrucking = canCreatePermission(perms, 'data.trucking')
  const canEditTrucking = canEditPermission(perms, 'data.trucking')

  const [docsLoading, setDocsLoading] = useState(false)
  const [selectedContractDocs, setSelectedContractDocs] = useState<DocumentItem[]>([])
  const [stoInfoLoading, setStoInfoLoading] = useState(false)
  const [stoInfo, setStoInfo] = useState<StoInfoRow[]>([])
  const [stoQtySummary, setStoQtySummary] = useState<{
    sto_count: number
    total_sto_quantity: number
  } | null>(null)
  const [stoDetailRow, setStoDetailRow] = useState<StoInfoRow | null>(null)
  const [stoDetailData, setStoDetailData] = useState<Record<string, unknown> | null>(null)
  const [stoDetailLoading, setStoDetailLoading] = useState(false)
  const [stoLogisticsViewLoading, setStoLogisticsViewLoading] = useState(false)
  const [stoLogisticsOpLoading, setStoLogisticsOpLoading] = useState(false)
  /** STO No column → read-only view modal */
  const [viewShipmentModal, setViewShipmentModal] = useState<{
    shipmentId: string
    editContractId: string | null
    editStoNumber: string | null
    editContractNumbers: string | null
  } | null>(null)
  const [viewTruckingModal, setViewTruckingModal] = useState<{
    operationId: string
    contractId: string | null
    contractExtNo: string | null
    poNumber: string | null
  } | null>(null)
  /** Operation ID column → Add / Edit / View / Plot Trucking or Shipment */
  const [logisticsOpModal, setLogisticsOpModal] = useState<
    | {
        kind: 'shipment'
        mode: 'add' | 'edit' | 'view' | 'plot'
        shipmentId: string | null
        stoNumber: string | null
        contractNumbers: string | null
        prefilledPOs: ShipmentPoOption[] | null
      }
    | {
        kind: 'trucking'
        mode: 'add' | 'edit' | 'view' | 'plot'
        operationId: string | null
        contractId: string | null
        contractExtNo: string | null
        poNumber: string | null
      }
    | null
  >(null)
  const [contractPayments, setContractPayments] = useState<Array<{ payment_status: string }>>([])
  const [contractPaymentsLoading, setContractPaymentsLoading] = useState(false)
  const [activityLog, setActivityLog] = useState<
    Array<{
      id: string
      username: string
      full_name?: string
      action: string
      entity_type: string
      timestamp: string
      before_data: Record<string, unknown> | null
      after_data: Record<string, unknown> | null
    }>
  >([])
  const [activityLogLoading, setActivityLogLoading] = useState(false)
  const [detailLogTab, setDetailLogTab] = useState<'activity' | 'comments'>('activity')
  const [contractRemarks, setContractRemarks] = useState<
    Array<{
      id: string
      text: string
      category?: string | null
      created_at: string
      updated_at: string
      username?: string
      full_name?: string
    }>
  >([])
  const [contractRemarksLoading, setContractRemarksLoading] = useState(false)
  const [newRemarkText, setNewRemarkText] = useState('')
  const [newRemarkSaving, setNewRemarkSaving] = useState(false)
  const [displayContract, setDisplayContract] = useState<ContractDetailModalContract | null>(contract)
  const [cargoReadinessEditing, setCargoReadinessEditing] = useState(false)
  const [cargoReadinessDraft, setCargoReadinessDraft] = useState('')
  const [cargoReadinessRemark, setCargoReadinessRemark] = useState('')
  const [cargoReadinessSaving, setCargoReadinessSaving] = useState(false)
  const [b2bParties, setB2bParties] = useState<B2bPartyRow[]>([])
  const [b2bPartiesLoading, setB2bPartiesLoading] = useState(false)

  useEffect(() => {
    setDisplayContract(contract)
    setCargoReadinessEditing(false)
    setCargoReadinessDraft('')
    setCargoReadinessRemark('')
  }, [contract])

  const fetchContractDocuments = useCallback(async (contractInternalId: string) => {
    try {
      setDocsLoading(true)
      const docs = await fetchDocumentsByContractId(contractInternalId)
      setSelectedContractDocs(docs)
    } catch (err) {
      console.error('Fetch documents error:', err)
      setSelectedContractDocs([])
    } finally {
      setDocsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (contract) {
      void fetchContractDocuments(contract.id)
    } else {
      setSelectedContractDocs([])
    }
  }, [contract, documentsRefreshKey, fetchContractDocuments])

  useEffect(() => {
    if (!contract?.id) {
      setStoInfo([])
      setStoQtySummary(null)
      return
    }
    let cancelled = false
    setStoInfoLoading(true)
    setStoInfo([])
    setStoQtySummary(null)
    api
      .get(`/contracts/${contract.id}/sto-information`)
      .then((res) => {
        if (cancelled || !res.data?.data?.stos) return
        setStoInfo(res.data.data.stos)
        const summary = res.data.data.summary as
          | { sto_count?: number; total_sto_quantity?: number }
          | undefined
        if (summary && typeof summary.sto_count === 'number') {
          setStoQtySummary({
            sto_count: summary.sto_count,
            total_sto_quantity: Number(summary.total_sto_quantity) || 0,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStoInfo([])
          setStoQtySummary(null)
        }
      })
      .finally(() => {
        if (!cancelled) setStoInfoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contract?.id])

  useEffect(() => {
    if (!contract?.contract_id) {
      setContractPayments([])
      return
    }
    let cancelled = false
    setContractPaymentsLoading(true)
    api
      .get('/finance/payments', { params: { contract_id: contract.contract_id } })
      .then((res) => {
        if (cancelled) return
        const list = res.data?.data ?? []
        setContractPayments(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setContractPayments([])
      })
      .finally(() => {
        if (!cancelled) setContractPaymentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contract?.contract_id])

  useEffect(() => {
    if (!contract?.id) {
      setActivityLog([])
      return
    }
    let cancelled = false
    setActivityLogLoading(true)
    api
      .get(`/contracts/${contract.id}/activity-log`)
      .then((res) => {
        if (cancelled) return
        setActivityLog(Array.isArray(res.data?.data) ? res.data.data : [])
      })
      .catch(() => {
        if (!cancelled) setActivityLog([])
      })
      .finally(() => {
        if (!cancelled) setActivityLogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contract?.id])

  useEffect(() => {
    if (!contract?.id) {
      setContractRemarks([])
      setNewRemarkText('')
      return
    }
    let cancelled = false
    setContractRemarksLoading(true)
    api
      .get(`/contracts/${contract.id}/remarks`)
      .then((res) => {
        if (cancelled) return
        setContractRemarks(Array.isArray(res.data?.data) ? res.data.data : [])
      })
      .catch(() => {
        if (!cancelled) setContractRemarks([])
      })
      .finally(() => {
        if (!cancelled) setContractRemarksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contract?.id])

  const saveNewRemark = useCallback(async () => {
    if (!contract?.id) return
    const text = newRemarkText.trim()
    if (!text) return
    setNewRemarkSaving(true)
    try {
      await api.post(`/contracts/${contract.id}/remarks`, { text })
      setNewRemarkText('')
      const res = await api.get(`/contracts/${contract.id}/remarks`)
      const loaded = Array.isArray(res.data?.data) ? res.data.data : []
      setContractRemarks(loaded)
      onContractUpdated?.({ id: contract.id, remarks_count: loaded.length })
    } finally {
      setNewRemarkSaving(false)
    }
  }, [newRemarkText, contract?.id, onContractUpdated])

  const startCargoReadinessEdit = useCallback(() => {
    if (!displayContract) return
    setCargoReadinessDraft(sliceIsoDate(displayContract.cargo_readiness_date))
    setCargoReadinessRemark('')
    setCargoReadinessEditing(true)
  }, [displayContract])

  const cancelCargoReadinessEdit = useCallback(() => {
    setCargoReadinessEditing(false)
    setCargoReadinessDraft('')
    setCargoReadinessRemark('')
  }, [])

  const saveCargoReadinessEdit = useCallback(async () => {
    if (!displayContract?.id) return
    const remark = cargoReadinessRemark.trim()
    if (!remark) {
      alert('Remark is required when changing Cargo Readiness Date.')
      return
    }
    const nextDate = toApiDateOnly(cargoReadinessDraft)
    const prevDate = toApiDateOnly(displayContract.cargo_readiness_date)
    if (cargoReadinessDatesEqual(prevDate, nextDate)) {
      alert('Cargo Readiness Date has not changed.')
      return
    }
    setCargoReadinessSaving(true)
    try {
      const putRes = await api.put(`/contracts/${displayContract.id}`, {
        cargo_readiness_date: nextDate,
      })
      const remarkText = buildCargoReadinessChangeRemark(prevDate, nextDate, remark)
      await api.post(`/contracts/${displayContract.id}/remarks`, {
        text: remarkText,
        category: 'CARGO_READINESS',
      })
      const updatedDate =
        putRes.data?.data?.cargo_readiness_date != null
          ? sliceIsoDate(String(putRes.data.data.cargo_readiness_date))
          : nextDate ?? ''
      const remarksRes = await api.get(`/contracts/${displayContract.id}/remarks`)
      const loaded = Array.isArray(remarksRes.data?.data) ? remarksRes.data.data : []
      setContractRemarks(loaded)
      const patch = {
        id: displayContract.id,
        cargo_readiness_date: updatedDate || undefined,
        remarks_count: loaded.length,
      }
      setDisplayContract((prev) => (prev ? { ...prev, ...patch } : prev))
      onContractUpdated?.(patch)
      setDetailLogTab('comments')
      setCargoReadinessEditing(false)
      setCargoReadinessDraft('')
      setCargoReadinessRemark('')
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Failed to update Cargo Readiness Date. Please try again.'
      alert(message)
    } finally {
      setCargoReadinessSaving(false)
    }
  }, [cargoReadinessDraft, cargoReadinessRemark, displayContract, onContractUpdated])

  useEffect(() => {
    if (!contract?.id) {
      setB2bParties([])
      return
    }
    const isOriginB2b =
      isContractB2b(contract) && String(contract.contract_reference_po || '').trim() === ''

    if (!isOriginB2b) {
      setB2bParties([])
      return
    }

    let cancelled = false
    setB2bPartiesLoading(true)
    api
      .get(`/contracts/${contract.id}/b2b-parties`)
      .then((res) => {
        if (cancelled) return
        setB2bParties(Array.isArray(res.data?.data) ? res.data.data : [])
      })
      .catch(() => {
        if (!cancelled) setB2bParties([])
      })
      .finally(() => {
        if (!cancelled) setB2bPartiesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contract?.id, contract?.contract_type, contract?.b2b_flag, contract?.contract_reference_po])

  const fetchStoDetailData = useCallback(
    async (row: StoInfoRow): Promise<Record<string, unknown> | null> => {
      if (!contract?.id) return null
      const sto = String(row.sto_number ?? '').trim()
      const operationId = String(row.operation_id ?? '').trim()
      if ((!sto || sto === '-') && (!operationId || operationId === '-')) return null

      const res = await api.get(`/contracts/${contract.id}/logistics-sto-detail`, {
        params: {
          type: row.type,
          ...(sto && sto !== '-' ? { sto } : {}),
          ...(operationId && operationId !== '-' ? { operation_id: operationId } : {}),
        },
      })
      return (res.data?.data as Record<string, unknown> | undefined) ?? null
    },
    [contract?.id],
  )

  const openStoDetail = useCallback(
    async (row: StoInfoRow) => {
      if (!contract?.id) return
      const sto = String(row.sto_number ?? '').trim()
      const operationId = String(row.operation_id ?? '').trim()
      if ((!sto || sto === '-') && (!operationId || operationId === '-')) return

      setStoDetailRow(row)
      setStoDetailData(null)
      setStoDetailLoading(true)
      try {
        setStoDetailData(await fetchStoDetailData(row))
      } catch {
        setStoDetailData(null)
      } finally {
        setStoDetailLoading(false)
      }
    },
    [contract?.id, fetchStoDetailData],
  )

  const openStoLogisticsView = useCallback(
    async (row: StoInfoRow) => {
      if (!contract?.id) return
      setStoLogisticsViewLoading(true)
      try {
        const data = await fetchStoDetailData(row)
        const entityId = String(data?.id ?? '').trim()
        if (!data || !entityId) {
          await openStoDetail(row)
          return
        }

        const contractId = String(contract.contract_id || '').trim()
        const poNumber =
          String(contract.po_number || '').trim() ||
          String(contract.po_numbers || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)[0] ||
          null

        if (row.type === 'shipment') {
          setViewShipmentModal({
            shipmentId: entityId,
            editContractId: contractId || null,
            editStoNumber:
              String(row.sto_number ?? '').trim() ||
              String(row.operation_id ?? '').trim() ||
              null,
            editContractNumbers: contractId || null,
          })
          return
        }

        setViewTruckingModal({
          operationId: entityId,
          contractId: contractId || null,
          contractExtNo: String(contract.contract_ext_no || contractId || '').trim() || null,
          poNumber,
        })
      } catch {
        await openStoDetail(row)
      } finally {
        setStoLogisticsViewLoading(false)
      }
    },
    [contract, fetchStoDetailData, openStoDetail],
  )

  /** STO No / Operation ID → Add / Edit / View / Plot (open statuses → Edit). */
  const openStoLogisticsOperation = useCallback(
    async (row: StoInfoRow) => {
      if (!contract?.id) return
      const sto = String(row.sto_number ?? '').trim()
      const operationId = String(row.operation_id ?? '').trim()
      const hasSto = Boolean(sto && sto !== '-' && sto !== '—')
      const hasOp =
        stoOperationIdIsOpenable(row) ||
        Boolean(operationId && operationId !== '-' && operationId !== '—')
      if (!hasSto && !hasOp) return
      setStoLogisticsOpLoading(true)
      try {
        const data = await fetchStoDetailData(row)
        const entityId = String(data?.id ?? '').trim() || String(row.id ?? '').trim() || null
        const status = String(data?.status ?? row.status ?? '').trim()
        const primary = resolveShipmentTablePrimaryAction(status)

        const contractId = String(contract.contract_id || '').trim()
        const contractExtNo =
          String(contract.contract_ext_no || contractId || '').trim() || null
        const poNumber =
          String(contract.po_number || '').trim() ||
          String(contract.po_numbers || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)[0] ||
          null
        const stoNumber =
          String(row.sto_number ?? '').trim() ||
          String(row.operation_id ?? '').trim() ||
          null

        if (row.type === 'shipment') {
          const canMutate = canAddShipment || canEditShipment
          let mode: 'add' | 'edit' | 'view' | 'plot' = 'view'
          if (primary === 'view' || !canMutate) {
            mode = entityId ? 'view' : 'add'
            if (mode === 'add' && !canAddShipment) {
              await openStoDetail(row)
              return
            }
          } else if (primary === 'add') {
            mode = entityId ? 'plot' : 'add'
            if (!canAddShipment && !canEditShipment) {
              await openStoDetail(row)
              return
            }
          } else {
            mode = entityId ? (canEditShipment ? 'edit' : 'view') : 'add'
          }

          if ((mode === 'edit' || mode === 'view' || mode === 'plot') && !entityId) {
            mode = 'add'
          }

          const prefilledPOs: ShipmentPoOption[] | null =
            mode === 'add' && (poNumber || contractId)
              ? [
                  {
                    key: contractId || poNumber || 'po',
                    contractId: contractId || poNumber || '',
                    poNumber,
                    label: poNumber || contractId,
                    contractData: {
                      contract_id: contractId,
                      po_number: poNumber,
                      transport_mode: contract.transport_mode,
                      incoterm: contract.incoterm,
                      quantity_ordered: contract.quantity_ordered,
                      outstanding_quantity: contract.outstanding_quantity,
                      delivery_start_date: contract.delivery_start_date,
                      delivery_end_date: contract.delivery_end_date,
                      supplier: contract.supplier,
                      buyer: contract.buyer,
                      product: contract.product,
                      contract_ext_no: contract.contract_ext_no,
                    },
                  },
                ]
              : null

          setLogisticsOpModal({
            kind: 'shipment',
            mode,
            shipmentId: entityId,
            stoNumber,
            contractNumbers: contractId || null,
            prefilledPOs,
          })
          return
        }

        // Trucking — mirror list: Unplanned → Add/Plot, Cancelled → View, else Edit
        const truckStatus = status.toUpperCase()
        const canMutateTruck = canAddTrucking || canEditTrucking
        let truckMode: 'add' | 'edit' | 'view' | 'plot' = 'view'
        if (truckStatus === 'CANCELLED' || !canMutateTruck) {
          truckMode = entityId ? 'view' : 'add'
          if (truckMode === 'add' && !canAddTrucking) {
            await openStoDetail(row)
            return
          }
        } else if (truckStatus === 'UNPLANNED' || !entityId) {
          truckMode = entityId ? 'plot' : 'add'
          if (!canAddTrucking && !canEditTrucking) {
            await openStoDetail(row)
            return
          }
        } else {
          truckMode = entityId ? (canEditTrucking ? 'edit' : 'view') : 'add'
        }

        if ((truckMode === 'edit' || truckMode === 'view' || truckMode === 'plot') && !entityId) {
          truckMode = 'add'
        }

        setLogisticsOpModal({
          kind: 'trucking',
          mode: truckMode,
          operationId: entityId || operationId || null,
          contractId: contractId || null,
          contractExtNo,
          poNumber,
        })
      } catch {
        await openStoDetail(row)
      } finally {
        setStoLogisticsOpLoading(false)
      }
    },
    [
      contract,
      fetchStoDetailData,
      openStoDetail,
      canAddShipment,
      canEditShipment,
      canAddTrucking,
      canEditTrucking,
    ],
  )

  const closeStoDetail = useCallback(() => {
    setStoDetailRow(null)
    setStoDetailData(null)
    setStoDetailLoading(false)
  }, [])

  if (!contract) return null

  // Logistics endpoint summary uses SAP STO Qty by STO/PO (Operation ID fallback for list).
  const displayStoCount = stoQtySummary?.sto_count ?? contract.sto_count ?? 0
  const displayTotalStoQty =
    stoQtySummary != null ? stoQtySummary.total_sto_quantity : contract.total_sto_quantity

  return (
    <>
      <div
        className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 ${
          stacked ? 'z-[70]' : 'z-50'
        }`}
      >
        <Card className="max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Contract Details</CardTitle>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">Basic Information</h3>
                <div className={DETAIL_GRID}>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">PO</div>
                    <div className="font-medium mt-1 break-words whitespace-normal">
                      {formatSapDisplayValue(contract.po_numbers || contract.po_number)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract</div>
                    <div className="font-medium mt-1 break-words whitespace-normal">
                      {formatSapDisplayValue(contract.contract_id)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract Ext No</div>
                    <div className="font-medium mt-1 break-words whitespace-normal">{formatSapDisplayValue(contract.contract_ext_no)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">GR PO Status</div>
                    <div className="mt-1">
                      <GrStatusValue status={contract.gr_po_status} />
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      GR STO Status
                      <FieldHelp text={FIELD_HELP.grStoStatus} />
                    </div>
                    <div className="mt-1">
                      <GrStatusValue status={contract.gr_sto_status} />
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Source Type</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.source_type)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Group Name</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.group_name)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Company Name
                      <FieldHelp text={FIELD_HELP.companyName} />
                    </div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.company_name)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">LT/SPOT</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.lt_spot)}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Important Dates & Cycles</h3>
                <div className={DETAIL_GRID}>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract Date</div>
                    <div className="font-medium mt-1">{formatDate(contract.contract_date)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Due Date Delivery Start</div>
                    <div className="font-medium mt-1">{formatDate(contract.delivery_start_date)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Due Date Delivery End</div>
                    <div className="font-medium mt-1">{formatDate(contract.delivery_end_date)}</div>
                  </div>
                  {canViewContractPaymentInfo && (
                    <>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Due Date Payment</div>
                        <div className="font-medium mt-1">{formatDate(contract.due_date_payment)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">DP Date</div>
                        <div className="font-medium mt-1">{formatDate(contract.dp_date)}</div>
                      </div>
                      <div className="p-3 bg-gray-50 rounded">
                        <div className="text-gray-500">Payoff Date</div>
                        <div className="font-medium mt-1">{formatDate(contract.payoff_date)}</div>
                      </div>
                    </>
                  )}
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-gray-500">Cargo Readiness Date</div>
                      {canEditContract && !cargoReadinessEditing && (
                        <SectionEditButton onClick={startCargoReadinessEdit} />
                      )}
                      {canEditContract && cargoReadinessEditing && (
                        <div className="flex gap-2">
                          <SectionCancelButton
                            onClick={cancelCargoReadinessEdit}
                            disabled={cargoReadinessSaving}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => void saveCargoReadinessEdit()}
                            disabled={cargoReadinessSaving || !cargoReadinessRemark.trim()}
                          >
                            {cargoReadinessSaving ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                      )}
                    </div>
                    {cargoReadinessEditing ? (
                      <div className="mt-2 space-y-2">
                        <DateInputDdMmYyyy
                          valueIso={cargoReadinessDraft}
                          onChangeIso={setCargoReadinessDraft}
                          className="h-9 text-sm bg-white max-w-[200px]"
                          disabled={cargoReadinessSaving}
                        />
                        <textarea
                          className="w-full min-h-[72px] border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 bg-white"
                          placeholder="Remark (required) — explain why Cargo Readiness Date is changing"
                          value={cargoReadinessRemark}
                          onChange={(e) => setCargoReadinessRemark(e.target.value)}
                          disabled={cargoReadinessSaving}
                        />
                      </div>
                    ) : (
                      <div className="font-medium mt-1">
                        {formatDate(displayContract?.cargo_readiness_date ?? contract.cargo_readiness_date)}
                      </div>
                    )}
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Log Cycle
                      <FieldHelp text={cycleHelp.log} />
                    </div>
                    <div
                      className={cn(
                        'font-medium mt-1',
                        logCycleDaysClass(contract.log_cycle_days, contract.trade_cycle_days),
                      )}
                    >
                      {formatLogCycleDays(contract.log_cycle_days, contract.trade_cycle_days)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Trade Cycle
                      <FieldHelp text={cycleHelp.trade} />
                    </div>
                    <div className={cn('font-medium mt-1', signedCycleDaysClass(contract.trade_cycle_days))}>
                      {formatSignedCycleDays(contract.trade_cycle_days)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Cash Cycle
                      <FieldHelp text={cycleHelp.cash} />
                    </div>
                    <div className={cn('font-medium mt-1', signedCycleDaysClass(contract.cash_cycle_days))}>
                      {formatSignedCycleDays(contract.cash_cycle_days)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      DP Cycle
                      <FieldHelp text={cycleHelp.dp} />
                    </div>
                    <div className={cn('font-medium mt-1', signedCycleDaysClass(contract.dp_cycle_days))}>
                      {formatSignedCycleDays(contract.dp_cycle_days)}
                    </div>
                  </div>
                  <EmptyDetailField />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Logistic Information</h3>
                <div className={`${DETAIL_GRID} mb-4`}>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Transport Mode</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.transport_mode)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Incoterm</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.incoterm)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Product</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.product)}</div>
                  </div>
                </div>
                <h4 className="text-sm font-semibold mb-2">Table List STO</h4>
                {stoInfoLoading ? (
                  <div className="text-sm text-gray-500">Loading STO information...</div>
                ) : stoInfo.length === 0 ? (
                  <div className="text-sm text-gray-500">No STO information for this contract.</div>
                ) : (
                  <div className="overflow-x-auto border rounded">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="text-left p-2 font-medium">STO No</th>
                          <th className="text-left p-2 font-medium">Operation ID</th>
                          <th className="text-left p-2 font-medium">Type</th>
                          <th className="text-left p-2 font-medium">Late Indicator</th>
                          <th className="text-left p-2 font-medium">Status</th>
                          <th className="text-left p-2 font-medium">STO Qty</th>
                          <th className="text-left p-2 font-medium">Delivery Qty</th>
                          <th className="text-left p-2 font-medium">Receive Qty</th>
                          <th className="text-left p-2 font-medium">Vessel / Trucking Owner</th>
                          <th className="text-left p-2 font-medium">
                            <span className="inline-flex items-center gap-1">
                              ETA
                              <FieldHelp text={FIELD_HELP.stoListEta} />
                            </span>
                          </th>
                          <th className="text-left p-2 font-medium">
                            <span className="inline-flex items-center gap-1">
                              ETC
                              <FieldHelp text={FIELD_HELP.stoListEtc} />
                            </span>
                          </th>
                          <th className="text-left p-2 font-medium">
                            <span className="inline-flex items-center gap-1">
                              ATA
                              <FieldHelp text={FIELD_HELP.stoListAta} />
                            </span>
                          </th>
                          <th className="text-left p-2 font-medium">
                            <span className="inline-flex items-center gap-1">
                              ATC
                              <FieldHelp text={FIELD_HELP.stoListAtc} />
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stoInfo.map((row, idx) => (
                          <tr key={`${row.type}-${row.sto_number}-${idx}`} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="p-2">
                              <button
                                type="button"
                                onClick={() => void openStoLogisticsOperation(row)}
                                disabled={stoLogisticsOpLoading}
                                className="text-left text-blue-600 hover:underline font-medium cursor-pointer disabled:opacity-50"
                                title={
                                  row.type === 'shipment'
                                    ? 'Open Add / Edit / View Shipment'
                                    : 'Open Add / Edit / View Trucking'
                                }
                              >
                                {formatSapDisplayValue(row.sto_number)}
                              </button>
                            </td>
                            <td className="p-2">
                              {stoOperationIdIsOpenable(row) ? (
                                <button
                                  type="button"
                                  onClick={() => void openStoLogisticsOperation(row)}
                                  disabled={stoLogisticsOpLoading}
                                  className="text-left text-blue-600 hover:underline font-medium cursor-pointer disabled:opacity-50"
                                  title={
                                    row.type === 'shipment'
                                      ? 'Open Add / Edit / View Shipment'
                                      : 'Open Add / Edit / View Trucking'
                                  }
                                >
                                  {stoOperationIdDisplay(row)}
                                </button>
                              ) : (
                                <span className="text-gray-700">{stoOperationIdDisplay(row)}</span>
                              )}
                            </td>
                            <td className="p-2">
                              <Badge
                                variant="outline"
                                className={
                                  row.type === 'shipment' ? 'border-blue-300 text-blue-700' : 'border-amber-300 text-amber-700'
                                }
                              >
                                {row.type === 'shipment' ? 'Shipment' : 'Trucking'}
                              </Badge>
                            </td>
                            <td className="p-2">
                              <Badge
                                className={
                                  row.late_indicator === 'Late'
                                    ? 'bg-red-500'
                                    : row.late_indicator === 'On Time'
                                      ? 'bg-green-500'
                                      : 'bg-gray-400'
                                }
                              >
                                {row.late_indicator}
                              </Badge>
                            </td>
                            <td className="p-2">
                              <Badge className={shipmentStatusBadgeClass(row.status)}>
                                {formatShipmentStatusLabel(row.status)}
                              </Badge>
                            </td>
                            <td className="p-2">{formatQtyMtFromKg(row.sto_quantity)}</td>
                            <td className="p-2">{formatQtyMtFromKg(row.quantity_delivered)}</td>
                            <td className="p-2">{formatQtyMtFromKg(row.quantity_receive)}</td>
                            <td className="p-2">
                              {row.type === 'shipment' ? (row.vessel_name ?? '-') : (row.trucking_owner ?? '-')}
                            </td>
                            <td className="p-2 whitespace-nowrap">{formatStoDate(stoListEta(row))}</td>
                            <td className="p-2 whitespace-nowrap">{formatStoDate(stoListEtc(row))}</td>
                            <td className="p-2 whitespace-nowrap">{formatStoDate(stoListAta(row))}</td>
                            <td className="p-2 whitespace-nowrap">{formatStoDate(stoListAtc(row))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className={`${DETAIL_GRID} mt-4`}>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">B2B Flag</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.b2b_flag)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Buyer</div>
                    <div className="font-medium mt-1">{partiesBuyerDisplay(contract)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Supplier</div>
                    <div className="font-medium mt-1">{formatSapDisplayValue(contract.supplier)}</div>
                  </div>
                </div>
              </div>

              {isContractB2b(contract) && String(contract.contract_reference_po || '').trim() === '' && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    Table List PO (Child)
                    <FieldHelp text={FIELD_HELP.b2bParties} />
                  </h4>
                  {b2bPartiesLoading ? (
                    <div className="text-sm text-gray-500">Loading child POs...</div>
                  ) : b2bParties.length === 0 ? (
                    <div className="text-sm text-gray-500">No child POs linked to this origin contract.</div>
                  ) : (
                    <div className="overflow-x-auto border rounded">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-100 border-b">
                            <th className="text-left p-2 font-medium">PO</th>
                            <th className="text-left p-2 font-medium">Buyer</th>
                            <th className="text-left p-2 font-medium">Supplier</th>
                            <th className="text-left p-2 font-medium">Delivery Qty</th>
                            <th className="text-left p-2 font-medium">Receive Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b2bParties.map((r) => (
                            <tr key={r.contract_id} className="border-b last:border-0">
                              <td className="p-2">{formatSapDisplayValue(r.po_numbers)}</td>
                              <td className="p-2">{formatSapDisplayValue(r.buyer || r.company_name)}</td>
                              <td className="p-2">{formatSapDisplayValue(r.supplier)}</td>
                              <td className="p-2">{formatQtyMtFromKg(r.quantity_delivery)}</td>
                              <td className="p-2">{formatQtyMtFromKg(r.quantity_receive)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold mb-3">Quantity</h3>
                <div className={DETAIL_GRID}>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract Quantity</div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.quantity_ordered)}</div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded border-2 border-blue-200">
                    <div className="text-gray-500">
                      Total STO Quantity ({displayStoCount} STO{displayStoCount !== 1 ? 's' : ''})
                    </div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(displayTotalStoQty)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Delivery Quantity</div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.quantity_delivery)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Receive Quantity</div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.quantity_receive)}</div>
                  </div>
                  <div
                    className={cn(
                      'p-3 rounded border-2',
                      contract.outstanding_quantity < 0
                        ? 'bg-green-50 border-green-200'
                        : contract.outstanding_quantity > 0
                          ? 'bg-red-50 border-red-200'
                          : 'bg-gray-50 border-gray-200',
                    )}
                  >
                    <div
                      className={cn(
                        'font-semibold flex items-center gap-1',
                        contract.outstanding_quantity < 0
                          ? 'text-green-700'
                          : contract.outstanding_quantity > 0
                            ? 'text-red-700'
                            : 'text-gray-700',
                      )}
                    >
                      Outstanding Quantity
                      <FieldHelp text={cycleHelp.outstanding} />
                    </div>
                    <div
                      className={cn(
                        'font-bold text-xl mt-1',
                        contract.outstanding_quantity < 0
                          ? 'text-green-600'
                          : contract.outstanding_quantity > 0
                            ? 'text-red-600'
                            : 'text-gray-500',
                      )}
                    >
                      {formatOutstandingQtyMtFromKg(contract.outstanding_quantity)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Over/Under Delivery Status
                      <FieldHelp text={FIELD_HELP.overUnderDelivery} />
                    </div>
                    <div className="font-semibold mt-1">{formatSapDisplayValue(contract.over_under_delivery_status)}</div>
                  </div>
                </div>
              </div>

              {canViewContractPaymentInfo && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Payment Information</h3>
                  <div className={DETAIL_GRID}>
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Unit Price</div>
                      <div className="font-medium mt-1">{formatCurrency(contract.unit_price, contract.currency)}</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Contract Value</div>
                      <div className="font-medium mt-1">{formatCurrency(contract.contract_value, contract.currency)}</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Payment Status</div>
                      <div className="font-medium mt-1">
                        {contractPaymentsLoading ? (
                          <span className="text-gray-400">Loading...</span>
                        ) : (() => {
                          const statuses = Array.from(
                            new Set(
                              contractPayments
                                .map((p) => String(p.payment_status || '').trim())
                                .filter(Boolean),
                            ),
                          )
                          if (statuses.length === 0) return '-'
                          return (
                            <div className="flex flex-wrap gap-1.5">
                              {statuses.map((status) => (
                                <Badge
                                  key={status}
                                  className={cn(
                                    'hover:bg-inherit',
                                    PAYMENT_STATUS_BADGE_CLASS[status.toUpperCase()] ??
                                      'bg-gray-100 text-gray-800',
                                  )}
                                >
                                  {formatSapDisplayValue(status)}
                                </Badge>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold mb-3">Documents</h3>
                {docsLoading ? (
                  <div className="text-sm text-gray-500">Loading documents...</div>
                ) : selectedContractDocs.length === 0 ? (
                  <div className="text-sm text-gray-500">No documents uploaded for this contract.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedContractDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between px-3 py-2 border rounded">
                        <div>
                          <div className="text-sm font-medium">{doc.file_name}</div>
                          <div className="text-xs text-gray-500">
                            {(doc.document_type || 'FILE')} •{' '}
                            {doc.created_at ? new Date(doc.created_at).toLocaleString() : ''}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadDocument(doc.id, doc.file_name)}>
                          View
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-lg font-semibold">Activity</h3>
                  <div className="inline-flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      className={cn(
                        'px-3 py-1.5 text-sm',
                        detailLogTab === 'activity' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50',
                      )}
                      onClick={() => setDetailLogTab('activity')}
                    >
                      Activity Log
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'px-3 py-1.5 text-sm',
                        detailLogTab === 'comments' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50',
                      )}
                      onClick={() => setDetailLogTab('comments')}
                    >
                      Comments
                    </button>
                  </div>
                </div>

                {detailLogTab === 'activity' ? (
                  activityLogLoading ? (
                    <p className="text-sm text-gray-500 py-4">Loading activity...</p>
                  ) : activityLog.length === 0 ? (
                    <p className="text-sm text-gray-500 py-4">No activity recorded for this contract.</p>
                  ) : (
                    <div className="overflow-x-auto rounded border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="text-left p-2 font-medium">User</th>
                            <th className="text-left p-2 font-medium">Date &amp; Time</th>
                            <th className="text-left p-2 font-medium">Action</th>
                            <th className="text-left p-2 font-medium">Area</th>
                            <th className="text-left p-2 font-medium">Field</th>
                            <th className="text-left p-2 font-medium">Old value</th>
                            <th className="text-left p-2 font-medium">New value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activityLog.flatMap((log) => {
                            const before =
                              log.before_data && typeof log.before_data === 'object'
                                ? (log.before_data as Record<string, unknown>)
                                : {}
                            const after =
                              log.after_data && typeof log.after_data === 'object'
                                ? (log.after_data as Record<string, unknown>)
                                : {}
                            const toStr = (v: unknown): string => {
                              if (v == null) return ''
                              if (typeof v === 'object') return JSON.stringify(v)
                              return String(v)
                            }
                            const keys = new Set([...Object.keys(before), ...Object.keys(after)])
                            const rows = Array.from(keys)
                              .filter((k) => toStr(before[k]) !== toStr(after[k]))
                              .map((k) => ({
                                key: k,
                                old:
                                  before[k] != null
                                    ? typeof before[k] === 'object'
                                      ? JSON.stringify(before[k])
                                      : String(before[k])
                                    : '—',
                                new:
                                  after[k] != null
                                    ? typeof after[k] === 'object'
                                      ? JSON.stringify(after[k])
                                      : String(after[k])
                                    : '—',
                              }))
                            const entityLabel = log.entity_type.replace(/_/g, ' ')
                            const userLabel = log.username || log.full_name || '—'
                            const timeLabel = log.timestamp
                              ? new Date(log.timestamp).toLocaleString(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : '—'

                            if (rows.length === 0) return []

                            return rows.map((row, i) => (
                              <tr key={`${log.id}-${row.key}-${i}`} className="border-b last:border-0">
                                {i === 0 ? (
                                  <>
                                    <td className="p-2 align-top" rowSpan={rows.length}>
                                      {userLabel}
                                    </td>
                                    <td className="p-2 align-top whitespace-nowrap" rowSpan={rows.length}>
                                      {timeLabel}
                                    </td>
                                    <td className="p-2 align-top" rowSpan={rows.length}>
                                      {log.action}
                                    </td>
                                    <td className="p-2 align-top" rowSpan={rows.length}>
                                      {entityLabel}
                                    </td>
                                  </>
                                ) : null}
                                <td className="p-2 align-top text-gray-700 whitespace-nowrap">{row.key}</td>
                                <td className="p-2 align-top text-gray-600 max-w-[260px] truncate" title={row.old}>
                                  {row.old}
                                </td>
                                <td className="p-2 align-top max-w-[260px] truncate" title={row.new}>
                                  {row.new}
                                </td>
                              </tr>
                            ))
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <div className="rounded border p-3">
                    <div className="flex items-start gap-2">
                      <textarea
                        className="w-full min-h-[80px] border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                        placeholder="Write a comment for this contract..."
                        value={newRemarkText}
                        onChange={(e) => setNewRemarkText(e.target.value)}
                      />
                      <Button
                        type="button"
                        onClick={saveNewRemark}
                        disabled={newRemarkSaving || !newRemarkText.trim()}
                      >
                        {newRemarkSaving ? 'Saving...' : 'Post'}
                      </Button>
                    </div>

                    <div className="mt-4">
                      {contractRemarksLoading ? (
                        <div className="text-sm text-gray-500 py-4">Loading comments...</div>
                      ) : contractRemarks.length === 0 ? (
                        <div className="text-sm text-gray-500 py-4">No comments yet.</div>
                      ) : (
                        <div className="space-y-3">
                          {contractRemarks.map((r) => (
                            <div key={r.id} className="border rounded p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium">{r.full_name || r.username || '—'}</div>
                                <div className="text-xs text-gray-500 whitespace-nowrap">
                                  {r.created_at
                                    ? new Date(r.created_at).toLocaleString(undefined, {
                                        dateStyle: 'short',
                                        timeStyle: 'short',
                                      })
                                    : '—'}
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words">{r.text}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {stoDetailRow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <Card className="max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <CardHeader className="shrink-0 border-b">
              <div className="flex items-center justify-between">
                <CardTitle>
                  {stoDetailRow.type === 'shipment' ? 'Shipment' : 'Trucking'} details
                  {stoDetailRow.sto_number && stoDetailRow.sto_number !== '-' && ` · STO ${stoDetailRow.sto_number}`}
                  {stoDetailRow.operation_id && ` · ${stoDetailRow.operation_id}`}
                </CardTitle>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close" onClick={closeStoDetail}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              {stoDetailLoading ? (
                <div className="text-sm text-gray-500 py-8">Loading details...</div>
              ) : !stoDetailData ? (
                <div className="text-sm text-gray-500 py-8">No details found for this STO / Operation.</div>
              ) : stoDetailRow.type === 'shipment' ? (
                <div className="space-y-6">
                  <StoDetailSection title="STO Information">
                    <StoDetailField label="STO No" value={String(stoDetailData.sto_number ?? '-')} />
                    <StoDetailField label="Operation ID" value={String(stoDetailData.operation_id ?? '-')} />
                    <StoDetailField label="Status" value={String(stoDetailData.status ?? '-')} />
                    <StoDetailField label="Contract(s)" value={String(stoDetailData.contract_numbers ?? '-')} />
                    <StoDetailField label="Vessel Name" value={String(stoDetailData.vessel_name ?? '-')} />
                    <StoDetailField label="Port of Loading" value={String(stoDetailData.port_of_loading ?? '-')} />
                    <StoDetailField label="Port of Discharge" value={String(stoDetailData.port_of_discharge ?? '-')} />
                    <StoDetailField label="Product" value={String(stoDetailData.product ?? '-')} />
                  </StoDetailSection>

                  <StoDetailSection title="Quantity">
                    <StoDetailField
                      label="STO Quantity (MT)"
                      value={formatQtyMtFromKg(coalesceSapQtyKg(stoDetailData.sto_quantity))}
                    />
                    <StoDetailField
                      label="Quantity Delivery (MT)"
                      value={formatQtyMtFromKg(
                        coalesceSapQtyKg(stoDetailData.quantity_delivered, stoDetailRow.quantity_delivered),
                      )}
                    />
                    <StoDetailField
                      label="Quantity Receive (MT)"
                      value={formatQtyMtFromKg(
                        coalesceSapQtyKg(stoDetailData.quantity_receive, stoDetailRow.quantity_receive),
                      )}
                    />
                  </StoDetailSection>

                  <StoDetailSection title="Important Dates">
                    <StoDetailField
                      label="Due Date Delivery Start"
                      value={formatDate(String(stoDetailData.delivery_start_date ?? ''))}
                    />
                    <StoDetailField
                      label="Due Date Delivery End"
                      value={formatDate(String(stoDetailData.delivery_end_date ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Vessel Completed Loading"
                      value={formatDate(String(stoDetailData.eta_vessel_completed_loading ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Vessel Complete Discharge"
                      value={formatDate(String(stoDetailData.eta_vessel_complete_discharge ?? ''))}
                    />
                    <StoDetailField
                      label="ATA Vessel Completed Loading"
                      value={formatDate(String(stoDetailData.ata_vessel_completed_loading ?? ''))}
                    />
                    <StoDetailField
                      label="ATA Vessel Complete Discharge"
                      value={formatDate(String(stoDetailData.ata_vessel_complete_discharge ?? ''))}
                    />
                  </StoDetailSection>
                </div>
              ) : (
                <div className="space-y-6">
                  <StoDetailSection title="STO Information">
                    <StoDetailField label="STO No" value={String(stoDetailData.sto_number ?? '-')} />
                    <StoDetailField label="Operation ID" value={String(stoDetailData.operation_id ?? '-')} />
                    <StoDetailField label="Status" value={String(stoDetailData.status ?? '-')} />
                    <StoDetailField label="Contract" value={String(stoDetailData.contract_number ?? '-')} />
                    <StoDetailField label="Trucking Owner" value={String(stoDetailData.trucking_owner ?? '-')} />
                    <StoDetailField label="Loading Location" value={String(stoDetailData.loading_location ?? '-')} />
                    <StoDetailField label="Unloading Location" value={String(stoDetailData.unloading_location ?? '-')} />
                    <StoDetailField label="Product" value={String(stoDetailData.product ?? '-')} />
                  </StoDetailSection>

                  <StoDetailSection title="Quantity">
                    <StoDetailField
                      label="Contract Qty (MT)"
                      value={formatQtyMtFromKg(
                        coalesceSapQtyKg(stoDetailData.contract_qty, stoDetailData.sto_quantity),
                      )}
                    />
                    <StoDetailField
                      label="Outstanding Qty (MT)"
                      value={formatOutstandingQtyMtFromKg(
                        coalesceSapQtyKg(stoDetailData.outstanding_quantity, contract?.outstanding_quantity),
                      )}
                    />
                    <StoDetailField
                      label="Quantity Delivery (MT)"
                      value={formatQtyMtFromKg(
                        coalesceSapQtyKg(stoDetailData.quantity_delivered, stoDetailRow.quantity_delivered),
                      )}
                    />
                    <StoDetailField
                      label="Quantity Receive (MT)"
                      value={formatQtyMtFromKg(
                        coalesceSapQtyKg(stoDetailData.quantity_receive, stoDetailRow.quantity_receive),
                      )}
                    />
                  </StoDetailSection>

                  <StoDetailSection title="Important Dates">
                    <StoDetailField
                      label="Due Date Delivery Start"
                      value={formatDate(String(stoDetailData.delivery_start_date ?? ''))}
                    />
                    <StoDetailField
                      label="Due Date Delivery End"
                      value={formatDate(String(stoDetailData.delivery_end_date ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Trucking Start Receive Date"
                      value={formatDate(String(stoDetailData.eta_trucking_start_date ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Trucking Completion Date"
                      value={formatDate(String(stoDetailData.eta_trucking_completion_date ?? ''))}
                    />
                    <StoDetailField
                      label="Trucking Start Receive Date"
                      value={formatDate(String(stoDetailData.trucking_start_date ?? ''))}
                    />
                    <StoDetailField
                      label="Trucking Last Receive Date"
                      value={formatDate(String(stoDetailData.trucking_completion_date ?? ''))}
                    />
                  </StoDetailSection>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ViewShipmentModal
        open={viewShipmentModal != null}
        onClose={() => setViewShipmentModal(null)}
        stacked
        editShipmentId={viewShipmentModal?.shipmentId ?? null}
        editContractId={viewShipmentModal?.editContractId ?? null}
        editStoNumber={viewShipmentModal?.editStoNumber ?? null}
        editContractNumbers={viewShipmentModal?.editContractNumbers ?? null}
        onSubmit={async () => {}}
        onShipmentChanged={() => {
          if (!contract?.id) return
          void api
            .get(`/contracts/${contract.id}/sto-information`)
            .then((res) => {
              if (res.data?.data?.stos) setStoInfo(res.data.data.stos)
            })
            .catch(() => {})
        }}
      />

      <ViewTruckingOperationModal
        open={viewTruckingModal != null}
        onClose={() => setViewTruckingModal(null)}
        stacked
        editTruckingOperationId={viewTruckingModal?.operationId ?? null}
        initialContractId={viewTruckingModal?.contractId ?? null}
        initialContractExtNo={viewTruckingModal?.contractExtNo ?? null}
        initialPoNumber={viewTruckingModal?.poNumber ?? null}
      />

      <AddNewShipmentModal
        open={logisticsOpModal?.kind === 'shipment'}
        stacked
        mode={
          logisticsOpModal?.kind === 'shipment' &&
          (logisticsOpModal.mode === 'edit' || logisticsOpModal.mode === 'view')
            ? 'edit'
            : 'add'
        }
        readOnly={logisticsOpModal?.kind === 'shipment' && logisticsOpModal.mode === 'view'}
        plotShipmentId={
          logisticsOpModal?.kind === 'shipment' && logisticsOpModal.mode === 'plot'
            ? logisticsOpModal.shipmentId
            : null
        }
        editShipmentId={
          logisticsOpModal?.kind === 'shipment' &&
          (logisticsOpModal.mode === 'edit' || logisticsOpModal.mode === 'view')
            ? logisticsOpModal.shipmentId
            : null
        }
        editContractId={
          logisticsOpModal?.kind === 'shipment'
            ? String(contract?.contract_id || '').trim() || null
            : null
        }
        editStoNumber={
          logisticsOpModal?.kind === 'shipment' ? logisticsOpModal.stoNumber : null
        }
        editContractNumbers={
          logisticsOpModal?.kind === 'shipment' ? logisticsOpModal.contractNumbers : null
        }
        prefilledStoNumber={
          logisticsOpModal?.kind === 'shipment' &&
          (logisticsOpModal.mode === 'add' || logisticsOpModal.mode === 'plot')
            ? logisticsOpModal.stoNumber
            : null
        }
        prefilledContractNumbers={
          logisticsOpModal?.kind === 'shipment' && logisticsOpModal.contractNumbers
            ? [logisticsOpModal.contractNumbers]
            : null
        }
        prefilledPOs={
          logisticsOpModal?.kind === 'shipment' ? logisticsOpModal.prefilledPOs : null
        }
        onClose={() => setLogisticsOpModal(null)}
        onSubmit={async (payload) => {
          if (logisticsOpModal?.kind === 'shipment' && logisticsOpModal.mode === 'view') return
          await submitAddNewShipmentPayload(payload)
          setLogisticsOpModal(null)
          if (contract?.id) {
            try {
              const res = await api.get(`/contracts/${contract.id}/sto-information`)
              if (res.data?.success && Array.isArray(res.data.data?.stos)) {
                setStoInfo(res.data.data.stos)
                if (res.data.data.summary) {
                  setStoQtySummary({
                    sto_count: Number(res.data.data.summary.sto_count ?? 0),
                    total_sto_quantity: Number(res.data.data.summary.total_sto_quantity ?? 0),
                  })
                }
              }
            } catch {
              /* keep existing rows */
            }
          }
        }}
      />

      <CreateTruckingOperationModal
        open={logisticsOpModal?.kind === 'trucking'}
        stacked
        mode={
          logisticsOpModal?.kind === 'trucking' &&
          (logisticsOpModal.mode === 'edit' || logisticsOpModal.mode === 'view')
            ? 'edit'
            : 'add'
        }
        readOnly={logisticsOpModal?.kind === 'trucking' && logisticsOpModal.mode === 'view'}
        plotOperationId={
          logisticsOpModal?.kind === 'trucking' && logisticsOpModal.mode === 'plot'
            ? logisticsOpModal.operationId
            : null
        }
        editTruckingOperationId={
          logisticsOpModal?.kind === 'trucking' &&
          (logisticsOpModal.mode === 'edit' || logisticsOpModal.mode === 'view')
            ? logisticsOpModal.operationId
            : null
        }
        initialContractId={
          logisticsOpModal?.kind === 'trucking' ? logisticsOpModal.contractId : null
        }
        initialContractExtNo={
          logisticsOpModal?.kind === 'trucking' ? logisticsOpModal.contractExtNo : null
        }
        initialPoNumber={
          logisticsOpModal?.kind === 'trucking' ? logisticsOpModal.poNumber : null
        }
        onClose={() => setLogisticsOpModal(null)}
        onCreated={() => {
          setLogisticsOpModal(null)
          if (contract?.id) {
            void api
              .get(`/contracts/${contract.id}/sto-information`)
              .then((res) => {
                if (res.data?.success && Array.isArray(res.data.data?.stos)) {
                  setStoInfo(res.data.data.stos)
                  if (res.data.data.summary) {
                    setStoQtySummary({
                      sto_count: Number(res.data.data.summary.sto_count ?? 0),
                      total_sto_quantity: Number(res.data.data.summary.total_sto_quantity ?? 0),
                    })
                  }
                }
              })
              .catch(() => {})
          }
        }}
      />
    </>
  )
}
