'use client'

import { CheckCircle2, ChevronRight, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SapImportProgressProps {
  phase: 'uploading' | 'processing'
  /** 0-100, the file going to the server. */
  uploadProgress: number
  /** 0-100, the rows going into the database. */
  processingProgress: number
  doneCount: number
  totalCount: number
  failedCount: number
  elapsed: string
  elapsedSeconds: number
  rowsPerSecond: number
  /** Formatted time left, or null when it cannot be estimated yet. */
  eta: string | null
  canCancel: boolean
  cancelling: boolean
  onCancel: () => void
}

function Step({ state, label }: { state: 'done' | 'active' | 'todo'; label: string }) {
  return (
    <span
      className={
        state === 'done'
          ? 'inline-flex items-center gap-1 font-medium text-emerald-700'
          : state === 'active'
            ? 'inline-flex items-center gap-1 font-medium text-blue-700'
            : 'inline-flex items-center gap-1 text-gray-400'
      }
    >
      {state === 'done' ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : null}
      {state === 'active' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {label}
    </span>
  )
}

/** The import in flight: three steps, one bar, and the numbers people ask for (rows done, elapsed, speed, time left). */
export function SapImportProgressPanel(props: SapImportProgressProps) {
  const { phase, uploadProgress, processingProgress, doneCount, totalCount, failedCount, elapsed, elapsedSeconds, rowsPerSecond, eta, canCancel, cancelling, onCancel } = props
  const uploading = phase === 'uploading'
  const pct = uploading ? uploadProgress : processingProgress
  return (
    <div className="rounded-xl border border-blue-200 bg-white px-5 py-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Step state={uploading ? 'active' : 'done'} label={uploading ? 'Uploading file' : 'Uploaded'} />
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" aria-hidden />
          <Step state={uploading ? 'todo' : 'active'} label="Processing rows" />
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" aria-hidden />
          <Step state="todo" label="Done" />
        </div>
        <span className="text-sm font-semibold tabular-nums text-blue-700">{pct}%</span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>

      {uploading ? (
        <p className="mt-3 text-xs text-gray-500">Please keep this page open until the upload completes.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
            <span>
              <span className="font-semibold text-gray-900 tabular-nums">{doneCount.toLocaleString('en-US')}</span> / {totalCount.toLocaleString('en-US')} rows
            </span>
            <span>Elapsed {elapsed}</span>
            {rowsPerSecond > 0 ? <span>~{rowsPerSecond >= 1 ? Math.round(rowsPerSecond) : rowsPerSecond.toFixed(1)} rows/sec</span> : null}
            {eta ? <span>About {eta} left</span> : null}
            {failedCount > 0 ? <span className="font-medium text-red-600">{failedCount.toLocaleString('en-US')} failed</span> : null}
          </div>
          {doneCount === 0 && elapsedSeconds < 20 ? (
            <p className="mt-2 text-xs text-gray-500">Reading the file and starting the first rows. This usually takes a few seconds.</p>
          ) : doneCount === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              Still starting up after {elapsed}. Large files can take a little longer; if this does not move for several minutes, refresh the page or upload again.
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-500">
              Large files can take several minutes. You can leave this page: progress is saved on the server and the history updates when it is done.
            </p>
          )}
        </>
      )}

      {canCancel ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
            <X className="mr-2 h-4 w-4" aria-hidden />
            {cancelling ? 'Cancelling...' : uploading ? 'Cancel upload' : 'Cancel import'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
