/**
 * What the Claim Data import page says about a file and about the data KLIP holds: which kind a file is (from its name), how big it is, and the numbers of the summary cards.
 * Pure functions, so the rules are tested without the page.
 */

export type ClaimDataKind = 'os' | 'real'

export const CLAIM_KIND_LABEL: Record<ClaimDataKind, string> = { os: 'Outstanding', real: 'Realised' }

/** What an import of this kind does to the data already there. */
export const CLAIM_KIND_MODE: Record<ClaimDataKind, string> = {
  os: 'Replaces the whole Outstanding snapshot',
  real: 'Upserted per CR number (cumulative)',
}

export function isClaimDataFileName(name: string): boolean {
  return /\.xlsx?$/i.test(String(name || '').trim())
}

/**
 * OSCLAIM... -> os, REALCLAIM... -> real, anything else -> null (the person picks). Spaces, underscores and case do not matter.
 * SAP is moving to ONE file in the OSCLAIM layout; until it carries the column that tells outstanding from realised, a REALCLAIM file is still accepted.
 */
export function detectClaimDataKind(fileName: string): ClaimDataKind | null {
  const letters = String(fileName || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (letters.includes('REALCLAIM')) return 'real'
  if (letters.includes('OSCLAIM')) return 'os'
  return null
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface ClaimStatusData {
  latest: Partial<Record<ClaimDataKind, { file_name: string; data_as_of: string | null; uploaded_at: string; total_rows: number }>>
  counts: { os_susut?: number; os_mutu?: number; real_susut?: number; real_mutu?: number }
}

export interface ClaimKindCount {
  imported: boolean
  shortage: number
  quality: number
  total: number
}

export interface ClaimStatusSummary {
  lastImport: { kind: ClaimDataKind; fileName: string; uploadedAt: string } | null
  os: ClaimKindCount
  real: ClaimKindCount
  /** The date the outstanding snapshot is "as of" (YYYY-MM-DD), and how many days ago that is. */
  dataAsOf: string | null
  dataAsOfDaysAgo: number | null
}

/** Whole days from a YYYY-MM-DD date to `now`, on the calendar (not 24h blocks); negative never, a future date reads 0. */
export function daysSinceIsoDate(iso: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.max(0, Math.round((today - then) / 86_400_000))
}

export function summarizeClaimStatus(status: ClaimStatusData | null, now: Date = new Date()): ClaimStatusSummary {
  const latest = status?.latest ?? {}
  const counts = status?.counts ?? {}
  const kindCount = (kind: ClaimDataKind): ClaimKindCount => {
    const shortage = Number(kind === 'os' ? counts.os_susut : counts.real_susut) || 0
    const quality = Number(kind === 'os' ? counts.os_mutu : counts.real_mutu) || 0
    return { imported: Boolean(latest[kind]), shortage, quality, total: shortage + quality }
  }
  const candidates = (['os', 'real'] as ClaimDataKind[])
    .map((kind) => ({ kind, row: latest[kind] }))
    .filter((c): c is { kind: ClaimDataKind; row: NonNullable<ClaimStatusData['latest'][ClaimDataKind]> } => Boolean(c.row))
    .sort((a, b) => new Date(b.row.uploaded_at).getTime() - new Date(a.row.uploaded_at).getTime())
  const newest = candidates[0]
  const asOf = latest.os?.data_as_of ?? null
  return {
    lastImport: newest ? { kind: newest.kind, fileName: newest.row.file_name, uploadedAt: newest.row.uploaded_at } : null,
    os: kindCount('os'),
    real: kindCount('real'),
    dataAsOf: asOf,
    dataAsOfDaysAgo: asOf ? daysSinceIsoDate(asOf, now) : null,
  }
}

/** What POST /claim-data/upload answers. */
export interface ClaimImportResultData {
  uploadId: string
  kind: ClaimDataKind
  totalRows: number
  susutRows: number
  mutuRows: number
  insertedRows: number
  replacedRows: number
  failedRows: number
  b2b: number
  direct: number
  unmatched: number
  warnings: string[]
  errors: Array<{ rowIndex: number; message: string; sheet?: string }>
  sheetsRead?: number
  subtotalRowsSkipped?: number
}

/** One row of GET /claim-data/uploads. */
export interface ClaimUploadHistoryItem {
  id: string
  kind: ClaimDataKind
  file_name: string
  data_as_of: string | null
  uploaded_at: string
  total_rows: number
  susut_rows: number
  mutu_rows: number
  inserted_rows: number
  replaced_rows: number
  failed_rows: number
  b2b_rows: number
  direct_rows: number
  unmatched_rows: number
  warnings: string[] | null
  errors: unknown[] | null
  uploaded_by_name: string | null
  uploaded_by_username: string | null
}

export type ClaimUploadFilter = 'all' | 'os' | 'real' | 'failed'

export const CLAIM_UPLOAD_FILTERS: ReadonlyArray<{ id: ClaimUploadFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'os', label: 'Outstanding' },
  { id: 'real', label: 'Realised' },
  { id: 'failed', label: 'With failed rows' },
]

export function filterClaimUploads<T extends Pick<ClaimUploadHistoryItem, 'kind' | 'failed_rows'>>(items: T[], filter: ClaimUploadFilter): T[] {
  if (filter === 'all') return items
  if (filter === 'failed') return items.filter((item) => (Number(item.failed_rows) || 0) > 0)
  return items.filter((item) => item.kind === filter)
}

/** What this page imports by hand: the OUTSTANDING file only. A realised (REALCLAIM) file is refused here so it can never replace the outstanding snapshot by mistake. */
export function isRealisedClaimFileName(fileName: string): boolean {
  return detectClaimDataKind(fileName) === 'real'
}

export type ClaimAutoRunOutcome = 'imported' | 'unchanged' | 'no_file' | 'source_missing' | 'failed'
export type ClaimAutoRunTone = 'ok' | 'info' | 'warn' | 'error'

/** One run of the claim folder job (GET /claim-data/auto-import/status). */
export interface ClaimAutoImportRun {
  id: string
  trigger_source: 'cron' | 'manual' | string
  started_at: string
  finished_at: string | null
  outcome: ClaimAutoRunOutcome | string
  file_name: string | null
  file_mtime: string | null
  total_rows: number | null
  failed_rows: number | null
  detail: string | null
}

export interface ClaimAutoImportStatus {
  running: boolean
  cronEnabled: boolean
  cron: string
  folder: string
  runs: ClaimAutoImportRun[]
}

const CLAIM_RUN_LABEL: Record<string, { label: string; tone: ClaimAutoRunTone }> = {
  imported: { label: 'New file imported', tone: 'ok' },
  unchanged: { label: 'No new file', tone: 'ok' },
  no_file: { label: 'No claim file in the folder', tone: 'warn' },
  source_missing: { label: 'Folder not reachable', tone: 'error' },
  failed: { label: 'Failed', tone: 'error' },
}

export function describeClaimAutoRun(run: ClaimAutoImportRun): { label: string; tone: ClaimAutoRunTone } {
  return CLAIM_RUN_LABEL[run.outcome] ?? { label: run.outcome, tone: 'info' }
}

/** True once the run has finished (it is written when it ends, so a row means it ended). */
export function isClaimAutoRunFinished(run: ClaimAutoImportRun | null): boolean {
  return !!run && !!run.finished_at
}

/** "Every day at 07:00" for the plain `m h * * *` schedules the job uses; the raw expression for anything else. */
export function describeDailyCron(cron: string): string {
  const m = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*\s*$/.exec(String(cron || ''))
  if (!m) return cron || '-'
  return `every day at ${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`
}
