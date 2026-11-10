import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSapAutoImportPathCache,
  ensureSapAutoImportFolders,
  isSapAutoImportDailyExport,
  isSapAutoImportExcelFile,
  jakartaDateYmd,
  resolveSafeFailedWorkbookPath,
  sapAutoImportResultFileName,
  sapAutoImportFailedDir,
  sapAutoImportOriginalDir,
  sapAutoImportShareFailedPath,
  sapAutoImportSuccessDir,
  shouldSkipCompletedSapAutoImport,
} from './sapAutoImportPaths';

const originalRoot = process.env.SAP_AUTO_IMPORT_ROOT;

/**
 * The folder IT moved to on 2026-11-04 (`import-data/logistics-report/original`) holds more than the daily export. These are the names
 * found there on 2026-11-10 (listing taken from the share), and the importer must take only the first kind.
 */
describe('isSapAutoImportDailyExport: only the daily ZMMLOG_RPT export is imported', () => {
  afterEach(() => {
    delete process.env.SAP_AUTO_IMPORT_FILE_PATTERN;
  });

  it('accepts the daily export under both spellings IT has used (one space or two after ZMMLOG_RPT)', () => {
    expect(isSapAutoImportDailyExport('ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx')).toBe(true);
    expect(isSapAutoImportDailyExport('ZMMLOG_RPT  from 01 Jan 2026 to 04 Nov 2026.xlsx')).toBe(true);
    expect(isSapAutoImportDailyExport('zmmlog_rpt from 01 Jan 2026 to 10 Nov 2026.XLSX')).toBe(true);
  });

  it('refuses the ME2N workbook, which was the NEWEST file on 2026-11-09 and 2026-11-10 (it is written after the export)', () => {
    expect(isSapAutoImportDailyExport('ME2N from 01 Jan 2026 to 10 Nov 2026.xlsx')).toBe(false);
    expect(isSapAutoImportDailyExport('Part 1ME2N from 260101 to 260630.xlsx')).toBe(false);
    expect(isSapAutoImportDailyExport('Part 2ME2N from 260701 to 261110.xlsx')).toBe(false);
  });

  it('refuses the two halves the daily file is built from', () => {
    expect(isSapAutoImportDailyExport('Part 1ZMMLOG_RPT from 260101 to 260630.xlsx')).toBe(false);
    expect(isSapAutoImportDailyExport('Part 2ZMMLOG_RPT from 260701 to 261110.xlsx')).toBe(false);
  });

  it('refuses Excel lock files, other extensions and other names', () => {
    expect(isSapAutoImportDailyExport('~$ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx')).toBe(false);
    expect(isSapAutoImportDailyExport('ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.csv')).toBe(false);
    expect(isSapAutoImportDailyExport('Tarikan ZMMLOG_RPT (Phase 3).XLSX')).toBe(false);
    expect(isSapAutoImportDailyExport('sample.xlsx')).toBe(false);
  });

  it('SAP_AUTO_IMPORT_FILE_PATTERN replaces the rule, and a broken expression falls back to the default', () => {
    process.env.SAP_AUTO_IMPORT_FILE_PATTERN = '^LOGISTICS_';
    expect(isSapAutoImportDailyExport('LOGISTICS_2026-11-10.xlsx')).toBe(true);
    expect(isSapAutoImportDailyExport('ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx')).toBe(false);
    process.env.SAP_AUTO_IMPORT_FILE_PATTERN = '([unclosed';
    expect(isSapAutoImportDailyExport('ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx')).toBe(true);
  });
});

