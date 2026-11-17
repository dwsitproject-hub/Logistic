'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { iconButtonClass } from '@/lib/iconButton'
import { Badge } from '@/components/ui/badge'
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
import { MasterKpis, type MasterKpiItem } from '@/components/master/MasterKpis'
import { MasterTableFooter } from '@/components/master/MasterTableFooter'
import { ActivityFilterBar, FilterSelect, type FilterSelectOption } from '@/components/activity/ActivityFilterBar'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import api from '@/lib/api'
import { formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import { filterRegionSiteOptions } from '@/lib/globalScopeFilters'
import { roleToneClass, userInitials } from '@/lib/userDirectory'
import { formatRoleDisplayName, formatRoleLabel } from '@/lib/userRoles'
import {
  type ActivityDetailEvent,
  type DailyActivitySummary,
  type UserActivitySummary,
  USER_ACTIVITY_IDLE_MINUTES,
  eventTypeLabel,
} from '@/lib/userActivityLog'
import { Activity, ArrowLeft, Clock, Layers, MapPin, MousePointerClick, Pencil, Plus, RefreshCw, Shield, Users } from 'lucide-react'

const PAGE_SIZE = 20
const LEVELS = ['Dept Head', 'Section Head', 'Staff', 'Admin']
const EMPTY_SUMMARY: UserActivitySummary = { users: 0, total_actions: 0, clicks: 0, changes: 0, day_records: 0 }

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

/** The Region/Site names of a user (up to two, then "+N"); "-" when the user has none. */
function RegionSiteCell({ places }: { places: string[] }) {
  if (!places.length) return <span className="text-gray-400">-</span>
  const more = places.length - 2
  return (
    <div className="truncate text-gray-800" title={places.join(', ')}>
      {places.slice(0, 2).join(', ')}
      {more > 0 ? <span className="text-gray-500"> +{more}</span> : null}
    </div>
  )
}

function UserActivityLogPageContent() {
  const router = useRouter()
  const defaultRange = useMemo(() => defaultDateRange(), [])
  const [authorized, setAuthorized] = useState(false)
  const [items, setItems] = useState<DailyActivitySummary[]>([])
  const [summary, setSummary] = useState<UserActivitySummary>(EMPTY_SUMMARY)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom)
  const [dateTo, setDateTo] = useState(defaultRange.dateTo)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [level, setLevel] = useState('')
  const [regionSite, setRegionSite] = useState('')
  const [roleOptions, setRoleOptions] = useState<FilterSelectOption[]>([])
  const [regionOptions, setRegionOptions] = useState<string[]>([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailSummary, setDetailSummary] = useState<DailyActivitySummary | null>(null)
  const [detailEvents, setDetailEvents] = useState<ActivityDetailEvent[]>([])
  const requestRef = useRef(0)
  const debouncedSearch = useDebouncedValue(search.trim(), 350)

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

  // The role and Region/Site choices, the same lists the Users page filters and edits with.
  useEffect(() => {
    if (!authorized) return
    api
      .get('/roles')
      .then((res) => {
        const roles = (res.data?.data ?? []) as Array<{ role_name: string; display_name: string }>
        setRoleOptions(roles.map((r) => ({ value: r.role_name, label: formatRoleDisplayName(r.display_name) })))
      })
      .catch((err) => console.error('Failed to load roles', err))
    api
      .get('/contracts/filter-options/group-plants')
      .then((res) => {
        const groupPlants = (res.data?.data?.groupPlants ?? []) as string[]
        setRegionOptions(filterRegionSiteOptions(Array.isArray(groupPlants) ? groupPlants : []))
      })
      .catch((err) => console.error('Failed to load Region/Site options', err))
  }, [authorized])

  const roleLabel = useCallback(
    (code: string) => roleOptions.find((option) => option.value === code)?.label ?? formatRoleDisplayName(formatRoleLabel(code)),
    [roleOptions],
  )

  const fetchSummary = useCallback(async () => {
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
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (role) params.set('role', role)
      if (level) params.set('level', level)
      if (regionSite) params.set('regionSite', regionSite)
      const res = await api.get(`/user-activity/daily-summary?${params.toString()}`)
      if (requestId !== requestRef.current) return
      setItems(res.data?.data?.items ?? [])
      setSummary({ ...EMPTY_SUMMARY, ...(res.data?.data?.summary ?? {}) })
      setTotal(res.data?.data?.pagination?.total ?? 0)
    } catch (err) {
      if (requestId !== requestRef.current) return
      console.error('Failed to load user activity summary', err)
      setLoadFailed(true)
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [page, dateFrom, dateTo, debouncedSearch, role, level, regionSite])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const filterSignature = `${dateFrom}|${dateTo}|${debouncedSearch}|${role}|${level}|${regionSite}`
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
    void fetchSummary()
  }, [authorized, fetchSummary])

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
    } catch (err) {
      console.error('Failed to load activity detail', err)
    } finally {
      setDetailLoading(false)
    }
  }

  const clearFilters = () => {
    const range = defaultDateRange()
    setSearch('')
    setRole('')
    setLevel('')
    setRegionSite('')
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setPage(1)
  }

  const hasFilters =
    Boolean(search || role || level || regionSite) || dateFrom !== defaultRange.dateFrom || dateTo !== defaultRange.dateTo

  if (!authorized) {
    return <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
  }

  const kpis: MasterKpiItem[] = [
    { id: 'users', icon: <Users className="h-4 w-4" />, label: 'Active users', value: summary.users, tone: 'bg-blue-50 text-blue-600', hint: 'with activity in the period' },
    { id: 'actions', icon: <Activity className="h-4 w-4" />, label: 'Total actions', value: summary.total_actions, tone: 'bg-violet-50 text-violet-600', hint: 'every recorded event' },
    { id: 'clicks', icon: <MousePointerClick className="h-4 w-4" />, label: 'Button clicks', value: summary.clicks, tone: 'bg-sky-50 text-sky-600', hint: 'clicks on buttons and menus' },
    { id: 'changes', icon: <Pencil className="h-4 w-4" />, label: 'Changes', value: summary.changes, tone: 'bg-amber-50 text-amber-600', hint: 'add, update and edit' },
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
          searchPlaceholder="Search name or username"
          searchLabel="Search users"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
          hasFilters={hasFilters}
          onClear={clearFilters}
          actions={
            <>
              <Button
                variant="ghost"
                size="icon"
                className={iconButtonClass('sync')}
                title="Refresh"
                aria-label="Refresh"
                onClick={() => void fetchSummary()}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={iconButtonClass('neutral')}
                title="Back to Users"
                aria-label="Back to Users"
                onClick={() => router.push('/users')}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Button>
            </>
          }
        >
          <FilterSelect
            icon={<Shield className="h-4 w-4" />}
            value={role}
            onChange={setRole}
            options={roleOptions}
            allLabel="All roles"
            ariaLabel="Filter by role"
            className="w-[170px]"
          />
          <FilterSelect
            icon={<Layers className="h-4 w-4" />}
            value={level}
            onChange={setLevel}
            options={LEVELS.map((value) => ({ value, label: value }))}
            allLabel="All levels"
            ariaLabel="Filter by level"
            className="w-[140px]"
          />
          <div className="w-[170px]" title="Region/Site the user is scoped to">
            <SearchableMultiSelect
              label="Region/Site"
              hideLabel
              singleSelect
              options={regionOptions}
              selected={regionSite ? [regionSite] : []}
              onChange={(values) => setRegionSite(values[0] ?? '')}
              placeholder="All Region/Site"
              emptyMessage="No Region/Site values"
              uppercaseOptionLabels
              icon={<MapPin className="h-4 w-4" />}
              buttonClassName="w-full flex items-center justify-between gap-2 h-9 px-3 py-2 text-left text-sm border border-gray-200 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
          </div>
        </ActivityFilterBar>

        {loadFailed ? (
          <div className="px-4 py-12 text-center text-sm text-red-600">Could not load the activity log. Try Refresh.</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            {loading
              ? 'Loading…'
              : hasFilters
                ? 'No activity matches these filters.'
                : 'No activity recorded for the selected period. Activity is tracked when users browse the app.'}
          </div>
        ) : (
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                  <th scope="col" className="px-4 py-2.5">Date</th>
                  <th scope="col" className="px-4 py-2.5">User</th>
                  <th scope="col" className="px-4 py-2.5">Role and level</th>
                  <th scope="col" className="px-4 py-2.5">Region/Site</th>
                  <th scope="col" className="px-4 py-2.5">Actions</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Active time</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={`${row.user_id}-${row.activity_date}`}
                    tabIndex={0}
                    onClick={() => void openDetail(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.target === event.currentTarget) void openDetail(row)
                    }}
                    className="cursor-pointer border-b border-gray-100 outline-none transition-colors last:border-b-0 hover:bg-gray-50 focus-visible:bg-blue-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-700">{row.activity_date}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${roleToneClass(row.role)}`}
                          aria-hidden
                        >
                          {userInitials(row.full_name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-900">{row.full_name}</div>
                          <div className="truncate text-xs text-gray-500">{row.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setRole(row.role)
                        }}
                        title="Show only this role"
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium hover:opacity-80 ${roleToneClass(row.role)}`}
                      >
                        {roleLabel(row.role)}
                      </button>
                      <div className="mt-0.5 text-xs text-gray-500">{row.level || '-'}</div>
                    </td>
                    <td className="max-w-[14rem] px-4 py-3">
                      <RegionSiteCell places={row.region_sites ?? []} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold tabular-nums text-gray-900">{row.total_count.toLocaleString('en-US')}</div>
                      <div className="text-xs tabular-nums text-gray-500">
                        {row.click_count} clicks · {row.create_count} add · {row.update_count} update · {row.edit_count} edit
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Clock className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                        {row.active_duration_label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <MasterTableFooter
          countText={
            total === 0
              ? `0 day records · idle after ${USER_ACTIVITY_IDLE_MINUTES} min`
              : `Showing ${from.toLocaleString('en-US')}-${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} day records · idle after ${USER_ACTIVITY_IDLE_MINUTES} min · click a row for the detail`
          }
          kinds={[]}
          pager={{ page, totalPages, onPageChange: setPage, disabled: loading }}
        />
      </div>

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
                          <TableCell className="whitespace-nowrap text-xs">{formatDateTimeDMY(ev.event_at)}</TableCell>
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
