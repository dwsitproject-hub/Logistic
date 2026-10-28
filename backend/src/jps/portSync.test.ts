import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));

import { jpsPortSyncProblems } from './portSync';

const list = (rows: unknown) => JSON.stringify(rows);

describe('a port cannot be switched on unless DHM knows it', () => {
  const env = { ...process.env };
  beforeEach(() => {
    queryMock.mockReset();
    delete process.env.JPS_PORTS;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('a port with a DHM code passes', async () => {
    queryMock.mockResolvedValue({ rows: [{ code: 'PORT-0010', deleted: false }] });
    expect(await jpsPortSyncProblems(list([{ port: 'PORT DUMAI', enabled: true }]))).toEqual([]);
  });

  it('a port that is no Master Port is refused, and says to add it first', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const p = await jpsPortSyncProblems(list([{ port: 'PORT NOWHERE', enabled: true }]));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('There is no Master Port "PORT NOWHERE"');
  });

  it('a Master Port without a DHM code, or deleted in DHM, is not synced', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ code: null, deleted: false }] });
    expect((await jpsPortSyncProblems(list([{ port: 'PORT A', enabled: true }])))[0]).toContain('not synced with DHM');
    queryMock.mockResolvedValueOnce({ rows: [{ code: 'PORT-9', deleted: true }] });
    expect((await jpsPortSyncProblems(list([{ port: 'PORT B', enabled: true }])))[0]).toContain('not synced with DHM');
  });

  it('a port that is off is not checked', async () => {
    expect(await jpsPortSyncProblems(list([{ port: 'PORT A', enabled: false }]))).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('a port already switched on is not checked again, so the list can be edited while its port is being fixed; a newly switched on one is', async () => {
    process.env.JPS_PORTS = list([{ port: 'PORT BONTANG', enabled: true }]);
    queryMock.mockResolvedValue({ rows: [{ code: null, deleted: false }] });
    expect(await jpsPortSyncProblems(list([{ port: 'PORT BONTANG', enabled: true }, { port: 'PORT KUMAI', enabled: false }]))).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
    expect(await jpsPortSyncProblems(list([{ port: 'PORT BONTANG', enabled: true }, { port: 'PORT DUMAI', enabled: true }]))).toHaveLength(1);
  });

  it('an unreadable list is left to the validation that already explains it', async () => {
    expect(await jpsPortSyncProblems('garbage')).toEqual([]);
  });
});
