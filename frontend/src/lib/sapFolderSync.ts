/**
 * The SAP folder job's runs (cron and the Sync button), as the SAP Imports page shows them.
 * Mirrors sap_auto_import_runs / GET /sap-master-v2/auto-import/status.
 */
export type SapFolderRunOutcome =
  | 'running'
  | 'imported'
  | 'no_new_file'
  | 'skipped_in_flight'
  | 'already_running'
  | 'source_missing'
  | 'failed'

export interface SapFolderRun {
  id: string
  trigger_source: 'cron' | 'manual' | string
  started_at: string
  finished_at: string | null
  outcome: SapFolderRunOutcome | string
  detail: string | null
  newest_file: string | null
  newest_file_mtime: string | null
  files_scanned: number | null
  files_processed: number | null
  files_skipped: number | null
  import_id: string | null
}

export type SapFolderRunTone = 'ok' | 'info' | 'warn' | 'error'

const OUTCOME_LABEL: Record<string, { label: string; tone: SapFolderRunTone }> = {
  running: { label: 'Running', tone: 'info' },
  imported: { label: 'New file imported', tone: 'ok' },
  no_new_file: { label: 'No new file', tone: 'ok' },
  skipped_in_flight: { label: 'Skipped - an import is running', tone: 'warn' },
  already_running: { label: 'Skipped - a sync is already running', tone: 'warn' },
  source_missing: { label: 'Folder not reachable', tone: 'error' },
  failed: { label: 'Failed', tone: 'error' },
}

export function describeSapFolderRun(run: SapFolderRun): { label: string; tone: SapFolderRunTone } {
  return OUTCOME_LABEL[run.outcome] ?? { label: run.outcome, tone: 'info' }
}

/** Jakarta wall-clock, e.g. "08 Oct 2026, 06:00". */
export function formatSapFolderTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * The run a Sync click started: the newest run that began at or after the click (clock skew allowance) - not just the newest
 * run, which can be an earlier cron run while the new one has not been written yet.
 */
export function findRunStartedSince(runs: SapFolderRun[], sinceMs: number, skewMs = 15_000): SapFolderRun | null {
  const cutoff = sinceMs - skewMs
  return runs.find((r) => new Date(r.started_at).getTime() >= cutoff) ?? null
}

/** True once that run has finished, so polling can stop. */
export function isSapFolderRunFinished(run: SapFolderRun | null): boolean {
  return !!run && run.outcome !== 'running' && !!run.finished_at
}
