import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock('../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { buildUserActivityWhere, listUserActivityDailySummary } from './userActivityLog.service';
import { buildAiAgentActivityWhere, listAiKlipAgentActivityLogs } from './aiKlipAgentActivityLog.service';

/** The text must hold the Postgres placeholders ($1, $2, ...), never the index number itself: a template that loses its "$" runs but filters on nothing. */
const placeholders = (sql: string) => [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

describe('buildUserActivityWhere', () => {
  it('with no filter matches everything and has no values', () => {
    expect(buildUserActivityWhere({})).toEqual({ whereSql: '1=1', values: [], nextIndex: 1 });
  });

  it('numbers every filter as a placeholder and keeps values in step', () => {
    const { whereSql, values, nextIndex } = buildUserActivityWhere({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-17',
      userId: 'u-1',
      role: 'LOGISTICS',
      level: 'Staff',
      regionSite: 'BONTANG',
      search: 'rina',
    });
    expect(values).toEqual(['2026-11-01', '2026-11-17', 'u-1', 'LOGISTICS', 'Staff', 'BONTANG', '%rina%']);
    expect([...new Set(placeholders(whereSql))]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(nextIndex).toBe(8);
  });

  it('uses one placeholder for the three search columns', () => {
    const { whereSql, values } = buildUserActivityWhere({ search: ' Rina ' });
    expect(values).toEqual(['%Rina%']);
    expect(whereSql).toMatch(/u\.full_name ILIKE \$1 OR u\.username ILIKE \$1 OR u\.email ILIKE \$1/);
  });

  it('compares the level without case and filters Region/Site through user_region_sites', () => {
    const { whereSql } = buildUserActivityWhere({ level: 'dept head', regionSite: 'BATAM' });
    expect(whereSql).toContain('UPPER(TRIM(u.level)) = UPPER($1)');
    expect(whereSql).toContain('FROM user_region_sites urs WHERE urs.user_id = u.id AND urs.region_site = $2');
  });

  it('ignores empty or blank filters', () => {
    expect(buildUserActivityWhere({ role: '  ', level: '', regionSite: ' ', search: '' }).values).toEqual([]);
  });
});

describe('listUserActivityDailySummary', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('puts LIMIT and OFFSET after the filter values, and returns the totals of the whole filtered period', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: 41 }] }) // count
      .mockResolvedValueOnce({ rows: [{ users: 7, total_actions: 900, clicks: 700, changes: 55 }] }) // totals
      .mockResolvedValueOnce({ rows: [] }); // page rows
    const result = await listUserActivityDailySummary({ role: 'FINANCE', level: 'Staff', page: 3, limit: 20 });

    const [pageSql, pageValues] = queryMock.mock.calls[2] as [string, unknown[]];
    expect(pageValues).toEqual(['FINANCE', 'Staff', 20, 40]);
    expect(pageSql).toContain('LIMIT $3 OFFSET $4');
    expect(placeholders(pageSql)).toEqual([1, 2, 3, 4]);

    expect(result.summary).toEqual({ users: 7, total_actions: 900, clicks: 700, changes: 55, day_records: 41 });
    expect(result.pagination).toEqual({ page: 3, limit: 20, total: 41, totalPages: 3 });
  });

  it('joins users in the count as well, so a role / level / Region filter applies to it', async () => {
    queryMock.mockResolvedValue({ rows: [{ total: 0 }] });
    await listUserActivityDailySummary({ regionSite: 'BONTANG' });
    expect((queryMock.mock.calls[0][0] as string)).toContain('JOIN users u ON u.id = e.user_id');
  });
});

describe('buildAiAgentActivityWhere', () => {
  it('with no filter matches everything', () => {
    expect(buildAiAgentActivityWhere({})).toEqual({ whereSql: '1=1', values: [], nextIndex: 1 });
  });

  it('numbers every filter as a placeholder', () => {
    const { whereSql, values, nextIndex } = buildAiAgentActivityWhere({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-17',
      agentName: 'KLIP Agent',
      status: 'error',
      search: 'contract',
    });
    expect(values).toEqual(['2026-11-01', '2026-11-17', 'KLIP Agent', 'error', '%contract%']);
    expect([...new Set(placeholders(whereSql))]).toEqual([1, 2, 3, 4, 5]);
    expect(nextIndex).toBe(6);
  });

  it('accepts only success or error as a status', () => {
    expect(buildAiAgentActivityWhere({ status: 'weird' }).values).toEqual([]);
    expect(buildAiAgentActivityWhere({ status: 'success' }).values).toEqual(['success']);
  });
});

describe('listAiKlipAgentActivityLogs', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns the cards of the whole filtered period and pages after the filter values', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: 120, success: 100, errors: 20, agents: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await listAiKlipAgentActivityLogs({ status: 'error', page: 2, limit: 50 });

    const [pageSql, pageValues] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(pageValues).toEqual(['error', 50, 50]);
    expect(pageSql).toContain('LIMIT $2 OFFSET $3');
    expect(result.summary).toEqual({ total: 120, success: 100, errors: 20, agents: 3 });
    expect(result.pagination.totalPages).toBe(3);
  });
});
