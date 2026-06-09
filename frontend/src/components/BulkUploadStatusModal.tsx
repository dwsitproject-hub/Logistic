'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type BulkUploadStatusResult = {
  created: number
  updated: number
  failed: number
  errors: string[]
}

type BulkUploadStatusModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  result: BulkUploadStatusResult | null
  createdLabel?: string
  updatedLabel?: string
  failedLabel?: string
  errorsTitle?: string
}

/** CSV / bulk upload result modal — matches Shipment & Trucking bulk-create styling. */
export function BulkUploadStatusModal({
  open,
  onOpenChange,
  title,
  result,
  createdLabel = 'Created',
  updatedLabel = 'Updated',
  failedLabel = 'Failed',
  errorsTitle = 'Row issues',
}: BulkUploadStatusModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-green-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">{createdLabel}</div>
                <div className="text-lg font-semibold tabular-nums text-green-800">{result.created}</div>
              </div>
              <div className="rounded-md border bg-slate-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">{updatedLabel}</div>
                <div className="text-lg font-semibold tabular-nums">{result.updated}</div>
              </div>
              <div className="rounded-md border bg-red-50 px-3 py-2">
                <div className="text-xs text-muted-foreground">{failedLabel}</div>
                <div className="text-lg font-semibold tabular-nums text-red-800">{result.failed}</div>
              </div>
            </div>
            {result.errors.length > 0 ? (
              <div>
                <div className="font-medium text-gray-900 mb-2">{errorsTitle}</div>
                <ul className="max-h-48 overflow-auto rounded border bg-white text-xs space-y-1 p-2">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-gray-800">{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
