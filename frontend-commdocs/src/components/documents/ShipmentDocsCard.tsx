'use client'

import { Download, ExternalLink, Ship } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiData, errorMessage } from '@/lib/api'
import { dateTime, longDate, plural } from '@/lib/format'
import { fileSize } from '@/lib/files'
import type { ShipmentDocGroup } from '@/lib/types'
import { ErrorNote, Spinner } from '../ui'

/**
 * Shipment Docs: the BL and SI files that were uploaded in KLIP (Shipments > Edit Shipment) for this PO, grouped by voyage (vessel, voyage, STO, date).
 * Read-only: uploading and deleting stay in KLIP. A voyage that carries several POs has one set of files, so the same files show under each of its POs and say
 * so. The Contract of a shipment is not listed here: COD has its own Contract card. The files open through the same /api/documents/:id/view and /download that KLIP uses.
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

  const total = groups ? groups.reduce((n, g) => n + g.documents.length, 0) : 0

  return (
    <div className="panel sd-card" aria-label="Shipment Docs">
      <div className="sd-head">
        <b>
          <Ship aria-hidden /> Shipment Docs{groups && total ? ` (${total})` : ''}
        </b>
        <span className="hint">BL and SI uploaded in KLIP · view only</span>
      </div>
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
            {g.documents.map((d) => (
              <div className="sd-doc" key={d.id}>
                <span className={`pill ${d.type === 'BL' ? 'ok' : 'neutral'}`}>{d.type}</span>
                <div style={{ minWidth: 0 }}>
                  <span className="sd-name" title={d.fileName}>
                    {d.fileName}
                  </span>
                  <small>
                    {dateTime(d.uploadedAt)}
                    {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}
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
          </div>
        ))
      )}
    </div>
  )
}
