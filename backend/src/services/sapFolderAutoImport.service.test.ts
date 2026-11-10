import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifySapAutoImportRun,
  listOriginalExcelFiles,
  partitionOriginalFilesByChecksum,
  pickLatestOriginalFile,
  type SapFolderAutoImportRunResult,
} from './sapFolderAutoImport.service';
import { SAP_IMPORT_STALE_AFTER_MINUTES, SQL_ACTIVE_SAP_IMPORT, SQL_SAP_IMPORT_IN_FLIGHT_EXISTS } from '../utils/sapImportInFlightSql';

describe('partitionOriginalFilesByChecksum', () => {
  it('skips files whose SHA-256 was already completed and keeps new or changed content', () => {
    const files = [
      { fileName: 'a.xlsx', sha256: 'aaa' },
      { fileName: 'b.xlsx', sha256: 'bbb' },
      { fileName: 'a-copy.xlsx', sha256: 'aaa' },
    ];
    const { toProcess, skipped } = partitionOriginalFilesByChecksum(files, new Set(['aaa']));
    expect(skipped.map((f) => f.fileName)).toEqual(['a.xlsx', 'a-copy.xlsx']);
    expect(toProcess).toEqual([{ fileName: 'b.xlsx', sha256: 'bbb' }]);
  });
});

/**
 * Original is an archive - nobody empties it - so importing every file would replay a month of
 * old SAP exports over the current state, in name order. Only the newest export describes today.
 */
describe('pickLatestOriginalFile', () => {
  it('takes the newest file by modification time', () => {
    const files = [
      { fileName: 'SAP 01.xlsx', mtimeMs: 1_000 },
      { fileName: 'SAP 03.xlsx', mtimeMs: 3_000 },
      { fileName: 'SAP 02.xlsx', mtimeMs: 2_000 },
    ];
    expect(pickLatestOriginalFile(files).map((f) => f.fileName)).toEqual(['SAP 03.xlsx']);
  });

  it('breaks a timestamp tie by name, so a bulk copy still chooses deterministically', () => {
    const files = [
      { fileName: 'SAP 2026-09-02.xlsx', mtimeMs: 5_000 },
      { fileName: 'SAP 2026-09-10.xlsx', mtimeMs: 5_000 },
    ];
    expect(pickLatestOriginalFile(files).map((f) => f.fileName)).toEqual(['SAP 2026-09-10.xlsx']);
  });

  it('passes through zero or one file untouched', () => {
    expect(pickLatestOriginalFile([])).toEqual([]);
    const one = [{ fileName: 'only.xlsx', mtimeMs: 1 }];
    expect(pickLatestOriginalFile(one)).toEqual(one);
  });

  it('does not fall back to an older file - a newest file already imported means nothing to do', () => {
    const files = [
      { fileName: 'old.xlsx', mtimeMs: 1_000, sha256: 'old' },
      { fileName: 'new.xlsx', mtimeMs: 9_000, sha256: 'new' },
    ];
    const chosen = pickLatestOriginalFile(files);
    const { toProcess } = partitionOriginalFilesByChecksum(chosen, new Set(['new']));
    // Nothing to process, and crucially `old.xlsx` is not resurrected to fill the gap - that
    // would re-apply a superseded SAP state on top of the current one.
    expect(toProcess).toEqual([]);
  });
});

/**
 * The folder of 2026-11-10: the daily export, the ME2N workbook written a moment later, and the two halves. Only the first is imported.
 */
describe('listOriginalExcelFiles', () => {
  it('separates the daily export from the ME2N workbooks and the Part 1 / Part 2 halves', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-sap-list-'));
    const names = [
      'ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx',
      'ME2N from 01 Jan 2026 to 10 Nov 2026.xlsx',
      'Part 1ZMMLOG_RPT from 260101 to 260630.xlsx',
      'Part 2ZMMLOG_RPT from 260701 to 261110.xlsx',
      'Part 2ME2N from 260701 to 261110.xlsx',
      '~$ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx',
      'notes.txt',
    ];
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
    fs.mkdirSync(path.join(dir, 'archive'));
    const listing = listOriginalExcelFiles(dir);
    expect(listing.daily).toEqual(['ZMMLOG_RPT from 01 Jan 2026 to 10 Nov 2026.xlsx']);
    expect(listing.other.sort()).toEqual(
      [
        'ME2N from 01 Jan 2026 to 10 Nov 2026.xlsx',
        'Part 1ZMMLOG_RPT from 260101 to 260630.xlsx',
        'Part 2ME2N from 260701 to 261110.xlsx',
        'Part 2ZMMLOG_RPT from 260701 to 261110.xlsx',
      ].sort(),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a missing folder is neither', () => {
    expect(listOriginalExcelFiles(path.join(os.tmpdir(), 'klip-no-such-folder-xyz'))).toEqual({ daily: [], other: [] });
  });
});

