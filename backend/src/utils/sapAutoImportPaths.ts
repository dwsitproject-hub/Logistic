import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getUploadRootDir } from './fileUpload';
import logger from './logger';

const EXCEL_EXT = new Set(['.xlsx', '.xlsm', '.xlsb', '.xls']);

export function sapAutoImportRootDir(): string {
  const configured = String(process.env.SAP_AUTO_IMPORT_ROOT || '').trim();
  if (configured) {
    /*
     * A UNC path (\\server\share\...) is what the folder looks like to whoever gave it to you,
     * and it is meaningless to this process on Linux: path.isAbsolute() says false, so it would
     * be quietly joined onto the working directory and the scan would find nothing, with no
     * error anywhere. Say so instead - the fix is to point at the mounted path.
     */
    if (/^[\\/]{2}/.test(configured) && process.platform !== 'win32') {
      logger.error(
        'SAP_AUTO_IMPORT_ROOT is a UNC path but this process is not on Windows - use the mounted path instead',
        { configured },
      );
    }
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(getUploadRootDir(), 'SAP Data');
}

/**
 * Where result workbooks go, when that is not where the source files come from.
 *
 * The share holding Original is mounted read-only, and SIT and production read the *same* folder
 * - so writing Success/Failed back to it is both impossible here and wrong there, since the two
 * environments produce identically named workbooks that would overwrite each other. Defaults to
 * the source root, which is the old single-folder behaviour.
 */
export function sapAutoImportResultsRootDir(): string {
  const configured = String(process.env.SAP_AUTO_IMPORT_RESULTS_ROOT || '').trim();
  if (!configured) return sapAutoImportRootDir();
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

/**
 * The names this folder is known by, because they are not ours to choose.
 *
 * IT owns the share and names the folders: as of 2026-09-13 they are `ORIGINAL`, `SUCCEED` and
 * `FAILED`. `SUCCEED` is not a case variant of `Success` - no amount of case folding matches
 * them - so the accepted spellings are listed. Matching is case-insensitive within the list.
 *
 * The first entry is canonical: it is what gets created when nothing matching exists.
 */
const SUBDIR_ALIASES: Record<string, readonly string[]> = {
  Original: ['Original', 'ORIGINAL'],
  Success: ['Success', 'SUCCEED', 'SUCCEEDED', 'SUCCESS'],
  Failed: ['Failed', 'FAILED', 'FAIL'],
};

/**
 * Resolve a subfolder against what is actually on disk, by any of its accepted names.
 *
 * A miss is silent and expensive: the scan finds nothing and reports `filesScanned: 0`, which
 * reads exactly like a morning with no new files. That is how a moved path went unnoticed.
 *
 * Memoised per root+name, because the result folders are resolved once per imported file and on
 * a network share every readdir is a round trip.
 */
const subdirCache = new Map<string, string>();

function resolveSubdir(root: string, canonical: keyof typeof SUBDIR_ALIASES | string): string {
  const cacheKey = `${root} ${canonical}`;
  const cached = subdirCache.get(cacheKey);
  if (cached) return cached;

  const accepted = (SUBDIR_ALIASES[canonical] ?? [canonical]).map((n) => n.toLowerCase());
  let resolved = path.join(root, String(canonical));
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    // Earlier aliases win, so a folder holding both `Success` and `SUCCEED` resolves predictably.
    let best: { name: string; rank: number } | null = null;
    for (const entry of entries) {
      const rank = accepted.indexOf(entry.name.toLowerCase());
      if (rank === -1) continue;
      if (!best || rank < best.rank) best = { name: entry.name, rank };
    }
    if (best) resolved = path.join(root, best.name);
  } catch {
    /* root not present yet - the canonical spelling is the right answer to create */
  }
  subdirCache.set(cacheKey, resolved);
  return resolved;
}

/** Only for tests and for a root that changed under us. */
export function clearSapAutoImportPathCache(): void {
  subdirCache.clear();
}

/** Read-only input, on the source root. KLIP never writes here. */
export function sapAutoImportOriginalDir(): string {
  return resolveSubdir(sapAutoImportRootDir(), 'Original');
}

export function sapAutoImportSuccessDir(): string {
  return resolveSubdir(sapAutoImportResultsRootDir(), 'Success');
}

export function sapAutoImportFailedDir(): string {
  return resolveSubdir(sapAutoImportResultsRootDir(), 'Failed');
}

/**
 * Create the folders KLIP writes to - and only those.
 *
 * Original is deliberately never created. It belongs to IT, it is mounted read-only, and a
 * mkdir there fails; more to the point, a run that had to create its own input folder would be
 * pointing somewhere wrong and should say so rather than manufacture an empty one.
 *
 * A failure to create the result folders is logged, not thrown: the import itself can still run
 * and is the valuable part. Losing a result workbook is a smaller loss than losing the import.
 */
export function ensureSapAutoImportFolders(): {
  root: string;
  original: string;
  success: string;
  failed: string;
  originalExists: boolean;
} {
  const original = sapAutoImportOriginalDir();
  const success = sapAutoImportSuccessDir();
  const failed = sapAutoImportFailedDir();
  for (const dir of [success, failed]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      logger.error('Could not create SAP auto-import result folder', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    root: sapAutoImportRootDir(),
    original,
    success,
    failed,
    originalExists: fs.existsSync(original),
  };
}

export function isSapAutoImportExcelFile(fileName: string): boolean {
  const base = path.basename(fileName);
  if (base.startsWith('~$')) return false;
  return EXCEL_EXT.has(path.extname(base).toLowerCase());
}

/**
 * Which Excel files in Original are the daily export.
 *
 * Original is IT's folder and it holds more than the daily file. From 2026-11-05 it also holds an `ME2N ...` workbook (a different
 * SAP report: 17 columns of purchasing documents, nothing KLIP imports) and the `Part 1ZMMLOG_RPT ...` / `Part 2ZMMLOG_RPT ...`
 * halves the daily file is assembled from. The importer takes the newest file by modification time, and on 2026-11-09 and 2026-11-10
 * the newest file in the folder was the ME2N workbook, written a fraction of a second after the export: the run would have tried
 * to read a purchasing report as the logistics report.
 *
 * So the daily export is recognised by name: `ZMMLOG_RPT from <date> to <date>.xlsx` (the number of spaces after ZMMLOG_RPT has
 * varied: one name had two). SAP_AUTO_IMPORT_FILE_PATTERN overrides it with a regular expression (case-insensitive), for the day SAP
 * renames the report.
 */
export const SAP_AUTO_IMPORT_DEFAULT_FILE_PATTERN = '^ZMMLOG_RPT\\s+from\\s';

export function sapAutoImportDailyExportPattern(): RegExp {
  const configured = String(process.env.SAP_AUTO_IMPORT_FILE_PATTERN || '').trim();
  if (configured) {
    try {
      return new RegExp(configured, 'i');
    } catch (error) {
      logger.error('SAP_AUTO_IMPORT_FILE_PATTERN is not a valid regular expression - using the default', {
        configured,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return new RegExp(SAP_AUTO_IMPORT_DEFAULT_FILE_PATTERN, 'i');
}

/** An Excel file whose name says it is the daily logistics export (see above). */
export function isSapAutoImportDailyExport(fileName: string): boolean {
  if (!isSapAutoImportExcelFile(fileName)) return false;
  return sapAutoImportDailyExportPattern().test(path.basename(fileName));
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Jakarta calendar date as yyyy-MM-dd (UTC+7), matching other KLIP daily jobs. */
export function jakartaDateYmd(now = new Date()): string {
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return jakarta.toISOString().slice(0, 10);
}

export function sapAutoImportResultFileName(
  originalFileName: string,
  kind: 'success' | 'failed',
  now = new Date(),
): string {
  const stem = path.basename(originalFileName, path.extname(originalFileName)).replace(/[^\w.\-]+/g, '_');
  const safeStem = (stem || 'sap').slice(0, 120);
  return `${jakartaDateYmd(now)}__${safeStem}_${kind}.xlsx`;
}

/**
 * Resolve a failed-workbook download. Query may be a basename or a share-style path;
 * only the basename under Failed/ is used. Path traversal is rejected.
 */
export function resolveSafeFailedWorkbookPath(requestedFile: string): string | null {
  const raw = String(requestedFile || '').trim();
  if (!raw) return null;
  const base = path.basename(raw.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..' || base.includes('..')) return null;
  if (!/\.xlsx$/i.test(base)) return null;
  const failedDir = path.resolve(sapAutoImportFailedDir());
  const resolved = path.resolve(failedDir, base);
  const relative = path.relative(failedDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

export function sapAutoImportShareFailedPath(fileName: string): string {
  return `Klip/SAP Data/Failed/${path.basename(fileName)}`;
}

export function shouldSkipCompletedSapAutoImport(status: string | null | undefined): boolean {
  return String(status || '').toLowerCase() === 'completed';
}

/** The same case-insensitive folder lookup, for the other IT-owned import folders on the share (the Claim Data folder uses it). */
export function resolveAutoImportSubdir(root: string, canonical: string): string {
  return resolveSubdir(root, canonical);
}
