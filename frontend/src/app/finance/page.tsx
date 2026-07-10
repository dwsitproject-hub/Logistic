'use client'

import { useEffect, useRef, useState } from 'react'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ArrowDown, ArrowUp, Filter, Loader2, RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import { formatRupiah } from '@/lib/utils'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'

type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'

interface Payment {
  id: string
  invoice_number: string
  invoice_date: string | null
  payment_amount: number | null
  currency: string | null
  payment_due_date: string | null
  payment_date: string | null
  payment_status: PaymentStatus
  payment_method: string | null
  bank_reference: string | null
  contract_id: string | null
  supplier: string | null
  product: string | null
  created_at: string
  due_date_payment?: string | null
  dp_date?: string | null
  payoff_date?: string | null
  dp_date_deviation_days?: number | null
  payoff_date_deviation_days?: number | null
}

interface FinanceSummary {
  totals: {
    totalRecords: number
    totalAmount: number | null
    pendingAmount: number | null
    partialAmount: number | null
    paidAmount: number | null
    overdueAmount: number | null
  }
  byStatus: Array<{
    status: PaymentStatus | string
    count: number
    amount: number | null
  }>
  byMonth: Array<{
    month: string
    dueAmount: number | null
    paidAmount: number | null
  }>
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PARTIAL: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
}

const formatAmount = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-'
  return formatRupiah(value)
}

const formatDate = (value: string | null) => formatDateDMY(value || '')

