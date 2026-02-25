'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { Loader2, RefreshCw } from 'lucide-react'
import api from '@/lib/api'

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

const formatAmount = (value: number | null | undefined, currency = 'USD') => {
  if (value === null || value === undefined) return '-'
  return Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

const formatDate = (value: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function FinancePage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

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

    const response = await api.get('/finance/payments', { params })
    setPayments(response.data.data || [])
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

  const handleUpdatePayment = async (
    id: string,
    updates: Partial<Pick<Payment, 'payment_status' | 'payment_method'>>
  ) => {
    if (!updates.payment_status && updates.payment_method === undefined) return
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

  const statusSummary = useMemo(() => {
    if (!summary) return []
    return summary.byStatus
      .map((item) => ({
        ...item,
        status: item.status || 'UNKNOWN',
      }))
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
  }, [summary])

  const latestCurrency = useMemo(() => {
    const firstPayment = payments.find((p) => p.currency)
    return firstPayment?.currency || 'USD'
  }, [payments])

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
                  <CardTitle>Total Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-gray-900">
                    {formatAmount(summary?.totals.totalAmount || 0, latestCurrency)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">{summary?.totals.totalRecords || 0} records</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pending Amount</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-yellow-600">
                    {formatAmount(summary?.totals.pendingAmount || 0, latestCurrency)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Awaiting payment confirmation</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Paid Amount</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-green-600">
                    {formatAmount(summary?.totals.paidAmount || 0, latestCurrency)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Completed payments</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Overdue Amount</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-red-600">
                    {formatAmount(summary?.totals.overdueAmount || 0, latestCurrency)}
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Require immediate attention</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <Input
                        placeholder="Search by invoice, contract, or supplier"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
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

              <Card>
                <CardHeader>
                  <CardTitle>Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {statusSummary.length === 0 && (
                    <p className="text-sm text-gray-500">No payment records found</p>
                  )}
                  {statusSummary.map((item) => (
                    <div key={item.status} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{item.status}</p>
                        <p className="text-xs text-gray-500">{item.count} payments</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {formatAmount(item.amount || 0, latestCurrency)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Contract</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Due Date Payment</TableHead>
                        <TableHead>DP Date</TableHead>
                        <TableHead>Payoff Date</TableHead>
                        <TableHead>DP Dev. (Days)</TableHead>
                        <TableHead>Payoff Dev. (Days)</TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead>Status</TableHead>
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
                              <div className="font-medium text-gray-900">{payment.invoice_number || '-'}</div>
                              <div className="text-xs text-gray-500">
                                {payment.invoice_date ? `Invoice date: ${formatDate(payment.invoice_date)}` : ''}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-gray-900">{payment.contract_id || '-'}</div>
                              <div className="text-xs text-gray-500">
                                {payment.product ? `Product: ${payment.product}` : ''}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-gray-900">{payment.supplier || '-'}</div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-gray-900">
                              {formatAmount(payment.payment_amount, payment.currency || latestCurrency)}
                            </TableCell>
                            <TableCell>{formatDate(payment.due_date_payment ?? null)}</TableCell>
                            <TableCell>{formatDate(payment.dp_date ?? null)}</TableCell>
                            <TableCell>{formatDate(payment.payoff_date ?? null)}</TableCell>
                            <TableCell>{payment.dp_date_deviation_days ?? '-'}</TableCell>
                            <TableCell>{payment.payoff_date_deviation_days ?? '-'}</TableCell>
                            <TableCell>{formatDate(payment.payment_date)}</TableCell>
                            <TableCell>
                              <Select
                                value={payment.payment_status}
                                disabled={savingId === payment.id}
                                onValueChange={(value) =>
                                  handleUpdatePayment(payment.id, {
                                    payment_status: value as PaymentStatus,
                                  })
                                }
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue>
                                    <Badge
                                      className={`${
                                        statusColors[payment.payment_status] ||
                                        'bg-gray-100 text-gray-800'
                                      }`}
                                    >
                                      {payment.payment_status}
                                    </Badge>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="PENDING">PENDING</SelectItem>
                                  <SelectItem value="PARTIAL">PARTIAL</SelectItem>
                                  <SelectItem value="PAID">PAID</SelectItem>
                                  <SelectItem value="OVERDUE">OVERDUE</SelectItem>
                                </SelectContent>
                              </Select>
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

