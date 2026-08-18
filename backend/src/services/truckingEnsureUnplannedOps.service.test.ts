import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthRequest } from '../middleware/auth';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

vi.mock('../utils/operationId', () => ({
  allocateNextSyntheticSequenceDefault: vi.fn(),
  buildSyntheticOperationId: vi.fn(
    (_mode: string, dmy: string, seq: number) =>
      `OP-LAND-${dmy}${String(seq).padStart(4, '0')}`,
  ),
  formatDDMMYYYY: vi.fn(() => '21072026'),
}));

vi.mock('../utils/truckingActiveOp', () => ({
  getOrCreateActiveTruckingOp: vi.fn(),
}));

vi.mock('./truckingList.service', () => ({
  invalidateTruckingListCache: vi.fn(),
}));

import { query } from '../database/connection';
import { allocateNextSyntheticSequenceDefault } from '../utils/operationId';
import { getOrCreateActiveTruckingOp } from '../utils/truckingActiveOp';
import { invalidateTruckingListCache } from './truckingList.service';
import { ensureUnplannedTruckingOpsForRequest } from './truckingEnsureUnplannedOps.service';

describe('ensureUnplannedTruckingOpsForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates UNPLANNED op via getOrCreate for backlog contract without active op', async () => {
    const contractId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: contractId }], rowCount: 1 } as never);
    vi.mocked(allocateNextSyntheticSequenceDefault).mockResolvedValueOnce(7);
    vi.mocked(getOrCreateActiveTruckingOp).mockImplementation(async (_db, _id, opts) => ({
      id: 'op-new',
      operation_id: opts?.allocateOperationId ? await opts.allocateOperationId() : 'OP-LAND-x',
      status: 'UNPLANNED',
      created: true,
    }));

    const req = { query: {} } as AuthRequest;
    const result = await ensureUnplannedTruckingOpsForRequest(req);

    expect(result.created).toBe(1);
    expect(result.operationIds).toEqual(['OP-LAND-210720260007']);
    expect(result.skippedActive).toBe(0);
    expect(invalidateTruckingListCache).toHaveBeenCalled();
  });

  it('second run creates 0 when backlog query returns empty (already has op)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const req = { query: {} } as AuthRequest;
    const result = await ensureUnplannedTruckingOpsForRequest(req);

    expect(result.created).toBe(0);
    expect(result.operationIds).toEqual([]);
    expect(getOrCreateActiveTruckingOp).not.toHaveBeenCalled();
    expect(invalidateTruckingListCache).not.toHaveBeenCalled();
  });

  it('skips contract that already has an active trucking op', async () => {
    const contractId = '11111111-2222-3333-4444-555555555555';
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: contractId }], rowCount: 1 } as never);
    vi.mocked(getOrCreateActiveTruckingOp).mockResolvedValueOnce({
      id: 'op-1',
      operation_id: 'OP-LAND-EXISTING',
      status: 'PLANNED',
      created: false,
    });

    const req = { query: {} } as AuthRequest;
    const result = await ensureUnplannedTruckingOpsForRequest(req);

    expect(result.created).toBe(0);
    expect(result.skippedActive).toBe(1);
    expect(allocateNextSyntheticSequenceDefault).not.toHaveBeenCalled();
    expect(invalidateTruckingListCache).not.toHaveBeenCalled();
  });
});
