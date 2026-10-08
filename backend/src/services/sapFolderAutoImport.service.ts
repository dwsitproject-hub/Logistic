import fs from 'fs';
import path from 'path';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { SQL_SAP_IMPORT_IN_FLIGHT_EXISTS } from '../utils/sapImportInFlightSql';
import { sendEmail } from './email.service';
import { failStaleSapImports } from './sapImportRecovery.service';
import { frontendUrl } from './sessionAuth.service';
import { SapMasterV2ImportService } from './sapMasterV2Import.service';
import {
  buildSapAutoImportEmailHtml,
  buildSapAutoImportEmailSubject,
  type SapAutoImportEmailFile,
  type SapAutoImportEmailKind,
} from './sapAutoImportEmail.template';
import { type SapAutoImportIdentityRow } from '../utils/sapAutoImportIdentity';
import {
  ensureSapAutoImportFolders,
  isSapAutoImportExcelFile,
  resolveSafeFailedWorkbookPath,
  sapAutoImportFailedDir,
  sapAutoImportResultFileName,
  sapAutoImportShareFailedPath,
  sapAutoImportSuccessDir,
  sha256File,
  shouldSkipCompletedSapAutoImport,
} from '../utils/sapAutoImportPaths';
import {
  writeSapAutoImportFailedWorkbook,
  writeSapAutoImportSuccessWorkbook,
} from '../utils/sapAutoImportWorkbook';

export interface SapFolderAutoImportFileResult {
  fileName: string;
  sha256: string;
  status: 'completed' | 'failed' | 'skipped';
  importId?: string;
  processedRecords?: number;
  skippedRecords?: number;
  failedRecords?: number;
  successFileName?: string | null;
  failedFileName?: string | null;
  errorMessage?: string;
  errorLog?: string[];
}

export interface SapFolderAutoImportRunResult {
  ran: boolean;
  skipReason?: 'in_flight' | 'already_running';
  filesScanned: number;
  filesProcessed: number;
  filesSkippedChecksum: number;
  files: SapFolderAutoImportFileResult[];
  emailSent: boolean;
}

export type SapAutoImportTrigger = 'cron' | 'manual';

export type SapAutoImportRunOutcome =
  | 'imported'
  | 'no_new_file'
  | 'skipped_in_flight'
  | 'already_running'
  | 'source_missing'
  | 'failed';

/** What a run saw, beyond its result: the file it chose and whether the folder was there at all. */
export interface SapAutoImportRunTrace {
  newestFile?: string;
  newestFileMtimeMs?: number;
  sourceMissing?: boolean;
}

let runLock = false;
let runLockSince = 0;

/**
 * A run that has held the lock this long is hung (a stalled read on the network share never returns), not slow: the whole
 * import takes minutes. Without a limit one hung run left `runLock` set until the backend restarted, and every later run -
 * the cron and the Sync button - answered "already running" and did nothing.
 */
const RUN_LOCK_MAX_MS = 45 * 60 * 1000;

