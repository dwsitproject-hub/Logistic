'use client'

import { Pencil, Save, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ErrorNote, Modal, Spinner, useToast } from '@/components/ui'
import { apiData, apiJson, errorMessage, isAbort, toQuery } from '@/lib/api'
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from '@/lib/documentTypes'
import { longDate, plural } from '@/lib/format'
import { readPoCreators } from '@/lib/poCreators'
import type { CreatorCompleteness } from '@/lib/types'

type Order = 'pos' | 'complete' | 'gaps'
type Payload = { creators: CreatorCompleteness[]; loaded: { pos: number; creators: number; loadedAt: string | null } }

const CHUNK = 1000

/**
 * Documents uploaded vs total, by the person who created the PO in SAP (GET /api/commercial-documents/completeness-by-creator).
 * The creator is the "Created by" of the SAP ME2N report, which an administrator loads here: the SAP auto-import does not read it.
 * SAP gives an employee number; an administrator can give a number a name. A PO the report does not know is listed as "No creator data".
 */
export function CreatorPanel({ range, isAdmin }: { range: { dateFrom: string; dateTo: string }; isAdmin: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<Order>('pos')
  const [reload, setReload] = useState(0)
  const [loadingFile, setLoadingFile] = useState('')
  const [naming, setNaming] = useState<CreatorCompleteness | null>(null)
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
        setError(errorMessage(err, 'Could not load the creators. Please try again.'))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [range, reload])

  const rows = useMemo(() => {
    const list = data?.creators || []
    const ratio = (c: CreatorCompleteness) => (c.totalSlots ? c.uploadedSlots / c.totalSlots : 0)
    // The row for POs without a creator always comes last: it is a gap in the data, not a person.
    const sorted = [...list].sort((a, b) => {
      if (!a.createdBy !== !b.createdBy) return a.createdBy ? -1 : 1
      if (order === 'complete') return ratio(b) - ratio(a) || b.contractCount - a.contractCount
      if (order === 'gaps') return ratio(a) - ratio(b) || b.missingSlots - a.missingSlots
      return b.contractCount - a.contractCount || ratio(b) - ratio(a)
    })
    return sorted
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
      toast(`Loaded ${plural(read.rows.length, 'PO')} from ${plural(read.creators, 'creator')}${notes ? ` · ${notes}` : ''}`)
      setReload((n) => n + 1)
    } catch (err) {
      setError(errorMessage(err, 'The report could not be loaded.'))
    } finally {
      setLoadingFile('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const label = (c: CreatorCompleteness) => (c.createdBy ? c.displayName || c.createdBy : 'No creator data')
  const known = data?.loaded.pos || 0

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '14px 16px 0', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ padding: 0 }}>Documents by SAP creator</h3>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            Uploaded out of 11 per PO, by the person who created the PO in SAP.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
            <>
              <button className="btn sm" type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(loadingFile)}>
                <Upload aria-hidden />
                {loadingFile || 'Load ME2N report'}
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
            </>
          ) : null}
        </div>
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
          No creator data yet.{' '}
          {isAdmin
            ? 'Load the SAP ME2N report (Excel) with the button above: it has the "Created by" of every PO.'
            : 'An administrator needs to load the SAP ME2N report first.'}
        </p>
      ) : (
        <div className="tbl-wrap">
          <table style={{ minWidth: '44rem' }}>
            <thead>
              <tr>
                <th>Created by</th>
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
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                      <b>{label(c)}</b>
                      {c.createdBy && c.displayName ? <span className="hint">· {c.createdBy}</span> : null}
                      {isAdmin && c.createdBy ? (
                        <button className="icon-btn" type="button" title="Give this number a name" aria-label={`Name ${c.createdBy}`} onClick={() => setNaming(c)}>
                          <Pencil aria-hidden />
                        </button>
                      ) : null}
                    </div>
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
          Creators come from the SAP ME2N report loaded
          {data?.loaded.loadedAt ? ` on ${longDate(data.loaded.loadedAt)}` : ''} ({plural(known, 'PO')}, {plural(data?.loaded.creators || 0, 'creator')}). A PO created after that is listed under
          &quot;No creator data&quot; until the report is loaded again.
        </p>
      ) : null}
      {naming ? (
        <NameModal
          creator={naming}
          onClose={() => setNaming(null)}
          onSaved={() => {
            setNaming(null)
            setReload((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}

function NameModal({ creator, onClose, onSaved }: { creator: CreatorCompleteness; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(creator.displayName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await apiJson('/commercial-documents/creator-names', { method: 'PUT', body: { created_by: creator.createdBy, display_name: name.trim() } })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Name this SAP user"
      subtitle={`SAP user ${creator.createdBy}`}
      onClose={onClose}
      busy={busy}
      narrow
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
            <Save aria-hidden />
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cn-name">Name</label>
        <input className="input" id="cn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={120} autoFocus />
        <span className="hint">Leave it empty to show the number again.</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  )
}
