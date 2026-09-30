import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: async () => ({
    query: (...args: unknown[]) => queryMock(...args),
    release: () => undefined,
  }),
}));

import { B2bEndingChildSnapshotService } from './b2bEndingChildSnapshot.service';
import { ContractLatestSpdSnapshotService } from './contractLatestSpdSnapshot.service';
import { ContractStoAggSnapshotService } from './contractStoAggSnapshot.service';

beforeEach(() => {
  queryMock.mockReset();
});

const sqls = () => queryMock.mock.calls.map((c) => String(c[0] ?? ''));

function assertSwapIsTransactional(table: string): void {
  const text = sqls().join('\n');
  expect(text).not.toMatch(/TRUNCATE/i);
  const order = sqls();
  const staleAt = order.findIndex((sql) => /is_stale\s*=\s*TRUE/i.test(sql));
  const deleteAt = order.findIndex((sql) => new RegExp(`DELETE FROM ${table}`, 'i').test(sql));
  const commitAt = order.findIndex((sql) => /^\s*COMMIT/i.test(sql));
  const freshAt = order.findIndex((sql) => /is_stale\s*=\s*FALSE/i.test(sql));
  expect(staleAt).toBeGreaterThanOrEqual(0);
  expect(deleteAt).toBeGreaterThan(staleAt);
  expect(commitAt).toBeGreaterThan(deleteAt);
  expect(freshAt).toBeGreaterThan(commitAt);
}

describe('full snapshot refresh cannot publish an empty table as fresh', () => {
  it('latest_spd marks stale, swaps in one transaction, then clears the flag', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/INSERT/i.test(sql)) return { rows: [], rowCount: 19236 };
      return { rows: [], rowCount: 1 };
    });
    await expect(ContractLatestSpdSnapshotService.refreshAll()).resolves.toBe(19236);
    assertSwapIsTransactional('contract_latest_spd_snapshot');
  });

  it('sto_agg marks stale, swaps in one transaction, then clears the flag', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/INSERT/i.test(sql)) return { rows: [], rowCount: 5545 };
      return { rows: [], rowCount: 1 };
    });
    await expect(ContractStoAggSnapshotService.refreshAll()).resolves.toBe(5545);
    assertSwapIsTransactional('contract_sto_agg_snapshot');
  });

  it('b2b marks stale, swaps in one transaction, then clears the flag', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/INSERT/i.test(sql)) return { rows: [], rowCount: 588 };
      return { rows: [], rowCount: 1 };
    });
    await expect(B2bEndingChildSnapshotService.refreshAll()).resolves.toBe(588);
    assertSwapIsTransactional('b2b_ending_child_snapshot');
  });

  it('a failed insert leaves latest_spd stale', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/INSERT/i.test(sql)) throw new Error('insert exploded');
      return { rows: [], rowCount: 1 };
    });
    await expect(ContractLatestSpdSnapshotService.refreshAll()).rejects.toThrow('insert exploded');
    expect(sqls().some((sql) => /is_stale\s*=\s*FALSE/i.test(sql))).toBe(false);
    expect(sqls().some((sql) => /ROLLBACK/i.test(sql))).toBe(true);
  });

  it('a 0-row insert is not published as fresh', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await expect(ContractStoAggSnapshotService.refreshAll()).rejects.toThrow(/0 rows/);
    expect(sqls().some((sql) => /is_stale\s*=\s*FALSE/i.test(sql))).toBe(false);
    expect(sqls().some((sql) => /ROLLBACK/i.test(sql))).toBe(true);
  });
});
