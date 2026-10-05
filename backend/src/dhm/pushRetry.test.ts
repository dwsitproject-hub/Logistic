import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const pushRowMock = vi.hoisted(() => vi.fn());
const loadRowsMock = vi.hoisted(() => vi.fn());
const enabledMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());
const rawPortPush = vi.hoisted(() => vi.fn());
const rawNamedPush = vi.hoisted(() => vi.fn());
const rawExternalPush = vi.hoisted(() => vi.fn());

vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('./config', () => ({ isDhmEnabled: enabledMock }));
vi.mock('./pushCatalog', () => ({
  pushRow: pushRowMock,
  loadRowsByIds: loadRowsMock,
  rowName: (_m: string, row: Record<string, unknown>) => String(row.name ?? row.id),
}));
vi.mock('./pushMaster', () => ({
  pushMasterPortToDhm: rawPortPush,
  pushNamedMasterToDhm: rawNamedPush,
  pushMasterExternalPartyToDhm: rawExternalPush,
  pushMasterCompanyToDhm: vi.fn(),
  pushMasterPlantToDhm: vi.fn(),
  pushMasterSiteToDhm: vi.fn(),
}));
vi.mock('./pushVessel', () => ({ pushMasterVesselToDhm: vi.fn() }));
vi.mock('./pushState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pushState')>();
  return { ...actual, recordPushOutcome: recordMock };
});

import { listDhmPushStates, retryDhmPushes } from './pushRetry';
import { pushMasterPortToDhm, pushNamedMasterToDhm, pushMasterExternalPartyToDhm } from './pushTracked';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('retryDhmPushes', () => {
  beforeEach(() => {
    queryMock.mockReset();
    pushRowMock.mockReset();
    loadRowsMock.mockReset();
    enabledMock.mockReset();
    enabledMock.mockReturnValue(true);
  });

  it('does nothing while DHM is switched off', async () => {
    enabledMock.mockReturnValue(false);
    const summary = await retryDhmPushes({ onlyDue: true });
    expect(summary).toMatchObject({ disabled: true, attempted: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('the cron respects the backoff; the button does not', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await retryDhmPushes({ onlyDue: true });
    await retryDhmPushes({ onlyDue: false });
    const [cron, button] = queryMock.mock.calls.map((c) => String(c[0]));
    expect(cron).toContain("status = 'FAILED'");
    expect(cron).toContain('next_attempt_at <= NOW()');
    expect(button).toContain("status = 'FAILED'");
    expect(button).not.toContain('next_attempt_at');
  });

  it('pushes the CURRENT row, never with overwrite, and counts what went through', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { entity_kind: 'port', entity_id: A },
        { entity_kind: 'port', entity_id: B },
      ],
    });
    loadRowsMock.mockResolvedValue([
      { id: A, port: 'PORT BONTANG' },
      { id: B, port: 'PORT KUMAI' },
    ]);
    pushRowMock.mockResolvedValueOnce({ dhmStatus: 'updated', dhmCode: 'PORT-0048' }).mockResolvedValueOnce({ dhmError: 'DHM unavailable' });
    const summary = await retryDhmPushes({ onlyDue: true });
    expect(loadRowsMock).toHaveBeenCalledWith('port', [A, B]);
    expect(pushRowMock).toHaveBeenNthCalledWith(1, 'port', { id: A, port: 'PORT BONTANG' }, false);
    expect(pushRowMock).toHaveBeenNthCalledWith(2, 'port', { id: B, port: 'PORT KUMAI' }, false);
    expect(summary).toMatchObject({ attempted: 2, synced: 1, stillFailing: 1, dropped: 0 });
  });

  it('drops the record of a master that no longer exists', async () => {
    queryMock.mockResolvedValue({ rows: [{ entity_kind: 'site', entity_id: A }] });
    loadRowsMock.mockResolvedValue([]);
    const summary = await retryDhmPushes({ onlyDue: true });
    expect(summary).toMatchObject({ attempted: 0, dropped: 1 });
    expect(pushRowMock).not.toHaveBeenCalled();
    const del = queryMock.mock.calls.find((c) => /DELETE FROM dhm_push_state/.test(String(c[0]))) as [string, unknown[]];
    expect(del[1]).toEqual(['site', A]);
  });

  it('one row that throws does not stop the others', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { entity_kind: 'product', entity_id: A },
        { entity_kind: 'product', entity_id: B },
      ],
    });
    loadRowsMock.mockResolvedValue([{ id: A, name: 'CPO' }, { id: B, name: 'PK' }]);
    pushRowMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ dhmStatus: 'created', dhmCode: 'CMD-1' });
    const summary = await retryDhmPushes({ onlyDue: false });
    expect(summary).toMatchObject({ attempted: 2, synced: 1, stillFailing: 1 });
  });

  it('ignores a kind it does not know', async () => {
    queryMock.mockResolvedValue({ rows: [{ entity_kind: 'nonsense', entity_id: A }] });
    const summary = await retryDhmPushes({ onlyDue: true });
    expect(summary.attempted).toBe(0);
    expect(loadRowsMock).not.toHaveBeenCalled();
  });
});

describe('listDhmPushStates', () => {
  beforeEach(() => {
    queryMock.mockReset();
    loadRowsMock.mockReset();
  });

  it('names each undelivered master, and says so when the master has been deleted since', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { entity_kind: 'port', entity_id: A, status: 'FAILED', error: 'x', attempts: 2 },
        { entity_kind: 'port', entity_id: B, status: 'CONFLICT', error: null, attempts: 1 },
      ],
    });
    loadRowsMock.mockResolvedValue([{ id: A, name: 'PORT BONTANG' }]);
    const out = await listDhmPushStates();
    expect(out.map((r) => r.name)).toEqual(['PORT BONTANG', '(deleted)']);
  });
});

describe('the tracked push functions leave a note of how the push went', () => {
  beforeEach(() => recordMock.mockReset());

  it('records the master kind with the raw result, and returns that result unchanged', async () => {
    const failed = { dhmError: 'DHM unavailable' };
    rawPortPush.mockResolvedValue(failed);
    const result = await pushMasterPortToDhm(A, { port: 'PORT BONTANG' } as never, { overwrite: false });
    expect(result).toBe(failed);
    expect(recordMock).toHaveBeenCalledWith('port', A, failed);
  });

  it('products and incoterms share the generic push; the table and slug say which one it was', async () => {
    rawNamedPush.mockResolvedValue({ dhmStatus: 'created', dhmCode: 'CMD-1' });
    await pushNamedMasterToDhm('products', A, 'commodity', 'CPO', null);
    expect(recordMock).toHaveBeenLastCalledWith('product', A, { dhmStatus: 'created', dhmCode: 'CMD-1' });
    await pushNamedMasterToDhm('master_reference_items', B, 'incoterm', 'CIF', null);
    expect(recordMock).toHaveBeenLastCalledWith('incoterm', B, { dhmStatus: 'created', dhmCode: 'CMD-1' });
  });

  it('a generic push that is neither is not recorded', async () => {
    rawNamedPush.mockResolvedValue({ dhmError: 'x' });
    await pushNamedMasterToDhm('master_reference_items', A, 'shipper', 'ACME', null);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('the external-party push is its own kind', async () => {
    rawExternalPush.mockResolvedValue({ dhmConflict: true });
    await pushMasterExternalPartyToDhm(A, { value_3: 'ACME' } as never, {});
    expect(recordMock).toHaveBeenCalledWith('ext_company', A, { dhmConflict: true });
  });
});
