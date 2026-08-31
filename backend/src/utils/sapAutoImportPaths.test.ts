import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureSapAutoImportFolders,
  isSapAutoImportExcelFile,
  jakartaDateYmd,
  resolveSafeFailedWorkbookPath,
  sapAutoImportResultFileName,
  sapAutoImportShareFailedPath,
  shouldSkipCompletedSapAutoImport,
} from './sapAutoImportPaths';

const originalRoot = process.env.SAP_AUTO_IMPORT_ROOT;

describe('sapAutoImportPaths', () => {
  afterEach(() => {
    if (originalRoot === undefined) delete process.env.SAP_AUTO_IMPORT_ROOT;
    else process.env.SAP_AUTO_IMPORT_ROOT = originalRoot;
  });

  it('ignores Excel lock files and non-Excel names', () => {
    expect(isSapAutoImportExcelFile('report.xlsx')).toBe(true);
    expect(isSapAutoImportExcelFile('report.xlsm')).toBe(true);
    expect(isSapAutoImportExcelFile('~$report.xlsx')).toBe(false);
    expect(isSapAutoImportExcelFile('notes.txt')).toBe(false);
  });

  it('skips only completed checksums so failed files can be retried', () => {
    expect(shouldSkipCompletedSapAutoImport('completed')).toBe(true);
    expect(shouldSkipCompletedSapAutoImport('COMPLETED')).toBe(true);
    expect(shouldSkipCompletedSapAutoImport('failed')).toBe(false);
    expect(shouldSkipCompletedSapAutoImport('skipped')).toBe(false);
    expect(shouldSkipCompletedSapAutoImport(null)).toBe(false);
  });

  it('names Success/Failed workbooks with Jakarta date and original stem', () => {
    const now = new Date('2026-08-26T17:00:00.000Z'); // 2026-08-27 00:00 WIB
    expect(sapAutoImportResultFileName('SAP Data v3.xlsx', 'success', now)).toBe(
      '2026-08-27__SAP_Data_v3_success.xlsx',
    );
    expect(sapAutoImportResultFileName('SAP Data v3.xlsx', 'failed', now)).toBe(
      '2026-08-27__SAP_Data_v3_failed.xlsx',
    );
    expect(jakartaDateYmd(now)).toBe('2026-08-27');
  });

  it('sanitizes to a basename under Failed/ and rejects non-xlsx', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-auto-'));
    process.env.SAP_AUTO_IMPORT_ROOT = tmp;
    ensureSapAutoImportFolders();
    const failedDir = path.join(tmp, 'Failed');

    expect(resolveSafeFailedWorkbookPath('../secret.xlsx')).toBe(path.join(failedDir, 'secret.xlsx'));
    expect(resolveSafeFailedWorkbookPath('../../../etc/passwd')).toBeNull();
    expect(resolveSafeFailedWorkbookPath('not-excel.csv')).toBeNull();
    const ok = resolveSafeFailedWorkbookPath('Klip/SAP Data/Failed/2026-08-27__stem_failed.xlsx');
    expect(ok).toBe(path.join(failedDir, '2026-08-27__stem_failed.xlsx'));
    expect(path.relative(failedDir, ok!).startsWith('..')).toBe(false);
    expect(sapAutoImportShareFailedPath('2026-08-27__stem_failed.xlsx')).toBe(
      'Klip/SAP Data/Failed/2026-08-27__stem_failed.xlsx',
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
