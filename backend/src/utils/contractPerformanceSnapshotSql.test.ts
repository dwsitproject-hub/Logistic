import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/contractQtyMoveSnapshot.service', () => ({
  resolveContractsQtyMoveCte: async () => 'qty_move AS (SELECT 1 AS contract_number)',
}));
vi.mock('../services/contractStoAggSnapshot.service', () => ({
  resolveContractsStoAggCte: async () => 'sto_agg AS (SELECT 1 AS contract_number)',
}));
vi.mock('../services/contractLatestSpdSnapshot.service', () => ({
  resolveContractsLatestSpdCte: async () => 'latest_spd AS (SELECT 1 AS contract_number)',
  isContractLatestSpdSnapshotFresh: async () => true,
}));
vi.mock('../services/contractPerformanceSnapshot.service', () => ({
  CONTRACT_PERFORMANCE_SNAPSHOT_TABLE: 'contract_performance_snapshot',
  isContractPerformanceSnapshotFresh: async () => false,
}));

const {
  buildContractPerformanceSnapshotRefreshSql,
  CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS,
} = await import('./contractPerformanceSnapshotSql');

describe('buildContractPerformanceSnapshotRefreshSql', () => {
  it('materialises the row set globally - no date range and no user filters', async () => {
    const sql = await buildContractPerformanceSnapshotRefreshSql();

    // A per-contract row is date-independent, so one snapshot must serve every date range.
    // A stray date predicate here would silently truncate the snapshot to one window.
    expect(sql).not.toMatch(/contract_date\s*>=/);
    expect(sql).not.toMatch(/contract_date\s*<=/);
    // No bound parameters at all: user filters belong on the read path.
    expect(sql).not.toMatch(/\$\d/);

    // Withdrawn contracts are a population rule, not a user filter, and must stay excluded.
    expect(sql).toContain('sap_presence');
    expect(sql).toContain('INSERT INTO contract_performance_snapshot');
  });

  it('materialises contract_date, which the live query never selects', async () => {
    const sql = await buildContractPerformanceSnapshotRefreshSql();
    // The live query filters dates in contract_scope, so contract_date is not in `base`. The
    // snapshot has to carry it or no date range could be served from the snapshot at all.
    expect(sql).toContain('MAX(c.contract_date) AS contract_date');
    expect(CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS).toContain('contract_date');
  });

  it('names every column explicitly so the INSERT cannot depend on SELECT-list order', async () => {
    const sql = await buildContractPerformanceSnapshotRefreshSql();
    for (const col of CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS) {
      expect(sql).toContain(`rs.${col}`);
    }
    // in_logistics_open_os is stored, not recomputed on read - the read path selects base.*
    // and expects it present.
    expect(CONTRACT_PERFORMANCE_SNAPSHOT_COLUMNS).toContain('in_logistics_open_os');
  });
});
