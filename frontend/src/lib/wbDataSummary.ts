/**
 * Numbers and labels for the WB Data page (the history of the weighbridge uploads made on the Trucking page).
 * Pure functions, so the rules are tested without the page. The time and file helpers are the Logistics Data ones (lib/sapImportSummary.ts), so both pages read alike.
 */
import { formatDateDMY } from '@/lib/dateFormat'
import type { SapImportTone } from '@/lib/sapImportSummary'

export interface WbImportRow {
  id: string
  file_name: string | null
  /** What the server wrote: completed | partial | failed. */
  status: string
  created_at: string
  updated_at: string | null
  uploaded_by_name?: string | null
  uploaded_by_username?: string | null
  raw_ticket_rows: number
  aggregated_po_dates: number
  operations_updated: number
  operations_failed: number
  rows_upserted: number
  sheets_processed_count?: number
  sheets_skipped_count?: number
  parse_failures_count?: number
}

export type WbImportOutcome = 'completed' | 'partial' | 'failed' | 'nothing_written' | 'empty'

/**
 * What an upload amounted to. The server stores `completed` the moment the batch row is made and only rewrites it when the upload finishes, so two shapes of `completed` are not a clean
 * success: a file with PO/date lines in it that wrote no row and failed no operation, and a file with no ticket at all (a failed-rows export uploaded back, a sheet with no data).
 */
export function wbImportOutcome(imp: Pick<WbImportRow, 'status' | 'raw_ticket_rows' | 'aggregated_po_dates' | 'rows_upserted' | 'operations_failed'>): WbImportOutcome {
  const status = String(imp.status || '').toLowerCase()
  if (status === 'failed') return 'failed'
  if (status === 'partial') return 'partial'
  const tickets = Number(imp.raw_ticket_rows) || 0
  const poDates = Number(imp.aggregated_po_dates) || 0
  if (tickets === 0 && poDates === 0) return 'empty'
  if (poDates > 0 && (Number(imp.rows_upserted) || 0) === 0 && (Number(imp.operations_failed) || 0) === 0) return 'nothing_written'
  return 'completed'
}

const OUTCOME_META: Record<WbImportOutcome, { label: string; tone: SapImportTone; hint: string }> = {
  completed: { label: 'Completed', tone: 'success', hint: 'Every operation of the file was written.' },
  partial: { label: 'With issues', tone: 'warning', hint: 'Some operations could not be written; the rest were.' },
  failed: { label: 'Failed', tone: 'danger', hint: 'No row was written.' },
  nothing_written: { label: 'Nothing written', tone: 'warning', hint: 'The file had PO / date lines, but no row was written and none failed - the upload may have stopped before it finished.' },
  empty: { label: 'No tickets', tone: 'neutral', hint: 'The file had no weighbridge ticket to read.' },
}

export function wbImportStatusMeta(imp: Parameters<typeof wbImportOutcome>[0]): { label: string; tone: SapImportTone; hint: string } {
  return OUTCOME_META[wbImportOutcome(imp)]
}

export type WbImportFilter = 'all' | 'completed' | 'with_issues' | 'failed'

export const WB_IMPORT_FILTERS: ReadonlyArray<{ id: WbImportFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'with_issues', label: 'With issues' },
  { id: 'failed', label: 'Failed' },
]

export function filterWbImports<T extends Parameters<typeof wbImportOutcome>[0]>(imports: T[], filter: WbImportFilter): T[] {
  if (filter === 'all') return imports
  return imports.filter((imp) => {
    const outcome = wbImportOutcome(imp)
    if (filter === 'completed') return outcome === 'completed'
    if (filter === 'failed') return outcome === 'failed'
    return outcome === 'partial' || outcome === 'nothing_written'
  })
}

