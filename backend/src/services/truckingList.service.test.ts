import { describe, expect, it } from 'vitest';
import {
  buildTruckingListSummaryFromRows,
  invalidateTruckingListCache,
  sortTruckingListRows,
  type TruckingListRow,
} from './truckingList.service';

describe('truckingList.service', () => {
  it('buildTruckingListSummaryFromRows mirrors SQL status partition counts', () => {
    const rows: TruckingListRow[] = [
      { status: 'PLANNED', trucking_start_date: null, trucking_completion_date: null },
      { status: 'IN_TRANSIT', trucking_start_date: '2025-01-01', trucking_completion_date: null },
      { status: 'LOADING', trucking_start_date: '2025-01-02', trucking_completion_date: null },
      { status: 'COMPLETED', trucking_start_date: '2025-01-01', trucking_completion_date: '2025-01-10' },
      { status: 'CANCELLED', trucking_start_date: null, trucking_completion_date: null },
    ];

    const summary = buildTruckingListSummaryFromRows(rows);
    expect(summary.total).toBe(5);
    expect(summary.status.planned).toBe(1);
    expect(summary.status.inProgress).toBe(2);
    expect(summary.status.loading).toBe(1);
    expect(summary.status.inTransit).toBe(1);
    expect(summary.status.completed).toBe(1);
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

  it('invalidateTruckingListCache clears cached rows without throwing', () => {
    expect(() => invalidateTruckingListCache()).not.toThrow();
  });
});
