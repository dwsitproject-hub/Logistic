import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getUploadRootDir } from './fileUpload';

const EXCEL_EXT = new Set(['.xlsx', '.xlsm', '.xlsb', '.xls']);

export function sapAutoImportRootDir(): string {
  const configured = String(process.env.SAP_AUTO_IMPORT_ROOT || '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(getUploadRootDir(), 'SAP Data');
}

export function sapAutoImportOriginalDir(): string {
  return path.join(sapAutoImportRootDir(), 'Original');
}

export function sapAutoImportSuccessDir(): string {
  return path.join(sapAutoImportRootDir(), 'Success');
}

export function sapAutoImportFailedDir(): string {
  return path.join(sapAutoImportRootDir(), 'Failed');
}

export function ensureSapAutoImportFolders(): {
  root: string;
  original: string;
  success: string;
  failed: string;
} {
  const original = sapAutoImportOriginalDir();
  const success = sapAutoImportSuccessDir();
  const failed = sapAutoImportFailedDir();
  for (const dir of [original, success, failed]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { root: sapAutoImportRootDir(), original, success, failed };
}

export function isSapAutoImportExcelFile(fileName: string): boolean {
  const base = path.basename(fileName);
  if (base.startsWith('~$')) return false;
  return EXCEL_EXT.has(path.extname(base).toLowerCase());
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
