import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyMaster = vi.hoisted(() => vi.fn());
const applyVessel = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('./webhook', () => ({
  verifyDhmSignature: () => true,
  parseDhmWebhookPayload: (raw: Buffer) => JSON.parse(raw.toString('utf8')),
}));
vi.mock('./applyMaster', () => ({
  applyDhmMasterRecord: applyMaster,
  markDhmMasterDeleted: vi.fn(),
  NOT_NEWER_THAN_DELETE_SQL: ' AND ($2::int IS NULL OR dhm_version IS NULL OR dhm_version <= $2::int)',
}));
vi.mock('./replica', () => ({
  applyDhmVesselRecord: applyVessel,
  markDhmWebhookDelivery: async () => true,
}));

import { handleDhmWebhook } from './webhookHandler';

const body = (extra: Record<string, unknown>) =>
  Buffer.from(
    JSON.stringify({
      event: 'record.updated',
      deliveryId: 'd-1',
      entityType: 'commodity',
      recordId: '3f2b8c1e-5a4d-4c7e-9b1a-0d6e2f8a7c11',
      occurredAt: '2026-10-05T02:11:00.000Z',
      data: { name: 'CPO' },
      ...extra,
    }),
  );

describe('webhook: the version decides whether a delivery may overwrite the replica', () => {
  beforeEach(() => {
    applyMaster.mockReset();
    applyVessel.mockReset();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it('a master delivery with a version is ordered against the replica', async () => {
    await handleDhmWebhook(body({ version: 3 }), 'sig');
    expect(applyMaster).toHaveBeenCalledWith('commodity', expect.objectContaining({ version: 3 }), { versionKnown: true });
  });

  it('a delivery with no version is applied as before: its "1" is a placeholder, not a version', async () => {
    await handleDhmWebhook(body({}), 'sig');
    expect(applyMaster).toHaveBeenCalledWith('commodity', expect.objectContaining({ version: 1 }), { versionKnown: false });
  });

  it('a vessel delivery is ordered the same way', async () => {
    await handleDhmWebhook(body({ entityType: 'vessel', version: 7 }), 'sig');
    expect(applyVessel).toHaveBeenCalledWith(expect.objectContaining({ version: 7 }), { versionKnown: true });
    applyVessel.mockClear();
    await handleDhmWebhook(body({ entityType: 'vessel', deliveryId: 'd-2' }), 'sig');
    expect(applyVessel).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), { versionKnown: false });
  });

  it('a vessel tombstone cannot bury a newer version of the record', async () => {
    await handleDhmWebhook(body({ entityType: 'vessel', event: 'record.deleted', version: 3 }), 'sig');
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE master_vessels');
    expect(sql).toContain('dhm_version <= $2::int');
    expect(params).toEqual(['3f2b8c1e-5a4d-4c7e-9b1a-0d6e2f8a7c11', 3]);
  });
});
