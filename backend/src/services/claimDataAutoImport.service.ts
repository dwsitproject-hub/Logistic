import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { parseClaimDataWorkbook, type ClaimDataParseResult } from '../utils/claimDataWorkbook';
import {
  claimAutoImportOriginalDir,
  isClaimAutoImportFile,
  jakartaDateOfMtime,
  pickNewestClaimFile,
} from '../utils/claimAutoImportPaths';
import { sha256File } from '../utils/sapAutoImportPaths';
import { importClaimData, type ClaimDataImportResult } from './claimData.service';

/**
 * Claim Data, from the folder SAP writes into (IT's share, mounted read-only). Two ways in, one result:
 *   - the schedule (CLAIM_AUTO_IMPORT_ENABLED, CLAIM_AUTO_IMPORT_CRON, default 07:00 Asia/Jakarta);
 *   - an administrator's Sync on the Import Claim Data page (the backup for when the schedule did not run).
 *
 * The newest OSCLAIM file in `original` is taken, and only when KLIP does not have those exact bytes yet (SHA-256 of the last imported file).
 * It is imported as OUTSTANDING: it replaces the outstanding snapshot, exactly as the manual import does, and its "data as of" is the date the file was
 * written. Realised claims are not read from this folder. Every run leaves a row in claim_data_auto_import_runs.
 */

export type ClaimAutoImportOutcome = 'imported' | 'unchanged' | 'no_file' | 'source_missing' | 'failed';
export type ClaimAutoImportTrigger = 'cron' | 'manual';

export type ClaimAutoImportResult = {
  outcome: ClaimAutoImportOutcome;
  fileName: string | null;
  uploadId: string | null;
  totalRows: number;
  failedRows: number;
  detail: string | null;
};

/** The schedule: CLAIM_AUTO_IMPORT_CRON, or 07:00 every day. */
export function claimAutoImportCron(): string {
  return process.env.CLAIM_AUTO_IMPORT_CRON || '0 7 * * *';
}

export function isClaimAutoImportEnabled(): boolean {
  return String(process.env.CLAIM_AUTO_IMPORT_ENABLED || 'false').toLowerCase() === 'true';
}

/** Everything the run touches outside itself, so the branches are tested without a share or a database. */
export type ClaimAutoImportDeps = {
  originalDir: () => string;
  dirExists: (dir: string) => boolean;
  listFiles: (dir: string) => Array<{ fileName: string; mtimeMs: number }>;
  hashFile: (filePath: string) => Promise<string>;
  parseFile: (filePath: string) => { parsed: ClaimDataParseResult } | { error: string };
  lastImportedHash: () => Promise<string | null>;
  importOutstanding: (args: { fileName: string; dataAsOf: string; userId: string | null; parsed: ClaimDataParseResult }) => Promise<ClaimDataImportResult>;
  recordRun: (run: {
    trigger: ClaimAutoImportTrigger;
    startedAt: Date;
    startedBy: string | null;
    result: ClaimAutoImportResult;
    fileHash: string | null;
    fileMtime: Date | null;
  }) => Promise<void>;
};

const defaultDeps: ClaimAutoImportDeps = {
  originalDir: claimAutoImportOriginalDir,
  dirExists: (dir) => fs.existsSync(dir),
  listFiles: (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && isClaimAutoImportFile(e.name))
      .map((e) => ({ fileName: e.name, mtimeMs: fs.statSync(path.join(dir, e.name)).mtimeMs })),
  hashFile: sha256File,
  parseFile: (filePath) => {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.readFile(filePath);
    } catch (error) {
      return { error: `The file could not be read as an Excel workbook (${error instanceof Error ? error.message : String(error)}).` };
    }
    const parsed = parseClaimDataWorkbook(wb, 'os');
    if (parsed.errors.length > 0) return { error: parsed.errors.join(' ') };
    return { parsed };
  },
  lastImportedHash: async () => {
    const r = await query(`SELECT file_hash FROM claim_data_auto_import_runs WHERE outcome = 'imported' ORDER BY started_at DESC LIMIT 1`);
    return r.rows[0]?.file_hash ? String(r.rows[0].file_hash) : null;
  },
  importOutstanding: ({ fileName, dataAsOf, userId, parsed }) => importClaimData({ kind: 'os', fileName, userId, dataAsOf, parsed }),
  recordRun: async ({ trigger, startedAt, startedBy, result, fileHash, fileMtime }) => {
    await query(
      `INSERT INTO claim_data_auto_import_runs
         (trigger_source, started_at, finished_at, outcome, file_name, file_hash, file_mtime, upload_id, total_rows, failed_rows, detail, started_by)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11::uuid)`,
      [trigger, startedAt, result.outcome, result.fileName, fileHash, fileMtime, result.uploadId, result.totalRows, result.failedRows, result.detail, startedBy],
    );
  },
};

let running = false;

const empty = (outcome: ClaimAutoImportOutcome, fileName: string | null, detail: string | null): ClaimAutoImportResult => ({
  outcome,
  fileName,
  uploadId: null,
  totalRows: 0,
  failedRows: 0,
  detail,
});

