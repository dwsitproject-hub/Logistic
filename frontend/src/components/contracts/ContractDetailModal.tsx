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
import { formatDateDMY } from '@/lib/dateFormat'
import { canViewPermission, usePermissions } from '@/components/PermissionsContext'

const CONTRACT_PAYMENT_INFO_PERMISSION = 'data.contract_payment_info'

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
  due_date_payment?: string
  dp_date?: string
  payoff_date?: string
  dp_date_deviation_days?: number
  payoff_date_deviation_days?: number
  contract_ext_no?: string
  cargo_readiness_date?: string
  over_under_delivery_status?: string
  log_cycle_days?: number | null
  trade_cycle_days?: number | null
  cash_cycle_days?: number | null
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
  eta_trucking_completion_date?: string | null
  ata_discharge_complete?: string | null
  trucking_completion_date?: string | null
}

export type B2bPartyRow = {
  contract_id: string
  contract_date?: string | null
  po_numbers?: string | null
  contract_ext_no?: string | null
  company_name?: string | null
  supplier?: string | null
  incoterm?: string | null
  certification?: string | null
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
    case 'Completed':
    case 'COMPLETED':
      return 'bg-blue-100 text-blue-800'
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

function getContractOverallStatus(
  c: Pick<ContractDetailModalContract, 'import_status' | 'status' | 'payment_status'>,
): string {
  const delivery = String(c.import_status || c.status || '').toUpperCase()
  const paid = String(c.payment_status || '').toUpperCase() === 'PAID'
  return delivery === 'CLOSE' && paid ? 'Close' : (c.import_status || c.status || '-')
}

function ContractStatusBadge({ status }: { status: string }) {
  return <Badge className={getStatusColor(status)}>{status}</Badge>
}

/**
 * B2B contracts: show Buyer in Parties the same as Company Name (display-only).
 */
export function partiesBuyerDisplay(
  c: Pick<ContractDetailModalContract, 'buyer' | 'company_name' | 'b2b_flag' | 'contract_type'>,
): string {
  const isB2b = isContractB2b(c)
  if (isB2b) {
    const company = String(c.company_name || '').trim()
    const buyer = String(c.buyer || '').trim()
    return company || buyer || '-'
  }
  return String(c.buyer || '').trim() || '-'
}

function formatDate(dateStr: string | null | undefined) {
  return formatDateDMY(dateStr)
}

function formatCurrency(amount: number | string, currency: string = 'USD') {
  if (amount === null || amount === undefined || amount === '') return '-'
  const number = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(number)) return '-'
  return formatRupiah(number)
}

