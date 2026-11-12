/**
 * Numbers and labels for the Logistics Data (SAP import) page: what the summary cards say and how a history row is described.
 * Pure functions, so the rules are tested without the page.
 */

export interface SapImportRow {
  id: string
  import_timestamp: string
  status: string
  total_records: number
  processed_records: number
  failed_records: number
  source?: string
  file_name?: string | null
  imported_by_name?: string | null
}

export type SapImportTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const STATUS_META: Record<string, { label: string; tone: SapImportTone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  completed_with_errors: { label: 'With errors', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
}

export function sapImportStatusMeta(status: string): { label: string; tone: SapImportTone } {
  return STATUS_META[status] ?? { label: status || 'Unknown', tone: 'neutral' }
}

export function isSapImportRunning(status: string): boolean {
  return status === 'processing' || status === 'pending'
}

export type SapImportFilter = 'all' | 'completed' | 'with_errors' | 'failed'

export const SAP_IMPORT_FILTERS: ReadonlyArray<{ id: SapImportFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'with_errors', label: 'With errors' },
  { id: 'failed', label: 'Failed' },
]

export function filterSapImports<T extends Pick<SapImportRow, 'status'>>(imports: T[], filter: SapImportFilter): T[] {
  if (filter === 'all') return imports
  const wanted = filter === 'completed' ? 'completed' : filter === 'with_errors' ? 'completed_with_errors' : 'failed'
  return imports.filter((imp) => imp.status === wanted)
}

const byNewest = (a: SapImportRow, b: SapImportRow) =>
  new Date(b.import_timestamp).getTime() - new Date(a.import_timestamp).getTime()

/** Share of the file's rows that went in, 0-100; null for a file with no rows. */
export function sapImportSuccessRate(imp: Pick<SapImportRow, 'total_records' | 'processed_records'>): number | null {
  const total = Number(imp.total_records) || 0
  if (total <= 0) return null
  return Math.min(100, ((Number(imp.processed_records) || 0) / total) * 100)
}

export interface SapImportSummary {
  count: number
  latest: SapImportRow | null
  /** Failed rows summed over the newest RECENT imports, and how many imports that was. */
  recentFailedRows: number
  recentCount: number
  /** Rows imported over rows in the file, summed over every finished import in the list (a big file counts for more than a small one). Null when nothing finished. */
  weightedSuccessRate: number | null
  finishedCount: number
}

const RECENT = 7

export function summarizeSapImports(imports: SapImportRow[]): SapImportSummary {
  const sorted = [...imports].sort(byNewest)
  const recent = sorted.slice(0, RECENT)
  const finished = sorted.filter((imp) => !isSapImportRunning(imp.status) && imp.status !== 'cancelled' && Number(imp.total_records) > 0)
  const total = finished.reduce((sum, imp) => sum + (Number(imp.total_records) || 0), 0)
  const done = finished.reduce((sum, imp) => sum + (Number(imp.processed_records) || 0), 0)
  return {
    count: sorted.length,
    latest: sorted[0] ?? null,
    recentFailedRows: recent.reduce((sum, imp) => sum + (Number(imp.failed_records) || 0), 0),
    recentCount: recent.length,
    weightedSuccessRate: total > 0 ? Math.min(100, (done / total) * 100) : null,
    finishedCount: finished.length,
  }
}

/** "Today", "Yesterday" or "12 Nov 2026" for the date, "06:02" for the time (the browser's clock, like the rest of the page). */
export function formatSapImportWhen(iso: string, now: Date = new Date()): { day: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { day: '—', time: '' }
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (diffDays === 0) return { day: 'Today', time }
  if (diffDays === 1) return { day: 'Yesterday', time }
  return { day: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), time }
}

/** "CPO 3 Sep 2026.xlsx" -> "CPO 3 Sep 2026". */
export function displaySapImportFileName(fileName: string | null | undefined): string {
  const raw = String(fileName || '').trim()
  if (!raw) return '—'
  const withoutExt = raw.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, '').trim()
  return withoutExt || raw
}

/** Bar segments for a history row, in percent of the file's rows: what went in, and what failed (at least 2% when anything failed, so it stays visible). */
export function sapImportBarSegments(imp: Pick<SapImportRow, 'total_records' | 'processed_records' | 'failed_records'>): {
  okPct: number
  failedPct: number
} {
  const total = Number(imp.total_records) || 0
  if (total <= 0) return { okPct: 0, failedPct: 0 }
  const failed = Number(imp.failed_records) || 0
  const failedPct = failed > 0 ? Math.max(2, Math.min(100, (failed / total) * 100)) : 0
  const okPct = Math.max(0, Math.min(100 - failedPct, ((Number(imp.processed_records) || 0) / total) * 100))
  return { okPct, failedPct }
}
