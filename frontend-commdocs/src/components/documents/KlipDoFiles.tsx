'use client'

import { useEffect, useState } from 'react'
import { apiData, errorMessage } from '@/lib/api'
import { dateTime, plural } from '@/lib/format'
import { fileSize } from '@/lib/files'

export type KlipDoFile = {
  id: string
  fileName: string
  sizeBytes: number | null
  mimeType: string | null
  uploadedAt: string | null
  uploadedBy: string | null
}

/**
 * The Delivery Order files uploaded in KLIP (Trucking > Upload DO) for this PO, newest first. They fill the DO slot of the PO like a COD upload and are read only here:
 * the DO row of the drawer lists them next to the COD versions and the viewer opens them through the KLIP document endpoint.
 */
export function useKlipDo(poKey: string) {
  const [files, setFiles] = useState<KlipDoFile[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!poKey) return
    const ctrl = new AbortController()
    setFiles(null)
    setError('')
    apiData<{ files: KlipDoFile[] }>(`/commercial-documents/klip-do/${encodeURIComponent(poKey)}`, { signal: ctrl.signal })
      .then((d) => setFiles(d?.files || []))
      .catch((err) => {
        if (!ctrl.signal.aborted) setError(errorMessage(err, 'Could not load the delivery orders uploaded in KLIP.'))
      })
    return () => ctrl.abort()
  }, [poKey])

  return { files, error }
}

/** The KLIP files under the DO viewer bar: one line each, the chosen one marked. Shown only when KLIP holds a DO for the PO. */
export function KlipDoList({ files, selectedId, onSelect }: { files: KlipDoFile[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!files.length) return null
  return (
    <div className="sd-pick" aria-label="Delivery orders uploaded in KLIP">
      <small className="hint">
        {plural(files.length, 'file')} uploaded in KLIP (Trucking &gt; Upload DO), view only
      </small>
      {files.map((f) => (
        <button
          type="button"
          className="sd-row"
          key={f.id}
          aria-pressed={f.id === selectedId}
          title={f.uploadedBy ? `Uploaded by ${f.uploadedBy}` : undefined}
          onClick={() => onSelect(f.id)}
        >
          <span className="nm">{f.fileName}</span>
          <small>
            {dateTime(f.uploadedAt)}
            {f.sizeBytes ? ` · ${fileSize(f.sizeBytes)}` : ''}
          </small>
          <span className="badge">via KLIP</span>
        </button>
      ))}
    </div>
  )
}