/**
 * A fresh file in the share that was not pulled looked the same from the outside whatever the reason. Each reason gets its own
 * outcome now, so the Sync button and the status line can say which one it was.
 */
describe('classifySapAutoImportRun', () => {
  const base: SapFolderAutoImportRunResult = {
    ran: true,
    filesScanned: 12,
    filesProcessed: 0,
    filesSkippedChecksum: 0,
    files: [],
    emailSent: false,
  };

  it('names an import that was refused because another one is "running"', () => {
    expect(classifySapAutoImportRun({ ...base, ran: false, skipReason: 'in_flight' }, {}).outcome).toBe('skipped_in_flight');
    expect(classifySapAutoImportRun({ ...base, ran: false, skipReason: 'already_running' }, {}).outcome).toBe('already_running');
  });

  it('tells a missing folder from an empty one', () => {
    expect(classifySapAutoImportRun({ ...base, filesScanned: 0 }, { sourceMissing: true }).outcome).toBe('source_missing');
    const empty = classifySapAutoImportRun({ ...base, filesScanned: 0 }, { sourceMissing: false });
    expect(empty.outcome).toBe('no_new_file');
    expect(empty.detail).toMatch(/no Excel files/i);
  });

  it('says so when the folder holds Excel files and none is the daily export - not "no new file"', () => {
    const r = classifySapAutoImportRun({ ...base, filesScanned: 0 }, { otherExcelFiles: 3 });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toMatch(/3 Excel file/);
    expect(r.detail).toMatch(/none is named like the daily export/);
  });

  it('says the newest file was already imported when its checksum is registered', () => {
    const r = classifySapAutoImportRun(
      { ...base, filesSkippedChecksum: 1, files: [{ fileName: 'x.xlsx', sha256: 'a', status: 'skipped' }] },
      { newestFile: 'ZMMLOG_RPT to 08 Oct 2026.xlsx' },
    );
    expect(r.outcome).toBe('no_new_file');
    expect(r.detail).toContain('ZMMLOG_RPT to 08 Oct 2026.xlsx');
    expect(r.detail).toMatch(/already imported/i);
  });

  it('reports an import, and a failed one with its message', () => {
    const done = classifySapAutoImportRun(
      { ...base, filesProcessed: 1, files: [{ fileName: 'new.xlsx', sha256: 'n', status: 'completed' }] },
      {},
    );
    expect(done).toEqual({ outcome: 'imported', detail: 'Imported new.xlsx.' });
    const failed = classifySapAutoImportRun(
      { ...base, files: [{ fileName: 'bad.xlsx', sha256: 'b', status: 'failed', errorMessage: 'sheet missing' }] },
      {},
    );
    expect(failed.outcome).toBe('failed');
    expect(failed.detail).toContain('sheet missing');
  });
});

/**
 * A row a restart left in 'processing' used to block the daily import for good, and only opening the SAP Import History page
 * ever cleared it. Every in-flight check now ignores a row older than the limit.
 */
describe('in-flight SQL', () => {
  it('ignores an import that has been "running" past the stale limit, in every check that uses it', () => {
    expect(SAP_IMPORT_STALE_AFTER_MINUTES).toBeGreaterThanOrEqual(60);
    for (const sql of [SQL_ACTIVE_SAP_IMPORT, SQL_SAP_IMPORT_IN_FLIGHT_EXISTS]) {
      expect(sql).toContain(`INTERVAL '${SAP_IMPORT_STALE_AFTER_MINUTES} minutes'`);
      expect(sql).toMatch(/status IN \('processing', 'pending'\)/);
    }
  });
});
