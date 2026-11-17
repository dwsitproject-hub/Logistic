'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { canViewPermission, usePermissions } from '@/components/PermissionsContext'
import { Button } from '@/components/ui/button'
import { MasterKpis, type MasterKpiItem } from '@/components/master/MasterKpis'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { ActivityFilterBar, FilterSelect } from '@/components/activity/ActivityFilterBar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import api from '@/lib/api'
import { AI_KLIP_AGENT_ACTIVITY_PAGE_PERMISSION } from '@/lib/aiKlipAgentActivity'
import { formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import { iconButtonClass } from '@/lib/iconButton'
import { Bot, CircleAlert, CircleCheck, CircleDot, KeyRound, ListChecks, RefreshCw } from 'lucide-react'

type ActivityLogRow = {
  id: string
  agent_name: string
  api_key_name: string
  activity: string
  activity_at: string
  status: string
  created_by_username?: string | null
}

type ActivitySummary = { total: number; success: number; errors: number; agents: number }

const PAGE_SIZE = 20
const EMPTY_SUMMARY: ActivitySummary = { total: 0, success: 0, errors: 0, agents: 0 }
const STATUS_OPTIONS = [
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
]

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${day}` }
}

export default function AiKlipAgentActivityPage() {
  return (
    <Layout>
      <AiKlipAgentActivityPageContent />
    </Layout>
  )
}

function AiKlipAgentActivityPageContent() {
  const router = useRouter()
  const perms = usePermissions()
  const canViewPage = canViewPermission(perms, AI_KLIP_AGENT_ACTIVITY_PAGE_PERMISSION)

  const defaultRange = useMemo(() => defaultDateRange(), [])
  const [items, setItems] = useState<ActivityLogRow[]>([])
  const [summary, setSummary] = useState<ActivitySummary>(EMPTY_SUMMARY)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [agentOptions, setAgentOptions] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom)
  const [dateTo, setDateTo] = useState(defaultRange.dateTo)
  const [agentName, setAgentName] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const requestRef = useRef(0)
  const debouncedSearch = useDebouncedValue(search.trim(), 350)

  useEffect(() => {
    if (perms.loaded && !canViewPage) {
      router.replace('/contracts')
    }
  }, [canViewPage, perms.loaded, router])

  useEffect(() => {
    if (!canViewPage) return
    api
      .get('/ai-klip-agent-activity/agents')
      .then((res) => {
        setAgentOptions(res.data?.data?.agents ?? [])
      })
      .catch((err) => {
        console.error('Failed to load AI agent names', err)
      })
  }, [canViewPage])

  const fetchData = useCallback(async () => {
    const requestId = ++requestRef.current
    try {
      setLoading(true)
      setLoadFailed(false)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))
      const fromIso = toApiDateOnly(dateFrom)
      const toIso = toApiDateOnly(dateTo)
      if (fromIso) params.set('dateFrom', fromIso)
      if (toIso) params.set('dateTo', toIso)
      if (agentName) params.set('agentName', agentName)
      if (status) params.set('status', status)
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await api.get(`/ai-klip-agent-activity/logs?${params.toString()}`)
      if (requestId !== requestRef.current) return
      setItems(res.data?.data?.items ?? [])
      setSummary({ ...EMPTY_SUMMARY, ...(res.data?.data?.summary ?? {}) })
      setTotal(res.data?.data?.pagination?.total ?? 0)
    } catch (err) {
      if (requestId !== requestRef.current) return
      console.error('Failed to load AI Klip Agent activity logs', err)
      setLoadFailed(true)
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [page, dateFrom, dateTo, agentName, status, debouncedSearch])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const filterSignature = `${dateFrom}|${dateTo}|${agentName}|${status}|${debouncedSearch}`
  const skipPageReset = useRef(true)
  useEffect(() => {
    if (skipPageReset.current) {
      skipPageReset.current = false
      return
    }
    setPage(1)
  }, [filterSignature])

  useEffect(() => {
    if (!canViewPage) return
    void fetchData()
  }, [fetchData, canViewPage])

  const clearFilters = () => {
    const range = defaultDateRange()
    setSearch('')
    setAgentName('')
    setStatus('')
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setPage(1)
  }

  const hasFilters =
    Boolean(search || agentName || status) || dateFrom !== defaultRange.dateFrom || dateTo !== defaultRange.dateTo

  if (!perms.loaded || !canViewPage) {
    return <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
  }

  const kpis: MasterKpiItem[] = [
    { id: 'total', icon: <ListChecks className="h-4 w-4" />, label: 'Activities', value: summary.total, tone: 'bg-blue-50 text-blue-600', hint: 'recorded in the period' },
    { id: 'success', icon: <CircleCheck className="h-4 w-4" />, label: 'Success', value: summary.success, tone: 'bg-emerald-50 text-emerald-600', hint: 'answered without error' },
    { id: 'errors', icon: <CircleAlert className="h-4 w-4" />, label: 'Errors', value: summary.errors, tone: 'bg-red-50 text-red-600', hint: 'failed requests' },
    { id: 'agents', icon: <Bot className="h-4 w-4" />, label: 'AI agents', value: summary.agents, tone: 'bg-violet-50 text-violet-600', hint: 'with activity in the period' },
  ]
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(total, page * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <MasterKpis items={kpis} />

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <ActivityFilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search activity or API key"
          searchLabel="Search activity"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
          hasFilters={hasFilters}
          onClear={clearFilters}
          actions={
            <Button
              variant="ghost"
              size="icon"
              className={iconButtonClass('sync')}
              title="Refresh"
              aria-label="Refresh"
              onClick={() => void fetchData()}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
          }
        >
          <FilterSelect
            icon={<Bot className="h-4 w-4" />}
            value={agentName}
            onChange={setAgentName}
            options={agentOptions.map((name) => ({ value: name, label: name }))}
            allLabel="All agents"
            ariaLabel="Filter by AI agent"
            className="w-[210px]"
          />
          <FilterSelect
            icon={<CircleDot className="h-4 w-4" />}
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            allLabel="All statuses"
            ariaLabel="Filter by status"
            className="w-[160px]"
          />
        </ActivityFilterBar>

        {loadFailed ? (
          <div className="px-4 py-12 text-center text-sm text-red-600">Could not load the activity log. Try Refresh.</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            {loading ? 'Loading…' : hasFilters ? 'No activity matches these filters.' : 'No activity logs found for this period.'}
          </div>
        ) : (
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                  <th scope="col" className="px-4 py-2.5">Date</th>
                  <th scope="col" className="px-4 py-2.5">API key</th>
                  <th scope="col" className="px-4 py-2.5">Activity</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const failed = row.status === 'error'
                  return (
                    <tr key={row.id} className="border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 align-top tabular-nums text-gray-700">{formatDateTimeDMY(row.activity_at)}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex min-w-0 items-center gap-2 font-medium text-gray-900">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600" aria-hidden>
                            <KeyRound className="h-3.5 w-3.5" />
                          </span>
                          <span className="truncate">{row.api_key_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className={failed ? 'text-red-700' : 'text-gray-800'}>{row.activity}</div>
                        <div className="mt-0.5 text-xs text-gray-400">{row.agent_name}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                            failed ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${failed ? 'bg-red-500' : 'bg-emerald-500'}`} aria-hidden />
                          {failed ? 'Error' : 'Success'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <MasterTableFooter
          countText={
            total === 0
              ? '0 records'
              : `Showing ${from.toLocaleString('en-US')}-${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} records`
          }
          kinds={[]}
          pager={{ page, totalPages, onPageChange: setPage, disabled: loading }}
        />
      </div>
    </div>
  )
}
