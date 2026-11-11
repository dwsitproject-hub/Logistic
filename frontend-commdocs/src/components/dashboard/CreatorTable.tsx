'use client'

import { RefreshCw, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ErrorNote, Spinner, useToast } from '@/components/ui'
import { apiData, apiJson, errorMessage, isAbort, toQuery } from '@/lib/api'
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from '@/lib/documentTypes'
import { longDate, plural } from '@/lib/format'
import { readPoCreators } from '@/lib/poCreators'
import type { CreatorCompleteness } from '@/lib/types'

type Order = 'pos' | 'complete' | 'gaps'
type Run = { outcome: string; trigger: string; at: string; fileName: string | null; detail: string | null }
type Payload = {
  creators: CreatorCompleteness[]
  loaded: { pos: number; creators: number; loadedAt: string | null }
  /** The scheduled load from the SAP share: whether it is on, the last run that loaded a file, and the last run of any kind. */
  auto?: { enabled: boolean; lastLoaded: Run | null; lastRun: Run | null }
}

const CHUNK = 1000

/**
 * The "By user" view of the Dashboard's Completeness: documents uploaded vs total, by the person who created the PO in SAP
 * (GET /api/commercial-documents/completeness-by-creator). The creator is the "Created by" of the SAP ME2N report: loaded every morning from the
 * SAP share, or by an administrator here. SAP gives an employee number (NIK). A name for it will come from the PRC application, so for now the
 * number is what shows: `displayName` and the commercial_creator_names table are the place for that sync, and nothing here edits them.
 * A PO the report does not know is listed as "No creator data".
 */
