import fs from 'fs';
import path from 'path';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { SQL_SAP_IMPORT_IN_FLIGHT_EXISTS } from '../utils/sapImportInFlightSql';
import { sendEmail } from './email.service';
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

let runLock = false;

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

async function sendRunEmail(kind: SapAutoImportEmailKind, files: SapAutoImportEmailFile[], filesSkippedChecksum = 0): Promise<boolean> {
  const recipients = await findSapAutoImportAdminRecipients();
  const appUrl = frontendUrl();
  const input = { kind, frontendUrl: appUrl, files, filesSkippedChecksum };
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
export async function runSapFolderAutoImport(
  options: { notify?: boolean } = {},
): Promise<SapFolderAutoImportRunResult> {
  const notify = options.notify !== false;

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
  try {
    const folders = ensureSapAutoImportFolders();
    const fileNames = listOriginalExcelFiles(folders.original);
    const hashed: Array<{ fileName: string; sha256: string; fileSize: number; filePath: string }> = [];

    for (const fileName of fileNames) {
      const filePath = path.join(folders.original, fileName);
      const stat = fs.statSync(filePath);
      hashed.push({
        fileName,
        sha256: await sha256File(filePath),
        fileSize: stat.size,
        filePath,
      });
    }

    if (await sapImportInFlight()) {
      logger.warn('SAP folder auto-import skipped: another import is in flight');
      const emailSent = notify
        ? await sendRunEmail('skipped_in_flight', [])
        : false;
      return {
        ran: false,
        skipReason: 'in_flight',
        filesScanned: hashed.length,
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
        filesScanned: hashed.length,
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
        const wroteSuccess = writeSapAutoImportSuccessWorkbook(
          path.join(sapAutoImportSuccessDir(), successFileName),
          successRows,
        );
        const wroteFailed = writeSapAutoImportFailedWorkbook(
          path.join(sapAutoImportFailedDir(), failedFileName),
          failedRows,
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
      filesScanned: hashed.length,
      filesProcessed: processedResults.filter((f) => f.status === 'completed').length,
      filesSkippedChecksum: skipped.length,
      files: allFiles,
      emailSent,
    };
  } finally {
    runLock = false;
  }
}

/** Daily cron entry — no-op when disabled. Never throws. */
export async function runSapFolderAutoImportJob(): Promise<SapFolderAutoImportRunResult | null> {
  if (!isSapAutoImportEnabled()) {
    logger.info('SAP folder auto-import cron skipped (SAP_AUTO_IMPORT_ENABLED is not true)');
    return null;
  }
  try {
    const result = await runSapFolderAutoImport({ notify: true });
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

export function failedWorkbookAbsolutePath(requestedFile: string): string | null {
  return resolveSafeFailedWorkbookPath(requestedFile);
}

/** Exposed for tests that need to release the module lock after a mocked hang. */
export function resetSapFolderAutoImportLockForTests(): void {
  runLock = false;
}