/** The user who uploaded, as a person reads it: the full name, else the username, else "Unknown" (the user was removed, or the upload predates the column). */
export function wbImportUploaderLabel(imp: Pick<WbImportRow, 'uploaded_by_name' | 'uploaded_by_username'>): string {
  return String(imp.uploaded_by_name || '').trim() || String(imp.uploaded_by_username || '').trim() || 'Unknown'
}

const byNewest = (a: WbImportRow, b: WbImportRow) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

/** Operations written over operations in the file (written + failed), 0-100; null when the file had none. */
export function wbImportOperationRate(imp: Pick<WbImportRow, 'operations_updated' | 'operations_failed'>): number | null {
  const ok = Number(imp.operations_updated) || 0
  const failed = Number(imp.operations_failed) || 0
  if (ok + failed <= 0) return null
  return (ok / (ok + failed)) * 100
}

export interface WbImportSummary {
  count: number
  latest: WbImportRow | null
  /** Failed operations summed over the newest RECENT uploads, and how many uploads that was. */
  recentFailedOperations: number
  recentCount: number
  /** Operations written over operations seen, summed over every upload in the list (a big file counts for more). Null when no upload had an operation. */
  weightedOperationRate: number | null
  /** Different people who uploaded in the list. */
  uploaderCount: number
}

const RECENT = 7

export function summarizeWbImports(imports: WbImportRow[]): WbImportSummary {
  const sorted = [...imports].sort(byNewest)
  const recent = sorted.slice(0, RECENT)
  const ok = sorted.reduce((sum, imp) => sum + (Number(imp.operations_updated) || 0), 0)
  const failed = sorted.reduce((sum, imp) => sum + (Number(imp.operations_failed) || 0), 0)
  const uploaders = new Set(sorted.map((imp) => wbImportUploaderLabel(imp).toLowerCase()).filter((name) => name !== 'unknown'))
  return {
    count: sorted.length,
    latest: sorted[0] ?? null,
    recentFailedOperations: recent.reduce((sum, imp) => sum + (Number(imp.operations_failed) || 0), 0),
    recentCount: recent.length,
    weightedOperationRate: ok + failed > 0 ? (ok / (ok + failed)) * 100 : null,
    uploaderCount: uploaders.size,
  }
}

/** Bar segments for a history row, in percent of the operations: written, and failed (at least 2% when any failed, so it stays visible). */
export function wbImportBarSegments(imp: Pick<WbImportRow, 'operations_updated' | 'operations_failed'>): { okPct: number; failedPct: number } {
  const ok = Number(imp.operations_updated) || 0
  const failed = Number(imp.operations_failed) || 0
  const total = ok + failed
  if (total <= 0) return { okPct: 0, failedPct: 0 }
  const failedPct = failed > 0 ? Math.max(2, Math.min(100, (failed / total) * 100)) : 0
  const okPct = Math.max(0, Math.min(100 - failedPct, (ok / total) * 100))
  return { okPct, failedPct }
}

/** Seconds the upload took (created -> last update), or null when either time is missing / out of order. */
export function wbImportDurationSeconds(imp: Pick<WbImportRow, 'created_at' | 'updated_at'>): number | null {
  if (!imp.updated_at) return null
  const start = new Date(imp.created_at).getTime()
  const end = new Date(imp.updated_at).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  return (end - start) / 1000
}

/**
 * The day of an upload's timestamp, DD/MM/YYYY, in the browser's time zone - the zone its time (HH:mm:ss) is shown in.
 * formatDateDMY is for calendar dates and reads the date part of an ISO string as it is: given 2026-08-11T19:00:24Z it says 11/08, while the time next to it (02:00 on the 12th, WIB) says otherwise.
 */
export function formatWbUploadDay(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : formatDateDMY(d)
}

/** "1,234.5 MT" for a weight in kilograms (the app shows weights in MT); "—" when there is none. */
export function formatKgAsMt(kg: unknown): string {
  if (kg == null || kg === '') return '—'
  const n = Number(kg)
  if (!Number.isFinite(n)) return '—'
  return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} MT`
}