/** True while a run is going (the page keeps its Sync button disabled). */
export function isClaimAutoImportRunning(): boolean {
  return running;
}

/**
 * Look in `original` for the newest OSCLAIM file; if it is new, import it. Never throws: a problem is the run's `failed` outcome, recorded.
 * The folder is IT's and read-only: this only reads from it.
 */
export async function runClaimAutoImport(
  opts: { trigger: ClaimAutoImportTrigger; startedBy?: string | null },
  deps: ClaimAutoImportDeps = defaultDeps,
): Promise<ClaimAutoImportResult> {
  if (running) return empty('failed', null, 'An import is already running.');
  running = true;
  const startedAt = new Date();
  const startedBy = opts.startedBy ?? null;
  let fileHash: string | null = null;
  let fileMtime: Date | null = null;
  let result: ClaimAutoImportResult;
  try {
    const dir = deps.originalDir();
    if (!deps.dirExists(dir)) {
      result = empty('source_missing', null, `The folder is not there: ${dir}. Check CLAIM_AUTO_IMPORT_ROOT and that the claim share is mounted into the container.`);
    } else {
      const newest = pickNewestClaimFile(deps.listFiles(dir));
      if (!newest) {
        result = empty('no_file', null, 'No claim file in the folder (the name must start with "OSCLAIM"). CLAIM_AUTO_IMPORT_FILE_PATTERN changes the rule.');
      } else {
        const filePath = path.join(dir, newest.fileName);
        fileMtime = new Date(newest.mtimeMs);
        fileHash = await deps.hashFile(filePath);
        if (fileHash === (await deps.lastImportedHash())) {
          result = empty('unchanged', newest.fileName, 'This file was already imported.');
        } else {
          const read = deps.parseFile(filePath);
          if ('error' in read) {
            result = empty('failed', newest.fileName, read.error);
          } else if (read.parsed.rows.length === 0) {
            // An empty file must not replace the snapshot: that would wipe every outstanding claim.
            result = empty('failed', newest.fileName, 'The file has no claim rows, so the outstanding snapshot was left as it is.');
          } else {
            const imported = await deps.importOutstanding({
              fileName: newest.fileName,
              dataAsOf: jakartaDateOfMtime(newest.mtimeMs),
              userId: startedBy,
              parsed: read.parsed,
            });
            result = {
              outcome: 'imported',
              fileName: newest.fileName,
              uploadId: imported.uploadId,
              totalRows: imported.totalRows,
              failedRows: imported.failedRows,
              detail: imported.failedRows ? `${imported.failedRows} row(s) could not be saved; see the import history.` : null,
            };
          }
        }
      }
    }
  } catch (error) {
    logger.error('Claim Data auto-import failed', { error: error instanceof Error ? error.message : String(error) });
    result = empty('failed', null, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500));
  } finally {
    running = false;
  }
  try {
    await deps.recordRun({ trigger: opts.trigger, startedAt, startedBy, result, fileHash, fileMtime });
  } catch (error) {
    logger.error('Claim Data auto-import: could not record the run', { error: error instanceof Error ? error.message : String(error) });
  }
  logger.info('Claim Data auto-import finished', { trigger: opts.trigger, outcome: result.outcome, file: result.fileName, rows: result.totalRows });
  return result;
}

/** Cron entry: a no-op when CLAIM_AUTO_IMPORT_ENABLED is not true. Never throws. */
export async function runClaimAutoImportJob(): Promise<ClaimAutoImportResult | null> {
  if (!isClaimAutoImportEnabled()) {
    logger.info('Claim Data auto-import cron skipped (CLAIM_AUTO_IMPORT_ENABLED is not true)');
    return null;
  }
  return runClaimAutoImport({ trigger: 'cron' });
}

/** Sync button: start a run in the background (the import takes a while) and return at once. `started` is false when one is already going. */
export function startClaimAutoImportInBackground(startedBy: string | null): { started: boolean } {
  if (running) return { started: false };
  void runClaimAutoImport({ trigger: 'manual', startedBy });
  return { started: true };
}

export type ClaimAutoImportRunRow = {
  id: string;
  trigger_source: ClaimAutoImportTrigger;
  started_at: string;
  finished_at: string | null;
  outcome: ClaimAutoImportOutcome;
  file_name: string | null;
  file_mtime: string | null;
  total_rows: number | null;
  failed_rows: number | null;
  detail: string | null;
};

/** The latest runs, newest first, for the page's status strip. */
export async function listRecentClaimAutoImportRuns(limit = 5): Promise<ClaimAutoImportRunRow[]> {
  const r = await query(
    `SELECT id, trigger_source, started_at, finished_at, outcome, file_name, file_mtime, total_rows, failed_rows, detail
       FROM claim_data_auto_import_runs ORDER BY started_at DESC LIMIT $1`,
    [Math.max(1, Math.min(50, limit))],
  );
  return r.rows as ClaimAutoImportRunRow[];
}
