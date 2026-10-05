import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));

import {
  attachDhmPushState,
  classifyPush,
  MAX_AUTO_PUSH_ATTEMPTS,
  recordPushOutcome,
  retryDelayMs,
} from './pushState';

const ID = '3f2b8c1e-5a4d-4c7e-9b1a-0d6e2f8a7c11';
const MIN = 60_000;

describe('classifyPush', () => {
  it('reads the one shape every push function returns', () => {
    expect(classifyPush({ dhmStatus: 'updated', dhmCode: 'CMD-0006' })).toEqual({ state: 'synced' });
    expect(classifyPush({ dhmCode: 'CMD-0006' })).toEqual({ state: 'synced' });
    expect(classifyPush({ dhmError: 'DHM unavailable' })).toEqual({ state: 'failed', error: 'DHM unavailable' });
    expect(classifyPush({ dhmConflict: true, dhmStatus: 'duplicate', dhmCode: 'X' })).toEqual({ state: 'conflict', error: null });
  });

  it('a conflict stays a conflict even when the overwrite attempt also reported an error', () => {
    expect(classifyPush({ dhmConflict: true, dhmError: 'DHM overwrite failed' })).toEqual({
      state: 'conflict',
      error: 'DHM overwrite failed',
    });
  });

  it('nothing back (DHM switched off, or nothing to send) is not a failure', () => {
    expect(classifyPush({})).toEqual({ state: 'ignored' });
    expect(classifyPush(null)).toEqual({ state: 'ignored' });
    expect(classifyPush(undefined)).toEqual({ state: 'ignored' });
  });
});

describe('retryDelayMs', () => {
  it('backs off, then hands the row to a person after the last automatic attempt', () => {
    expect(retryDelayMs(1)).toBe(5 * MIN);
    expect(retryDelayMs(2)).toBe(15 * MIN);
    expect(retryDelayMs(3)).toBe(30 * MIN);
    expect(retryDelayMs(7)).toBe(8 * 60 * MIN);
    expect(retryDelayMs(MAX_AUTO_PUSH_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(MAX_AUTO_PUSH_ATTEMPTS + 5)).toBeNull();
  });

  it('never waits less than the step before it', () => {
    let last = 0;
    for (let n = 1; n < MAX_AUTO_PUSH_ATTEMPTS; n += 1) {
      const d = retryDelayMs(n) as number;
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe('recordPushOutcome', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });
  const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));

  it('a push that went through clears the row', async () => {
    await recordPushOutcome('port', ID, { dhmStatus: 'updated', dhmCode: 'PORT-0048' });
    expect(sqls()).toHaveLength(1);
    expect(sqls()[0]).toMatch(/^\s*DELETE FROM dhm_push_state/);
    expect(queryMock.mock.calls[0][1]).toEqual(['port', ID]);
  });

  it('a first failure is recorded with attempt 1 and the first backoff', async () => {
    await recordPushOutcome('plant', ID, { dhmError: 'Plant needs a DHM site. Sync Master Site first.' });
    const insert = queryMock.mock.calls.find((c) => /INSERT INTO dhm_push_state/.test(String(c[0]))) as [string, unknown[]];
    expect(insert[0]).toContain("'FAILED'");
    expect(insert[1]).toEqual(['plant', ID, 'Plant needs a DHM site. Sync Master Site first.', 1, 5 * MIN]);
  });

  it('a repeated failure counts up, and the last automatic attempt leaves no next attempt', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      /SELECT attempts/.test(sql) ? { rows: [{ attempts: MAX_AUTO_PUSH_ATTEMPTS - 1 }] } : { rows: [] },
    );
    await recordPushOutcome('vessel', ID, { dhmError: 'DHM unavailable' });
    const insert = queryMock.mock.calls.find((c) => /INSERT INTO dhm_push_state/.test(String(c[0]))) as [string, unknown[]];
    expect(insert[1]).toEqual(['vessel', ID, 'DHM unavailable', MAX_AUTO_PUSH_ATTEMPTS, null]);
  });

  it('a conflict is recorded without a next attempt: a person has to choose to overwrite', async () => {
    await recordPushOutcome('product', ID, { dhmConflict: true, dhmStatus: 'duplicate' });
    const insert = queryMock.mock.calls[0] as [string, unknown[]];
    expect(insert[0]).toContain("'CONFLICT'");
    expect(insert[0]).toContain('next_attempt_at = NULL');
  });

  it('writes nothing for an empty result or a row id that is not a uuid', async () => {
    await recordPushOutcome('site', ID, {});
    await recordPushOutcome('site', 'not-a-uuid', { dhmError: 'x' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('never breaks the save that triggered it', async () => {
    queryMock.mockRejectedValue(new Error('connection lost'));
    await expect(recordPushOutcome('site', ID, { dhmError: 'x' })).resolves.toBeUndefined();
  });
});

describe('attachDhmPushState', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('marks only the rows that have an undelivered push, and asks once', async () => {
    queryMock.mockResolvedValue({
      rows: [{ entity_id: ID, status: 'FAILED', error: 'DHM unavailable', attempts: 2, next_attempt_at: '2026-10-05T10:00:00Z' }],
    });
    const other = '11111111-1111-4111-8111-111111111111';
    const out = await attachDhmPushState('port', [
      { id: ID, port: 'PORT BONTANG' },
      { id: other, port: 'PORT KUMAI' },
      { id: 'vlp-PORT X', port: 'PORT X' }, // a name taken from shipments, not a master row
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(['port', [ID, other]]);
    expect(out[0]).toMatchObject({
      dhm_push_status: 'FAILED',
      dhm_push_error: 'DHM unavailable',
      dhm_push_attempts: 2,
      dhm_push_next_attempt_at: '2026-10-05T10:00:00Z',
    });
    expect(out[1]).not.toHaveProperty('dhm_push_status');
    expect(out[2]).not.toHaveProperty('dhm_push_status');
  });

  it('does not touch the database when no row has a uuid id, or when nothing is undelivered', async () => {
    expect(await attachDhmPushState('port', [{ id: 'vlp-A' }])).toEqual([{ id: 'vlp-A' }]);
    expect(queryMock).not.toHaveBeenCalled();
    queryMock.mockResolvedValue({ rows: [] });
    const rows = [{ id: ID }];
    expect(await attachDhmPushState('site', rows)).toBe(rows);
  });

  it('a failure to read the state leaves the list as it was', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    const rows = [{ id: ID }];
    expect(await attachDhmPushState('site', rows)).toBe(rows);
  });
});
