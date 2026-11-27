'use client'

import { useEffect, useState } from 'react'
import { Download, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { previewMimeType } from '@/lib/documentView'
import { codVersionLabel, downloadCodFile, pickCodVersion, type CodFileGroup } from '@/lib/codFiles'
import { formatDateTimeDMY } from '@/lib/dateFormat'
import type { PreviewableDocument } from '@/components/shared/DocumentPreviewDialog'

interface Props {
  group: CodFileGroup
  /** Opens the file in the page's preview dialog. */
  onPreview: (doc: PreviewableDocument) => void
  /** The "In use" badge, on the latest version only: set when that file is certain to be the one that goes out. */
  inUse?: boolean
  /** A line under the latest version: where a file of this kind goes (for example "Sent to JPS and the Jetty email when the PO has no Contract uploaded in KLIP"). */
  note?: string
  /** A line under the file, for a limit the user should know (for example "Uploaded for the PO, not for one voyage"). */
  footnote?: string
  onError?: (message: string) => void
}

/**
 * One PO's files of one COD type, read only: the version picked in a dropdown (opened on the latest), its name, who uploaded it and when, View and Download. The dropdown only
 * exists when there is more than one version. The "In use" badge, when the page can be sure of it, sits on the latest version alone, so someone who picks an older one sees at once that
 * it is not the one that goes out.
 */
export function CodFilesBlock({ group, onPreview, inUse, note, footnote, onError }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const latestId = group.versions[0]?.id ?? null
  // A reload that brings a newer version opens on it again; a pick of a version that no longer exists falls back to the latest (pickCodVersion).
  useEffect(() => {
    setPickedId(null)
  }, [latestId, group.poNumber])

  const current = pickCodVersion(group, pickedId)
  if (!current) return null
  const canPreview = previewMimeType(current.fileName, current.mimeType) !== null

  return (
    <div className="mt-2 rounded-md border border-blue-100 bg-blue-50/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[0.6875rem] text-gray-600">
        <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800">COD</span>
        <span className="truncate" title={`PO ${group.poNumber}`}>
          PO {group.poNumber} · read only
        </span>
      </div>
      {group.versions.length > 1 ? (
        <select
          aria-label={`Version of ${current.fileName}`}
          className="mt-1 w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-[0.6875rem] text-gray-800"
          value={current.id}
          onChange={(e) => setPickedId(e.target.value)}
        >
          {group.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {codVersionLabel(v)}
            </option>
          ))}
        </select>
      ) : null}
      <p className="mt-1 flex items-center gap-1 text-xs font-medium text-gray-800">
        <span className="truncate" title={current.fileName}>
          {current.fileName}
        </span>
        {current.isLatest && inUse ? (
          <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-green-800" title={note}>
            In use
          </span>
        ) : null}
        {!current.isLatest ? <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[0.625rem] font-medium text-gray-700">Older version</span> : null}
      </p>
      {group.versions.length === 1 ? (
        <p className="text-[0.625rem] tabular-nums text-gray-500">
          {[current.uploadedAt ? formatDateTimeDMY(current.uploadedAt) : '', current.uploadedBy ?? ''].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <div className="mt-1 flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[0.6875rem]"
          disabled={!canPreview}
          title={canPreview ? 'View here, without leaving the page' : 'This file type cannot be previewed. Use Download.'}
          onClick={() => onPreview({ id: current.id, fileName: current.fileName, mimeType: current.mimeType, source: 'cod' })}
        >
          <Eye className="mr-1 h-3 w-3" />
          View
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[0.6875rem]"
          onClick={() => {
            downloadCodFile(current.id, current.fileName).catch(() => onError?.('Failed to download the document. Please try again.'))
          }}
        >
          <Download className="mr-1 h-3 w-3" />
          Download
        </Button>
      </div>
      {note && current.isLatest ? <p className="mt-1 text-[0.625rem] text-gray-500">{note}</p> : null}
      {footnote ? <p className="mt-1 text-[0.625rem] text-gray-500">{footnote}</p> : null}
    </div>
  )
}
