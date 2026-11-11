import { describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { runPoCreatorsAutoLoad, type PoCreatorsDeps } from './poCreators.service';

const READ = { rows: [{ po_number: '1001', created_by: 'U1' }, { po_number: '1002', created_by: 'U2' }], creators: 2, conflicts: 0, skipped: 0 };

function deps(over: Partial<PoCreatorsDeps> = {}) {
  const recorded: Array<{ outcome: string; file: string | null; hash: string | null }> = [];
  const d: PoCreatorsDeps = {
    originalDir: () => '/share/Original',
    dirExists: () => true,
    listFiles: () => [{ fileName: 'ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx', mtimeMs: 1000 }],
    hashFile: async () => 'hash-new',
    readWorkbook: () => READ,
    lastLoadedHash: async () => 'hash-old',
    upsert: vi.fn(async (rows) => rows.length),
    recordRun: async ({ result, fileHash }) => {
      recorded.push({ outcome: result.outcome, file: result.fileName, hash: fileHash });
    },
    ...over,
  };
  return { d, recorded };
}

describe('runPoCreatorsAutoLoad', () => {
  it('loads a file that is new, and records the run with its hash', async () => {
    const { d, recorded } = deps();
    const r = await runPoCreatorsAutoLoad({ trigger: 'cron' }, d);
    expect(r).toMatchObject({ outcome: 'loaded', rows: 2, creators: 2, fileName: 'ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx' });
    expect(d.upsert).toHaveBeenCalledWith(READ.rows, 'ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx', null);
    expect(recorded).toEqual([{ outcome: 'loaded', file: 'ME2N from 01 Jan 2026 to 11 Nov 2026.xlsx', hash: 'hash-new' }]);
  });
  it('writes nothing when the newest file is the one already loaded', async () => {
    const { d, recorded } = deps({ lastLoadedHash: async () => 'hash-new' });
    const r = await runPoCreatorsAutoLoad({ trigger: 'cron' }, d);
    expect(r.outcome).toBe('unchanged');
    expect(d.upsert).not.toHaveBeenCalled();
    expect(recorded[0].outcome).toBe('unchanged');
  });
  it('says so when the folder is missing or holds no ME2N file', async () => {
    const missing = deps({ dirExists: () => false });
    expect((await runPoCreatorsAutoLoad({ trigger: 'cron' }, missing.d)).outcome).toBe('source_missing');
    const none = deps({ listFiles: () => [] });
    const r = await runPoCreatorsAutoLoad({ trigger: 'cron' }, none.d);
    expect(r.outcome).toBe('no_file');
    expect(r.detail).toMatch(/ME2N from/);
    expect(none.d.upsert).not.toHaveBeenCalled();
  });
  it('fails, without writing, on a file that is not the report or has no creators', async () => {
    const notReport = deps({ readWorkbook: () => null });
    expect((await runPoCreatorsAutoLoad({ trigger: 'cron' }, notReport.d)).outcome).toBe('failed');
    const emptyReport = deps({ readWorkbook: () => ({ rows: [], creators: 0, conflicts: 0, skipped: 3 }) });
    expect((await runPoCreatorsAutoLoad({ trigger: 'manual' }, emptyReport.d)).outcome).toBe('failed');
    expect(notReport.d.upsert).not.toHaveBeenCalled();
    expect(emptyReport.d.upsert).not.toHaveBeenCalled();
  });
  it('turns an error into a recorded failure and never throws', async () => {
    const { d, recorded } = deps({ upsert: vi.fn(async () => { throw new Error('connection reset'); }) });
    const r = await runPoCreatorsAutoLoad({ trigger: 'cron' }, d);
    expect(r).toMatchObject({ outcome: 'failed', detail: 'connection reset' });
    expect(recorded[0].outcome).toBe('failed');
  });
  it('passes the administrator who pressed Check now', async () => {
    const { d } = deps();
    await runPoCreatorsAutoLoad({ trigger: 'manual', startedBy: 'user-1' }, d);
    expect(d.upsert).toHaveBeenCalledWith(READ.rows, expect.any(String), 'user-1');
  });
});
