'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, FileSpreadsheet, User } from 'lucide-react'
import { SapImportStatusChip } from '@/components/sap-import/SapImportStatusChip'
import { displaySapImportFileName, formatSapImportWhen } from '@/lib/sapImportSummary'
import { formatDateTimeDMY, formatTimeHMS } from '@/lib/dateFormat'
import {
  WB_IMPORT_FILTERS,
  filterWbImports,
  wbImportBarSegments,
  wbImportStatusMeta,
  wbImportUploaderLabel,
  type WbImportFilter,
  type WbImportRow,
} from '@/lib/wbDataSummary'

interface Props {
  imports: WbImportRow[]
  error: string | null
  onOpen: (id: string) => void
  /** Icon buttons at the right end of the section header, so every action of the table sits inside the table's section. */
  actions?: ReactNode
}

const GRID = 'md:grid md:grid-cols-[1.1fr_1.7fr_1.2fr_1.7fr_1fr_1rem] md:items-center md:gap-3'
const n = (value: unknown) => (Number(value) || 0).toLocaleString('en-US')

function ResultBar({ imp }: { imp: WbImportRow }) {
  const { okPct, failedPct } = wbImportBarSegments(imp)
  const failed = Number(imp.operations_failed) || 0
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full bg-emerald-500" style={{ width: `${okPct}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${failedPct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-gray-500">
        {n(imp.operations_updated)} operations · <span className={failed > 0 ? 'font-medium text-red-600' : undefined}>{n(failed)} failed</span> · {n(imp.rows_upserted)} rows
      </p>
    </div>
  )
}

/** The WB upload history: filter chips on top, one clickable row per upload (the whole row opens its details), with who uploaded it and when. */
export function WbDataHistory({ imports, error, onOpen, actions }: Props) {
  const [filter, setFilter] = useState<WbImportFilter>('all')
  const rows = useMemo(
    () => [...filterWbImports(imports, filter)].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [imports, filter],
  )
  const now = new Date()

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label="WB upload history">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Upload history</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {WB_IMPORT_FILTERS.map((f) => (
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
        <div>Uploaded</div>
        <div>File</div>
        <div>Uploaded by</div>
        <div>Result</div>
        <div>Status</div>
        <div />
      </div>

      <ul>
        {rows.map((imp) => {
          const when = formatSapImportWhen(imp.created_at, now)
          const by = wbImportUploaderLabel(imp)
          const known = by !== 'Unknown'
          return (
            <li key={imp.id} className="border-b border-gray-100 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(imp.id)}
                className={`flex w-full flex-col gap-2 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-gray-50 focus-visible:bg-blue-50 ${GRID}`}
                aria-label={`Open details of the upload of ${when.day} ${when.time} by ${by}`}
              >
                <div title={formatDateTimeDMY(imp.created_at)}>
                  <div className="font-medium text-gray-900">{when.day}</div>
                  <div className="text-xs tabular-nums text-gray-500">{formatTimeHMS(imp.created_at)}</div>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-gray-800" title={imp.file_name || undefined}>
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <span className="truncate">{displaySapImportFileName(imp.file_name)}</span>
                </div>
                <div className="min-w-0">
                  <span
                    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                      known ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-dashed border-gray-300 text-gray-400'
                    }`}
                    title={imp.uploaded_by_username ? `${by} (${imp.uploaded_by_username})` : by}
                  >
                    <User className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{by}</span>
                  </span>
                </div>
                <ResultBar imp={imp} />
                <div>
                  <SapImportStatusChip status={imp.status} meta={wbImportStatusMeta(imp)} />
                </div>
                <ChevronRight className="hidden h-4 w-4 text-gray-300 md:block" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      {error ? <div className="px-4 py-12 text-center text-sm text-red-600">{error}</div> : null}
      {!error && imports.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-gray-500">No WB upload yet. Uploads are made on the Trucking page.</div>
      ) : null}
      {!error && imports.length > 0 && rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">No upload matches this filter.</div>
      ) : null}
    </section>
  )
}
