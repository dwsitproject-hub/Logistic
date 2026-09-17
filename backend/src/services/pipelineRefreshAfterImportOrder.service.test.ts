import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries: Array<{ sql: string; params?: unknown[] }> = [];

vi.mock('../database/connection', () => ({
  getClient: async () => ({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })), release: vi.fn() }),
  query: async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    return { rowCount: 0, rows: [] };
  },
}));

import {
  markPipelineDailySummaryStale,
  PipelineDailySummaryService,
} from './pipelineDailySummary.service';

beforeEach(() => {
  queries.length = 0;
  vi.restoreAllMocks();
});

/**
 * The race this pins down: the trucking build joins contract_qty_move_snapshot and reads the other
 * derived snapshots. A SAP import refreshes those, and marking the pipeline stale used to kick the
 * rebuild at the same moment - so the rebuild could publish a generation computed from pre-import
 * quantities, and the page would serve it until the next rebuild, the following morning.
 */
describe('marking the pipeline snapshot stale', () => {
  it('marks stale without kicking the rebuild when the caller will run it itself', async () => {
    const spy = vi.spyOn(PipelineDailySummaryService, 'refreshAll').mockResolvedValue(undefined);
    await markPipelineDailySummaryStale(['trucking'], { schedule: false });
    await new Promise((r) => setImmediate(r));

    // Still marked stale - readers must know the snapshot pre-dates the import.
    expect(queries.some((q) => /SET is_stale = TRUE/.test(q.sql))).toBe(true);
    expect(queries.some((q) => q.params?.[0] && Array.isArray(q.params[0]))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  /*
   * Runs second on purpose. The scheduler's debounce is module state stamped when a refresh is
   * scheduled, so the no-schedule case has to go first, while that state is still clean -
   * otherwise it would pass because the debounce blocked the call, not because the option did.
   */
  it('kicks the rebuild by default', async () => {
    const spy = vi.spyOn(PipelineDailySummaryService, 'refreshAll').mockResolvedValue(undefined);
    await markPipelineDailySummaryStale(['trucking']);
    await new Promise((r) => setImmediate(r));

    expect(queries.some((q) => /SET is_stale = TRUE/.test(q.sql))).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});