export function CreatorTable({ range, isAdmin }: { range: { dateFrom: string; dateTo: string }; isAdmin: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<Order>('pos')
  const [reload, setReload] = useState(0)
  const [loadingFile, setLoadingFile] = useState('')
  const [checking, setChecking] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    apiData<Payload>(`/commercial-documents/completeness-by-creator${toQuery(range)}`, { signal: ctrl.signal })
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch((err) => {
        if (isAbort(err)) return
        setError(errorMessage(err, 'Could not load the users. Please try again.'))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [range, reload])

  const rows = useMemo(() => {
    const list = data?.creators || []
    const ratio = (c: CreatorCompleteness) => (c.totalSlots ? c.uploadedSlots / c.totalSlots : 0)
    // The row for POs without a creator always comes last: it is a gap in the data, not a person.
    return [...list].sort((a, b) => {
      if (!a.createdBy !== !b.createdBy) return a.createdBy ? -1 : 1
      if (order === 'complete') return ratio(b) - ratio(a) || b.contractCount - a.contractCount
      if (order === 'gaps') return ratio(a) - ratio(b) || b.missingSlots - a.missingSlots
      return b.contractCount - a.contractCount || ratio(b) - ratio(a)
    })
  }, [data, order])

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      setLoadingFile('Reading the file…')
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const read = readPoCreators(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }))
      if (!read) throw new Error('This is not the ME2N report: the sheet needs the columns "Purchasing Document" and "Created by".')
      if (!read.rows.length) throw new Error('The report has no PO with a creator.')
      for (let i = 0; i < read.rows.length; i += CHUNK) {
        setLoadingFile(`Loading ${Math.min(i + CHUNK, read.rows.length).toLocaleString('en-US')} of ${read.rows.length.toLocaleString('en-US')} POs…`)
        await apiJson('/commercial-documents/po-creators', { method: 'POST', body: { rows: read.rows.slice(i, i + CHUNK), source_file: file.name } })
      }
      const notes = [read.conflicts ? `${plural(read.conflicts, 'PO')} had two creators (the first was kept)` : '', read.skipped ? `${plural(read.skipped, 'row')} skipped` : '']
        .filter(Boolean)
        .join(', ')
      toast(`Loaded ${plural(read.rows.length, 'PO')} from ${plural(read.creators, 'user')}${notes ? ` · ${notes}` : ''}`)
      setReload((n) => n + 1)
    } catch (err) {
      setError(errorMessage(err, 'The report could not be loaded.'))
    } finally {
      setLoadingFile('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // "Check now": the same look at the SAP share that the schedule makes.
  const checkNow = async () => {
    setChecking(true)
    setError('')
    try {
      const res = await apiJson<{ outcome: string; fileName: string | null; rows: number; creators: number; detail: string | null }>('/commercial-documents/po-creators/sync', { method: 'POST' })
      const r = res.data
      if (r.outcome === 'loaded') toast(`Loaded ${plural(r.rows, 'PO')} from ${plural(r.creators, 'user')} (${r.fileName})`)
      else if (r.outcome === 'unchanged') toast(`Already up to date (${r.fileName})`)
      else setError(r.detail || 'The report could not be loaded.')
      if (r.outcome === 'loaded') setReload((n) => n + 1)
    } catch (err) {
      setError(errorMessage(err, 'Could not check for the report.'))
    } finally {
      setChecking(false)
    }
  }

  // The NIK is the SAP number; a name (from the PRC sync, when it exists) goes beside it.
  const label = (c: CreatorCompleteness) => (c.createdBy ? c.displayName || c.createdBy : 'No creator data')
  const known = data?.loaded.pos || 0
  // A problem shows while the last check is newer than the last successful load: quiet "unchanged" runs do not hide it.
  const lastRun = data?.auto?.lastRun
  const problem =
    lastRun && ['failed', 'source_missing', 'no_file'].includes(lastRun.outcome) && (!data?.auto?.lastLoaded || lastRun.at > data.auto.lastLoaded.at) ? lastRun : null

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 16px 0', flexWrap: 'wrap' }}>
        <div className="chips">
          {(
            [
              ['pos', 'Most POs'],
              ['complete', 'Most complete'],
              ['gaps', 'Biggest gaps'],
            ] as Array<[Order, string]>
          ).map(([k, l]) => (
            <button key={k} className="chip" type="button" aria-pressed={order === k} onClick={() => setOrder(k)}>
              {l}
            </button>
          ))}
        </div>
        {isAdmin ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" type="button" onClick={() => void checkNow()} disabled={checking || Boolean(loadingFile)} title="Look for a new ME2N report in the SAP share now">
              <RefreshCw aria-hidden />
              {checking ? 'Checking…' : 'Check now'}
            </button>
            <button className="btn sm" type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(loadingFile)}>
              <Upload aria-hidden />
              {loadingFile || 'Load ME2N report'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
          </div>
        ) : null}
      </div>
      <div style={{ padding: '8px 16px 0' }}>
        <ErrorNote>{error}</ErrorNote>
      </div>
      {loading ? (
        <div style={{ padding: 16 }}>
          <Spinner />
        </div>
      ) : !known ? (
        <p className="hint" style={{ padding: 16, margin: 0 }}>
          No user data yet.{' '}
          {isAdmin
            ? 'Load the SAP ME2N report (Excel) with the button above: it has the "Created by" of every PO.'
            : 'An administrator needs to load the SAP ME2N report first.'}
        </p>
      ) : (
        <div className="tbl-wrap">
          <table style={{ minWidth: '44rem' }}>
            <thead>
              <tr>
                <th>User (SAP NIK)</th>
                <th style={{ textAlign: 'right' }}>POs</th>
                <th>Documents uploaded</th>
                <th style={{ textAlign: 'right' }}>All 11</th>
                <th style={{ textAlign: 'right' }}>Nothing yet</th>
                <th title="The 11 document types in checklist order. Darker means more of this person's POs have it.">By document</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.createdBy || '(none)'}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{label(c)}</b>
                    {c.createdBy && c.displayName ? <span className="hint"> · {c.createdBy}</span> : null}
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {c.contractCount.toLocaleString('en-US')}
                  </td>
                  <td style={{ minWidth: '13rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="track" style={{ flex: 1 }} title={`${c.uploadedSlots.toLocaleString('en-US')} of ${c.totalSlots.toLocaleString('en-US')} documents`}>
                        <i className="a" style={{ width: `${Math.min(100, c.completenessPct)}%` }} />
                      </div>
                      <span className="num" style={{ whiteSpace: 'nowrap' }}>
                        <b>{c.completenessPct.toFixed(1)}%</b>
                      </span>
                    </div>
                    <span className="hint num">
                      {c.uploadedSlots.toLocaleString('en-US')} of {c.totalSlots.toLocaleString('en-US')}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {c.completeCount.toLocaleString('en-US')}
                  </td>
                  <td className="num" style={{ textAlign: 'right', color: c.emptyCount ? 'var(--bad)' : undefined }}>
                    {c.emptyCount.toLocaleString('en-US')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {DOCUMENT_TYPES.map((t) => {
                        const n = c.byType[t] || 0
                        const share = c.contractCount ? n / c.contractCount : 0
                        return (
                          <span
                            key={t}
                            title={`${DOCUMENT_LABELS[t]}: ${n.toLocaleString('en-US')} of ${plural(c.contractCount, 'PO')}`}
                            style={{
                              width: 14,
                              height: 18,
                              borderRadius: 3,
                              background: `color-mix(in srgb, var(--accent) ${Math.round(share * 100)}%, var(--muted-bg))`,
                            }}
                          />
                        )
                      })}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="hint">
                    No POs in this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {known ? (
        <p className="hint" style={{ padding: '10px 16px 14px', margin: 0 }}>
          Users come from the SAP ME2N report loaded
          {data?.loaded.loadedAt ? ` on ${longDate(data.loaded.loadedAt)}` : ''} ({plural(known, 'PO')}, {plural(data?.loaded.creators || 0, 'user')}). A PO created after that is listed under
          &quot;No creator data&quot; until the report is loaded again.{' '}
          {data?.auto?.enabled ? 'The SAP share is checked for a new report every morning.' : 'Automatic loading is off: an administrator loads the report here.'} SAP only gives the
          NIK; names will come from the PRC application.
        </p>
      ) : null}
      {problem ? (
        <div style={{ padding: '0 16px 14px' }}>
          <div className="alert bad" role="alert">
            <span>
              The last check of the SAP share ({longDate(problem.at)}) found a problem: {problem.detail || problem.outcome}
            </span>
          </div>
        </div>
      ) : null}
    </>
  )
}
