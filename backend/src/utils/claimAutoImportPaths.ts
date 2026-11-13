import path from 'path';
import logger from './logger';
import { getUploadRootDir } from './fileUpload';
import { isSapAutoImportExcelFile, resolveAutoImportSubdir } from './sapAutoImportPaths';

/**
 * Where the Claim Data auto-import looks, and which file in there it takes.
 *
 * Same arrangement as the SAP logistics auto-import: IT's folder on the Synology share is mounted read-only into the container
 * (docker-compose.backend.claim-share.yml, KLIP_CLAIM_IMPORT_MOUNT -> /mnt/claim-import), CLAIM_AUTO_IMPORT_ROOT points at the mounted path,
 * and the files SAP drops are in its `original` subfolder. KLIP only reads there.
 */
export function claimAutoImportRootDir(): string {
  const configured = String(process.env.CLAIM_AUTO_IMPORT_ROOT || '').trim();
  if (configured) {
    if (/^[\/]{2}/.test(configured) && process.platform !== 'win32') {
      logger.error('CLAIM_AUTO_IMPORT_ROOT is a UNC path but this process is not on Windows - use the mounted path instead', { configured });
    }
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(getUploadRootDir(), 'claim');
}

/** The folder SAP writes into (`original`, in whatever case IT spells it). */
export function claimAutoImportOriginalDir(): string {
  return resolveAutoImportSubdir(claimAutoImportRootDir(), 'original');
}

/** The OSCLAIM export. SAP names it `OSCLAIM_ALLREGION_...`; CLAIM_AUTO_IMPORT_FILE_PATTERN (a regular expression, case-insensitive) changes the rule if that name changes. */
export const CLAIM_AUTO_IMPORT_DEFAULT_FILE_PATTERN = '^OSCLAIM';

export function claimAutoImportFilePattern(): RegExp {
  const configured = String(process.env.CLAIM_AUTO_IMPORT_FILE_PATTERN || '').trim();
  if (configured) {
    try {
      return new RegExp(configured, 'i');
    } catch (error) {
      logger.error('CLAIM_AUTO_IMPORT_FILE_PATTERN is not a valid regular expression - using the default', {
        configured,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return new RegExp(CLAIM_AUTO_IMPORT_DEFAULT_FILE_PATTERN, 'i');
}

export function isClaimAutoImportFile(fileName: string): boolean {
  if (!isSapAutoImportExcelFile(fileName)) return false;
  return claimAutoImportFilePattern().test(path.basename(fileName));
}

/** The newest file by modification time (ties: the later name), or null. */
export function pickNewestClaimFile<T extends { fileName: string; mtimeMs: number }>(files: T[]): T | null {
  let best: T | null = null;
  for (const f of files) {
    if (!best || f.mtimeMs > best.mtimeMs || (f.mtimeMs === best.mtimeMs && f.fileName > best.fileName)) best = f;
  }
  return best;
}

/** The calendar date (YYYY-MM-DD, Asia/Jakarta) a file was written: that is the "data as of" of an auto-imported snapshot. */
export function jakartaDateOfMtime(mtimeMs: number): string {
  return new Date(mtimeMs + 7 * 3_600_000).toISOString().slice(0, 10);
}
