'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { X, Upload, Eye, Download, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { FieldHelp } from '@/components/FieldHelp'
import { FIELD_HELP } from '@/lib/fieldHelpText'
import {
  COMMERCIAL_DOCUMENT_LABELS,
  COMMERCIAL_DOCUMENT_TYPES,
  commercialDocumentTypeLabel,
  documentVersionLabel,
  filesForDocumentCategory,
  isContractB2bOrigin,
  type CommercialDocumentFileRecord,
  type CommercialDocumentHistoryEntry,
  type CommercialDocumentRow,
  type CommercialDocumentType,
} from '@/lib/commercialDocumentsTypes'
import {
  formatCommercialDate,
  formatCommercialIdr,
  formatCommercialQtyKg,
  commercialTotalPriceTooltip,
} from '@/lib/commercialDocumentsFormat'
import { formatDateTimeDMY } from '@/lib/dateFormat'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SettlementInvoiceUploadModal } from '@/components/commercial-documents/SettlementInvoiceUploadModal'

type B2bParty = {
  po_number?: string | null
  contract_ext_no?: string | null
  company_name?: string | null
  supplier?: string | null
  buyer?: string | null
  product?: string | null
  quantity_ordered?: number | null
}

type PdfPreviewState = {
  fileId: string
  fileName: string
  documentType: CommercialDocumentType
  url: string
}

type Props = {
  row: CommercialDocumentRow | null
  canModifyDocuments?: boolean
  onClose: () => void
  onSaved: () => void
}

function revokePreviewUrl(url: string | null | undefined) {
  if (url) window.URL.revokeObjectURL(url)
}

