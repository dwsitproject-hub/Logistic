'use client'

import { useEffect, useState } from 'react'
import { apiData, errorMessage } from '@/lib/api'
import { dateTime, longDate, plural } from '@/lib/format'
import { fileSize } from '@/lib/files'
import type { ShipmentDocGroup } from '@/lib/types'

export type ShipmentDoc = ShipmentDocGroup['documents'][number]

/** The two kinds of file a voyage carries, each with its own section: a BL and a SI are different documents with different owners. */
const SECTIONS: Array<{ type: ShipmentDoc['type']; label: string }> = [
  { type: 'BL', label: 'Bill of Lading (BL)' },
  { type: 'SI', label: 'Shipping Instruction (SI)' },
]

/**
 * The BL and SI files that were uploaded in KLIP (Shipments > Edit Shipment) for this PO, grouped by voyage. Loaded by the drawer, which lists "Shipment Docs" in
 * the checklist like any other document type and shows the picked file in the same viewer. The Contract of a shipment is not here: COD has its own Contract type.
 */
export function useShipmentDocs(poKey: string) {
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

  const files = groups ? groups.flatMap((g) => g.documents) : []
  const latest = files.reduce<ShipmentDoc | null>((best, d) => (!best || String(d.uploadedAt).localeCompare(String(best.uploadedAt)) > 0 ? d : best), null)
  return { groups, files, latest, error }
}

/**
 * The file picker of the Shipment Docs type, in the drawer's right-hand panel above the viewer: per voyage (vessel, voyage, STO, date) a Bill of Lading and a
 * Shipping Instruction section, each file a row that opens in the viewer. A voyage that carries several POs has one set of files, so the same files show under
 * each of its POs and say so.
 */
export function ShipmentDocsPicker({
  groups,
  selectedId,
  onSelect,
}: {
  groups: ShipmentDocGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (!groups.length) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        No BL or SI has been uploaded in KLIP for this PO yet.
      </p>
    )
  }
  return (
    <div className="panel sd-card" aria-label="Shipment Docs files">
      {groups.map((g) => (
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
                  <button type="button" className="sd-file" key={d.id} aria-pressed={selectedId === d.id} onClick={() => onSelect(d.id)}>
                    <span className="sd-name" title={d.fileName}>
                      {d.fileName}
                    </span>
                    <small>
                      {dateTime(d.uploadedAt)}
                      {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
                      {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}
                      <span className="badge">via KLIP</span>
                    </small>
                  </button>
                ))}
              </section>
            )
          })}
        </div>
      ))}
    </div>
  )
}
