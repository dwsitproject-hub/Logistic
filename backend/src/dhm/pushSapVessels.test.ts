import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const pushRowMock = vi.fn();
const loadRowsMock = vi.fn();
const enabled = vi.fn();

vi.mock('../database/connection', () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('./config', () => ({ isDhmEnabled: () => enabled() }));
vi.mock('./pushCatalog', () => ({
  loadRowsByIds: (...args: unknown[]) => loadRowsMock(...args),
  pushRow: (...args: unknown[]) => pushRowMock(...args),
}));

import { pushUnlinkedSapVessels } from './pushSapVessels';

beforeEach(() => {
  queryMock.mockReset();
  pushRowMock.mockReset();
  loadRowsMock.mockReset();
  enabled.mockReset();
  enabled.mockReturnValue(true);
});

describe('pushUnlinkedSapVessels', () => {
  it('does nothing, and asks nothing, while DHM is off', async () => {
    enabled.mockReturnValue(false);
    expect(await pushUnlinkedSapVessels()).toMatchObject({ disabled: true, attempted: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('selects only vessels KLIP registered, DHM has not linked, nobody is waiting on, and no review is pending', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await pushUnlinkedSapVessels({ limit: 10 });
    const sql = String(queryMock.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain("registered_from = 'sap_auto'");
    expect(sql).toContain('dhm_id IS NULL');
    expect(sql).toContain("review_status IS DISTINCT FROM 'PENDING'");
    expect(sql).toContain("entity_kind = 'vessel'");
    expect(queryMock.mock.calls[0][1]).toEqual([10]);
    expect(pushRowMock).not.toHaveBeenCalled();
  });

  it('pushes what it found, without overwrite, and counts delivered and not delivered', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    loadRowsMock.mockResolvedValue([
      { id: 'a', vessel_name: 'BG. A' },
      { id: 'b', vessel_name: 'BG. B' },
      { id: 'c', vessel_name: 'BG. C' },
    ]);
    pushRowMock
      .mockResolvedValueOnce({ dhmStatus: 'created', dhmCode: 'VSL-1' })
      .mockResolvedValueOnce({ dhmConflict: true, dhmStatus: 'duplicate', dhmCode: 'VSL-2' }) // DHM already had that name: linked, left for a person
      .mockRejectedValueOnce(new Error('boom'));
    const summary = await pushUnlinkedSapVessels();
    expect(summary).toEqual({ disabled: false, attempted: 3, synced: 1, notDelivered: 2 });
    expect(pushRowMock.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['vessel', false],
      ['vessel', false],
      ['vessel', false],
    ]);
  });
});
