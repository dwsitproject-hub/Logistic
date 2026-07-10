'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import { Loader2 } from 'lucide-react'
import { downloadTandaTerimaPdf } from '@/lib/commercialDocumentTandaTerima'

interface TandaTerimaDownloadModalProps {
  open: boolean
  selectedCount: number
  contractExtNos: string[]
  onClose: () => void
}

export function TandaTerimaDownloadModal({
  open,
  selectedCount,
  contractExtNos,
  onClose,
}: TandaTerimaDownloadModalProps) {
  const [sendDate, setSendDate] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSendDate('')
      setDownloading(false)
      setError(null)
    }
  }, [open])

  const canDownload = sendDate.trim().length > 0 && contractExtNos.length > 0 && !downloading

  const handleDownload = async () => {
    if (!canDownload) return
    setDownloading(true)
    setError(null)
    try {
      await downloadTandaTerimaPdf(contractExtNos, sendDate)
      onClose()
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to download Tanda Terima PDF'
      setError(message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !downloading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Download Tanda Terima</DialogTitle>
          <DialogDescription>
            {selectedCount === 1
              ? '1 contract selected. Enter Send Date to generate the PDF.'
              : `${selectedCount} contracts selected. Enter Send Date to generate the PDF.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <label className="text-sm font-medium text-gray-700" htmlFor="tanda-terima-send-date">
            Send Date
          </label>
          <DateInputDdMmYyyy
            valueIso={sendDate}
            onChangeIso={setSendDate}
            className="w-full max-w-xs"
            disabled={downloading}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={downloading}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleDownload()} disabled={!canDownload}>
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating…
              </>
            ) : (
              'Download PDF'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
