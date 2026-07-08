import { describe, expect, it } from 'vitest';
import {
  buildTruckingListQuery,
  buildTruckingListSummaryFromRows,
  invalidateTruckingListCache,
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

  it('buildTruckingListSummaryFromRows mirrors SQL status partition counts', () => {
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
});
