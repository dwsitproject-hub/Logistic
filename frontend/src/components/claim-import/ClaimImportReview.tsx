'use client'

import { FileSpreadsheet, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CLAIM_KIND_LOOK } from '@/components/claim-import/ClaimKindIcon'
import { CLAIM_KIND_LABEL, CLAIM_KIND_MODE, formatFileSize, type ClaimDataKind } from '@/lib/claimDataImportView'
import { formatDateDMY } from '@/lib/dateFormat'

interface Props {
  fileName: string
  fileSize: number
  /** What the file name says it is; null when it says nothing (the person must choose). */
  kind: ClaimDataKind | null
  detected: boolean
  onKind: (kind: ClaimDataKind) => void
  dataAsOf: string
  onDataAsOf: (value: string) => void
  maxDate: string
  onCancel: () => void
  onImport: () => void
}

/** Between choosing a file and importing it: what the file is, what the import will do, and the one thing an outstanding import needs (its date). */
export function ClaimImportReview({ fileName, fileSize, kind, detected, onKind, dataAsOf, onDataAsOf, maxDate, onCancel, onImport }: Props) {
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
            <p className="text-xs text-gray-500">{formatFileSize(fileSize)} · ready to import</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-gray-400" onClick={onCancel} aria-label="Remove the file">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-gray-600">
          What is this file?{' '}
          {kind && detected ? <span className="font-normal text-gray-400">Read from the file name; change it if that is wrong.</span> : null}
          {!kind ? <span className="font-normal text-amber-700">The file name does not say. Choose one.</span> : null}
        </p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Claim data type">
          {(['os', 'real'] as ClaimDataKind[]).map((option) => {
            const { Icon, tone, hover } = CLAIM_KIND_LOOK[option]
            const selected = kind === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onKind(option)}
                className={
                  selected
                    ? 'flex items-start gap-3 rounded-lg border-2 border-blue-500 bg-blue-50/40 px-3 py-2.5 text-left'
                    : 'flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left hover:border-gray-300 hover:bg-gray-50'
                }
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`} aria-hidden>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    {CLAIM_KIND_LABEL[option]} <span className="font-normal text-gray-500">({hover.toLowerCase()})</span>
                  </span>
                  <span className="block text-xs text-gray-500">{CLAIM_KIND_MODE[option]}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {kind === 'os' ? (
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
            Importing replaces the whole Outstanding snapshot{dataAsOf ? ` (data as of ${formatDateDMY(dataAsOf)})` : ''}. Claims that are not in this file disappear from the Outstanding view.
          </p>
        </div>
      ) : null}
      {kind === 'real' ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Realised claims are added per CR number: a claim already imported with the same CR number is replaced, the rest are kept.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onImport} disabled={!kind}>
          <Upload className="mr-2 h-4 w-4" aria-hidden />
          Import
        </Button>
      </div>
    </div>
  )
}
