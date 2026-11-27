'use client'

import { Download, ExternalLink, Ship } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiData, errorMessage } from '@/lib/api'
import { dateTime, longDate, plural } from '@/lib/format'
import { fileSize } from '@/lib/files'
import type { ShipmentDocGroup } from '@/lib/types'
import { ErrorNote, Spinner } from '../ui'

type ShipmentDoc = ShipmentDocGroup['documents'][number]

/** The two kinds of file a voyage carries, each with its own section: a BL and a SI are different documents with different owners. */
const SECTIONS: Array<{ type: ShipmentDoc['type']; label: string }> = [
  { type: 'BL', label: 'Bill of Lading (BL)' },
  { type: 'SI', label: 'Shipping Instruction (SI)' },
]

/**
 * Shipment Docs: the BL and SI files that were uploaded in KLIP (Shipments > Edit Shipment) for this PO, grouped by voyage (vessel, voyage, STO, date) and, inside a
 * voyage, by kind (BL, SI). Read-only: uploading and deleting stay in KLIP. A voyage that carries several POs has one set of files, so the same files show under each
 * of its POs and say so. The Contract of a shipment is not listed here: COD has its own Contract card. The files open through the same /api/documents/:id/view
 * and /download that KLIP uses. Under the title: the latest upload, as the other document types show it (date and who).
 */
export function ShipmentDocsCard({ poKey }: { poKey: string }) {
  const [groups, setGroups] = useState<ShipmentDocGroup[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!poKey) return
    const ctrl = new AbortController()
    setGroups(null)
    setError('')
    apiData<{ groups: ShipmentDocGroup[] }>(`/commercial-documents/shipment-docs/${encodeURIComponent(poKey)}`, { signal: ctrl.signal })
      .then((d) => setGroups(d?.groups || []))
      .catch((err) => {
        if (!ctrl.signal.aborted) setError(errorMessage(err, 'Could not load the shipment documents.'))
      })
    return () => ctrl.abort()
  }, [poKey])

  const all = groups ? groups.flatMap((g) => g.documents) : []
  const latest = all.reduce<ShipmentDoc | null>((best, d) => (!best || String(d.uploadedAt).localeCompare(String(best.uploadedAt)) > 0 ? d : best), null)

  return (
    <div className="panel sd-card" aria-label="Shipment Docs">
      <div className="sd-head">
        <b>
          <Ship aria-hidden /> Shipment Docs{all.length ? ` (${all.length})` : ''}
        </b>
        <span className="hint">BL and SI uploaded in KLIP · view only</span>
      </div>
      {latest ? (
        <small className="sd-latest">
          Latest · {dateTime(latest.uploadedAt)}
          {latest.uploadedBy ? ` · ${latest.uploadedBy}` : ''}
          <span className="badge">via KLIP</span>
        </small>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
      {groups === null && !error ? (
        <Spinner />
      ) : groups && groups.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          No BL or SI has been uploaded in KLIP for this PO yet.
        </p>
      ) : (
        groups?.map((g) => (
          <div className="sd-group" key={g.shipmentId}>
            <div className="sd-gh">
              <b>{g.vesselName || 'Vessel not set'}</b>
              {g.voyageNo ? <span className="hint">Voyage {g.voyageNo}</span> : null}
              {g.reference ? <span className="hint mono">{g.reference}</span> : null}
              {g.date ? <span className="hint">{longDate(g.date)}</span> : null}
            </div>
            {g.sharedWithPos.length ? (
              <small className="hint" title={`Also on PO ${g.sharedWithPos.join(', ')}`}>
                Shared with {plural(g.sharedWithPos.length, 'other PO')}: the files belong to the voyage
              </small>
            ) : null}
            {SECTIONS.map(({ type, label }) => {
              const docs = g.documents.filter((d) => d.type === type)
              return (
                <section className="sd-sub" key={type} aria-label={label}>
                  <div className="sd-sh">
                    <span className={`pill ${docs.length ? 'ok' : 'neutral'}`}>{type}</span>
                    <b>{label}</b>
                    <span className="hint">{docs.length ? plural(docs.length, 'file') : 'Not uploaded yet'}</span>
                  </div>
                  {docs.map((d) => (
                    <div className="sd-doc" key={d.id}>
                      <div style={{ minWidth: 0, gridColumn: '1 / -1' }}>
                        <span className="sd-name" title={d.fileName}>
                          {d.fileName}
                        </span>
                        <small>
                          {dateTime(d.uploadedAt)}
                          {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
                          {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}
                          <span className="badge">via KLIP</span>
                        </small>
                      </div>
                      <div className="sd-actions">
                        <a className="btn sm ghost" href={`/api/documents/${encodeURIComponent(d.id)}/view`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink aria-hidden />
                          View
                        </a>
                        <a className="btn sm ghost" href={`/api/documents/${encodeURIComponent(d.id)}/download`} download>
                          <Download aria-hidden />
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
