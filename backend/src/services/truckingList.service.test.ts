import { describe, expect, it } from 'vitest';
import {
  buildTruckingListQuery,
  buildTruckingListSummaryFromRows,
  buildPaginatedListQuery,
  buildTruckingStatusContractQtyQuery,
  buildTruckingStatusOutstandingQtyQuery,
  getCachedFilteredTotal,
  invalidateTruckingListCache,
  mergeTruckingUnplannedBreakdownIntoSummary,
  parseTruckingStatusContractQtyFromSqlRow,
  parseTruckingStatusOutstandingQtyFromSqlRow,
  sortTruckingListRows,
  type TruckingListRow,
} from './truckingList.service';
import { appendTruckingPipelineStageFilter } from '../utils/truckingPagePipelineSql';

describe('truckingList.service', () => {
  it('list query defers pipeline status filter until after STO expansion', () => {
    const req = {
      query: { status: 'UNPLANNED', page: '1', limit: '20' },
    } as Parameters<typeof buildTruckingListQuery>[0];

    const withInner = buildTruckingListQuery(req);
    const deferred = buildTruckingListQuery(req, { omitStatusFilter: true });

    const innerStage = appendTruckingPipelineStageFilter(
      'UNPLANNED',
      `NULLIF(TRIM(COALESCE(NULLIF(TRIM(c.sto_number::text), ''), sa.sto_numbers)), '')`,
      1,
    ).sql.trim();

    expect(withInner.preOuterQuery).toContain(innerStage);
    expect(deferred.preOuterQuery).not.toContain(innerStage);
  });

  it('buildTruckingSummaryFromRows mirrors SQL status partition counts', () => {
    const rows: TruckingListRow[] = [
      { status: 'PLANNED', status_db: 'PLANNED', trucking_start_date: null, trucking_completion_date: null },
      {
        status: 'COMPLETED',
        status_db: 'PLANNED',
        trucking_start_date: '2026-06-01',
        trucking_completion_date: '2026-06-30',
      },
      { status: 'IN_PROGRESS', status_db: 'IN_TRANSIT', trucking_start_date: '2025-01-01', trucking_completion_date: null },
      { status: 'PLANNED', status_db: 'LOADING', trucking_start_date: null, trucking_completion_date: null },
      { status: 'COMPLETED', status_db: 'COMPLETED', trucking_start_date: '2025-01-01', trucking_completion_date: '2025-01-10' },
      { status: 'CANCELLED', status_db: 'CANCELLED', trucking_start_date: null, trucking_completion_date: null },
    ];

    const summary = buildTruckingListSummaryFromRows(rows);
    expect(summary.total).toBe(6);
    expect(summary.status.planned).toBe(2);
    expect(summary.status.inProgress).toBe(1);
    expect(summary.status.loading).toBe(1);
    expect(summary.status.inTransit).toBe(1);
    expect(summary.status.completed).toBe(2);
    expect(summary.status.cancelled).toBe(1);
  });

  it('parseTruckingStatusContractQtyFromSqlRow maps kg fields', () => {
    const qty = parseTruckingStatusContractQtyFromSqlRow({
      unplanned_contract_qty: '1000',
      planned_contract_qty: 2000,
      in_progress_contract_qty: '0',
      completed_contract_qty: 500,
      cancelled_contract_qty: null,
    });
    expect(qty).toEqual({
      unplanned: 1000,
      planned: 2000,
      inProgress: 0,
      completed: 500,
      cancelled: 0,
    });
  });

  it('mergeTruckingUnplannedBreakdownIntoSummary adds backlog contract qty when provided', () => {
    const merged = mergeTruckingUnplannedBreakdownIntoSummary(
      {
        total: 10,
        status: {
          unplanned: 3,
          planned: 2,
          inProgress: 1,
          loading: 0,
          inTransit: 0,
          unloading: 0,
          completed: 3,
          cancelled: 1,
        },
        statusContractQty: {
          unplanned: 1000,
          planned: 2000,
          inProgress: 500,
          completed: 3000,
          cancelled: 0,
        },
      },
      {
        contractRows: 4,
        executionRows: 3,
        totalTableRows: 7,
        backlogContractQtyKg: 9000,
      },
    );
    expect(merged?.status.unplanned).toBe(7);
    expect(merged?.statusContractQty?.unplanned).toBe(10000);
    expect(merged?.unplannedTable?.totalTableRows).toBe(7);
  });

  it('buildTruckingStatusContractQtyQuery dedupes by contract_number per status', () => {
    const req = {
      query: { page: '1', limit: '20', skipSapJoin: 'true' },
    } as Parameters<typeof buildTruckingListQuery>[0];
    const built = buildTruckingListQuery(req, { omitStatusFilter: true });
    const { text } = buildTruckingStatusContractQtyQuery(built);
    expect(text).toContain('per_contract');
    expect(text).toContain('GROUP BY status, contract_number');
    expect(text).toContain('unplanned_contract_qty');
    expect(text).toContain('MAX(COALESCE(contract_qty, 0))');
  });

  it('parseTruckingStatusOutstandingQtyFromSqlRow maps kg fields', () => {
    const qty = parseTruckingStatusOutstandingQtyFromSqlRow({
      planned_outstanding_qty: '3000',
      in_progress_outstanding_qty: 1500,
    });
    expect(qty).toEqual({ planned: 3000, inProgress: 1500 });
  });

  it('buildTruckingStatusOutstandingQtyQuery sums outstanding per status', () => {
    const req = {
      query: { page: '1', limit: '20', skipSapJoin: 'true' },
    } as Parameters<typeof buildTruckingListQuery>[0];
    const built = buildTruckingListQuery(req, { omitStatusFilter: true });
    const { text } = buildTruckingStatusOutstandingQtyQuery(built);
    expect(text).toContain('outstanding_quantity');
    expect(text).toContain("status IN ('PLANNED', 'IN_PROGRESS')");
    expect(text).toContain('planned_outstanding_qty');
    expect(text).toContain('in_progress_outstanding_qty');
  });

  it('sortTruckingListRows paginates consistently (sort + slice)', () => {
    const rows: TruckingListRow[] = [
      { created_at: '2025-01-03', operation_id: 'C' },
      { created_at: '2025-01-01', operation_id: 'A' },
      { created_at: '2025-01-02', operation_id: 'B' },
    ];
    const sorted = sortTruckingListRows(rows, 'created_at', 'ASC');
    expect(sorted.map((r) => r.operation_id)).toEqual(['A', 'B', 'C']);
    expect(sorted.slice(1, 3).map((r) => r.operation_id)).toEqual(['B', 'C']);
  });

  it('sortTruckingListRows prioritizes STO rows when requested', () => {
    const rows: TruckingListRow[] = [
      { created_at: '2025-01-01', operation_id: 'A', sto_number: '' },
      { created_at: '2025-01-03', operation_id: 'C', sto_number: '1006018900' },
      { created_at: '2025-01-02', operation_id: 'B', sto_number: '' },
    ];
    const sorted = sortTruckingListRows(rows, 'created_at', 'ASC', { prioritizeSapSto: true });
    expect(sorted[0].operation_id).toBe('C');
  });

  it('invalidateTruckingListCache clears cached rows without throwing', () => {
    expect(() => invalidateTruckingListCache()).not.toThrow();
  });

  it('getCachedFilteredTotal returns null when cache is empty', () => {
    invalidateTruckingListCache();
    expect(getCachedFilteredTotal('missing-filter-key')).toBeNull();
  });

  it('buildPaginatedListQuery with sto key paging skips row LIMIT', () => {
    const req = {
      query: { page: '1', limit: '20', skipSapJoin: 'true' },
    } as Parameters<typeof buildTruckingListQuery>[0];
    const built = buildTruckingListQuery(req, { omitStatusFilter: true });
    const pagingBuilt = {
      ...built,
      usesStoKeyPaging: true,
      expansionPaging: {
        limit: 20,
        offset: 0,
        orderBySql: 'ts.created_at DESC',
      },
    };
    const { text, params } = buildPaginatedListQuery(pagingBuilt, 'created_at', 'DESC', 20, 0);
    expect(text).toContain('expansion_keys AS');
    expect(text).toContain('paged_expansion AS');
    expect(text).not.toMatch(/trucking_page AS[\s\S]*LIMIT \$\d+/);
    expect(params).toHaveLength(built.innerParams.length + built.outerParams.length);
  });
});
