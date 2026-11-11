'use client'

import { RefreshCw, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorNote, Spinner, useToast } from '@/components/ui'
import { apiData, apiJson, errorMessage } from '@/lib/api'
import { dateTime, plural } from '@/lib/format'
import { readPoCreators } from '@/lib/poCreators'

type Run = {
  id: string
  trigger: string
  startedAt: string
  outcome: string
  fileName: string | null
  rows: number | null
  creators: number | null
  detail: string | null
}
type Status = {
  running: boolean
  enabled: boolean
  cron: string
  loaded: { pos: number; creators: number; loadedAt: string | null }
  runs: Run[]
}

const OUTCOME: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  loaded: ['Loaded', 'ok'],
  unchanged: ['Already up to date', 'neutral'],
  no_file: ['No ME2N file', 'warn'],
  source_missing: ['Folder not found', 'bad'],
  failed: ['Failed', 'bad'],
}

const CHUNK = 1000

/**
 * The SAP ME2N report (who created each PO), the source of Dashboard > Completeness > By user. The schedule reads it from the SAP share every
 * morning; this page is the backup, like the Sync button on KLIP's Logistics Report page: Sync looks in the share now, Upload loads a file by hand,
 * and the table says what every run did (GET /api/commercial-documents/po-creators/status, ADMIN).
 */
export default function Me2nReportPage() {
  const { toast } = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [uploading, setUploading] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await apiData<Status>('/commercial-documents/po-creators/status'))
    } catch (err) {
      setError(errorMessage(err, 'Could not load the ME2N status. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sync = async () => {
    setSyncing(true)
    setError('')
    try {
      const res = await apiJson<{ outcome: string; fileName: string | null; rows: number; creators: number; detail: string | null }>('/commercial-documents/po-creators/sync', { method: 'POST' })
      const r = res.data
      if (r.outcome === 'loaded') toast(`Loaded ${plural(r.rows, 'PO')} from ${plural(r.creators, 'user')} (${r.fileName})`)
      else if (r.outcome === 'unchanged') toast(`Already up to date (${r.fileName})`)
      else setError(r.detail || 'The report could not be loaded.')
    } catch (err) {
      setError(errorMessage(err, 'Could not check the SAP share.'))
    } finally {
      setSyncing(false)
      void load()
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      setUploading('Reading the file…')
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const read = readPoCreators(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }))
      if (!read) throw new Error('This is not the ME2N report: the sheet needs the columns "Purchasing Document" and "Created by".')
      if (!read.rows.length) throw new Error('The report has no PO with a creator.')
      for (let i = 0; i < read.rows.length; i += CHUNK) {
        setUploading(`Loading ${Math.min(i + CHUNK, read.rows.length).toLocaleString('en-US')} of ${read.rows.length.toLocaleString('en-US')} POs…`)
        await apiJson('/commercial-documents/po-creators', { method: 'POST', body: { rows: read.rows.slice(i, i + CHUNK), source_file: file.name } })
      }
      const notes = [read.conflicts ? `${plural(read.conflicts, 'PO')} had two creators (the first was kept)` : '', read.skipped ? `${plural(read.skipped, 'row')} skipped` : '']
        .filter(Boolean)
        .join(', ')
      toast(`Loaded ${plural(read.rows.length, 'PO')} from ${plural(read.creators, 'user')}${notes ? ` · ${notes}` : ''}`)
    } catch (err) {
      setError(errorMessage(err, 'The report could not be loaded.'))
    } finally {
      setUploading('')
      if (fileRef.current) fileRef.current.value = ''
      void load()
    }
  }

  const busy = syncing || Boolean(uploading) || status?.running === true

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ME2N Report</h1>
          <p>The SAP report that says who created each PO. It feeds Dashboard &gt; Completeness &gt; By user.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => void sync()} disabled={busy} title="Look for the newest ME2N report in the SAP share now">
            <RefreshCw aria-hidden />
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button className="btn primary" type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Load an ME2N Excel file by hand">
            <Upload aria-hidden />
            {uploading || 'Upload file'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {loading ? (
        <div style={{ padding: 16 }}>
          <Spinner />
        </div>
      ) : status ? (
        <>
          <div className="kpis">
            <div className="panel kpi">
              <span>POs with a creator</span>
              <b>{status.loaded.pos.toLocaleString('en-US')}</b>
              <small>from the SAP ME2N report</small>
            </div>
            <div className="panel kpi">
              <span>SAP users</span>
              <b>{status.loaded.creators.toLocaleString('en-US')}</b>
              <small>who created those POs</small>
            </div>
            <div className="panel kpi">
              <span>Last loaded</span>
              <b style={{ fontSize: '1.125rem' }}>{status.loaded.loadedAt ? dateTime(status.loaded.loadedAt) : '-'}</b>
              <small>{status.loaded.loadedAt ? 'newest data in COD' : 'nothing loaded yet'}</small>
            </div>
            <div className="panel kpi">
              <span>Schedule</span>
              <b style={{ fontSize: '1.125rem', color: status.enabled ? 'var(--ok)' : 'var(--warn)' }}>{status.enabled ? 'On' : 'Off'}</b>
              <small>{status.enabled ? `cron ${status.cron} (Asia/Jakarta)` : 'switched off on this server: use Sync or Upload'}</small>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Runs</h3>
            <p className="hint" style={{ padding: '2px 16px 0', margin: 0 }}>
              Every look at the SAP share, by the schedule or by Sync. A file already loaded is not loaded again.
            </p>
            <div className="tbl-wrap">
              <table style={{ minWidth: '48rem' }}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Started by</th>
                    <th>Result</th>
                    <th>File</th>
                    <th style={{ textAlign: 'right' }}>POs</th>
                    <th style={{ textAlign: 'right' }}>Users</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {status.runs.map((r) => {
                    const [label, tone] = OUTCOME[r.outcome] || [r.outcome, 'neutral' as const]
                    return (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{dateTime(r.startedAt)}</td>
                        <td>{r.trigger === 'cron' ? 'Schedule' : 'Sync'}</td>
                        <td>
                          <span className={`pill ${tone}`}>{label}</span>
                        </td>
                        <td className="hint" style={{ maxWidth: 260 }} title={r.fileName || undefined}>
                          <span className="ellipsis" style={{ display: 'block' }}>
                            {r.fileName || '-'}
                          </span>
                        </td>
                        <td className="num" style={{ textAlign: 'right' }}>
                          {r.rows === null || r.outcome !== 'loaded' ? '-' : r.rows.toLocaleString('en-US')}
                        </td>
                        <td className="num" style={{ textAlign: 'right' }}>
                          {r.creators === null || r.outcome !== 'loaded' ? '-' : r.creators.toLocaleString('en-US')}
                        </td>
                        <td className="hint">{r.outcome === 'unchanged' ? '' : r.detail || ''}</td>
                      </tr>
                    )
                  })}
                  {!status.runs.length ? (
                    <tr>
                      <td colSpan={7} className="hint">
                        No run yet. The schedule runs every morning; Sync looks in the share now.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