describe('sapAutoImportPaths', () => {
  afterEach(() => {
    if (originalRoot === undefined) delete process.env.SAP_AUTO_IMPORT_ROOT;
    else process.env.SAP_AUTO_IMPORT_ROOT = originalRoot;
    delete process.env.SAP_AUTO_IMPORT_RESULTS_ROOT;
    clearSapAutoImportPathCache();
  });

  /**
   * IT owns this folder and renames it: on 2026-09-13 it moved to `.../LOGISTICS REPORT/ORIGINAL`,
   * in capitals. On Linux a hardcoded `Original` then matches nothing and the scan reports zero
   * new files - indistinguishable from "nothing to import", which is how a broken path goes
   * unnoticed for days.
   */
  it('finds the subfolders whatever case they are stored in', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-case-'));
    fs.mkdirSync(path.join(tmp, 'ORIGINAL'));
    fs.mkdirSync(path.join(tmp, 'success'));
    process.env.SAP_AUTO_IMPORT_ROOT = tmp;
    clearSapAutoImportPathCache();

    expect(sapAutoImportOriginalDir()).toBe(path.join(tmp, 'ORIGINAL'));
    expect(sapAutoImportSuccessDir()).toBe(path.join(tmp, 'success'));
    // Absent: keep the canonical spelling, which is what ensureSapAutoImportFolders creates.
    expect(sapAutoImportFailedDir()).toBe(path.join(tmp, 'Failed'));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * `SUCCEED` is what IT actually called it on the share. It is not a case variant of `Success` -
   * no amount of case folding matches them - so it has to be an accepted alias, or the code would
   * try to create `Success` beside it on a read-only mount and fail.
   */
  it('accepts the folder names IT actually uses, including SUCCEED', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-alias-'));
    for (const d of ['ORIGINAL', 'SUCCEED', 'FAILED']) fs.mkdirSync(path.join(tmp, d));
    process.env.SAP_AUTO_IMPORT_ROOT = tmp;
    clearSapAutoImportPathCache();

    expect(sapAutoImportOriginalDir()).toBe(path.join(tmp, 'ORIGINAL'));
    expect(sapAutoImportSuccessDir()).toBe(path.join(tmp, 'SUCCEED'));
    expect(sapAutoImportFailedDir()).toBe(path.join(tmp, 'FAILED'));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * The source share is read-only and shared between SIT and production, so results must be able
   * to live somewhere else entirely.
   */
  it('writes results to their own root while reading from the source root', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-src-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-out-'));
    fs.mkdirSync(path.join(src, 'ORIGINAL'));
    process.env.SAP_AUTO_IMPORT_ROOT = src;
    process.env.SAP_AUTO_IMPORT_RESULTS_ROOT = out;
    clearSapAutoImportPathCache();

    expect(sapAutoImportOriginalDir()).toBe(path.join(src, 'ORIGINAL'));
    expect(sapAutoImportSuccessDir()).toBe(path.join(out, 'Success'));
    expect(sapAutoImportFailedDir()).toBe(path.join(out, 'Failed'));

    const folders = ensureSapAutoImportFolders();
    expect(folders.originalExists).toBe(true);
    // Nothing was created in the source root - it belongs to IT and is mounted read-only.
    expect(fs.readdirSync(src).sort()).toEqual(['ORIGINAL']);
    expect(fs.readdirSync(out).sort()).toEqual(['Failed', 'Success']);

    delete process.env.SAP_AUTO_IMPORT_RESULTS_ROOT;
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('reports a missing source folder rather than inventing one', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-missing-'));
    process.env.SAP_AUTO_IMPORT_ROOT = tmp;
    clearSapAutoImportPathCache();

    const folders = ensureSapAutoImportFolders();
    expect(folders.originalExists).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'Original'))).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does not create a second folder when one already exists under an accepted name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-case2-'));
    for (const d of ['ORIGINAL', 'SUCCEED', 'FAILED']) fs.mkdirSync(path.join(tmp, d));
    process.env.SAP_AUTO_IMPORT_ROOT = tmp;
    clearSapAutoImportPathCache();

    ensureSapAutoImportFolders();
    expect(fs.readdirSync(tmp).sort()).toEqual(['FAILED', 'ORIGINAL', 'SUCCEED']);

    fs.rmSync(tmp, { recursive: true, force: true });
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
