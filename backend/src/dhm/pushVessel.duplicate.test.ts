import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const persistMock = vi.hoisted(() => vi.fn());
const enabledMock = vi.hoisted(() => vi.fn());

vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('./config', () => ({ isDhmEnabled: enabledMock }));
vi.mock('./inbound', () => ({ postVesselInbound: postMock, putVesselInbound: putMock }));
vi.mock('./replica', () => ({ persistDhmReplica: persistMock }));

import { pushMasterVesselToDhm } from './pushVessel';

const record = { id: '6b3233f9-9be3-4442-965e-c5d1a1e72791', version: 1, isDeleted: false, data: { code: 'VSL-0180' }, updatedAt: '' };
const row = { vessel_code: 'MMAKXVI', vessel_name: 'BG. MAKMUR ABADI XVI' };
const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint "uq_master_vessels_dhm_id"'), { code: '23505' });

describe('a vessel DHM answers with a record another KLIP vessel already holds', () => {
  beforeEach(() => {
    queryMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    persistMock.mockReset();
    enabledMock.mockReturnValue(true);
    queryMock.mockResolvedValue({ rows: [{ vessel_name: 'BG. MAKMUR ABADI', dhm_code: 'VSL-0180' }] });
  });

  it('409 whose record is held by another vessel: a CONFLICT that names the holder, not "DHM unavailable"', async () => {
    postMock.mockResolvedValue({ ok: false, conflict: true, status: 'duplicate', code: 'VSL-0180', record });
    persistMock.mockRejectedValue(uniqueViolation);
    const result = await pushMasterVesselToDhm('local-1', row);
    expect(result.dhmConflict).toBe(true);
    expect(result.dhmError).toContain('"BG. MAKMUR ABADI"');
    expect(result.dhmError).toContain('VSL-0180');
    expect(result.dhmError).not.toContain('unavailable');
  });

  it('never overwrites that record, even when overwrite is asked for: it would put this barge on the other vessel', async () => {
    postMock.mockResolvedValue({ ok: false, conflict: true, status: 'duplicate', code: 'VSL-0180', record });
    persistMock.mockRejectedValue(uniqueViolation);
    await pushMasterVesselToDhm('local-1', row, { overwrite: true });
    expect(putMock).not.toHaveBeenCalled();
  });

  it('200 "updated" for a record another vessel holds says DHM changed that record too', async () => {
    postMock.mockResolvedValue({ ok: true, status: 'updated', code: 'VSL-0180', record });
    persistMock.mockRejectedValue(uniqueViolation);
    const result = await pushMasterVesselToDhm('local-1', row);
    expect(result.dhmConflict).toBe(true);
    expect(result.dhmError).toContain('DHM also updated that record');
  });

  it('any other error from storing the record still surfaces as before (it is not a duplicate)', async () => {
    postMock.mockResolvedValue({ ok: true, status: 'created', code: 'VSL-9', record });
    persistMock.mockRejectedValue(new Error('connection terminated'));
    const result = await pushMasterVesselToDhm('local-1', row);
    expect(result.dhmError).toContain('DHM unavailable');
    expect(result.dhmConflict).toBeUndefined();
  });

  it('a normal link is unchanged', async () => {
    postMock.mockResolvedValue({ ok: true, status: 'created', code: 'VSL-9', record });
    persistMock.mockResolvedValue(undefined);
    expect(await pushMasterVesselToDhm('local-1', row)).toEqual({ dhmStatus: 'created', dhmCode: 'VSL-9' });
  });
});
