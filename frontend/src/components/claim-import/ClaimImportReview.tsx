'use client'

import { FileSpreadsheet, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClaimKindIcon } from '@/components/claim-import/ClaimKindIcon'
import { CLAIM_KIND_LABEL, CLAIM_KIND_MODE, formatFileSize } from '@/lib/claimDataImportView'
import { formatDateDMY } from '@/lib/dateFormat'

interface Props {
  fileName: string
  fileSize: number
  dataAsOf: string
  onDataAsOf: (value: string) => void
  maxDate: string
  onCancel: () => void
  onImport: () => void
}

/**
 * Between choosing a file and importing it. This page imports the OUTSTANDING claim file only, so there is nothing to choose: the review says what
 * the import does and asks for the one thing it needs, the date the data is as of.
 */
export function ClaimImportReview({ fileName, fileSize, dataAsOf, onDataAsOf, maxDate, onCancel, onImport }: Props) {
  return (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileSpreadsheet className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900" title={fileName}>
              {fileName}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <ClaimKindIcon kind="os" size="sm" />
              {formatFileSize(fileSize)} · {CLAIM_KIND_LABEL.os} claims · ready to import
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-gray-400" onClick={onCancel} aria-label="Remove the file">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">
          Data as of
          <input
            type="date"
            value={dataAsOf}
            max={maxDate}
            onChange={(event) => onDataAsOf(event.target.value)}
            className="mt-1 block h-9 w-44 rounded-md border border-gray-300 px-2 text-sm"
          />
        </label>
        <p className="text-xs text-gray-500">
          Shown on Shortage Claim and Quality Claim as the outstanding date. Aging is always recomputed from CR date vs today.
        </p>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {CLAIM_KIND_MODE.os}
          {dataAsOf ? ` (data as of ${formatDateDMY(dataAsOf)})` : ''}. Claims that are not in this file disappear from the Outstanding view.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onImport} disabled={!dataAsOf}>
          <Upload className="mr-2 h-4 w-4" aria-hidden />
          Import
        </Button>
      </div>
    </div>
  )
}
