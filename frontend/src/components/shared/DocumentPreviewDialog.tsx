'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadDocumentPreview } from '@/lib/documentView'

export type PreviewableDocument = { id: string; fileName: string; mimeType?: string | null }

/**
 * Shows one uploaded document (PDF or image) in a dialog over the page, with Download. Nothing leaves the page: no new tab, no file saved. The file is fetched once when the
 * dialog opens; the blob URL is revoked when it closes or another document is chosen, and a slow answer for a document the user has already moved off is dropped.
 *
 * Its own layer, not the Radix Dialog: that one is fixed at z-50, and the Contract Details modal (z-70 when it is stacked on another modal) would hide it. This sits at
 * z-110, above the page's activity button (z-100) and every modal; Escape or a click outside closes it.
 */
export function DocumentPreviewDialog({ doc, onClose }: { doc: PreviewableDocument | null; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [type, setType] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    setUrl('')
    setType('')
    setError('')
    if (!doc) {
      setLoading(false)
      return
    }
    setLoading(true)
    let made = ''
    void loadDocumentPreview(doc.id, doc.fileName, doc.mimeType).then((result) => {
      if (mine !== seq.current) {
        if (result.url) URL.revokeObjectURL(result.url)
        return
      }
      made = result.url
      setUrl(result.url)
      setType(result.type)
      setError(result.error ?? '')
      setLoading(false)
    })
    return () => {
      if (made) URL.revokeObjectURL(made)
    }
  }, [doc?.id, doc?.fileName, doc?.mimeType]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The modal behind this one would otherwise close on the same key.
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [doc, onClose])

  if (!doc || typeof document === 'undefined') return null

  const download = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = doc.fileName
    a.click()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={doc.fileName} className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-gray-900" title={doc.fileName}>
            {doc.fileName}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="outline" size="sm" onClick={download} disabled={!url}>
              <Download className="mr-1 h-4 w-4" />
              Download
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close preview" title="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-gray-50">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading document...
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-600">{error}</div>
          ) : type === 'application/pdf' ? (
            <iframe title={doc.fileName} src={`${url}#toolbar=1`} className="h-full w-full border-0 bg-gray-100" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={doc.fileName} className="mx-auto h-full max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
