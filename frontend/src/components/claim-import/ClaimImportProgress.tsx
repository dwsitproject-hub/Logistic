'use client'

import { CheckCircle2, ChevronRight, Loader2 } from 'lucide-react'

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

/** The import in flight: the file goes up (a real percentage), then the server reads it (no percentage to give, so a moving bar). */
export function ClaimImportProgress({ phase, uploadProgress, fileName }: { phase: 'uploading' | 'processing'; uploadProgress: number; fileName: string }) {
  const uploading = phase === 'uploading'
  return (
    <div className="rounded-xl border border-blue-200 bg-white px-5 py-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Step state={uploading ? 'active' : 'done'} label={uploading ? 'Uploading file' : 'Uploaded'} />
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" aria-hidden />
          <Step state={uploading ? 'todo' : 'active'} label="Reading claims" />
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" aria-hidden />
          <Step state="todo" label="Done" />
        </div>
        {uploading ? <span className="text-sm font-semibold tabular-nums text-blue-700">{uploadProgress}%</span> : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        {uploading ? (
          <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }} />
        ) : (
          <div className="h-full w-full animate-pulse rounded-full bg-blue-400" />
        )}
      </div>
      <p className="mt-3 truncate text-xs text-gray-500" title={fileName}>
        {fileName}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {uploading ? 'Please keep this page open until the upload completes.' : 'The file has many sheets: reading it takes a few seconds. Please keep this page open.'}
      </p>
    </div>
  )
}
