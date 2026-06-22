'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { canViewPermission, usePermissions } from '@/components/PermissionsContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import api from '@/lib/api'
import { AI_KLIP_AGENT_ACTIVITY_PAGE_PERMISSION } from '@/lib/aiKlipAgentActivity'
import { formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import { ScrollText } from 'lucide-react'

type ActivityLogRow = {
  id: string
  agent_name: string
  api_key_name: string
  activity: string
  activity_at: string
  status: string
  created_by_username?: string | null
}

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
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [loading, setLoading] = useState(false)
  const [agentOptions, setAgentOptions] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom)
  const [dateTo, setDateTo] = useState(defaultRange.dateTo)
  const [agentName, setAgentName] = useState('')

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

  const fetchData = useCallback(
    async (pageNum: number, from: string, to: string, agent: string) => {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('page', String(pageNum))
        params.set('limit', String(PAGE_SIZE))
        const fromIso = toApiDateOnly(from)
        const toIso = toApiDateOnly(to)
        if (fromIso) params.set('dateFrom', fromIso)
        if (toIso) params.set('dateTo', toIso)
        if (agent) params.set('agentName', agent)
        const res = await api.get(`/ai-klip-agent-activity/logs?${params.toString()}`)
        setItems(res.data?.data?.items ?? [])
        setTotal(res.data?.data?.pagination?.total ?? 0)
      } catch (err) {
        console.error('Failed to load AI Klip Agent activity logs', err)
      } finally {
        setLoading(false)
      }
    },
    [PAGE_SIZE],
  )

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total, PAGE_SIZE])

  const filterSignature = `${dateFrom}|${dateTo}|${agentName}`
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
    void fetchData(page, dateFrom, dateTo, agentName)
  }, [page, dateFrom, dateTo, agentName, fetchData, canViewPage])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setPage(newPage)
  }

  const handleResetFilters = () => {
    const range = defaultDateRange()
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setAgentName('')
    setPage(1)
  }

  if (!perms.loaded || !canViewPage) {
    return <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScrollText className="h-8 w-8 text-violet-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Log Activity — AI Klip Agent</h1>
          <p className="text-gray-500 text-sm mt-1">
            Audit trail of AI Klip Agent actions (Shipment Planner and Chat).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
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
            <div className="space-y-1.5 min-w-[240px]">
              <label className="text-sm font-medium text-gray-700">AI Agent</label>
              <select
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">All agents</option>
                {agentOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleResetFilters}>
              Reset filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Activity Log</CardTitle>
          <span className="text-sm text-gray-500">{total.toLocaleString('en-US')} record(s)</span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-gray-500">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-gray-500">No activity logs found for the selected filters.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-gray-600">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">API Key Name</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Date</th>
                      <th className="px-3 py-2 font-medium">Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className="border-b last:border-b-0 hover:bg-gray-50/80">
                        <td className="px-3 py-2 align-top font-medium text-gray-900 whitespace-nowrap">
                          {row.api_key_name}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-700 whitespace-nowrap">
                          {formatDateTimeDMY(row.activity_at)}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-800">
                          <div
                            className={
                              row.status === 'error' ? 'text-red-700' : 'text-gray-800'
                            }
                          >
                            {row.activity}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-1">{row.agent_name}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between mt-4 pt-2 border-t">
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