export function DocumentCheckingModal({ row, canModifyDocuments = true, onClose, onSaved }: Props) {
  const [files, setFiles] = useState<CommercialDocumentFileRecord[]>([])
  const [history, setHistory] = useState<CommercialDocumentHistoryEntry[]>([])
  const [b2bParties, setB2bParties] = useState<B2bParty[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadingType, setUploadingType] = useState<CommercialDocumentType | null>(null)
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [settlementUploadOpen, setSettlementUploadOpen] = useState(false)

  const closePdfPreview = useCallback(() => {
    setPdfPreview((prev) => {
      revokePreviewUrl(prev?.url)
      return null
    })
  }, [])

  const loadModalData = useCallback(async () => {
    if (!row?.contract_ext_no) return
    setLoading(true)
    try {
      const [filesRes, historyRes] = await Promise.all([
        api.get(`/commercial-documents/files/${encodeURIComponent(row.contract_ext_no)}`),
        api.get(`/commercial-documents/history/${encodeURIComponent(row.contract_ext_no)}`),
      ])
      setFiles(filesRes.data?.data || [])
      setHistory(historyRes.data?.data || [])

      if (row.id && isContractB2bOrigin(row)) {
        try {
          const b2bRes = await api.get(`/contracts/${row.id}/b2b-parties`)
          setB2bParties(b2bRes.data?.data?.parties || b2bRes.data?.data || [])
        } catch {
          setB2bParties([])
        }
      } else {
        setB2bParties([])
      }
    } finally {
      setLoading(false)
    }
  }, [row])

  useEffect(() => {
    void loadModalData()
  }, [loadModalData])

  useEffect(() => {
    return () => {
      revokePreviewUrl(pdfPreview?.url)
    }
  }, [pdfPreview?.url])

  useEffect(() => {
    closePdfPreview()
  }, [row?.contract_ext_no, closePdfPreview])

  const versionsForType = (type: CommercialDocumentType) => filesForDocumentCategory(files, type)

  const latestFileForType = (type: CommercialDocumentType) => {
    const versions = versionsForType(type)
    return versions.length > 0 ? versions[versions.length - 1] : null
  }

  const handleUpload = async (type: CommercialDocumentType, file: File) => {
    if (!row) return
    setUploadingType(type)
    try {
      const form = new FormData()
      form.append('contract_ext_no', row.contract_ext_no)
      form.append('document_type', type)
      form.append('po_number', row.po_number || row.contract_id || 'UNKNOWN')
      form.append('buyer_name', row.buyer || '')
      form.append('contract_date', row.contract_date || '')
      form.append('file', file)
      await api.post('/commercial-documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await loadModalData()
      if (pdfPreview?.documentType === type) {
        closePdfPreview()
      }
      onSaved()
    } finally {
      setUploadingType(null)
    }
  }

  const togglePdfPreview = async (file: CommercialDocumentFileRecord, type: CommercialDocumentType) => {
    if (pdfPreview?.fileId === file.id) {
      closePdfPreview()
      return
    }

    revokePreviewUrl(pdfPreview?.url)
    setPdfPreview(null)
    setPdfPreviewLoading(true)
    try {
      const response = await api.get(`/commercial-documents/file/${file.id}/view`, {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
      setPdfPreview({
        fileId: file.id,
        fileName: file.file_name,
        documentType: type,
        url,
      })
    } finally {
      setPdfPreviewLoading(false)
    }
  }

  const downloadPdf = async (fileId: string, fileName: string) => {
    const response = await api.get(`/commercial-documents/file/${fileId}/download`, {
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (!row) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={cn(
          'bg-white w-full max-h-[92vh] rounded-lg shadow-xl flex flex-col overflow-hidden transition-[max-width]',
          pdfPreview ? 'max-w-6xl' : 'max-w-5xl',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Document Checking</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{row.contract_ext_no}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading...
              </div>
            ) : (
              <>
                <section>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Contract Information</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <Info label="Contract Date" value={formatCommercialDate(row.contract_date)} />
                    <Info label="Contract Ext No" value={row.contract_ext_no} />
                    <Info label="PO" value={row.po_number} />
                    <Info label="Incoterm" value={row.incoterm} />
                    <Info label="Product" value={row.product} />
                    <Info label="Group Plant" value={row.plant_site} />
                    <Info label="Contract Qty" value={formatCommercialQtyKg(row.quantity_ordered)} />
                    <Info label="Unit Price" value={formatCommercialIdr(row.unit_price)} />
                    <Info
                      label="Total Price"
                      value={
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">
                              {formatCommercialIdr(row.total_price)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-sm">
                            {commercialTotalPriceTooltip(row)}
                          </TooltipContent>
                        </Tooltip>
                      }
                    />
                    <Info label="Supplier" value={row.supplier} />
                    <Info label="Buyer" value={row.buyer} />
                  </div>
                </section>

                {isContractB2bOrigin(row) && b2bParties.length > 0 && (
                  <section>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      B2B Parties
                      <FieldHelp text={FIELD_HELP.b2bParties} />
                    </h3>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-100 border-b">
                            <th className="px-3 py-2 text-left font-medium">PO Number</th>
                            <th className="px-3 py-2 text-left font-medium">Contract Ext No</th>
                            <th className="px-3 py-2 text-left font-medium">Company Name</th>
                            <th className="px-3 py-2 text-left font-medium">Supplier</th>
                            <th className="px-3 py-2 text-left font-medium">Buyer</th>
                            <th className="px-3 py-2 text-left font-medium">Product</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b2bParties.map((p, idx) => (
                            <tr key={idx} className="border-b last:border-0">
                              <td className="px-3 py-2">{formatSapDisplayValue(p.po_number)}</td>
                              <td className="px-3 py-2">{formatSapDisplayValue(p.contract_ext_no)}</td>
                              <td className="px-3 py-2">{formatSapDisplayValue(p.company_name)}</td>
                              <td className="px-3 py-2">{formatSapDisplayValue(p.supplier)}</td>
                              <td className="px-3 py-2">{formatSapDisplayValue(p.buyer)}</td>
                              <td className="px-3 py-2">{formatSapDisplayValue(p.product)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Documents</h3>
                  <div className="space-y-3">
                    {COMMERCIAL_DOCUMENT_TYPES.map((type) => {
                      const versions = versionsForType(type)
                      const latest = versions.length > 0 ? versions[versions.length - 1] : null
                      const inputId = `commercial-doc-upload-${type}`
                      const isPreviewActive = pdfPreview?.fileId === latest?.id
                      const isFullReceive = type === 'invoice_fp_full'
                      return (
                        <div
                          key={type}
                          className={cn(
                            'rounded-lg border px-4 py-3 transition-colors',
                            isPreviewActive && 'border-blue-300 bg-blue-50/40 ring-1 ring-blue-200',
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm">{COMMERCIAL_DOCUMENT_LABELS[type]}</div>
                              {versions.length === 0 ? (
                                <div className="text-xs text-gray-500 mt-1">Not uploaded</div>
                              ) : (
                                <ul className="mt-2 space-y-1.5">
                                  {versions.map((file, idx) => (
                                    <li
                                      key={file.id}
                                      className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600"
                                    >
                                      <span className="min-w-0 truncate" title={file.file_name}>
                                        {documentVersionLabel(type, idx)} &gt; {file.file_name}
                                      </span>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2"
                                          disabled={pdfPreviewLoading && pdfPreview?.fileId !== file.id}
                                          onClick={() => void togglePdfPreview(file, type)}
                                          title={pdfPreview?.fileId === file.id ? 'Hide preview' : 'View'}
                                        >
                                          {pdfPreviewLoading && pdfPreview?.fileId !== file.id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <Eye className="h-3.5 w-3.5" />
                                          )}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2"
                                          onClick={() => void downloadPdf(file.id, file.file_name)}
                                          title="Download"
                                        >
                                          <Download className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {canModifyDocuments && !isFullReceive ? (
                                <input
                                  id={inputId}
                                  type="file"
                                  accept="application/pdf,.pdf"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) void handleUpload(type, f)
                                    e.target.value = ''
                                  }}
                                />
                              ) : null}
                              {canModifyDocuments ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={uploadingType === type}
                                  onClick={() => {
                                    if (isFullReceive) {
                                      setSettlementUploadOpen(true)
                                      return
                                    }
                                    document.getElementById(inputId)?.click()
                                  }}
                                  className="border-green-200 text-green-700 hover:bg-green-50"
                                >
                                  {uploadingType === type ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Upload className="h-4 w-4 mr-1" /> Upload
                                    </>
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                {pdfPreviewLoading && !pdfPreview ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/50 py-10 text-sm text-blue-700 lg:hidden">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading preview...
                  </div>
                ) : null}

                {pdfPreview ? (
                  <section className="rounded-lg border border-blue-200 overflow-hidden lg:hidden">
                    <PdfPreviewPanel
                      preview={pdfPreview}
                      onClose={closePdfPreview}
                      onDownload={() => void downloadPdf(pdfPreview.fileId, pdfPreview.fileName)}
                    />
                  </section>
                ) : null}

                <section>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">History</h3>
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-100 border-b">
                          <th className="px-3 py-2 text-left font-medium">Action Type</th>
                          <th className="px-3 py-2 text-left font-medium">Document Type</th>
                          <th className="px-3 py-2 text-left font-medium">Date/Timestamp</th>
                          <th className="px-3 py-2 text-left font-medium">User</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                              No history yet
                            </td>
                          </tr>
                        ) : (
                          history.map((h) => (
                            <tr key={h.id} className="border-b last:border-0">
                              <td className="px-3 py-2">{h.action_type === 'ADD' ? 'Add' : 'Edit'}</td>
                              <td className="px-3 py-2">
                                {commercialDocumentTypeLabel(h.document_type)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeDMY(h.created_at)}</td>
                              <td className="px-3 py-2">{formatSapDisplayValue(h.user_name)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>

          {(pdfPreview || pdfPreviewLoading) && (
            <aside className="hidden lg:flex lg:flex-col lg:w-[min(44%,520px)] lg:shrink-0 border-t lg:border-t-0 lg:border-l border-gray-200 bg-gray-50 min-h-0">
              {pdfPreviewLoading && !pdfPreview ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading preview...
                </div>
              ) : pdfPreview ? (
                <PdfPreviewPanel
                  preview={pdfPreview}
                  onClose={closePdfPreview}
                  onDownload={() => void downloadPdf(pdfPreview.fileId, pdfPreview.fileName)}
                  className="flex flex-col flex-1 min-h-0 h-full border-0 rounded-none"
                />
              ) : null}
            </aside>
          )}
        </div>
      </div>

      {settlementUploadOpen ? (
        <SettlementInvoiceUploadModal
          row={row}
          existingFileName={latestFileForType('invoice_fp_full')?.file_name}
          onClose={() => setSettlementUploadOpen(false)}
          onSaved={async () => {
            await loadModalData()
            onSaved()
          }}
        />
      ) : null}
    </div>
  )
}

function PdfPreviewPanel({
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
      <iframe
        src={preview.url}
        title={preview.fileName}
        className="w-full flex-1 min-h-[280px] lg:min-h-0 bg-gray-100 border-0"
      />
    </div>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  const display =
    typeof value === 'string' || typeof value === 'number' ? formatSapDisplayValue(value) : value
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-gray-900 mt-0.5">{display}</div>
    </div>
  )
}
