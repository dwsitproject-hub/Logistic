import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const applyLaneMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('./applyActuals', () => ({ applyJpsAtaLane: applyLaneMock }));

import { applyJpsInstruction } from './applyInstruction';
import type { JpsInstruction } from './types';

const instruction = (extra: Partial<JpsInstruction> = {}): JpsInstruction =>
  ({
    id: 10,
    status: 'Sailed',
    schedule: {
      ta: '2026-09-28T01:00:00Z',
      tb: '2026-09-28T03:00:00Z',
      cargo_ops_start_at: '2026-09-28T07:45:00Z',
      tc: '2026-09-29T16:30:00Z',
      sailed_at: '2026-09-29T17:00:00Z',
    },
    ...extra,
  }) as JpsInstruction;

describe('applyJpsInstruction: status and actual times arrive together', () => {
  beforeEach(() => {
    queryMock.mockReset();
    applyLaneMock.mockReset();
    queryMock.mockResolvedValue({ rows: [{ sto_key: '1006019026' }] });
    applyLaneMock.mockResolvedValue({ shipmentIds: [], changedShipmentIds: [] });
  });

  it('stores JPS\'s own cargo-operations start next to the other timestamps', async () => {
    await applyJpsInstruction('row-1', instruction());
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('schedule_cargo_ops_start_at = COALESCE($20::timestamptz, schedule_cargo_ops_start_at)');
    expect(sql).toContain('RETURNING sto_key');
    expect(params[19]).toBe('2026-09-28T07:45:00Z');
  });

  it('applies the actual times to the STO\'s shipments, by webhook or poll alike (same function)', async () => {
    await applyJpsInstruction('row-1', instruction());
    expect(applyLaneMock).toHaveBeenCalledTimes(1);
    expect(applyLaneMock).toHaveBeenCalledWith('1006019026', expect.objectContaining({ tc: '2026-09-29T16:30:00Z' }));
  });

  it('does not touch shipments for a v4.x response that has no schedule', async () => {
    await applyJpsInstruction('row-1', instruction({ schedule: undefined, status: 'Approved' }));
    expect(applyLaneMock).not.toHaveBeenCalled();
  });

  it('keeps the status update when the actual times cannot be written, to be made again on the next poll or webhook', async () => {
    applyLaneMock.mockRejectedValue(new Error('deadlock detected'));
    await expect(applyJpsInstruction('row-1', instruction())).resolves.toBeUndefined();
    // the status UPDATE already ran
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
