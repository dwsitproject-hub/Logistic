import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedQuery {
  sql: string;
  params?: unknown[];
}

const recorded: RecordedQuery[] = [];
const release = vi.fn();

/** pg_try_advisory_lock must report success, or every refresh short-circuits before building. */
function grant(sql: string): { rowCount: number; rows: unknown[] } {
  if (/pg_try_advisory_lock\(/.test(sql)) return { rowCount: 1, rows: [{ locked: true }] };
  return { rowCount: 1, rows: [] };
}

const fakeClient = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    recorded.push({ sql, params });
    return grant(sql);
  }),
  release,
};

vi.mock('../database/connection', () => ({
  getClient: async () => fakeClient,
  query: async () => ({ rowCount: 0, rows: [] }),
}));

import { PipelineDailySummaryService } from './pipelineDailySummary.service';

function sqls(): string[] {
  return recorded.map((r) => r.sql);
}

function indexOfMatch(pattern: RegExp): number {
  return sqls().findIndex((sql) => pattern.test(sql));
}

beforeEach(() => {
  recorded.length = 0;
  fakeClient.query.mockClear();
  release.mockClear();
});

/**
 * The refresh used to hold the advisory lock across the whole rebuild - minutes on SIT - which
 * kept ACCESS EXCLUSIVE on the published tables and kept one transaction (and therefore every
 * lock inside it) open for that entire window. These tests pin the shape that fixed it: heavy
 * build outside any transaction, and a locked transaction that only publishes.
 */
describe('pipeline daily summary refresh lock scope', () => {
  it('builds the trucking rebuild into staging tables before opening a transaction', async () => {
    await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();

    const beginAt = indexOfMatch(/^BEGIN$/);
    expect(beginAt).toBeGreaterThan(-1);

    const build = sqls().slice(0, beginAt);
    // Every heavy INSERT aims at a staging table, and runs before BEGIN.
    expect(build.some((s) => /INSERT INTO pipeline_stage_trucking_pipeline_daily_summary /.test(s))).toBe(true);
    expect(build.some((s) => /INSERT INTO pipeline_stage_trucking_list_stage_snapshot /.test(s))).toBe(true);
    expect(build.some((s) => /^CREATE TEMP TABLE pipeline_stage_trucking_list_stage_snapshot /.test(s))).toBe(true);

    // Nothing in the build phase writes a published table.
    expect(build.some((s) => /INSERT INTO trucking_pipeline_daily_summary \(/.test(s))).toBe(false);
    expect(build.some((s) => /INSERT INTO trucking_list_stage_snapshot \(/.test(s))).toBe(false);
  });

  it('holds the refresh advisory lock only for the publish transaction', async () => {
    await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();

    const all = sqls();
    const beginAt = all.findIndex((s) => /^BEGIN$/.test(s));
    const commitAt = all.findIndex((s) => /^COMMIT$/.test(s));
    expect(beginAt).toBeGreaterThan(-1);
    expect(commitAt).toBeGreaterThan(beginAt);

    const lockAt = all.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    expect(lockAt).toBe(beginAt + 1);
    expect(recorded[lockAt].params).toEqual(['pipeline_daily_summary:trucking']);

    // The locked window is exactly: lock, per-table DELETE + INSERT ... SELECT, refresh meta.
    const locked = all.slice(beginAt + 1, commitAt);
    expect(locked).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
      'DELETE FROM trucking_pipeline_daily_summary',
      'INSERT INTO trucking_pipeline_daily_summary SELECT * FROM pipeline_stage_trucking_pipeline_daily_summary',
      'DELETE FROM trucking_list_stage_snapshot',
      'INSERT INTO trucking_list_stage_snapshot SELECT * FROM pipeline_stage_trucking_list_stage_snapshot',
      expect.stringContaining('INSERT INTO pipeline_summary_refresh_meta'),
    ]);
  });

  it('never TRUNCATEs a published table, so readers are not blocked during a rebuild', async () => {
    await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();
    await PipelineDailySummaryService.refreshShipmentPipelineDailySummary();
    expect(sqls().some((s) => /\bTRUNCATE\b/.test(s))).toBe(false);
  });

  it('takes the session build lock without waiting and releases it before returning the client', async () => {
    await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();

    const all = sqls();
    const lockAt = all.findIndex((s) => /pg_try_advisory_lock\(/.test(s));
    const unlockAt = all.findIndex((s) => /pg_advisory_unlock\(/.test(s));
    expect(lockAt).toBe(0);
    expect(recorded[lockAt].params).toEqual(['pipeline_daily_summary:trucking:build']);
    expect(unlockAt).toBe(all.length - 1);
    expect(recorded[unlockAt].params).toEqual(['pipeline_daily_summary:trucking:build']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  /**
   * Waiting for a concurrent build parked pooled connections for minutes - seen live with two
   * page requests queued 365s and 308s behind a trucking stage build, which is what made the
   * Shipment and Trucking pages look dead. The holder is already producing the generation this
   * caller wanted, so the second caller must give the connection straight back.
   */
  it('skips instead of queueing when another build already holds the lock', async () => {
    fakeClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      if (/pg_try_advisory_lock\(/.test(sql)) return { rowCount: 1, rows: [{ locked: false }] };
      return { rowCount: 1, rows: [] };
    });

    const rows = await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();

    expect(rows).toBe(0);
    const all = sqls();
    expect(all.filter((x) => /pg_try_advisory_lock\(/.test(x))).toHaveLength(1);
    /** Nothing built, nothing published, and no blocking lock taken. */
    expect(all.some((x) => /CREATE TEMP TABLE/.test(x))).toBe(false);
    expect(all.some((x) => /^BEGIN$/.test(x))).toBe(false);
    expect(all.some((x) => /pg_advisory_lock\(/.test(x))).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('drops staging tables and releases the build lock when the build fails', async () => {
    fakeClient.query.mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      return grant(sql);
    });
    fakeClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      if (/INSERT INTO pipeline_stage_trucking_list_stage_snapshot /.test(sql)) {
        throw new Error('build blew up');
      }
      return grant(sql);
    });

    await expect(PipelineDailySummaryService.refreshTruckingPipelineDailySummary()).rejects.toThrow(
      'build blew up',
    );

    const all = sqls();
    expect(all.some((s) => /^COMMIT$/.test(s))).toBe(false);
    expect(
      all.filter((s) => /^DROP TABLE IF EXISTS pg_temp\.pipeline_stage_trucking_/.test(s)).length,
    ).toBeGreaterThanOrEqual(4);
    expect(all.some((s) => /pg_advisory_unlock\(/.test(s))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);

    fakeClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      recorded.push({ sql, params });
      return { rowCount: 1, rows: [] };
    });
  });
});
