/**
 * Shared helpers for showing live SAP import progress (dashboard list + detail page).
 * See backend `sapMasterV2.controller.ts` getAllImports/getImportStatus for why
 * `processed_records`/`failed_records` are safe to poll live while status is
 * 'processing'/'pending' (they're updated on an independent DB connection every 25 rows,
 * unlike a sap_raw_data recount which stays invisible until the import's transaction commits).
 */

export interface SapImportProgressRow {
  status: string;
  total_records: number;
  processed_records: number;
  failed_records: number;
  import_timestamp: string;
}

export function isSapImportInFlight(status: string | undefined | null): boolean {
  return status === 'processing' || status === 'pending';
}

export function computeSapImportProgress(imp: SapImportProgressRow): number {
  const total = Number(imp.total_records) || 0;
  const done = (Number(imp.processed_records) || 0) + (Number(imp.failed_records) || 0);
  if (total <= 0) {
    return isSapImportInFlight(imp.status) ? 0 : 100;
  }
  if (done <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/** "1h 12m", "3m 05s", "42s" — used for elapsed time and ETA display. */
export function formatSapImportDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export interface SapImportProgressStats {
  doneCount: number;
  elapsedSeconds: number;
  rowsPerSecond: number;
  remainingRows: number;
  etaSeconds: number | null;
}

export function computeSapImportProgressStats(
  imp: SapImportProgressRow,
  nowMs: number,
): SapImportProgressStats {
  const doneCount = (Number(imp.processed_records) || 0) + (Number(imp.failed_records) || 0);
  const startedAtMs = new Date(imp.import_timestamp).getTime();
  const elapsedSeconds = Number.isFinite(startedAtMs) ? Math.max(0, (nowMs - startedAtMs) / 1000) : 0;
  const rowsPerSecond = doneCount > 0 && elapsedSeconds > 0 ? doneCount / elapsedSeconds : 0;
  const remainingRows = Math.max(0, (Number(imp.total_records) || 0) - doneCount);
  const etaSeconds = rowsPerSecond > 0 ? remainingRows / rowsPerSecond : null;
  return { doneCount, elapsedSeconds, rowsPerSecond, remainingRows, etaSeconds };
}
