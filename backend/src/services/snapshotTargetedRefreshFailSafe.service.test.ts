import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: async () => ({
    query: (...args: unknown[]) => queryMock(...args),
    release: () => undefined,
  }),
}));

import { ContractQtyMoveSnapshotService } from './contractQtyMoveSnapshot.service';
import { ContractPerformanceSnapshotService } from './contractPerformanceSnapshot.service';

beforeEach(() => {
  queryMock.mockReset();
});

const staleWrites = () =>
  queryMock.mock.calls
    .map((c) => String(c[0] ?? ''))
    .filter((sql) => /UPDATE\s+\w*snapshot_meta[\s\S]*is_stale\s*=\s*TRUE/i.test(sql));

/**
 * A targeted refresh runs after a KLIP write - a shipment edit, a trucking realization, a daily
 * WB upload. When it fails the snapshot keeps the pre-edit values, and every read goes on serving
 * them: the only trace used to be a log line. The live fallback that once covered this was
 * removed earlier for being 840x slower, so the snapshot has to be marked stale instead - a slow
 * page is recoverable, a silently wrong outstanding qty is not.
 */
describe('targeted snapshot refresh fails safely', () => {
  it('qty_move marks the snapshot stale and still rethrows', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/UPDATE/i.test(sql) && /is_stale/i.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error('upsert exploded');
    });

    await expect(
      ContractQtyMoveSnapshotService.refreshForContracts(['C-1', 'C-2']),
    ).rejects.toThrow('upsert exploded');
    expect(staleWrites()).toHaveLength(1);
  });

  it('contract performance marks its snapshot stale and still rethrows', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(BEGIN|ROLLBACK|COMMIT)/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/UPDATE/i.test(sql) && /is_stale/i.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error('delete exploded');
    });

    await expect(
      ContractPerformanceSnapshotService.refreshForContracts(['C-1']),
    ).rejects.toThrow('delete exploded');
    expect(staleWrites()).toHaveLength(1);
  });

  it('does not touch the stale flag when the refresh succeeds', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
    await ContractQtyMoveSnapshotService.refreshForContracts(['C-1']);
    expect(staleWrites()).toHaveLength(0);
  });

  it('an empty id list is a no-op - no query, no stale flag', async () => {
    await ContractQtyMoveSnapshotService.refreshForContracts([]);
    await ContractPerformanceSnapshotService.refreshForContracts([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
