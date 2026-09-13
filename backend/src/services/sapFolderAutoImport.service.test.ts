import { describe, expect, it } from 'vitest';
import { partitionOriginalFilesByChecksum, pickLatestOriginalFile } from './sapFolderAutoImport.service';

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