/** Reading and hashing a workbook across the share must not wait forever either. */
const HASH_TIMEOUT_MS = 10 * 60 * 1000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 60000)} minutes`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** One word and one sentence for a finished run - what the Sync button and the status line show. */
export function classifySapAutoImportRun(
  result: SapFolderAutoImportRunResult,
  trace: SapAutoImportRunTrace,
): { outcome: SapAutoImportRunOutcome; detail: string } {
  if (result.skipReason === 'already_running') {
    return { outcome: 'already_running', detail: 'Another run of this job is still in progress.' };
  }
  if (result.skipReason === 'in_flight') {
    return {
      outcome: 'skipped_in_flight',
      detail: 'An SAP import is still running (status processing / pending), so the job did not start.',
    };
  }
  if (trace.sourceMissing) {
    return {
      outcome: 'source_missing',
      detail: 'The source folder does not exist inside the backend container (is the share mounted?).',
    };
  }
  const failed = result.files.find((f) => f.status === 'failed');
  if (result.filesProcessed > 0) {
    const names = result.files.filter((f) => f.status === 'completed').map((f) => f.fileName);
    return { outcome: 'imported', detail: `Imported ${names.join(', ')}.` };
  }
  if (failed) {
    return { outcome: 'failed', detail: `${failed.fileName}: ${failed.errorMessage ?? 'import failed'}` };
  }
  if (result.filesScanned === 0) {
    return { outcome: 'no_new_file', detail: 'The Original folder holds no Excel files.' };
  }
  return {
    outcome: 'no_new_file',
    detail: `The newest file${trace.newestFile ? ` (${trace.newestFile})` : ''} was already imported - same content as an earlier run.`,
  };
}

/**
 * Close the history rows of runs that can no longer be running. A run whose process never came back (the lock watchdog released
 * it) kept its row at 'running' forever, so the history claimed a sync was still in progress hours after a newer one had finished.
 * Anything 'running' for longer than the lock limit is hung or lost; say so.
 */
async function failOrphanRuns(): Promise<void> {
  try {
    await query(
      `UPDATE sap_auto_import_runs
          SET finished_at = NOW(),
              outcome = 'failed',
              detail = COALESCE(detail, 'The run never reported back (more than ' || $1::int || ' minutes). It was hung or the backend restarted; check the import it started.')
        WHERE outcome = 'running'
          AND started_at < NOW() - ($1::int * INTERVAL '1 minute')`,
      [Math.round(RUN_LOCK_MAX_MS / 60000)],
    );
  } catch (error) {
    logger.error('Could not close orphaned SAP auto-import runs', { error });
  }
}

/**
 * At backend start: every run still 'running' belongs to the process that just died (imports run inside this process), so it is
 * closed at once, with no age limit. 2026-10-08: the container was killed and restarted 11 times in four minutes while an import ran;
 * its history row and the import itself stayed 'running' / 'processing' for 30 minutes, and the page kept counting elapsed time.
 */
export async function closeRunsInterruptedByRestart(): Promise<void> {
  try {
    await query(
      `UPDATE sap_auto_import_runs
          SET finished_at = NOW(),
              outcome = 'failed',
              detail = 'Interrupted: the backend restarted while this run was in progress. Press Sync to run it again.'
        WHERE outcome = 'running'`,
    );
  } catch (error) {
    logger.error('Could not close SAP auto-import runs interrupted by a restart', { error });
  }
}

async function recordRunStart(trigger: SapAutoImportTrigger, startedBy: string | null): Promise<string | null> {
  await failOrphanRuns();
  try {
    const res = await query(
      `INSERT INTO sap_auto_import_runs (trigger_source, started_by) VALUES ($1, $2) RETURNING id::text`,
      [trigger, startedBy],
    );
    return (res.rows[0] as { id: string } | undefined)?.id ?? null;
  } catch (error) {
    logger.error('Could not record the start of an SAP auto-import run', { error });
    return null;
  }
}

async function recordRunFinish(
  runId: string | null,
  outcome: SapAutoImportRunOutcome,
  detail: string,
  result: SapFolderAutoImportRunResult | null,
  trace: SapAutoImportRunTrace,
): Promise<void> {
  if (!runId) return;
  try {
    await query(
      `UPDATE sap_auto_import_runs
          SET finished_at = NOW(),
              outcome = $2,
              detail = $3,
              newest_file = $4,
              newest_file_mtime = CASE WHEN $5::double precision IS NULL THEN NULL ELSE to_timestamp($5::double precision / 1000.0) END,
              files_scanned = $6,
              files_processed = $7,
              files_skipped = $8,
              import_id = $9::uuid
        WHERE id = $1::uuid`,
      [
        runId,
        outcome,
        detail,
        trace.newestFile ?? null,
        trace.newestFileMtimeMs ?? null,
        result?.filesScanned ?? null,
        result?.filesProcessed ?? null,
        result?.filesSkippedChecksum ?? null,
        result?.files.find((f) => f.importId)?.importId ?? null,
      ],
    );
  } catch (error) {
    logger.error('Could not record the end of an SAP auto-import run', { runId, error });
  }
}

export function isSapAutoImportEnabled(): boolean {
  return String(process.env.SAP_AUTO_IMPORT_ENABLED || 'false').toLowerCase() === 'true';
}

export function partitionOriginalFilesByChecksum(
  files: Array<{ fileName: string; sha256: string }>,
  completedSha256: Set<string>,
): {
  toProcess: Array<{ fileName: string; sha256: string }>;
  skipped: Array<{ fileName: string; sha256: string }>;
} {
  const toProcess: Array<{ fileName: string; sha256: string }> = [];
  const skipped: Array<{ fileName: string; sha256: string }> = [];
  for (const file of files) {
    if (completedSha256.has(file.sha256)) skipped.push(file);
    else toProcess.push(file);
  }
  return { toProcess, skipped };
}

export async function findSapAutoImportAdminRecipients(): Promise<string[]> {
  const result = await query(
    `SELECT email
     FROM users
     WHERE is_active = true
       AND UPPER(TRIM(role)) = 'ADMIN'
       AND email IS NOT NULL
       AND TRIM(email) <> ''`,
  );
  const dbEmails = result.rows
    .map((row: { email?: string }) => String(row.email || '').trim())
    .filter(Boolean);

  const extra = String(process.env.SAP_AUTO_IMPORT_EXTRA_RECIPIENTS || '')
    .split(/[,;]/)
    .map((email) => email.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const email of [...dbEmails, ...extra]) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(email);
  }
  return merged;
}

function failedFileDownloadUrl(fileName: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/sap-master-v2/auto-import/failed-file?file=${encodeURIComponent(fileName)}`;
}

