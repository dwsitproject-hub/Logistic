import { describe, expect, it, vi } from 'vitest';
import {
  SQL_TRUCKING_ONE_ACTIVE_PER_CONTRACT_CONFLICT,
  getOrCreateActiveTruckingOp,
  isPgUniqueViolation,
} from './truckingActiveOp';

describe('getOrCreateActiveTruckingOp', () => {
  it('returns the existing active row without inserting', async () => {
    const db = vi.fn(async () => ({
      rows: [{ id: 'op-1', operation_id: 'OP-LAND-EXISTING', status: 'UNPLANNED' }],
    }));
    const allocate = vi.fn(async () => 'OP-LAND-NEW');
    const result = await getOrCreateActiveTruckingOp(db, 'contract-1', {
      allocateOperationId: allocate,
    });
    expect(result).toEqual({
      id: 'op-1',
      operation_id: 'OP-LAND-EXISTING',
      status: 'UNPLANNED',
      created: false,
    });
    expect(allocate).not.toHaveBeenCalled();
    expect(db).toHaveBeenCalledTimes(1);
    expect(String(db.mock.calls[0]?.[0])).toContain('FOR UPDATE');
  });

  it('inserts UNPLANNED with ON CONFLICT when none exists', async () => {
    const db = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'op-new', operation_id: 'OP-LAND-050820260001', status: 'UNPLANNED' }],
      });
    const result = await getOrCreateActiveTruckingOp(db, 'contract-1', {
      allocateOperationId: async () => 'OP-LAND-050820260001',
    });
    expect(result.created).toBe(true);
    expect(result.id).toBe('op-new');
    expect(String(db.mock.calls[1]?.[0])).toContain('ON CONFLICT');
    expect(String(db.mock.calls[1]?.[0])).toContain(SQL_TRUCKING_ONE_ACTIVE_PER_CONTRACT_CONFLICT);
    expect(db.mock.calls[1]?.[1]).toEqual(['contract-1', 'OP-LAND-050820260001']);
  });

  it('selects the winner when INSERT hits ON CONFLICT DO NOTHING', async () => {
    const db = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'op-winner', operation_id: 'OP-LAND-WIN', status: 'PLANNED' }],
      });
    const result = await getOrCreateActiveTruckingOp(db, 'contract-1', {
      operationId: 'OP-LAND-LOST',
    });
    expect(result).toEqual({
      id: 'op-winner',
      operation_id: 'OP-LAND-WIN',
      status: 'PLANNED',
      created: false,
    });
  });
});

describe('isPgUniqueViolation', () => {
  it('detects Postgres 23505', () => {
    expect(isPgUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPgUniqueViolation({ code: '23503' })).toBe(false);
    expect(isPgUniqueViolation(null)).toBe(false);
  });
});
