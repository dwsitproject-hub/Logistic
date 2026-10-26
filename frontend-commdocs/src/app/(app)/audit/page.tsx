'use client'

import { Download, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ErrorNote, PageSize, Pager, Spinner, usePreference, useToast } from '@/components/ui'
import { apiData, errorMessage, isAbort, toQuery } from '@/lib/api'
import { AUDIT_GROUPS, auditGroupFilter, describeAudit, type AuditGroup } from '@/lib/audit'
import { dateTime, isoDate, plural } from '@/lib/format'
import { saveCsv } from '@/lib/files'
import { useSession } from '@/lib/session'
import type { AuditEntry, ManagedUser, Pagination, Role } from '@/lib/types'

const PERIODS: Array<[string, string, number | null]> = [
  ['7', 'Last 7 days', 7],
  ['30', 'Last 30 days', 30],
  ['90', 'Last 90 days', 90],
  ['all', 'All time', null],
]

/** Who did what, and when (GET /api/audit; ADMIN, SUPPORT, ADMIN_SUPPORT). */
export default function AuditPage() {
  const { user } = useSession()
  const { toast } = useToast()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<AuditGroup>('all')
  const [period, setPeriod] = useState('7')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePreference<number>('cd.pageSize.audit', 25)
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => setPage(1), [search, group, period, pageSize])

  // Names for user and role ids - only an administrator may list them; others see ids.
  useEffect(() => {
    if (user?.role !== 'ADMIN') return
    void Promise.all([apiData<ManagedUser[]>('/users').catch(() => []), apiData<Role[]>('/roles').catch(() => [])]).then(([u, r]) => {
      const map: Record<string, string> = {}
      for (const x of u || []) map[x.id] = x.full_name || x.email
      for (const x of r || []) map[x.id] = x.display_name || x.role_name
      setNames(map)
    })
  }, [user?.role])

  const params = useMemo(() => {
    const days = PERIODS.find((p) => p[0] === period)?.[2] ?? null
    const from = days ? new Date(Date.now() - days * 86_400_000) : null
    return { ...auditGroupFilter(group), search, dateFrom: from ? isoDate(from) : '' }
  }, [group, search, period])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    apiData<{ logs: AuditEntry[]; pagination: Pagination }>(`/audit${toQuery({ ...params, page, limit: pageSize })}`, {
      signal: ctrl.signal,
    })
      .then((d) => {
        setRows(d.logs || [])
        setPagination(d.pagination)
        setLoading(false)
      })
      .catch((err) => {
        if (isAbort(err)) return
        setError(errorMessage(err, 'Could not load the audit trail. Please try again.'))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [params, page, pageSize])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all: AuditEntry[] = []
      for (let p = 1; p <= 50; p++) {
        const d = await apiData<{ logs: AuditEntry[]; pagination: Pagination }>(`/audit${toQuery({ ...params, page: p, limit: 200 })}`)
        all.push(...(d.logs || []))
        if (p >= d.pagination.totalPages) break
      }
      saveCsv(
        `Audit_trail_${isoDate(new Date())}.csv`,
        ['When', 'User', 'Role', 'Action', 'What', 'Details'],
        all.map((e) => {
          const d = describeAudit(e, names)
          return [dateTime(e.timestamp), e.full_name || e.username || 'System', e.role, d.action, d.what, d.details]
        }),
      )
      toast(`Exported ${plural(all.length, 'event')}`)
    } catch (err) {
      toast(errorMessage(err, 'Export failed.'), true)
    } finally {
      setExporting(false)
    }
  }

  const total = pagination?.total ?? 0
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p>Who did what, and when. Sign-ins, uploads, views, downloads, deletes and access changes.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => void exportCsv()} disabled={exporting || !total}>
            <Download aria-hidden />
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="filters">
          <div className="input-ic">
            <Search aria-hidden />
            <input
              className="input"
              placeholder="Search user, PO or file name"
              aria-label="Search user, PO or file name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select className="select" aria-label="Action" value={group} onChange={(e) => setGroup(e.target.value as AuditGroup)}>
            {AUDIT_GROUPS.map(([k, l]) => (
              <option key={k} value={k}>
                {k === 'all' ? 'Action: All' : l}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="tbl-wrap">
          {loading ? (
            <div className="loading-veil">
              <Spinner />
            </div>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const d = describeAudit(e, names)
                return (
                  <tr key={e.id}>
                    <td className="num hint" style={{ whiteSpace: 'nowrap' }}>
                      {dateTime(e.timestamp)}
                    </td>
                    <td>
                      {e.full_name || e.username || 'System'}
                      {e.role ? <span className="sub">{e.role}</span> : null}
                    </td>
                    <td>
                      <span className={`pill ${d.tone}`}>{d.action}</span>
                    </td>
                    <td className="ellipsis" style={{ maxWidth: 260 }} title={d.what}>
                      {d.what || '-'}
                    </td>
                    <td className="mono ellipsis" style={{ fontSize: 12, maxWidth: 380 }} title={d.details}>
                      {d.details || '-'}
                    </td>
                  </tr>
                )
              })}
              {!loading && !rows.length ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    Nothing recorded for these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="tbl-foot">
          <div className="pp">
            <PageSize value={pageSize} onChange={setPageSize} />
            <span>
              {rows.length} of {plural(total, 'event')}
            </span>
          </div>
          <Pager page={page} pages={Math.max(1, pagination?.totalPages ?? 1)} onPage={setPage} />
        </div>
      </div>
    </>
  )
}
