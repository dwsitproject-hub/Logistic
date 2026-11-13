import { describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { runClaimAutoImport, type ClaimAutoImportDeps } from './claimDataAutoImport.service';

const FILE = 'OSCLAIM_ALLREGION_MUTU SUSUT_JAN S.D OKT 2026.xls';
// 2026-11-12 06:30 WIB = 2026-11-11 23:30 UTC: the Jakarta calendar date is already the 12th.
const MTIME = Date.UTC(2026, 10, 11, 23, 30, 0);
const PARSED = { rows: [{}, {}], errors: [], warnings: [] } as never;
const IMPORTED = { uploadId: 'up-1', totalRows: 2, failedRows: 0 } as never;

function deps(over: Partial<ClaimAutoImportDeps> = {}) {
  const recorded: Array<{ outcome: string; file: string | null; hash: string | null; trigger: string }> = [];
  const d: ClaimAutoImportDeps = {
    originalDir: () => '/mnt/claim-import/original',
    dirExists: () => true,
    listFiles: () => [{ fileName: FILE, mtimeMs: MTIME }],
    hashFile: async () => 'hash-new',
    parseFile: () => ({ parsed: PARSED }),
    lastImportedHash: async () => 'hash-old',
    importOutstanding: vi.fn(async () => IMPORTED),
    recordRun: async ({ result, fileHash, trigger }) => {
      recorded.push({ outcome: result.outcome, file: result.fileName, hash: fileHash, trigger });
    },
    ...over,
  };
  return { d, recorded };
}

describe('runClaimAutoImport', () => {
  it('imports a new file as OUTSTANDING, dated the day the file was written (Jakarta), and records the run', async () => {
    const { d, recorded } = deps();
    const r = await runClaimAutoImport({ trigger: 'cron' }, d);
    expect(r).toMatchObject({ outcome: 'imported', fileName: FILE, uploadId: 'up-1', totalRows: 2 });
    expect(d.importOutstanding).toHaveBeenCalledWith({ fileName: FILE, dataAsOf: '2026-11-12', userId: null, parsed: PARSED });
    expect(recorded).toEqual([{ outcome: 'imported', file: FILE, hash: 'hash-new', trigger: 'cron' }]);
  });

  it('imports nothing when the newest file is the one already imported', async () => {
    const { d, recorded } = deps({ lastImportedHash: async () => 'hash-new' });
    const r = await runClaimAutoImport({ trigger: 'cron' }, d);
    expect(r.outcome).toBe('unchanged');
    expect(d.importOutstanding).not.toHaveBeenCalled();
    expect(recorded[0].outcome).toBe('unchanged');
  });

  it('takes only the newest file, never an older one', async () => {
    const { d } = deps({
      listFiles: () => [
        { fileName: 'OSCLAIM_old.xls', mtimeMs: MTIME - 86_400_000 },
        { fileName: FILE, mtimeMs: MTIME },
      ],
    });
    await runClaimAutoImport({ trigger: 'manual' }, d);
    expect(d.importOutstanding).toHaveBeenCalledWith(expect.objectContaining({ fileName: FILE }));
  });

  it('says so when the folder is missing or holds no claim file', async () => {
    const missing = deps({ dirExists: () => false });
    const m = await runClaimAutoImport({ trigger: 'cron' }, missing.d);
    expect(m.outcome).toBe('source_missing');
    expect(m.detail).toMatch(/CLAIM_AUTO_IMPORT_ROOT/);
    const none = deps({ listFiles: () => [] });
    const n = await runClaimAutoImport({ trigger: 'cron' }, none.d);
    expect(n.outcome).toBe('no_file');
    expect(n.detail).toMatch(/OSCLAIM/);
    expect(none.d.importOutstanding).not.toHaveBeenCalled();
  });

  it('fails WITHOUT touching the snapshot on an unreadable file or one with no rows', async () => {
    const unreadable = deps({ parseFile: () => ({ error: 'Missing columns' }) });
    const u = await runClaimAutoImport({ trigger: 'cron' }, unreadable.d);
    expect(u).toMatchObject({ outcome: 'failed', detail: 'Missing columns' });
    const emptyFile = deps({ parseFile: () => ({ parsed: { rows: [], errors: [], warnings: [] } as never }) });
    const e = await runClaimAutoImport({ trigger: 'cron' }, emptyFile.d);
    expect(e.outcome).toBe('failed');
    expect(e.detail).toMatch(/left as it is/);
    expect(unreadable.d.importOutstanding).not.toHaveBeenCalled();
    expect(emptyFile.d.importOutstanding).not.toHaveBeenCalled();
  });

  it('reports rows that could not be saved', async () => {
    const { d } = deps({ importOutstanding: vi.fn(async () => ({ uploadId: 'up-2', totalRows: 10, failedRows: 3 }) as never) });
    const r = await runClaimAutoImport({ trigger: 'cron' }, d);
    expect(r).toMatchObject({ outcome: 'imported', failedRows: 3 });
    expect(r.detail).toMatch(/3 row/);
  });

  it('turns an error into a recorded failure and never throws', async () => {
    const { d, recorded } = deps({ importOutstanding: vi.fn(async () => { throw new Error('connection reset'); }) });
    const r = await runClaimAutoImport({ trigger: 'cron' }, d);
    expect(r).toMatchObject({ outcome: 'failed', detail: 'connection reset' });
    expect(recorded[0].outcome).toBe('failed');
  });

  it('passes the administrator who pressed Sync', async () => {
    const { d } = deps();
    await runClaimAutoImport({ trigger: 'manual', startedBy: 'user-1' }, d);
    expect(d.importOutstanding).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('refuses a second run while one is going', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = deps({ hashFile: async () => { await gate; return 'hash-new'; } });
    const first = runClaimAutoImport({ trigger: 'cron' }, slow.d);
    const second = await runClaimAutoImport({ trigger: 'manual' }, deps().d);
    expect(second).toMatchObject({ outcome: 'failed', detail: 'An import is already running.' });
    release();
    await first;
  });
});