async function loadCompletedChecksums(): Promise<Set<string>> {
  const result = await query(
    `SELECT sha256, status FROM sap_auto_import_files`,
  );
  const completed = new Set<string>();
  for (const row of result.rows as Array<{ sha256: string; status: string }>) {
    if (shouldSkipCompletedSapAutoImport(row.status)) {
      completed.add(row.sha256);
    }
  }
  return completed;
}

async function upsertRegistry(row: {
  fileName: string;
  sha256: string;
  fileSize: number;
  importId?: string | null;
  status: 'completed' | 'failed' | 'skipped';
  successFileName?: string | null;
  failedFileName?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO sap_auto_import_files (
       file_name, sha256, file_size, processed_at, import_id, status,
       success_file_name, failed_file_name, error_message
     ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8)
     ON CONFLICT (sha256) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       file_size = EXCLUDED.file_size,
       processed_at = EXCLUDED.processed_at,
       import_id = EXCLUDED.import_id,
       status = EXCLUDED.status,
       success_file_name = EXCLUDED.success_file_name,
       failed_file_name = EXCLUDED.failed_file_name,
       error_message = EXCLUDED.error_message`,
    [
      row.fileName,
      row.sha256,
      row.fileSize,
      row.importId ?? null,
      row.status,
      row.successFileName ?? null,
      row.failedFileName ?? null,
      row.errorMessage ?? null,
    ],
  );
}

async function sapImportInFlight(): Promise<boolean> {
  const result = await query(SQL_SAP_IMPORT_IN_FLIGHT_EXISTS);
  return (result.rowCount ?? 0) > 0;
}

function listOriginalExcelFiles(originalDir: string): string[] {
  if (!fs.existsSync(originalDir)) return [];
  return fs
    .readdirSync(originalDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSapAutoImportExcelFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Take only the newest file when the folder holds several.
 *
 * Original is an archive - nobody empties it - so a folder with a month of exports would
 * otherwise be imported end to end, replaying old SAP states over the current one in whatever
 * order the names sorted. Only the newest export describes today.
 *
 * Newest by modification time, because the file name is IT's format and not ours to parse; the
 * name breaks a tie only so the choice is deterministic when two files share a timestamp (which
 * a bulk copy onto a share does produce).
 *
 * If the newest file was already imported, this run has nothing to do. That is the point: it
 * must not fall back to an older file and undo the newer one.
 */
export function pickLatestOriginalFile<T extends { fileName: string; mtimeMs: number }>(
  files: readonly T[],
): T[] {
  if (files.length <= 1) return [...files];
  const newest = [...files].sort(
    (a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName, undefined, { numeric: true }),
  )[0];
  return [newest];
}

/** Escape hatch for a deliberate backfill of several files in one run. */
export function sapAutoImportProcessesAllFiles(): boolean {
  return String(process.env.SAP_AUTO_IMPORT_ALL_FILES || 'false').toLowerCase() === 'true';
}

async function sendRunEmail(
  kind: SapAutoImportEmailKind,
  files: SapAutoImportEmailFile[],
  filesSkippedChecksum = 0,
  sourcePath?: string,
): Promise<boolean> {
  const recipients = await findSapAutoImportAdminRecipients();
  const appUrl = frontendUrl();
  const input = { kind, frontendUrl: appUrl, files, filesSkippedChecksum, sourcePath };
  return sendEmail({
    to: recipients,
    subject: buildSapAutoImportEmailSubject(input),
    html: buildSapAutoImportEmailHtml(input),
  });
}

function toEmailFile(result: SapFolderAutoImportFileResult, appUrl: string): SapAutoImportEmailFile {
  const failedName = result.failedFileName ?? null;
  return {
    fileName: result.fileName,
    status: result.status,
    importId: result.importId,
    processedRecords: result.processedRecords,
    skippedRecords: result.skippedRecords,
    failedRecords: result.failedRecords,
    failedFileName: failedName,
    failedDownloadUrl: failedName ? failedFileDownloadUrl(failedName, appUrl) : null,
    failedSharePath: failedName ? sapAutoImportShareFailedPath(failedName) : null,
    errorMessage: result.errorMessage,
    errorLogSnippet: (result.errorLog ?? []).slice(0, 8),
  };
}

async function identitiesFromFailures(importId: string): Promise<SapAutoImportIdentityRow[]> {
  const result = await query(
    `SELECT contract_date, contract_number, contract_ext_no, po_number, sto_number, supplier, error_message
     FROM sap_import_failures
     WHERE import_id = $1
     ORDER BY row_number`,
    [importId],
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    contractDate: row.contract_date != null ? String(row.contract_date) : null,
    contractNumber: row.contract_number != null ? String(row.contract_number) : null,
    contractExtNo: row.contract_ext_no != null ? String(row.contract_ext_no) : null,
    poNumber: row.po_number != null ? String(row.po_number) : null,
    stoNumber: row.sto_number != null ? String(row.sto_number) : null,
    supplier: row.supplier != null ? String(row.supplier) : null,
    remarks: row.error_message != null ? String(row.error_message) : null,
  }));
}

/**
 * Scan Original/, import new Excel files sequentially via MASTER v2, write Success/Failed
 * workbooks, and email ADMIN. Original files are never moved or deleted.
 */
async function runSapFolderAutoImportCore(
  options: { notify?: boolean; latestOnly?: boolean },
  trace: SapAutoImportRunTrace,
): Promise<SapFolderAutoImportRunResult> {
  const notify = options.notify !== false;

  if (runLock && Date.now() - runLockSince > RUN_LOCK_MAX_MS) {
    logger.error('SAP folder auto-import: releasing a run lock held for too long (the earlier run is hung)', {
      heldMinutes: Math.round((Date.now() - runLockSince) / 60000),
    });
    runLock = false;
  }

  if (runLock) {
    logger.warn('SAP folder auto-import already running; skipping overlapping request');
    return {
      ran: false,
      skipReason: 'already_running',
      filesScanned: 0,
      filesProcessed: 0,
      filesSkippedChecksum: 0,
      files: [],
      emailSent: false,
    };
  }

  runLock = true;
  runLockSince = Date.now();
  try {
    const folders = ensureSapAutoImportFolders();
    trace.sourceMissing = !folders.originalExists;
    if (!folders.originalExists) {
      /*
       * Distinguish "the folder is not there" from "the folder is empty". Both used to surface as
       * filesScanned: 0, which is why a moved share path looked like an ordinary quiet morning.
       */
      logger.error('SAP folder auto-import: the source folder does not exist', {
        originalDir: folders.original,
        root: folders.root,
        hint: 'Check SAP_AUTO_IMPORT_ROOT and that the share is mounted into the container',
      });
      /*
       * Say so, and stop. Carrying on read an unreadable folder as an empty one and ended in the "no new files" email - the same
       * words as a quiet morning - so a share that had been dead since the evening before (2026-10-07: a Docker network took the
       * office LAN's subnet and the route to the NAS) went unnoticed until someone asked why a fresh file was not imported.
       */
      const emailSent = notify ? await sendRunEmail('source_missing', [], 0, folders.original) : false;
      return {
        ran: true,
        filesScanned: 0,
        filesProcessed: 0,
        filesSkippedChecksum: 0,
        files: [],
        emailSent,
      };
    }
    const fileNames = listOriginalExcelFiles(folders.original);
    /*
     * The folder it actually scanned, every run. Without this a path that has moved reports
     * `filesScanned: 0` and nothing else - identical to a morning with no new files, which is
     * how a changed share path stayed unnoticed until someone asked why nothing was importing.
     */
    logger.info('SAP folder auto-import scanning', {
      originalDir: folders.original,
      excelFilesFound: fileNames.length,
    });
    /*
     * Stat first, hash second. Hashing reads the whole workbook across a network share, and once
     * only the newest file is a candidate there is no reason to read the rest at all.
     */
    const stated = fileNames.map((fileName) => {
      const filePath = path.join(folders.original, fileName);
      const stat = fs.statSync(filePath);
      return { fileName, filePath, fileSize: stat.size, mtimeMs: stat.mtimeMs };
    });
    // `latestOnly` (the Sync button) ignores SAP_AUTO_IMPORT_ALL_FILES: a hand-started sync imports the newest file or nothing.
    const candidates =
      sapAutoImportProcessesAllFiles() && !options.latestOnly ? stated : pickLatestOriginalFile(stated);
    const newestStated = pickLatestOriginalFile(stated)[0];
    trace.newestFile = newestStated?.fileName;
    trace.newestFileMtimeMs = newestStated?.mtimeMs;
    if (candidates.length < stated.length) {
      logger.info('SAP folder auto-import taking the latest file only', {
        chosen: candidates[0]?.fileName,
        modified: candidates[0] ? new Date(candidates[0].mtimeMs).toISOString() : null,
        olderFilesIgnored: stated.length - candidates.length,
      });
    }

    const hashed: Array<{ fileName: string; sha256: string; fileSize: number; filePath: string }> = [];
    for (const candidate of candidates) {
      hashed.push({
        fileName: candidate.fileName,
        sha256: await withTimeout(sha256File(candidate.filePath), HASH_TIMEOUT_MS, `Reading ${candidate.fileName}`),
        fileSize: candidate.fileSize,
        filePath: candidate.filePath,
      });
    }

    // A row a restart left in 'processing' would otherwise block this run (and every later one) with no limit.
    await failStaleSapImports();

    if (await sapImportInFlight()) {
      logger.warn('SAP folder auto-import skipped: another import is in flight');
      const emailSent = notify
        ? await sendRunEmail('skipped_in_flight', [])
        : false;
      return {
        ran: false,
        skipReason: 'in_flight',
        filesScanned: stated.length,
        filesProcessed: 0,
        filesSkippedChecksum: 0,
        files: [],
        emailSent,
      };
    }

    const completed = await loadCompletedChecksums();
    const { toProcess, skipped } = partitionOriginalFilesByChecksum(
      hashed.map(({ fileName, sha256 }) => ({ fileName, sha256 })),
      completed,
    );
    const skippedResults: SapFolderAutoImportFileResult[] = skipped.map((file) => ({
      fileName: file.fileName,
      sha256: file.sha256,
      status: 'skipped',
      errorMessage: 'Already imported (same SHA-256)',
    }));

    if (toProcess.length === 0) {
      const emailSent = notify ? await sendRunEmail('no_new_files', [], skipped.length) : false;
      return {
        ran: true,
        filesScanned: stated.length,
        filesProcessed: 0,
        filesSkippedChecksum: skipped.length,
        files: skippedResults,
        emailSent,
      };
    }

    const processedResults: SapFolderAutoImportFileResult[] = [];

    for (const item of toProcess) {
      const meta = hashed.find((h) => h.sha256 === item.sha256 && h.fileName === item.fileName);
      if (!meta) continue;

      if (await sapImportInFlight()) {
        processedResults.push({
          fileName: meta.fileName,
          sha256: meta.sha256,
          status: 'skipped',
          errorMessage: 'Skipped: another SAP import started while this run was in progress',
        });
        continue;
      }

      try {
        const importResult = await SapMasterV2ImportService.importMasterV2File(meta.filePath, {
          source: 'scheduler',
          fileName: meta.fileName,
        });

        const successRows = importResult.successIdentities ?? [];
        let failedRows = importResult.failedIdentities ?? [];
        if (failedRows.length === 0 && (importResult.failedRecords ?? 0) > 0 && importResult.importId) {
          failedRows = await identitiesFromFailures(importResult.importId);
        }

        const successFileName = sapAutoImportResultFileName(meta.fileName, 'success');
        const failedFileName = sapAutoImportResultFileName(meta.fileName, 'failed');
        /*
         * A result workbook that cannot be written must not turn a successful import into a
         * failed one. These writes sit inside the same try as the import, so an EROFS from a
         * read-only share would have marked the file 'failed' and left the registry claiming the
         * data never landed - while it had, in full.
         */
        const writeResultWorkbook = (what: string, write: () => boolean): boolean => {
          try {
            return write();
          } catch (error) {
            logger.error('SAP auto-import result workbook could not be written (import itself is unaffected)', {
              what,
              fileName: meta.fileName,
              error: error instanceof Error ? error.message : String(error),
            });
            return false;
          }
        };
        const wroteSuccess = writeResultWorkbook('success', () =>
          writeSapAutoImportSuccessWorkbook(
            path.join(sapAutoImportSuccessDir(), successFileName),
            successRows,
          ),
        );
        const wroteFailed = writeResultWorkbook('failed', () =>
          writeSapAutoImportFailedWorkbook(
            path.join(sapAutoImportFailedDir(), failedFileName),
            failedRows,
          ),
        );

        const fileResult: SapFolderAutoImportFileResult = {
          fileName: meta.fileName,
          sha256: meta.sha256,
          status: 'completed',
          importId: importResult.importId,
          processedRecords: importResult.processedRecords,
          skippedRecords: importResult.skippedRecords ?? 0,
          failedRecords: importResult.failedRecords,
          successFileName: wroteSuccess ? successFileName : null,
          failedFileName: wroteFailed ? failedFileName : null,
          errorLog: importResult.errors,
        };
        processedResults.push(fileResult);
        await upsertRegistry({
          fileName: meta.fileName,
          sha256: meta.sha256,
          fileSize: meta.fileSize,
          importId: importResult.importId ?? null,
          status: 'completed',
          successFileName: fileResult.successFileName,
          failedFileName: fileResult.failedFileName,
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('SAP folder auto-import failed for file', { fileName: meta.fileName, error });
        const fileResult: SapFolderAutoImportFileResult = {
          fileName: meta.fileName,
          sha256: meta.sha256,
          status: 'failed',
          errorMessage: message,
        };
        processedResults.push(fileResult);
        await upsertRegistry({
          fileName: meta.fileName,
          sha256: meta.sha256,
          fileSize: meta.fileSize,
          status: 'failed',
          errorMessage: message,
        });
      }
    }

    const allFiles = [...skippedResults, ...processedResults];
    const appUrl = frontendUrl();
    const emailSent = notify
      ? await sendRunEmail(
          'run_summary',
          allFiles.map((f) => toEmailFile(f, appUrl)),
          skipped.length,
        )
      : false;

    return {
      ran: true,
      filesScanned: stated.length,
      filesProcessed: processedResults.filter((f) => f.status === 'completed').length,
      filesSkippedChecksum: skipped.length,
      files: allFiles,
      emailSent,
    };
  } finally {
    runLock = false;
  }
}

/**
 * Scan Original/, import the newest file if it is new, and leave a row in sap_auto_import_runs saying what happened - the cron and
 * the Sync button both come through here.
 */
export async function runSapFolderAutoImport(
  options: { notify?: boolean; latestOnly?: boolean; trigger?: SapAutoImportTrigger; startedBy?: string | null } = {},
): Promise<SapFolderAutoImportRunResult> {
  const trace: SapAutoImportRunTrace = {};
  const runId = await recordRunStart(options.trigger ?? 'manual', options.startedBy ?? null);
  try {
    const result = await runSapFolderAutoImportCore({ notify: options.notify, latestOnly: options.latestOnly }, trace);
    const { outcome, detail } = classifySapAutoImportRun(result, trace);
    await recordRunFinish(runId, outcome, detail, result, trace);
    return result;
  } catch (error) {
    await recordRunFinish(runId, 'failed', error instanceof Error ? error.message : String(error), null, trace);
    throw error;
  }
}

/** Daily cron entry — no-op when disabled. Never throws. */
export async function runSapFolderAutoImportJob(): Promise<SapFolderAutoImportRunResult | null> {
  if (!isSapAutoImportEnabled()) {
    logger.info('SAP folder auto-import cron skipped (SAP_AUTO_IMPORT_ENABLED is not true)');
    return null;
  }
  try {
    const result = await runSapFolderAutoImport({ notify: true, trigger: 'cron' });
    logger.info('SAP folder auto-import job finished', {
      skipReason: result.skipReason,
      filesScanned: result.filesScanned,
      filesProcessed: result.filesProcessed,
      filesSkippedChecksum: result.filesSkippedChecksum,
      emailSent: result.emailSent,
    });
    return result;
  } catch (error) {
    logger.error('SAP folder auto-import job failed', { error });
    return null;
  }
}

/** True while a run holds the lock (a lock held past RUN_LOCK_MAX_MS is hung, and does not count). */
export function isSapFolderAutoImportRunning(): boolean {
  return runLock && Date.now() - runLockSince <= RUN_LOCK_MAX_MS;
}

/**
 * The Sync button: the same run as the cron, started by hand as a backup for when the schedule did not pull a file.
 *
 * Returns at once and lets the run finish in the background - an import takes minutes, longer than a proxy keeps a request
 * open. The page polls the status endpoint. No email: the person who pressed the button is looking at the result.
 */
export function startSapFolderSyncInBackground(startedBy: string | null): { started: boolean } {
  if (isSapFolderAutoImportRunning()) return { started: false };
  void runSapFolderAutoImport({ notify: false, latestOnly: true, trigger: 'manual', startedBy }).catch((error) => {
    logger.error('SAP folder Sync run failed', { error });
  });
  return { started: true };
}

export interface SapAutoImportRunRow {
  id: string;
  trigger_source: string;
  started_at: string;
  finished_at: string | null;
  outcome: string;
  detail: string | null;
  newest_file: string | null;
  newest_file_mtime: string | null;
  files_scanned: number | null;
  files_processed: number | null;
  files_skipped: number | null;
  import_id: string | null;
}

export async function listRecentSapAutoImportRuns(limit = 5): Promise<SapAutoImportRunRow[]> {
  const result = await query(
    `SELECT id::text, trigger_source, started_at, finished_at, outcome, detail, newest_file, newest_file_mtime,
            files_scanned, files_processed, files_skipped, import_id::text
       FROM sap_auto_import_runs
      ORDER BY started_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(20, limit))],
  );
  return result.rows as SapAutoImportRunRow[];
}

export function failedWorkbookAbsolutePath(requestedFile: string): string | null {
  return resolveSafeFailedWorkbookPath(requestedFile);
}

/** Exposed for tests that need to release the module lock after a mocked hang. */
export function resetSapFolderAutoImportLockForTests(): void {
  runLock = false;
}
