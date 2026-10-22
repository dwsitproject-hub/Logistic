'use client'

import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { COMMERCIAL_DOCUMENT_LABELS, type CommercialDocumentType } from '@/lib/commercialDocumentsTypes'
import { cn } from '@/lib/utils'

export type PdfPreviewState = {
  fileId: string
  fileName: string
  documentType: CommercialDocumentType
  url: string
  error?: string
}

/** Inline PDF viewer for one commercial document: title, Download, close, and the PDF (or the reason it cannot be shown). */
export function PdfPreviewPanel({
  preview,
  onClose,
  onDownload,
  className,
}: {
  preview: PdfPreviewState
  onClose: () => void
  onDownload: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col bg-white overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b bg-white shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            {COMMERCIAL_DOCUMENT_LABELS[preview.documentType]}
          </div>
          <div className="text-xs text-gray-500 truncate mt-0.5" title={preview.fileName}>
            {preview.fileName}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close preview">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {preview.error ? (
        <div className="flex-1 min-h-[280px] lg:min-h-0 flex items-center justify-center px-6 text-center text-sm text-gray-600 bg-gray-50">
          {preview.error}
        </div>
      ) : (
        <iframe
          src={`${preview.url}#toolbar=1`}
          title={preview.fileName}
          className="w-full flex-1 min-h-[280px] lg:min-h-0 bg-gray-100 border-0"
        />
      )}
    </div>
  )
}
