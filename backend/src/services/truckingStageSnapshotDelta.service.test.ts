import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedQuery {
  sql: string;
  params?: unknown[];
}

const clientQueries: RecordedQuery[] = [];
const poolQueries: RecordedQuery[] = [];
const release = vi.fn();

/** Rows the mocked pool returns for the delta log lookup, per test. */
let pendingDeltaRows: Array<{ operation_id: string }> = [];

const fakeClient = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    clientQueries.push({ sql, params });
    if (/pg_try_advisory_lock\(/.test(sql)) return { rowCount: 1, rows: [{ locked: true }] };
    return { rowCount: 1, rows: [] };
  }),
  release,
};

vi.mock('../database/connection', () => ({
  getClient: async () => fakeClient,
  query: async (sql: string, params?: unknown[]) => {
    poolQueries.push({ sql, params });
    if (/FROM trucking_stage_snapshot_delta_log WHERE touched_at >=/.test(sql)) {
      return { rowCount: pendingDeltaRows.length, rows: pendingDeltaRows };
    }
    return { rowCount: 0, rows: [] };
  },
}));

import {
  PipelineDailySummaryService,
  refreshTruckingStageSnapshotForOperationIds,
} from './pipelineDailySummary.service';

function clientSqls(): string[] {
  return clientQueries.map((r) => r.sql);
}

beforeEach(() => {
  clientQueries.length = 0;
  poolQueries.length = 0;
  pendingDeltaRows = [];
  fakeClient.query.mockClear();
  release.mockClear();
});

/**
 * The targeted refresh exists because a WB upload's rows were invisible until the next full
 * rebuild - 227s on dev, up to 27min on SIT - while the page it feeds is the one the user reads
 * the remaining OS Qty from immediately afterwards.
 */
describe('trucking stage snapshot delta', () => {
  it('replaces only the named operations, inside one locked transaction', async () => {
    const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
    await refreshTruckingStageSnapshotForOperationIds(ids);

    const sqls = clientSqls();
    expect(sqls[0]).toBe('BEGIN');
    // Blocking form, not try_: a delta that races the publish swap is worthless, so it waits.
    expect(sqls[1]).toMatch(/pg_advisory_xact_lock\(/);
    expect(clientQueries[1].params).toEqual(['pipeline_daily_summary:trucking']);

    const del = sqls.findIndex((s) => /^DELETE FROM trucking_list_stage_snapshot WHERE operation_id/.test(s));
    const ins = sqls.findIndex((s) => /^\s*INSERT INTO trucking_list_stage_snapshot \(/.test(s));
    expect(del).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(del);
    expect(clientQueries[del].params).toEqual([ids]);

    // The rebuild is restricted to those operations - the whole point - and the restriction is
    // inside trucking_source, where it can actually prune work.
    const insertSql = sqls[ins];
    for (const id of ids) expect(insertSql).toContain(`'${id}'::uuid`);
    expect(insertSql).toMatch(/trucking_source AS \(\s*SELECT \* FROM \([\s\S]*\) ts_all\s*WHERE ts_all\.id IN \(/);

    // Never clears is_stale: a full rebuild is still owed.
    expect(sqls.some((s) => /is_stale\s*=\s*FALSE/i.test(s))).toBe(false);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('records what it touched so a rebuild can re-apply it, before committing', async () => {
    await refreshTruckingStageSnapshotForOperationIds(['33333333-3333-3333-3333-333333333333']);

    const sqls = clientSqls();
    const log = sqls.findIndex((s) => /INSERT INTO trucking_stage_snapshot_delta_log/.test(s));
    expect(log).toBeGreaterThan(-1);
    expect(sqls.indexOf('COMMIT')).toBeGreaterThan(log);
    expect(sqls[log]).toMatch(/ON CONFLICT \(operation_id\) DO UPDATE SET touched_at/);
  });

  it('does nothing, and opens no transaction, for an empty id list', async () => {
    const written = await refreshTruckingStageSnapshotForOperationIds([]);
    expect(written).toBe(0);
    expect(fakeClient.query).not.toHaveBeenCalled();
  });

  it('swallows its own failure so the upload that triggered it still succeeds', async () => {
    fakeClient.query.mockImplementationOnce(async () => {
      throw new Error('deadlock detected');
    });
    await expect(refreshTruckingStageSnapshotForOperationIds(['44444444-4444-4444-4444-444444444444']))
      .resolves.toBe(0);
    expect(clientSqls()).toContain('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });

  /**
   * The regression this guards: a rebuild reads its source, builds for minutes, then swaps
   * wholesale. Without a catch-up, an upload that landed mid-build is silently reverted to its
   * pre-upload quantities the moment the rebuild publishes - worse than never refreshing.
   */
  it('re-applies deltas the rebuild superseded, then prunes the older log entries', async () => {
    pendingDeltaRows = [{ operation_id: '55555555-5555-5555-5555-555555555555' }];
    await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();

    const lookup = poolQueries.find((q) =>
      /FROM trucking_stage_snapshot_delta_log WHERE touched_at >=/.test(q.sql),
    );
    expect(lookup).toBeDefined();
    // The cutoff is when the build STARTED reading, not when it published.
    const cutoff = (lookup?.params?.[0] as Date) ?? new Date(0);
    expect(cutoff).toBeInstanceOf(Date);

    // The superseded operation is rebuilt again, after the swap.
    const reapplied = clientSqls().filter((s) =>
      /^DELETE FROM trucking_list_stage_snapshot WHERE operation_id/.test(s),
    );
    expect(reapplied.length).toBe(1);

    const prune = poolQueries.find((q) =>
      /DELETE FROM trucking_stage_snapshot_delta_log WHERE touched_at </.test(q.sql),
    );
    expect(prune).toBeDefined();
    expect(prune?.params?.[0]).toBe(cutoff);
  });
});
