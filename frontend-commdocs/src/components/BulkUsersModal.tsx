'use client'

import { Download, FileSpreadsheet, Upload, UserPlus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { apiJson, errorMessage } from '@/lib/api'
import { MAX_BULK_ROWS, bulkRowBody, checkBulkRows, parseBulkSheet, type BulkRow } from '@/lib/bulkUsers'
import { downloadBulkUsersTemplate } from '@/lib/bulkUsersTemplate'
import { plural } from '@/lib/format'
import { roleLabel } from '@/lib/roles'
import type { Role } from '@/lib/types'
import { ErrorNote, Modal } from './ui'

type Result = { ok: boolean; invited?: boolean; error?: string }

/**
 * Users > Bulk upload: add many users from an Excel file. Download the template (Role is a real dropdown), fill it, upload it, check every row in
 * the preview (the role of a row can be changed there), then add. Rows with a problem are skipped; the rest are created one by one through the
 * same POST /users the Add user form uses, so each person gets the usual invitation e-mail.
 */
export function BulkUsersModal({
  roles,
  plants,
  existingEmails,
  onClose,
  onChanged,
}: {
  /** The roles a user can be given (active ones). */
  roles: Role[]
  plants: string[]
  existingEmails: string[]
  onClose: () => void
  /** Called once users were added, so the page reloads its list. */
  onChanged: () => void
}) {
  const [rows, setRows] = useState<BulkRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<number, Result>>({})
  const [finished, setFinished] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const checked = useMemo(
    () => (rows ? checkBulkRows(rows, { roles, plants, existingEmails: new Set(existingEmails.map((e) => e.toLowerCase())) }) : []),
    [rows, roles, plants, existingEmails],
  )
  const ready = checked.filter((r) => !r.errors.length)
  const problems = checked.length - ready.length

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = wb.Sheets['Users'] || wb.Sheets[wb.SheetNames[0]]
      const parsed = parseBulkSheet(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }))
      if (!parsed.length) return setError('No users found. Use the template: the header row needs an "Email" column and at least one filled row.')
      if (parsed.length > MAX_BULK_ROWS) return setError(`The file has ${parsed.length} rows. Upload at most ${MAX_BULK_ROWS} at a time.`)
      setRows(parsed)
      setFileName(file.name)
      setResults({})
      setFinished(false)
    } catch {
      setError('This file could not be read. Save it as .xlsx (Excel) and try again.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const addAll = async () => {
    setRunning(true)
    setError('')
    const done: Record<number, Result> = {}
    for (const r of ready) {
      try {
        const out = await apiJson<{ invitation_sent: boolean }>('/users', { method: 'POST', body: bulkRowBody(r) })
        done[r.rowNo] = { ok: true, invited: Boolean(out.data?.invitation_sent) }
      } catch (err) {
        done[r.rowNo] = { ok: false, error: errorMessage(err) }
      }
      setResults({ ...done })
    }
    setRunning(false)
    setFinished(true)
    if (Object.values(done).some((d) => d.ok)) onChanged()
  }

  const added = Object.values(results).filter((r) => r.ok).length
  const failed = Object.values(results).filter((r) => !r.ok).length
  const noMail = Object.values(results).filter((r) => r.ok && !r.invited).length

  return (
    <Modal
      title="Bulk upload users"
      subtitle="Add many users at once from an Excel file."
      onClose={onClose}
      wide
      busy={running}
      footer={
        <>
          {finished ? null : (
            <button className="btn" type="button" onClick={onClose} disabled={running}>
              Cancel
            </button>
          )}
          {finished ? (
            <button className="btn primary" type="button" onClick={onClose}>
              Close
            </button>
          ) : rows ? (
            <button className="btn primary" type="button" onClick={() => void addAll()} disabled={running || !ready.length}>
              <UserPlus aria-hidden />
              {running ? `Adding ${Object.keys(results).length}/${ready.length}…` : `Add ${plural(ready.length, 'user')}`}
            </button>
          ) : null}
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn"
          type="button"
          onClick={() => void downloadBulkUsersTemplate(roles, plants).catch((e) => setError(errorMessage(e, 'Could not create the template.')))}
          disabled={running}
        >
          <Download aria-hidden />
          Download template
        </button>
        <button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={running || finished}>
          <Upload aria-hidden />
          {rows ? 'Choose another file' : 'Upload filled file'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        <span className="hint">
          {fileName ? (
            <>
              <FileSpreadsheet aria-hidden style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> {fileName}
            </>
          ) : (
            `Excel (.xlsx), up to ${MAX_BULK_ROWS} rows. Role is a dropdown in the template.`
          )}
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>

      {rows ? (
        <>
          <p className="hint" style={{ margin: 0 }}>
            {finished
              ? `${plural(added, 'user')} added${noMail ? `, ${noMail} without an invitation e-mail (use "Resend invitation" on the Users page)` : ''}${failed ? `, ${failed} failed` : ''}${problems ? `, ${problems} skipped` : ''}.`
              : `${plural(ready.length, 'row')} ready${problems ? `, ${plural(problems, 'row')} with a problem will be skipped` : ''}. Change a role in the table if it is wrong.`}
          </p>
          <div className="tbl-wrap" style={{ maxHeight: '42vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
            <table style={{ minWidth: '46rem' }}>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Level</th>
                  <th>Region/Plant</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {checked.map((r) => {
                  const res = results[r.rowNo]
                  return (
                    <tr key={r.rowNo}>
                      <td className="hint">{r.rowNo}</td>
                      <td>{r.fullName || '-'}</td>
                      <td>{r.email || '-'}</td>
                      <td>
                        <select
                          className="select"
                          aria-label={`Role for row ${r.rowNo}`}
                          value={r.roleName || ''}
                          disabled={running || finished}
                          onChange={(e) => setRows((cur) => (cur || []).map((x) => (x.rowNo === r.rowNo ? { ...x, role: e.target.value } : x)))}
                        >
                          {r.roleName ? null : <option value="">{r.role ? `"${r.role}"?` : 'Choose…'}</option>}
                          {roles.map((o) => (
                            <option key={o.id} value={o.role_name}>
                              {roleLabel(o)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{r.levelValue || r.level || '-'}</td>
                      <td>{r.plantList.join(', ') || '-'}</td>
                      <td>
                        {res ? (
                          res.ok ? (
                            <span className={`pill ${res.invited ? 'ok' : 'warn'}`}>{res.invited ? 'Added' : 'Added, no e-mail'}</span>
                          ) : (
                            <span className="pill bad" title={res.error}>
                              Failed: {res.error}
                            </span>
                          )
                        ) : r.errors.length ? (
                          <span className="pill bad" title={r.errors.join(' ')}>
                            {r.errors[0]}
                            {r.errors.length > 1 ? ` (+${r.errors.length - 1})` : ''}
                          </span>
                        ) : (
                          <span className="pill ok">Ready</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          1. Download the template. 2. Fill one person per row; pick the Role from the dropdown. 3. Upload it here and check the rows before
          anything is created. Everyone gets an e-mail to choose their own password.
        </p>
      )}
    </Modal>
  )
}
