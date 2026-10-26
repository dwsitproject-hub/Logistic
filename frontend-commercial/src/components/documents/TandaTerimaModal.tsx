'use client'

import { Download, X } from 'lucide-react'
import { useState } from 'react'
import { apiBlob, errorMessage } from '@/lib/api'
import { typesDone } from '@/lib/documentTypes'
import { ddmmyyyy, isoDate, parseDdMmYyyy } from '@/lib/format'
import { saveBlob } from '@/lib/files'
import type { DocumentRow } from '@/lib/types'
import { ErrorNote, Modal } from '../ui'

/**
 * One Tanda Terima PDF for the chosen POs (POST /api/commercial-documents/tanda-terima/download). The API takes contract ext
 * numbers in the order they should print; the Send Date is typed dd/mm/yyyy as in KLIP.
 */
export function TandaTerimaModal({
  rows,
  removable,
  onRemove,
  onClose,
  onDone,
}: {
  rows: DocumentRow[]
  /** Several POs from the table selection can be removed here; a single PO from the drawer cannot. */
  removable: boolean
  onRemove: (row: DocumentRow) => void
  onClose: () => void
  onDone: (count: number) => void
}) {
  const [sendDate, setSendDate] = useState(ddmmyyyy(isoDate(new Date())))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    const iso = parseDdMmYyyy(sendDate)
    if (!iso) return setError('Enter the Send Date as dd/mm/yyyy, e.g. 26/10/2026.')
    if (!rows.length) return
    setBusy(true)
    setError('')
    try {
      const { blob, fileName } = await apiBlob('/commercial-documents/tanda-terima/download', {
        method: 'POST',
        body: { contractExtNos: rows.map((r) => r.contract_ext_no), sendDate: iso },
      })
      saveBlob(blob, fileName || `Tanda_Terima_${iso}.pdf`)
      onDone(rows.length)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Download Tanda Terima"
      subtitle={`${rows.length} PO${rows.length === 1 ? '' : 's'} selected. Enter the Send Date to generate one PDF for all of them.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={() => void download()} disabled={busy || !rows.length}>
            <Download aria-hidden />
            {busy ? 'Generating…' : 'Download PDF'}
          </button>
        </>
      }
    >
      <div className="field">
        <span className="flabel">Selected POs</span>
        <div className="ttlist">
          {rows.map((r) => (
            <div className="ttrow" key={r.id}>
              <span className="mono">{r.po_number || r.contract_ext_no}</span>
              <span className="hint ellipsis" title={r.supplier || undefined}>
                {r.supplier || '-'}
              </span>
              <span className="hint num">{typesDone(r)}/9 docs</span>
              {removable ? (
                <button
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  type="button"
                  onClick={() => onRemove(r)}
                  aria-label={`Remove PO ${r.po_number || r.contract_ext_no}`}
                >
                  <X aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {!rows.length ? <span className="hint">No PO selected.</span> : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor="tt-date">Send Date</label>
        <input
          className="input"
          id="tt-date"
          value={sendDate}
          onChange={(e) => setSendDate(e.target.value)}
          placeholder="dd/mm/yyyy"
          inputMode="numeric"
          style={{ maxWidth: 180 }}
        />
        <span className="hint">Printed on the receipt as the date the documents were sent.</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  )
}
