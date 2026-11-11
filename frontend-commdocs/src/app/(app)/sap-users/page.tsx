'use client'

import { Search, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ErrorNote, PageSize, Pager, Spinner, usePreference, useToast } from '@/components/ui'
import { apiData, apiJson, errorMessage, toQuery } from '@/lib/api'
import { dateTime, plural } from '@/lib/format'
import { readSapUsers } from '@/lib/sapUsers'

type SapUser = { userId: string; client: string | null; name: string; source: string; loadedAt: string | null; pos: number }
type Page = {
  users: SapUser[]
  total: number
  totals: { users: number; withData: number; loadedAt: string | null }
  unmatchedCreators: number
}

const CHUNK = 500

/**
 * SAP Users (administrators): the SAP user master (ZUSER) - the name behind each NIK. The Dashboard shows these names, in capitals, for the people who
 * created POs (the "Created by" of the ME2N report). The extract is uploaded here by hand for now; "Has data on the dashboard" keeps the users who created
 * POs. The source column leaves room for the PRC sync, which will win over the extract.
 */
export default function SapUsersPage() {
  const { toast } = useToast()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [hasData, setHasData] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePreference<number>('cd.pageSize.sapusers', 25)
  const [data, setData] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [uploading, setUploading] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => setPage(1), [search, hasData, pageSize])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    apiData<Page>(`/commercial-documents/sap-users${toQuery({ search, hasData: hasData ? '1' : '', page, limit: pageSize })}`)
      .then((d) => {
        if (!alive) return
        setData(d)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError(errorMessage(err, 'Could not load the SAP users. Please try again.'))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [search, hasData, page, pageSize, reload])

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      setUploading('Reading the file…')
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const read = readSapUsers(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }))
      if (!read) throw new Error('This is not the ZUSER file: the sheet needs the columns "User", "First Name" and "Last Name".')
      if (!read.rows.length) throw new Error('The file has no user.')
      for (let i = 0; i < read.rows.length; i += CHUNK) {
        setUploading(`Loading ${Math.min(i + CHUNK, read.rows.length).toLocaleString('en-US')} of ${read.rows.length.toLocaleString('en-US')} users…`)
        await apiJson('/commercial-documents/sap-users', { method: 'POST', body: { rows: read.rows.slice(i, i + CHUNK), source_file: file.name } })
      }
      const notes = [read.duplicates ? `${plural(read.duplicates, 'user')} listed twice (the first was kept)` : '', read.skipped ? `${plural(read.skipped, 'row')} skipped` : '']
        .filter(Boolean)
        .join(', ')
      toast(`Loaded ${plural(read.rows.length, 'SAP user')}${notes ? ` · ${notes}` : ''}`)
      setReload((n) => n + 1)
    } catch (err) {
      setError(errorMessage(err, 'The file could not be loaded.'))
    } finally {
      setUploading('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const pages = Math.max(1, Math.ceil((data?.total || 0) / pageSize))
  const t = data?.totals

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SAP Users</h1>
          <p>The SAP user master: the name behind each NIK. The Dashboard shows these names for the people who created POs.</p>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(uploading)} title="Load the ZUSER Excel file (User, First Name, Last Name)">
            <Upload aria-hidden />
            {uploading || 'Upload ZUSER file'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="panel">
        <div className="filters">
          <div className="input-ic">
            <Search aria-hidden />
            <input className="input" placeholder="Search NIK or name" aria-label="Search NIK or name" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <div className="chips" role="group" aria-label="Filter">
            <button className="chip" type="button" aria-pressed={hasData} onClick={() => setHasData((v) => !v)} title="Only the users who created POs of the ME2N report">
              Has data on the dashboard {t ? <b>{t.withData.toLocaleString('en-US')}</b> : null}
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table style={{ minWidth: '46rem' }}>
            <thead>
              <tr>
                <th>NIK (SAP user)</th>
                <th>Name</th>
                <th style={{ textAlign: 'right' }}>POs created</th>
                <th>Client</th>
                <th>Source</th>
                <th>Loaded</th>
              </tr>
            </thead>
            <tbody>
              {(data?.users || []).map((u) => (
                <tr key={u.userId}>
                  <td className="mono">{u.userId}</td>
                  <td>
                    <b>{u.name || '-'}</b>
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {u.pos ? u.pos.toLocaleString('en-US') : <span className="hint">-</span>}
                  </td>
                  <td className="hint">{u.client || '-'}</td>
                  <td>
                    <span className="pill neutral">{u.source}</span>
                  </td>
                  <td className="hint" style={{ whiteSpace: 'nowrap' }}>
                    {u.loadedAt ? dateTime(u.loadedAt) : '-'}
                  </td>
                </tr>
              ))}
              {loading && !data ? (
                <tr>
                  <td colSpan={6}>
                    <Spinner />
                  </td>
                </tr>
              ) : null}
              {!loading && data && !data.users.length ? (
                <tr>
                  <td colSpan={6} className="hint">
                    {t && !t.users
                      ? 'No SAP user yet. Upload the ZUSER file with the button above.'
                      : hasData
                        ? 'No user with data on the dashboard matches.'
                        : 'No user matches the search.'}
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
              {data ? `${plural(data.total, 'user')}` : ''}
              {t ? ` of ${t.users.toLocaleString('en-US')} loaded${t.loadedAt ? ` on ${dateTime(t.loadedAt)}` : ''}` : ''}
            </span>
          </div>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
        {data && data.unmatchedCreators > 0 ? (
          <p className="hint" style={{ padding: '0 16px 14px', margin: 0 }}>
            {plural(data.unmatchedCreators, 'creator')} of the ME2N report {data.unmatchedCreators === 1 ? 'has' : 'have'} no name in this list, so the Dashboard shows their NIK. Upload a newer ZUSER file to add them.
          </p>
        ) : null}
      </div>
    </>
  )
}