export default function FinancePage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [page, setPage] = useState<number>(1)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [totalRecords, setTotalRecords] = useState<number>(0)
  const [sortKey, setSortKey] = useState<string>('due_date_payment')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [openHeaderFilterId, setOpenHeaderFilterId] = useState<string | null>(null)
  const headerFilterPopoverRef = useRef<HTMLDivElement | null>(null)
  const [colFilters, setColFilters] = useState<{
    invoice_number?: string
    contract_id?: string
    supplier?: string
    product?: string
    currency?: string
    due_from?: string
    due_to?: string
    dp_from?: string
    dp_to?: string
    payoff_from?: string
    payoff_to?: string
  }>({})

  const fetchSummary = async () => {
    try {
      const response = await api.get('/finance/summary')
      setSummary(response.data.data)
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load finance summary')
    }
  }

  const fetchPayments = async (filters?: { status?: string; search?: string }) => {
    const params: Record<string, string> = {}
    if (filters?.status && filters.status !== 'all') {
      params.status = filters.status
    }
    if (filters?.search) {
      params.search = filters.search
    }
    params.page = String(page)
    params.limit = '100'
    params.sortKey = sortKey
    params.sortDir = sortDir
    if (colFilters.invoice_number) params.invoice_number = colFilters.invoice_number
    if (colFilters.contract_id) params.contract_id = colFilters.contract_id
    if (colFilters.supplier) params.supplier = colFilters.supplier
    if (colFilters.product) params.product = colFilters.product
    if (colFilters.currency) params.currency = colFilters.currency
    if (colFilters.due_from) params.due_from = colFilters.due_from
    if (colFilters.due_to) params.due_to = colFilters.due_to
    if (colFilters.dp_from) params.dp_from = colFilters.dp_from
    if (colFilters.dp_to) params.dp_to = colFilters.dp_to
    if (colFilters.payoff_from) params.payoff_from = colFilters.payoff_from
    if (colFilters.payoff_to) params.payoff_to = colFilters.payoff_to

    const response = await api.get('/finance/payments', { params })
    setPayments(response.data.data || [])
    setTotalPages(response.data.pagination?.totalPages || 1)
    setTotalRecords(response.data.pagination?.total || 0)
  }

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([fetchSummary(), fetchPayments({ status: statusFilter, search: searchTerm })])
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load finance data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      fetchPayments({ status: statusFilter, search: searchTerm }).catch((err: any) => {
        if (err?.name !== 'CanceledError') {
          setError(err.response?.data?.error?.message || 'Failed to load payments')
        }
      })
    }, 350)

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [statusFilter, searchTerm])

  useEffect(() => {
    fetchPayments({ status: statusFilter, search: searchTerm }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortKey, sortDir, colFilters])

  useEffect(() => {
    if (!openHeaderFilterId) return
    const onDocMouseDown = (ev: MouseEvent) => {
      const el = headerFilterPopoverRef.current
      if (!el) return
      if (ev.target instanceof Node && !el.contains(ev.target)) {
        setOpenHeaderFilterId(null)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [openHeaderFilterId])

  useEffect(() => {
    if (!openHeaderFilterId) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpenHeaderFilterId(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openHeaderFilterId])

  const handleRefresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      await Promise.all([fetchSummary(), fetchPayments({ status: statusFilter, search: searchTerm })])
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to refresh finance data')
    } finally {
      setRefreshing(false)
    }
  }

  const onSortHeaderClick = (key: string, initialDir: 'asc' | 'desc' = 'asc') => {
    setPage(1)
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(initialDir)
    }
  }

  const isColumnFilterActive = (colId: string) => {
    switch (colId) {
      case 'invoice_number': return Boolean(colFilters.invoice_number)
      case 'contract_id': return Boolean(colFilters.contract_id)
      case 'supplier': return Boolean(colFilters.supplier)
      case 'due_date_payment': return Boolean(colFilters.due_from || colFilters.due_to)
      case 'dp_date': return Boolean(colFilters.dp_from || colFilters.dp_to)
      case 'payoff_date': return Boolean(colFilters.payoff_from || colFilters.payoff_to)
      default: return false
    }
  }

  const handleUpdatePayment = async (
    id: string,
    updates: Partial<Pick<Payment, 'payment_method'>>
  ) => {
    if (updates.payment_method === undefined) return
    try {
      setSavingId(id)
      await api.patch(`/finance/payments/${id}`, updates)
      setPayments((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
      )
      // Refresh summary so dashboard numbers stay accurate
      void fetchSummary()
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to update payment')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Finance</h1>
            <p className="text-gray-600 mt-2">Payment status and financial tracking</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <Card>
            <CardContent className="py-16 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              <span className="ml-3 text-gray-500">Loading finance data...</span>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base leading-tight">
                    Total Payments
                    <FieldHelp text={FIELD_HELP.financeTotalAmount} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-h-[112px]">
                  <div className="text-2xl lg:text-3xl leading-tight font-semibold text-gray-900 break-words">
                    {formatAmount(summary?.totals.totalAmount || 0)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">{summary?.totals.totalRecords || 0} records</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base leading-tight">
                    Pending Amount
                    <FieldHelp text={FIELD_HELP.financePendingAmount} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-h-[112px]">
                  <div className="text-2xl lg:text-3xl leading-tight font-semibold text-yellow-600 break-words">
                    {formatAmount(summary?.totals.pendingAmount || 0)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Awaiting payment confirmation</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base leading-tight">
                    Paid Amount
                    <FieldHelp text={FIELD_HELP.financePaidAmount} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-h-[112px]">
                  <div className="text-2xl lg:text-3xl leading-tight font-semibold text-green-600 break-words">
                    {formatAmount(summary?.totals.paidAmount || 0)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Completed payments</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base leading-tight">
                    Overdue Amount
                    <FieldHelp text={FIELD_HELP.financeOverdueAmount} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-h-[112px]">
                  <div className="text-2xl lg:text-3xl leading-tight font-semibold text-red-600 break-words">
                    {formatAmount(summary?.totals.overdueAmount || 0)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Require immediate attention</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <Input
                        placeholder="Search by invoice, contract, or supplier"
                        value={searchTerm}
                        onChange={(e) => { setPage(1); setSearchTerm(e.target.value) }}
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v) }}>
                      <SelectTrigger className="md:w-48">
                        <SelectValue placeholder="Payment status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="PENDING">Pending</SelectItem>
                        <SelectItem value="PARTIAL">Partial</SelectItem>
                        <SelectItem value="PAID">Paid</SelectItem>
                        <SelectItem value="OVERDUE">Overdue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                  <div className="text-sm text-gray-600">
                    Showing <span className="font-medium text-gray-900">{payments.length}</span> rows on page{' '}
                    <span className="font-medium text-gray-900">{page}</span> of{' '}
                    <span className="font-medium text-gray-900">{totalPages}</span> pages ·{' '}
                    <span className="font-medium text-gray-900">{totalRecords.toLocaleString()}</span> total records
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      Prev
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                    <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="relative">
                          <div className="flex items-center gap-1">
                            <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('invoice_number')}>
                              Invoice
                              {sortKey === 'invoice_number' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </button>
                            <button type="button" className={`p-1 rounded hover:bg-gray-100 ${isColumnFilterActive('invoice_number') ? 'text-blue-700' : 'text-gray-500'}`} onClick={() => setOpenHeaderFilterId((p) => (p === 'invoice_number' ? null : 'invoice_number'))}>
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {openHeaderFilterId === 'invoice_number' && (
                            <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
                              <Input className="h-8" placeholder="Filter invoice..." value={colFilters.invoice_number || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, invoice_number: e.target.value || undefined })) }} />
                              <div className="mt-2 flex items-center justify-between">
                                <Button size="sm" variant="ghost" onClick={() => { setPage(1); setColFilters((p) => ({ ...p, invoice_number: undefined })) }}>Clear</Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenHeaderFilterId(null)}>Close</Button>
                              </div>
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="relative">
                          <div className="flex items-center gap-1">
                            <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('contract_id')}>
                              Contract
                              {sortKey === 'contract_id' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </button>
                            <button type="button" className={`p-1 rounded hover:bg-gray-100 ${isColumnFilterActive('contract_id') ? 'text-blue-700' : 'text-gray-500'}`} onClick={() => setOpenHeaderFilterId((p) => (p === 'contract_id' ? null : 'contract_id'))}>
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {openHeaderFilterId === 'contract_id' && (
                            <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
                              <Input className="h-8" placeholder="Filter contract..." value={colFilters.contract_id || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, contract_id: e.target.value || undefined })) }} />
                              <div className="mt-2 flex items-center justify-between">
                                <Button size="sm" variant="ghost" onClick={() => { setPage(1); setColFilters((p) => ({ ...p, contract_id: undefined })) }}>Clear</Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenHeaderFilterId(null)}>Close</Button>
                              </div>
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="relative">
                          <div className="flex items-center gap-1">
                            <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('supplier')}>
                              Supplier
                              {sortKey === 'supplier' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </button>
                            <button type="button" className={`p-1 rounded hover:bg-gray-100 ${isColumnFilterActive('supplier') ? 'text-blue-700' : 'text-gray-500'}`} onClick={() => setOpenHeaderFilterId((p) => (p === 'supplier' ? null : 'supplier'))}>
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {openHeaderFilterId === 'supplier' && (
                            <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[240px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
                              <Input className="h-8" placeholder="Filter supplier..." value={colFilters.supplier || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, supplier: e.target.value || undefined })) }} />
                              <div className="mt-2 flex items-center justify-between">
                                <Button size="sm" variant="ghost" onClick={() => { setPage(1); setColFilters((p) => ({ ...p, supplier: undefined })) }}>Clear</Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenHeaderFilterId(null)}>Close</Button>
                              </div>
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="text-right">
                          <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('payment_amount', 'desc')}>
                            Amount
                            {sortKey === 'payment_amount' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </button>
                        </TableHead>
                        <TableHead className="relative whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('due_date_payment')}>
                              Due Date Payment
                              {sortKey === 'due_date_payment' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </button>
                            <FieldHelp text={FIELD_HELP.dueDatePayment} />
                            <button type="button" className={`p-1 rounded hover:bg-gray-100 ${isColumnFilterActive('due_date_payment') ? 'text-blue-700' : 'text-gray-500'}`} onClick={() => setOpenHeaderFilterId((p) => (p === 'due_date_payment' ? null : 'due_date_payment'))}>
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {openHeaderFilterId === 'due_date_payment' && (
                            <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
                              <div className="grid grid-cols-2 gap-2">
                                <Input className="h-8" type="date" value={colFilters.due_from || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, due_from: e.target.value || undefined })) }} />
                                <Input className="h-8" type="date" value={colFilters.due_to || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, due_to: e.target.value || undefined })) }} />
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <Button size="sm" variant="ghost" onClick={() => { setPage(1); setColFilters((p) => ({ ...p, due_from: undefined, due_to: undefined })) }}>Clear</Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenHeaderFilterId(null)}>Close</Button>
                              </div>
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="relative whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('dp_date')}>
                              DP Date
                              {sortKey === 'dp_date' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </button>
                            <FieldHelp text={FIELD_HELP.dpDate} />
                            <button type="button" className={`p-1 rounded hover:bg-gray-100 ${isColumnFilterActive('dp_date') ? 'text-blue-700' : 'text-gray-500'}`} onClick={() => setOpenHeaderFilterId((p) => (p === 'dp_date' ? null : 'dp_date'))}>
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {openHeaderFilterId === 'dp_date' && (
                            <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
                              <div className="grid grid-cols-2 gap-2">
                                <Input className="h-8" type="date" value={colFilters.dp_from || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, dp_from: e.target.value || undefined })) }} />
                                <Input className="h-8" type="date" value={colFilters.dp_to || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, dp_to: e.target.value || undefined })) }} />
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <Button size="sm" variant="ghost" onClick={() => { setPage(1); setColFilters((p) => ({ ...p, dp_from: undefined, dp_to: undefined })) }}>Clear</Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenHeaderFilterId(null)}>Close</Button>
                              </div>
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="relative whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('payoff_date')}>
                              Payoff Date
                              {sortKey === 'payoff_date' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                            </button>
                            <FieldHelp text={FIELD_HELP.payoffDate} />
                            <button type="button" className={`p-1 rounded hover:bg-gray-100 ${isColumnFilterActive('payoff_date') ? 'text-blue-700' : 'text-gray-500'}`} onClick={() => setOpenHeaderFilterId((p) => (p === 'payoff_date' ? null : 'payoff_date'))}>
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {openHeaderFilterId === 'payoff_date' && (
                            <div ref={headerFilterPopoverRef} className="absolute left-0 top-full mt-2 w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-30">
                              <div className="grid grid-cols-2 gap-2">
                                <Input className="h-8" type="date" value={colFilters.payoff_from || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, payoff_from: e.target.value || undefined })) }} />
                                <Input className="h-8" type="date" value={colFilters.payoff_to || ''} onChange={(e) => { setPage(1); setColFilters((p) => ({ ...p, payoff_to: e.target.value || undefined })) }} />
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <Button size="sm" variant="ghost" onClick={() => { setPage(1); setColFilters((p) => ({ ...p, payoff_from: undefined, payoff_to: undefined })) }}>Clear</Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenHeaderFilterId(null)}>Close</Button>
                              </div>
                            </div>
                          )}
                        </TableHead>
                        <TableHead className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            DP Dev. (Days)
                            <FieldHelp text={FIELD_HELP.dpDeviationDays} />
                          </span>
                        </TableHead>
                        <TableHead className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            Payoff Dev. (Days)
                            <FieldHelp text={FIELD_HELP.payoffDeviationDays} />
                          </span>
                        </TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead>
                          <button type="button" className="inline-flex items-center gap-1 text-left font-medium hover:text-gray-900" onClick={() => onSortHeaderClick('payment_status')}>
                            Status
                            {sortKey === 'payment_status' ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                          </button>
                        </TableHead>
                        <TableHead>Method</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} className="py-10 text-center text-gray-500">
                            No payments found for the selected filters
                          </TableCell>
                        </TableRow>
                      ) : (
                        payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>
                              <div className="font-medium text-gray-900">{formatSapDisplayValue(payment.invoice_number)}</div>
                              <div className="text-xs text-gray-500">
                                {payment.invoice_date ? `Invoice date: ${formatDate(payment.invoice_date)}` : ''}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-gray-900">{formatSapDisplayValue(payment.contract_id)}</div>
                              <div className="text-xs text-gray-500">
                                {payment.product ? `Product: ${payment.product}` : ''}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-gray-900">{formatSapDisplayValue(payment.supplier)}</div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-gray-900">
                              {formatAmount(payment.payment_amount)}
                            </TableCell>
                            <TableCell>{formatDate(payment.due_date_payment ?? null)}</TableCell>
                            <TableCell>{formatDate(payment.dp_date ?? null)}</TableCell>
                            <TableCell>{formatDate(payment.payoff_date ?? null)}</TableCell>
                            <TableCell>{payment.dp_date_deviation_days ?? '-'}</TableCell>
                            <TableCell>{payment.payoff_date_deviation_days ?? '-'}</TableCell>
                            <TableCell>{formatDate(payment.payment_date)}</TableCell>
                            <TableCell>
                              <Badge className={`${statusColors[payment.payment_status] || 'bg-gray-100 text-gray-800'}`}>
                                {payment.payment_status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Input
                                defaultValue={payment.payment_method || ''}
                                disabled={savingId === payment.id}
                                placeholder="Method"
                                onBlur={(e) => {
                                  const next = e.target.value.trim()
                                  if (next === (payment.payment_method || '')) return
                                  void handleUpdatePayment(payment.id, {
                                    payment_method: next || null,
                                  })
                                }}
                              />
                              <div className="text-xs text-gray-500 mt-1">
                                {payment.bank_reference || ''}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  )
}

