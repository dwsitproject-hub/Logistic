'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, Upload, Loader2, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { SettlementInvoiceFieldsForm } from '@/components/commercial-documents/SettlementInvoiceFieldsForm'
import {
  EMPTY_SETTLEMENT_INVOICE_FIELDS,
  settlementFieldsFromApi,
  type SettlementInvoiceFieldKey,
  type SettlementInvoiceFields,
} from '@/lib/settlementInvoiceTypes'
import type { CommercialDocumentRow } from '@/lib/commercialDocumentsTypes'
import { cn } from '@/lib/utils'

type Props = {
  row: CommercialDocumentRow
  existingFileName?: string | null
  onClose: () => void
  onSaved: () => void
}

type OcrBanner = {
  type: 'info' | 'warning' | 'error'
  message: string
}

export function SettlementInvoiceUploadModal({
  row,
  existingFileName,
  onClose,
  onSaved,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fields, setFields] = useState<SettlementInvoiceFields>({ ...EMPTY_SETTLEMENT_INVOICE_FIELDS })
  const [ocrScanning, setOcrScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [banner, setBanner] = useState<OcrBanner | null>(null)

  const loadExistingSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const res = await api.get(
        `/commercial-documents/settlement-invoice/${encodeURIComponent(row.contract_ext_no)}`,
      )
      const data = res.data?.data
      if (data) {
        setFields(settlementFieldsFromApi(data))
      }
    } catch {
      /* no saved summary yet */
    } finally {
      setLoadingSummary(false)
    }
  }, [row.contract_ext_no])

  useEffect(() => {
    void loadExistingSummary()
  }, [loadExistingSummary])

  const runOcr = async (file: File) => {
    setOcrScanning(true)
    setBanner(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/commercial-documents/ocr/settlement-invoice', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const data = res.data?.data
      if (data?.fields) {
        setFields(settlementFieldsFromApi(data.fields))
      }
      if (data?.partial) {
        setBanner({ type: 'warning', message: 'Partial OCR read. Please verify fields.' })
      } else if (data?.extractedCount > 0) {
        setBanner({ type: 'info', message: 'Document scanned. Please review values before saving.' })
      }
    } catch {
      setBanner({
        type: 'warning',
        message: 'Partial OCR read. Please verify fields.',
      })
    } finally {
      setOcrScanning(false)
    }
  }

  const handleFileChange = (file: File | null) => {
    setSelectedFile(file)
    if (file) void runOcr(file)
  }

  const handleFieldChange = (key: SettlementInvoiceFieldKey, value: number | null) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!selectedFile) return
    setSubmitting(true)
    setBanner(null)
    try {
      const form = new FormData()
      form.append('contract_ext_no', row.contract_ext_no)
      form.append('document_type', 'invoice_pelunasan')
      form.append('po_number', row.po_number || row.contract_id || 'UNKNOWN')
      form.append('contract_date', row.contract_date || '')
      form.append('file', selectedFile)

      const uploadRes = await api.post('/commercial-documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const fileId = uploadRes.data?.data?.file_id as string | undefined

      await api.put('/commercial-documents/settlement-invoice', {
        contract_ext_no: row.contract_ext_no,
        contract_id: row.id || null,
        commercial_document_file_id: fileId || null,
        ...fields,
      })

      onSaved()
      onClose()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Failed to save document. Please try again.'
      setBanner({ type: 'error', message: msg })
    } finally {
      setSubmitting(false)
    }
  }

  const inputId = 'settlement-invoice-file-input'
  const busy = ocrScanning || submitting || loadingSummary

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white w-full max-w-2xl max-h-[92vh] rounded-lg shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Invoice Pelunasan</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{row.contract_ext_no}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={submitting} title="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {existingFileName ? (
            <p className="text-xs text-gray-500">
              Current file: <span className="font-medium text-gray-700">{existingFileName}</span>
              {' — '}upload a new file to replace it.
            </p>
          ) : null}

          <div>
            <input
              id={inputId}
              type="file"
              accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                handleFileChange(f)
                e.target.value = ''
              }}
            />
            <div
              className={cn(
                'rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
                selectedFile ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200',
                ocrScanning && 'border-blue-300 bg-blue-50/60',
              )}
            >
              {ocrScanning ? (
                <div className="flex flex-col items-center gap-2 text-blue-700">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm font-medium">Scanning document...</p>
                  <p className="text-xs text-blue-600/80">Extracting invoice amounts with OCR</p>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-700">
                    {selectedFile ? selectedFile.name : 'Select a PDF or image (PNG/JPEG)'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={busy}
                    onClick={() => document.getElementById(inputId)?.click()}
                  >
                    {selectedFile ? 'Choose different file' : 'Browse file'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {banner ? (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                banner.type === 'error' && 'border-red-200 bg-red-50 text-red-800',
                banner.type === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
                banner.type === 'info' && 'border-blue-200 bg-blue-50 text-blue-800',
              )}
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{banner.message}</p>
            </div>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Financial Summary</h3>
            <p className="text-xs text-gray-500 mb-3">
              Values are auto-filled from OCR when possible. Review and correct before submitting.
            </p>
            {loadingSummary ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading saved values...
              </div>
            ) : (
              <SettlementInvoiceFieldsForm
                values={fields}
                onChange={handleFieldChange}
                disabled={ocrScanning || submitting}
              />
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!selectedFile || ocrScanning || submitting || loadingSummary}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Submit'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