function formatMonthDeliveryEnd(dateStr: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '-'
  const mon = d.toLocaleString('en-US', { month: 'short' })
  return `${mon}-${d.getFullYear()}`
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

function StoDetailField({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="p-3 bg-gray-50 rounded">
      <div className="text-gray-500">{label}</div>
      <div className="font-medium mt-1">{value}</div>
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

export function ContractDetailModal({
  contract,
  onClose,
  showMonthDeliveryEnd = false,
  documentsRefreshKey = 0,
}: {
  contract: ContractDetailModalContract | null
  onClose: () => void
  showMonthDeliveryEnd?: boolean
  /** Increment to refetch documents while the modal stays open (e.g. after table upload). */
  documentsRefreshKey?: number
}) {
  const perms = usePermissions()
  const canViewContractPaymentInfo = canViewPermission(perms, CONTRACT_PAYMENT_INFO_PERMISSION)

  const [docsLoading, setDocsLoading] = useState(false)
  const [selectedContractDocs, setSelectedContractDocs] = useState<DocumentItem[]>([])
  const [stoInfoLoading, setStoInfoLoading] = useState(false)
  const [stoInfo, setStoInfo] = useState<StoInfoRow[]>([])
  const [stoDetailRow, setStoDetailRow] = useState<StoInfoRow | null>(null)
  const [stoDetailData, setStoDetailData] = useState<Record<string, unknown> | null>(null)
  const [stoDetailLoading, setStoDetailLoading] = useState(false)
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
  const [b2bParties, setB2bParties] = useState<B2bPartyRow[]>([])
  const [b2bPartiesLoading, setB2bPartiesLoading] = useState(false)

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
      return
    }
    let cancelled = false
    setStoInfoLoading(true)
    setStoInfo([])
    api
      .get(`/contracts/${contract.id}/sto-information`)
      .then((res) => {
        if (cancelled || !res.data?.data?.stos) return
        setStoInfo(res.data.data.stos)
      })
      .catch(() => {
        if (!cancelled) setStoInfo([])
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
      setContractRemarks(Array.isArray(res.data?.data) ? res.data.data : [])
    } finally {
      setNewRemarkSaving(false)
    }
  }, [newRemarkText, contract?.id])

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

  const openStoDetail = useCallback(
    (row: StoInfoRow) => {
      if (!contract?.id) return
      const sto = String(row.sto_number ?? '').trim()
      const operationId = String(row.operation_id ?? '').trim()
      if ((!sto || sto === '-') && (!operationId || operationId === '-')) return

      setStoDetailRow(row)
      setStoDetailData(null)
      setStoDetailLoading(true)
      api
        .get(`/contracts/${contract.id}/logistics-sto-detail`, {
          params: {
            type: row.type,
            ...(sto && sto !== '-' ? { sto } : {}),
            ...(operationId && operationId !== '-' ? { operation_id: operationId } : {}),
          },
        })
        .then((res) => {
          setStoDetailData(res.data?.data ?? null)
        })
        .catch(() => setStoDetailData(null))
        .finally(() => setStoDetailLoading(false))
    },
    [contract?.id],
  )

  const closeStoDetail = useCallback(() => {
    setStoDetailRow(null)
    setStoDetailData(null)
    setStoDetailLoading(false)
  }, [])

  if (!contract) return null

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
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
              <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/80 p-4 shadow-sm">
                <h3 className="text-base font-semibold text-amber-900 mb-3 tracking-tight">Highlight Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Contract</div>
                    <div className="font-semibold text-gray-900 mt-0.5 truncate" title={contract.contract_id || ''}>
                      {contract.contract_id || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Contract Ext No</div>
                    <div className="font-semibold text-gray-900 mt-0.5 break-words whitespace-normal">
                      {contract.contract_ext_no || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">
                      PO Number{contract.po_count && contract.po_count > 1 ? ` (${contract.po_count})` : ''}
                    </div>
                    <div className="font-semibold text-gray-900 mt-0.5 text-xs leading-snug break-words">
                      {contract.po_numbers || contract.po_number || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Contract Qty</div>
                    <div className="font-semibold text-gray-900 mt-0.5">{formatQtyMtFromKg(contract.quantity_ordered)}</div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Incoterm</div>
                    <div className="font-semibold text-gray-900 mt-0.5">{contract.incoterm || '-'}</div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-white/90 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800/80">Product</div>
                    <div className="font-semibold text-gray-900 mt-0.5 break-words">{contract.product || '-'}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Status</div>
                    <div className="mt-1">
                      <ContractStatusBadge status={getContractOverallStatus(contract)} />
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Unusual Flag</div>
                    <div className="mt-1">
                      {(() => {
                        const isUnusual =
                          (contract.log_cycle_days != null && contract.log_cycle_days >= 35) ||
                          (contract.trade_cycle_days != null && contract.trade_cycle_days >= 35) ||
                          (contract.cash_cycle_days != null && contract.cash_cycle_days >= 35)
                        return isUnusual ? (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Unusual</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">Normal</Badge>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Delivery Status</div>
                    <div className="mt-1">
                      <ContractStatusBadge status={contract.import_status || contract.status || '-'} />
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract Ext No</div>
                    <div className="font-medium mt-1 break-words whitespace-normal">{contract.contract_ext_no || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Source Type</div>
                    <div className="font-medium mt-1">{contract.source_type || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract Type</div>
                    <div className="font-medium mt-1">{contract.contract_type || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Group Name</div>
                    <div className="font-medium mt-1">{contract.group_name || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Company Name
                      <FieldHelp text={FIELD_HELP.companyName} />
                    </div>
                    <div className="font-medium mt-1">{contract.company_name || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">B2B Flag</div>
                    <div className="font-medium mt-1">{contract.b2b_flag || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">LT/SPOT</div>
                    <div className="font-medium mt-1">{contract.lt_spot || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Log Cycle
                      <FieldHelp text={FIELD_HELP.logCycle} />
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
                      <FieldHelp text={FIELD_HELP.tradeCycle} />
                    </div>
                    <div className={cn('font-medium mt-1', signedCycleDaysClass(contract.trade_cycle_days))}>
                      {formatSignedCycleDays(contract.trade_cycle_days)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Cash Cycle
                      <FieldHelp text={FIELD_HELP.cashCycle} />
                    </div>
                    <div className={cn('font-medium mt-1', signedCycleDaysClass(contract.cash_cycle_days))}>
                      {formatSignedCycleDays(contract.cash_cycle_days)}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded col-span-2">
                    <div className="text-gray-500">
                      PO Number{contract.po_count > 1 ? `s (${contract.po_count} total)` : ''}
                    </div>
                    <div className="font-medium mt-1 text-xs">{contract.po_numbers || contract.po_number || '-'}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Parties</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Buyer</div>
                    <div className="font-medium mt-1">{partiesBuyerDisplay(contract)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Supplier</div>
                    <div className="font-medium mt-1">{contract.supplier}</div>
                  </div>
                </div>
              </div>

              {isContractB2b(contract) && String(contract.contract_reference_po || '').trim() === '' && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    B2B Parties
                    <FieldHelp text={FIELD_HELP.b2bParties} />
                  </h3>
                  {b2bPartiesLoading ? (
                    <div className="text-sm text-gray-500">Loading B2B parties...</div>
                  ) : b2bParties.length === 0 ? (
                    <div className="text-sm text-gray-500">No B2B contracts linked to this origin contract.</div>
                  ) : (
                    <div className="overflow-x-auto border rounded">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-100 border-b">
                            <th className="text-left p-2 font-medium">PO Number</th>
                            <th className="text-left p-2 font-medium">Contract Ext No</th>
                            <th className="text-left p-2 font-medium">Company Name</th>
                            <th className="text-left p-2 font-medium">Supplier</th>
                            <th className="text-left p-2 font-medium">Incoterm</th>
                            <th className="text-left p-2 font-medium">Certification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b2bParties.map((r) => (
                            <tr key={r.contract_id} className="border-b last:border-0">
                              <td className="p-2">{r.po_numbers || '-'}</td>
                              <td className="p-2">{r.contract_ext_no || '-'}</td>
                              <td className="p-2">{r.company_name || '-'}</td>
                              <td className="p-2">{r.supplier || '-'}</td>
                              <td className="p-2">{r.incoterm || '-'}</td>
                              <td className="p-2">{r.certification || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold mb-3">Product & Quantity</h3>
                {(() => {
                  const inc = String(contract.incoterm || '').trim().toUpperCase()
                  const basis =
                    inc === 'FRC' || inc === 'CIF' || inc === 'CFR'
                      ? { label: 'Quantity Receive', hint: 'Incoterm FRC/CIF/CFR' }
                      : inc === 'LCO' || inc === 'FOB'
                        ? { label: 'Quantity Delivery', hint: 'Incoterm LCO/FOB' }
                        : { label: 'STO Quantity', hint: 'Fallback (other incoterms)' }
                  return (
                    <div className="text-xs text-gray-600 mb-2">
                      Outstanding Quantity basis: <span className="font-medium text-gray-800">{basis.label}</span>{' '}
                      <span className="text-gray-500">({basis.hint})</span>
                    </div>
                  )
                })()}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Product</div>
                    <div className="font-medium mt-1">{contract.product}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Contract Quantity</div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.quantity_ordered)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Quantity Delivery</div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.quantity_delivery ?? 0)}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Quantity Receive</div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.quantity_receive ?? 0)}</div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded border-2 border-blue-200">
                    <div className="text-gray-500">
                      Total STO Quantity ({contract.sto_count || 0} STO{contract.sto_count > 1 ? 's' : ''})
                    </div>
                    <div className="font-medium mt-1 text-base">{formatQtyMtFromKg(contract.total_sto_quantity)}</div>
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
                      <FieldHelp text={FIELD_HELP.outstandingQty} />
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
                    {contract.outstanding_quantity < 0 && <div className="text-xs text-green-600 mt-1">Over Delivered</div>}
                    {contract.outstanding_quantity > 0 && <div className="text-xs text-red-500 mt-1">Incomplete</div>}
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500 flex items-center gap-1">
                      Over/Under Delivery Status
                      <FieldHelp text={FIELD_HELP.overUnderDelivery} />
                    </div>
                    <div className="font-semibold mt-1">{contract.over_under_delivery_status || '-'}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Logistic Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Transport Mode</div>
                    <div className="font-medium mt-1">{contract.transport_mode || '-'}</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Incoterm</div>
                    <div className="font-medium mt-1">{contract.incoterm || '-'}</div>
                  </div>
                </div>
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
                          <th className="text-left p-2 font-medium">STO Quantity (MT)</th>
                          <th className="text-left p-2 font-medium">Quantity Delivered (MT)</th>
                          <th className="text-left p-2 font-medium">Quantity Received (MT)</th>
                          <th className="text-left p-2 font-medium">Vessel Name / Trucking Owner</th>
                          <th className="text-left p-2 font-medium">
                            ETA Vessel Arrival at Loading Port / ETA Trucking Completion Date
                          </th>
                          <th className="text-left p-2 font-medium">
                            ATA Vessel Complete Discharge / Trucking Last Receive Date
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stoInfo.map((row, idx) => (
                          <tr key={`${row.type}-${row.sto_number}-${idx}`} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="p-2">
                              <button
                                type="button"
                                onClick={() => openStoDetail(row)}
                                className="text-left text-blue-600 hover:underline font-medium cursor-pointer"
                              >
                                {row.sto_number || '-'}
                              </button>
                            </td>
                            <td className="p-2">
                              <button
                                type="button"
                                onClick={() => openStoDetail(row)}
                                className="text-left text-blue-600 hover:underline font-medium cursor-pointer"
                              >
                                {row.operation_id ?? '-'}
                              </button>
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
                            <td className="p-2">{row.status}</td>
                            <td className="p-2">{formatQtyMtFromKg(row.sto_quantity)}</td>
                            <td className="p-2">{formatQtyMtFromKg(row.quantity_delivered ?? 0)}</td>
                            <td className="p-2">{formatQtyMtFromKg(row.quantity_receive ?? 0)}</td>
                            <td className="p-2">
                              {row.type === 'shipment' ? (row.vessel_name ?? '-') : (row.trucking_owner ?? '-')}
                            </td>
                            <td className="p-2">
                              {row.type === 'shipment'
                                ? row.eta_vessel_arrival_loading_port
                                  ? formatDate(row.eta_vessel_arrival_loading_port)
                                  : '-'
                                : row.eta_trucking_completion_date
                                  ? formatDate(row.eta_trucking_completion_date)
                                  : '-'}
                            </td>
                            <td className="p-2">
                              {row.type === 'shipment'
                                ? row.ata_discharge_complete
                                  ? formatDate(row.ata_discharge_complete)
                                  : '-'
                                : row.trucking_completion_date
                                  ? formatDate(row.trucking_completion_date)
                                  : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Important Dates</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
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
                  {showMonthDeliveryEnd && (
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Month Delivery End</div>
                      <div className="font-medium mt-1">{formatMonthDeliveryEnd(contract.delivery_end_date)}</div>
                    </div>
                  )}
                  <div className="p-3 bg-gray-50 rounded">
                    <div className="text-gray-500">Cargo Readiness Date</div>
                    <div className="font-medium mt-1">{formatDate(contract.cargo_readiness_date)}</div>
                  </div>
                </div>
              </div>

              {canViewContractPaymentInfo && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Payment Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Unit Price</div>
                      <div className="font-medium mt-1">{formatCurrency(contract.unit_price, contract.currency)}</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Contract Value</div>
                      <div className="font-medium mt-1">{formatCurrency(contract.contract_value, contract.currency)}</div>
                    </div>
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
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">DP Date Deviation (Days)</div>
                      <div className="font-medium mt-1">{contract.dp_date_deviation_days ?? '-'}</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Payoff Date Deviation (Days)</div>
                      <div className="font-medium mt-1">{contract.payoff_date_deviation_days ?? '-'}</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded">
                      <div className="text-gray-500">Payment Status</div>
                      <div className="font-medium mt-1">
                        {contractPaymentsLoading ? (
                          <span className="text-gray-400">Loading...</span>
                        ) : contractPayments.length === 0 ? (
                          '-'
                        ) : (
                          contractPayments
                            .map((p) => p.payment_status)
                            .filter(Boolean)
                            .join(', ') || '-'
                        )}
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
                      value={formatQtyMtFromKg(Number(stoDetailData.sto_quantity ?? 0))}
                    />
                    <StoDetailField
                      label="Quantity Delivered (MT)"
                      value={formatQtyMtFromKg(Number(stoDetailData.quantity_delivered ?? 0))}
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
                      label="ATA Vessel Completed Loading"
                      value={formatDate(String(stoDetailData.ata_vessel_completed_loading ?? ''))}
                    />
                    <StoDetailField
                      label="ATA Vessel Complete Discharge"
                      value={formatDate(String(stoDetailData.ata_vessel_complete_discharge ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Vessel Complete Discharge"
                      value={formatDate(String(stoDetailData.eta_vessel_complete_discharge ?? ''))}
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
                      value={formatQtyMtFromKg(Number(stoDetailData.contract_qty ?? stoDetailData.sto_quantity ?? 0))}
                    />
                    <StoDetailField
                      label="Quantity Receive (MT)"
                      value={formatQtyMtFromKg(Number(stoDetailData.quantity_delivered ?? 0))}
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
                      label="Trucking Start Receive Date"
                      value={formatDate(String(stoDetailData.trucking_start_date ?? ''))}
                    />
                    <StoDetailField
                      label="Trucking Last Receive Date"
                      value={formatDate(String(stoDetailData.trucking_completion_date ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Trucking Start Receive Date"
                      value={formatDate(String(stoDetailData.eta_trucking_start_date ?? ''))}
                    />
                    <StoDetailField
                      label="ETA Trucking Completion Date"
                      value={formatDate(String(stoDetailData.eta_trucking_completion_date ?? ''))}
                    />
                  </StoDetailSection>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
