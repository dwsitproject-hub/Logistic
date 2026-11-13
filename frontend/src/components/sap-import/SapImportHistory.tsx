'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Clock, FileSpreadsheet, User } from 'lucide-react'
import { SapImportStatusChip } from '@/components/sap-import/SapImportStatusChip'
import {
  SAP_IMPORT_FILTERS,
  displaySapImportFileName,
  filterSapImports,
  formatSapImportWhen,
  isSapImportRunning,
  sapImportBarSegments,
  type SapImportFilter,
  type SapImportRow,
} from '@/lib/sapImportSummary'

interface Props {
  imports: SapImportRow[]
  error: string | null
  canUpload: boolean
  onOpen: (id: string) => void
  /** Icon buttons (Sync, Import) at the right end of the section header, so every action of the table sits inside the table's section. */
  actions?: ReactNode
}

const GRID = 'md:grid md:grid-cols-[1.1fr_1.7fr_0.9fr_1.5fr_1fr_1rem] md:items-center md:gap-3'

function ResultBar({ imp }: { imp: SapImportRow }) {
  const running = isSapImportRunning(imp.status)
  const total = Number(imp.total_records) || 0
  const done = Number(imp.processed_records) || 0
  const failed = Number(imp.failed_records) || 0
  if (running) {
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0
    return (
      <div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs tabular-nums text-gray-500">
          {done.toLocaleString('en-US')} / {total.toLocaleString('en-US')} rows
        </p>
      </div>
    )
  }
  const { okPct, failedPct } = sapImportBarSegments(imp)
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full bg-emerald-500" style={{ width: `${okPct}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${failedPct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-gray-500">
        {total.toLocaleString('en-US')} rows · <span className={failed > 0 ? 'font-medium text-red-600' : undefined}>{failed.toLocaleString('en-US')} failed</span>
      </p>
    </div>
  )
}

/** The import history: filter chips on top, one clickable row per import (the whole row opens its details). */
export function SapImportHistory({ imports, error, canUpload, onOpen, actions }: Props) {
  const [filter, setFilter] = useState<SapImportFilter>('all')
  const rows = useMemo(
    () =>
      [...filterSapImports(imports, filter)].sort(
        (a, b) => new Date(b.import_timestamp).getTime() - new Date(a.import_timestamp).getTime(),
      ),
    [imports, filter],
  )
  const now = new Date()

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label="Import history">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Import history</h3>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {SAP_IMPORT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={
                filter === f.id
                  ? 'rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700'
                  : 'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {actions ? <div className="flex items-center gap-1.5 border-l border-gray-200 pl-2">{actions}</div> : null}
        </div>
      </div>

      <div className={`hidden border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 ${GRID}`}>
        <div>When</div>
        <div>File</div>
        <div>Source</div>
        <div>Result</div>
        <div>Status</div>
        <div />
      </div>

      <ul>
        {rows.map((imp) => {
          const when = formatSapImportWhen(imp.import_timestamp, now)
          const scheduled = imp.source === 'scheduler'
          const by = imp.imported_by_name || (scheduled ? 'Scheduler' : '')
          return (
            <li key={imp.id} className="border-b border-gray-100 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(imp.id)}
                className={`flex w-full flex-col gap-2 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-gray-50 focus-visible:bg-blue-50 ${GRID}`}
                aria-label={`Open details of the import of ${when.day} ${when.time}`}
              >
                <div>
                  <div className="font-medium text-gray-900">{when.day}</div>
                  <div className="text-xs text-gray-500">
                    {when.time}
                    {by ? ` · ${by}` : ''}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-gray-800" title={imp.file_name || undefined}>
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <span className="truncate">{displaySapImportFileName(imp.file_name)}</span>
                </div>
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                    {scheduled ? <Clock className="h-3 w-3" aria-hidden /> : <User className="h-3 w-3" aria-hidden />}
                    {scheduled ? 'Scheduler' : 'Manual'}
                  </span>
                </div>
                <ResultBar imp={imp} />
                <div>
                  <SapImportStatusChip status={imp.status} />
                </div>
                <ChevronRight className="hidden h-4 w-4 text-gray-300 md:block" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      {error ? <div className="px-4 py-12 text-center text-sm text-red-600">{error}</div> : null}
      {!error && imports.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-gray-500">
          {canUpload ? 'No import history yet. Drop your first SAP file above.' : 'No import history available.'}
        </div>
      ) : null}
      {!error && imports.length > 0 && rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">No import matches this filter.</div>
      ) : null}
    </section>
  )
}
