'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react'
import { ClaimKindIcon } from '@/components/claim-import/ClaimKindIcon'
import { formatSapImportWhen, sapImportBarSegments } from '@/lib/sapImportSummary'
import { formatDateDMY } from '@/lib/dateFormat'
import {
  CLAIM_UPLOAD_FILTERS,
  filterClaimUploads,
  type ClaimUploadFilter,
  type ClaimUploadHistoryItem,
} from '@/lib/claimDataImportView'

const nf = new Intl.NumberFormat('en-US')
const GRID = 'md:grid md:grid-cols-[1.1fr_1.8fr_3rem_1.6fr_1fr_1rem] md:items-center md:gap-3'

function messagesOf(errors: unknown[] | null): string[] {
  return (errors ?? []).slice(0, 10).map((error) => {
    const e = error as { message?: string; sheet?: string; rowIndex?: number }
    if (e && typeof e === 'object' && e.message) return `${e.sheet ? `${e.sheet} · ` : ''}${e.rowIndex != null ? `row ${e.rowIndex}: ` : ''}${e.message}`
    return String(error)
  })
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-medium text-gray-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  )
}

/** The import history: filter chips, one row per import, and a row opens to its details (B2B / Direct, unmatched, warnings, failed rows). */
export function ClaimImportHistory({ items, loadError }: { items: ClaimUploadHistoryItem[]; loadError: string | null }) {
  const [filter, setFilter] = useState<ClaimUploadFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = useMemo(() => filterClaimUploads(items, filter), [items, filter])
  const now = new Date()

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label="Import history">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Import history</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the history">
          {CLAIM_UPLOAD_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={
                filter === option.id
                  ? 'rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700'
                  : 'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`hidden border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 ${GRID}`}>
        <div>When</div>
        <div>File</div>
        <div>Type</div>
        <div>Result</div>
        <div>Data as of</div>
        <div />
      </div>

      <ul>
        {rows.map((item) => {
          const when = formatSapImportWhen(item.uploaded_at, now)
          const open = openId === item.id
          const failed = Number(item.failed_rows) || 0
          const { okPct, failedPct } = sapImportBarSegments({
            total_records: item.total_rows,
            processed_records: Math.max(0, (Number(item.total_rows) || 0) - failed),
            failed_records: failed,
          })
          // An import with no user behind it came from the SAP folder (the 07:00 schedule); a manual one always has the person who made it.
          const by = item.uploaded_by_name || item.uploaded_by_username || 'Auto-import'
          const errorLines = messagesOf(item.errors)
          return (
            <li key={item.id} className="border-b border-gray-100 last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : item.id)}
                aria-expanded={open}
                className={`flex w-full flex-col gap-2 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-gray-50 focus-visible:bg-blue-50 ${GRID}`}
              >
                <div>
                  <div className="font-medium text-gray-900">{when.day}</div>
                  <div className="text-xs text-gray-500">
                    {when.time}
                    {by ? ` · ${by}` : ''}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-gray-800" title={item.file_name}>
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <span className="truncate">{item.file_name}</span>
                </div>
                <div>
                  <ClaimKindIcon kind={item.kind} />
                </div>
                <div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${okPct}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${failedPct}%` }} />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-gray-500">
                    {nf.format(item.total_rows)} rows · S {nf.format(item.susut_rows)} · Q {nf.format(item.mutu_rows)} ·{' '}
                    <span className={failed > 0 ? 'font-medium text-red-600' : undefined}>{nf.format(failed)} failed</span>
                  </p>
                </div>
                <div className="text-gray-700">{item.data_as_of ? formatDateDMY(item.data_as_of) : '-'}</div>
                {open ? <ChevronDown className="hidden h-4 w-4 text-gray-400 md:block" aria-hidden /> : <ChevronRight className="hidden h-4 w-4 text-gray-300 md:block" aria-hidden />}
              </button>
              {open ? (
                <div className="space-y-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Detail label="Inserted" value={nf.format(item.inserted_rows)} />
                    <Detail label="Replaced" value={nf.format(item.replaced_rows)} />
                    <Detail label="B2B" value={nf.format(item.b2b_rows)} />
                    <Detail label="Direct" value={nf.format(item.direct_rows)} />
                    <Detail label="Unmatched" value={nf.format(item.unmatched_rows)} />
                  </div>
                  {item.warnings && item.warnings.length > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <p className="mb-1 font-semibold">Warnings</p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {item.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {errorLines.length > 0 ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                      <p className="mb-1 font-semibold">Rows that could not be saved (showing {errorLines.length} of {item.errors?.length ?? 0})</p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {errorLines.map((line, index) => (
                          <li key={index}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {loadError ? <div className="px-4 py-12 text-center text-sm text-red-600">{loadError}</div> : null}
      {!loadError && items.length === 0 ? <div className="px-4 py-12 text-center text-sm text-gray-500">No imports yet. Drop your first claim file above.</div> : null}
      {!loadError && items.length > 0 && rows.length === 0 ? <div className="px-4 py-10 text-center text-sm text-gray-500">No import matches this filter.</div> : null}
    </section>
  )
}
