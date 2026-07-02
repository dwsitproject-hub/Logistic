'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import api from '@/lib/api'
import { formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import {
  type ActivityDetailEvent,
  type DailyActivitySummary,
  USER_ACTIVITY_IDLE_MINUTES,
  eventTypeLabel,
} from '@/lib/userActivityLog'
import { ArrowLeft, Activity, Clock, MousePointerClick, Pencil, Plus, RefreshCw } from 'lucide-react'

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${day}` }
}

export default function UserActivityLogPage() {
  return (
    <Layout>
      <UserActivityLogPageContent />
    </Layout>
  )
}

function UserActivityLogPageContent() {
  const router = useRouter()
  const defaultRange = useMemo(() => defaultDateRange(), [])
  const [authorized, setAuthorized] = useState(false)
  const [items, setItems] = useState<DailyActivitySummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [loading, setLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom)
  const [dateTo, setDateTo] = useState(defaultRange.dateTo)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailSummary, setDetailSummary] = useState<DailyActivitySummary | null>(null)
  const [detailEvents, setDetailEvents] = useState<ActivityDetailEvent[]>([])

  useEffect(() => {
    const userStr = localStorage.getItem('user')
    if (!userStr) {
      router.replace('/login')
      return
    }
    const user = JSON.parse(userStr) as { role?: string }
    if (user.role !== 'ADMIN') {
      router.replace('/dashboard')
      return
    }
    setAuthorized(true)
  }, [router])

  const fetchSummary = useCallback(
    async (pageNum: number, from: string, to: string) => {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('page', String(pageNum))
        params.set('limit', String(PAGE_SIZE))
        const fromIso = toApiDateOnly(from)
        const toIso = toApiDateOnly(to)
        if (fromIso) params.set('dateFrom', fromIso)
        if (toIso) params.set('dateTo', toIso)
        const res = await api.get(`/user-activity/daily-summary?${params.toString()}`)
        setItems(res.data?.data?.items ?? [])
        setTotal(res.data?.data?.pagination?.total ?? 0)
      } catch (err) {
        console.error('Failed to load user activity summary', err)
      } finally {
        setLoading(false)
      }
    },
    [PAGE_SIZE],
  )

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total, PAGE_SIZE])
  const filterSignature = `${dateFrom}|${dateTo}`
  const skipPageReset = useRef(true)

  useEffect(() => {
    if (skipPageReset.current) {
      skipPageReset.current = false
      return
    }
    setPage(1)
  }, [filterSignature])

  useEffect(() => {
    if (!authorized) return
    void fetchSummary(page, dateFrom, dateTo)
  }, [authorized, page, dateFrom, dateTo, fetchSummary])

  const openDetail = async (row: DailyActivitySummary) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailSummary(row)
    setDetailEvents([])
    try {
      const params = new URLSearchParams({
        userId: row.user_id,
        date: toApiDateOnly(row.activity_date) || String(row.activity_date).slice(0, 10),
      })
      const res = await api.get(`/user-activity/daily-detail?${params.toString()}`)
      setDetailSummary(res.data?.data?.summary ?? null)
      setDetailEvents(res.data?.data?.events ?? [])
      if (!res.data?.data?.summary && !res.data?.data?.events?.length) {
        console.error('Activity detail empty for', row.user_id, row.activity_date)
      }
    } catch (err) {
      console.error('Failed to load activity detail', err)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleResetFilters = () => {
    const range = defaultDateRange()
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setPage(1)
  }

  if (!authorized) {
    return <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/users')} title="Back to Users">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">User Activity Log</h1>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Daily summary of user actions and active time (idle after {USER_ACTIVITY_IDLE_MINUTES} minutes).
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => void fetchSummary(page, dateFrom, dateTo)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Date from</label>
              <DateInputDdMmYyyy valueIso={dateFrom} onChangeIso={setDateFrom} className="w-[160px]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Date to</label>
              <DateInputDdMmYyyy valueIso={dateTo} onChangeIso={setDateTo} className="w-[160px]" />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleResetFilters}>
              Reset filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Daily activity summary</CardTitle>
          <span className="text-sm text-gray-500">{total.toLocaleString('en-US')} day record(s)</span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-gray-500">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No activity recorded for the selected period. Activity is tracked when users browse the app.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">Add</TableHead>
                      <TableHead className="text-right">Update</TableHead>
                      <TableHead className="text-right">Edit</TableHead>
                      <TableHead className="text-right">Active time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((row) => (
                      <TableRow
                        key={`${row.user_id}-${row.activity_date}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => void openDetail(row)}
                      >
                        <TableCell>{row.activity_date}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.full_name}</div>
                          <div className="text-xs text-gray-500">{row.username}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.role}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{row.total_count}</TableCell>
                        <TableCell className="text-right">{row.click_count}</TableCell>
                        <TableCell className="text-right">{row.create_count}</TableCell>
                        <TableCell className="text-right">{row.update_count}</TableCell>
                        <TableCell className="text-right">{row.edit_count}</TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            {row.active_duration_label}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <span className="text-sm text-gray-500">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity detail</DialogTitle>
            <DialogDescription>
              {detailSummary
                ? `${detailSummary.full_name} (${detailSummary.username}) — ${detailSummary.activity_date}`
                : 'Loading…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-8 text-center text-gray-500">Loading detail…</div>
          ) : detailSummary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <SummaryChip icon={Activity} label="Total" value={detailSummary.total_count} />
                <SummaryChip icon={MousePointerClick} label="Clicks" value={detailSummary.click_count} />
                <SummaryChip icon={Plus} label="Add" value={detailSummary.create_count} />
                <SummaryChip icon={RefreshCw} label="Update" value={detailSummary.update_count} />
                <SummaryChip icon={Pencil} label="Edit" value={detailSummary.edit_count} />
                <SummaryChip icon={Clock} label="Active" value={detailSummary.active_duration_label} text />
              </div>

              {detailEvents.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No events for this day.</p>
              ) : (
                <div className="overflow-x-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Page</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailEvents.map((ev) => (
                        <TableRow key={ev.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatDateTimeDMY(ev.event_at)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{eventTypeLabel(ev.event_type)}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[280px] truncate" title={ev.action_label ?? ''}>
                            {ev.action_label || '—'}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-gray-500" title={ev.page_path ?? ''}>
                            {ev.page_path || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-red-600 text-center py-4">Could not load activity detail for this day.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryChip({
  icon: Icon,
  label,
  value,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  text?: boolean
}) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`font-semibold ${text ? 'text-base' : 'text-xl'}`}>{value}</div>
    </div>
  )
}
