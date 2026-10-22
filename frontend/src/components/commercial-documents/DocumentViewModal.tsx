'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  documentVersionLabel,
  filesForDocumentCategory,
  type CommercialDocumentFileRecord,
  type CommercialDocumentRow,
  type CommercialDocumentType,
} from '@/lib/commercialDocumentsTypes'
import {
  downloadCommercialDocument,
  loadCommercialDocumentPreview,
  revokePreviewUrl,
} from '@/lib/commercialDocumentFileAccess'
import { formatDateTimeDMY } from '@/lib/dateFormat'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { cn } from '@/lib/utils'
import { PdfPreviewPanel, type PdfPreviewState } from '@/components/commercial-documents/PdfPreviewPanel'

export type DocumentViewTarget = {
  row: CommercialDocumentRow
  type: CommercialDocumentType
}

type Props = {
  target: DocumentViewTarget | null
  onClose: () => void
}

/**
 * Read-only viewer opened from a checked cell of the Commercial Documents table: the document of that column for that contract, with Download.
 * When the type has several uploaded versions the newest opens first and the others are listed beside it. Uploading and deleting stay in
 * Document Checking (the pencil in Actions).
 */
export function DocumentViewModal({ target, onClose }: Props) {
  const [files, setFiles] = useState<CommercialDocumentFileRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PdfPreviewState | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  /** A slow answer for a file the user has already moved off must not replace the one on screen. */
  const previewSeq = useRef(0)

  const row = target?.row ?? null
  const type = target?.type ?? null
  const poNumber = String(row?.po_number || row?.contract_id || '').trim()
  const contractExtNo = String(row?.contract_ext_no || '').trim()

  // Oldest first, as filesForDocumentCategory returns them, so the label of a version (Contract, Contract (2), ...) is stable.
  const versions = useMemo(
    () => (type ? filesForDocumentCategory(files, type) : []),
    [files, type],
  )
  const selectedIndex = versions.findIndex((f) => f.id === selectedId)
  const selected = selectedIndex >= 0 ? versions[selectedIndex] : null

  const loadFiles = useCallback(async () => {
    if (!poNumber) {
      setFiles([])
      setLoadError('This contract has no PO number, so its documents cannot be looked up.')
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const qs = contractExtNo ? `?contract_ext_no=${encodeURIComponent(contractExtNo)}` : ''
      const res = await api.get(`/commercial-documents/files/${encodeURIComponent(poNumber)}${qs}`)
      setFiles(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch (err: unknown) {
      const e = err as { code?: string; name?: string }
      if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return
      setFiles([])
      setLoadError('Could not load the documents. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [poNumber, contractExtNo])

  // A new target: forget the previous one, then look its files up.
  useEffect(() => {
    previewSeq.current += 1
    setFiles([])
    setSelectedId(null)
    setPreview(null)
    setPreviewLoading(false)
    setDownloadError(null)
    setLoadError(null)
    if (!target) return
    void loadFiles()
    // `target` is the trigger; loadFiles already depends on the PO and the contract it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.row.id, target?.type, loadFiles])

  // Once the files are in, open the newest version.
  useEffect(() => {
    if (!type || loading || loadError) return
    if (versions.length === 0) return
    setSelectedId((cur) => (cur && versions.some((f) => f.id === cur) ? cur : versions[versions.length - 1].id))
  }, [type, loading, loadError, versions])

  // Load the selected file into the viewer.
  useEffect(() => {
    if (!selected || !type) return
    const seq = ++previewSeq.current
    setPreviewLoading(true)
    setPreview(null)
    setDownloadError(null)
    void loadCommercialDocumentPreview(selected.id).then((result) => {
      if (seq !== previewSeq.current) {
        revokePreviewUrl(result.url)
        return
      }
      setPreview({
        fileId: selected.id,
        fileName: selected.file_name,
        documentType: type,
        url: result.url,
        ...(result.error ? { error: result.error } : {}),
      })
      setPreviewLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, type])

  // The object URL of the PDF on screen is released when it changes and when the modal goes away.
  useEffect(() => {
    const url = preview?.url
    return () => revokePreviewUrl(url)
  }, [preview?.url])

  const handleDownload = async () => {
    if (!selected) return
    setDownloadError(null)
    const failure = await downloadCommercialDocument(selected.id, selected.file_name)
    if (failure) setDownloadError(failure)
  }

  const label = type ? COMMERCIAL_DOCUMENT_LABELS[type] : ''

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-5xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            PO {formatSapDisplayValue(row?.po_number)} · Contract {formatSapDisplayValue(row?.contract_ext_no)}
            {row?.supplier ? ` · ${row.supplier}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex h-[65vh] min-h-[360px] flex-col gap-3 lg:flex-row">
          {versions.length > 1 ? (
            <ul
              className="flex shrink-0 gap-2 overflow-auto lg:w-60 lg:flex-col"
              aria-label={`${label} versions`}
              data-testid="document-versions"
            >
              {[...versions].reverse().map((file) => {
                const index = versions.findIndex((f) => f.id === file.id)
                const isSelected = file.id === selectedId
                return (
                  <li key={file.id} className="min-w-[200px] lg:min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(file.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left text-xs transition',
                        isSelected
                          ? 'border-blue-300 bg-blue-50 text-blue-900'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <div className="font-medium">
                        {documentVersionLabel(type as CommercialDocumentType, index)}
                        {index === versions.length - 1 ? ' · latest' : ''}
                      </div>
                      <div className="mt-0.5 truncate" title={file.file_name}>
                        {file.file_name}
                      </div>
                      <div className="mt-0.5 text-gray-500">{formatDateTimeDMY(file.created_at)}</div>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {downloadError ? (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {downloadError}
              </div>
            ) : null}

            {loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : loadError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-gray-600">
                <p>{loadError}</p>
                {poNumber ? (
                  <Button variant="outline" size="sm" onClick={() => void loadFiles()}>
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : versions.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-600">
                No {label} file is stored for this contract. It may have been removed after the table was loaded.
              </div>
            ) : previewLoading || !preview ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening document…
              </div>
            ) : (
              <PdfPreviewPanel
                preview={preview}
                onClose={onClose}
                onDownload={() => void handleDownload()}
                className="min-h-0 flex-1 rounded-md border"
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
