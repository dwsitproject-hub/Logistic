import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientQuery = vi.fn();
const release = vi.fn();
const queryMock = vi.fn();
vi.mock('../database/connection', () => ({
  getClient: async () => ({ query: (...args: unknown[]) => clientQuery(...args), release }),
  query: (...args: unknown[]) => queryMock(...args),
}));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/oilLossQuerySql', () => ({ buildOilLossMainSql: vi.fn(), buildOilLossGainSql: vi.fn() }));

const META = { refreshedAt: new Date('2026-10-16T01:00:00Z'), isStale: true, logicVersion: 10, totalGainKg: 0, gainCount: 0 };
const snapshotRows = [
  { id: 'ship-1', transport_mode: 'SEA', sto_number: '1006020342', quantity_sfal: 3_007_120, quantity_sfbd: 2_998_908 },
  { id: 'ship-2', transport_mode: 'SEA', sto_number: '1006020352', quantity_sfal: 2_654_861, quantity_sfbd: null },
  { id: 'ship-1', transport_mode: 'LAND', sto_number: null, quantity_sfal: 5, quantity_sfbd: 6 },
];

// the snapshot service, as far as oilLoss.service reads it: rows, meta
vi.mock('./oilLossSnapshot.service', async () => {
  const actual = await vi.importActual<typeof import('./oilLossSnapshot.service')>('./oilLossSnapshot.service');
  return {
    ...actual,
    loadOilLossPayloadFromSnapshot: async () => ({ rows: snapshotRows.map((r) => ({ ...r })), gainRow: { total_gain_kg: 0, gain_count: 0 } }),
    readOilLossSnapshotMeta: async () => META,
    refreshOilLossSnapshot: vi.fn().mockResolvedValue(undefined),
    scheduleOilLossSnapshotRefresh: vi.fn(),
  };
});

import { loadOilLossPayload, patchCachedOilLossSfalSfbd, rememberOilLossPayloadFromSnapshot } from './oilLoss.service';
import { patchOilLossSnapshotSfalSfbd } from './oilLossSnapshot.service';

beforeEach(() => {
  clientQuery.mockReset();
  release.mockReset();
  queryMock.mockReset();
});

describe('patchCachedOilLossSfalSfbd: a saved SFAL / SFBD on the memory copy the page is served from', () => {
  it('does nothing before the memory copy has been filled', async () => {
    // this is the first test of the file, so the module has not filled its memory copy yet: nothing to patch, nothing thrown
    expect(patchCachedOilLossSfalSfbd('ship-1', 1, 2)).toBe(false);
  });

  it('changes the vessel row of that shipment only, and the next request is served the new figure', async () => {
    await rememberOilLossPayloadFromSnapshot();
    expect(patchCachedOilLossSfalSfbd('ship-1', 3_100_000, 3_050_000)).toBe(true);
    const payload = await loadOilLossPayload();
    const rows = payload.rows as Array<Record<string, unknown>>;
    const vessel = rows.find((r) => r.id === 'ship-1' && r.transport_mode === 'SEA')!;
    expect(vessel.quantity_sfal).toBe(3_100_000);
    expect(vessel.quantity_sfbd).toBe(3_050_000);
    // another STO and a trucking row that happens to share the id are untouched
    expect(rows.find((r) => r.id === 'ship-2')!.quantity_sfal).toBe(2_654_861);
    expect(rows.find((r) => r.id === 'ship-1' && r.transport_mode === 'LAND')!.quantity_sfal).toBe(5);
  });

  it('a cleared or zero quantity is no quantity (null, drawn as "-"), as in NULLIF(sfal_qty, 0)', async () => {
    await rememberOilLossPayloadFromSnapshot();
    expect(patchCachedOilLossSfalSfbd('ship-2', 0, '')).toBe(true);
    const rows = (await loadOilLossPayload()).rows as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === 'ship-2')!;
    expect(row.quantity_sfal).toBeNull();
    expect(row.quantity_sfbd).toBeNull();
  });

  it('a shipment that is not the primary row of any STO changes nothing', async () => {
    await rememberOilLossPayloadFromSnapshot();
    expect(patchCachedOilLossSfalSfbd('not-a-row', 1, 2)).toBe(false);
  });
});

describe('patchOilLossSnapshotSfalSfbd: the same figure in the snapshot table', () => {
  it('updates the row whose id IS the edited shipment (the opened row of its STO), vessel rows only, from the shipment itself', async () => {
    clientQuery.mockImplementation(async (text: string) => (/UPDATE oil_loss_snapshot/.test(String(text)) ? { rowCount: 1 } : { rowCount: 0 }));
    expect(await patchOilLossSnapshotSfalSfbd('0fafb4c7-b702-48da-883e-4ce6208d65ee')).toBe(true);
    const update = String(clientQuery.mock.calls.find((c) => /UPDATE oil_loss_snapshot/.test(String(c[0])))![0]).replace(/\s+/g, ' ');
    expect(update).toContain('quantity_sfal = NULLIF(s.sfal_qty, 0)');
    expect(update).toContain('quantity_sfbd = NULLIF(s.sfbd_qty, 0)');
    expect(update).toContain('o.id = s.id');
    expect(update).toContain("o.transport_mode = 'SEA'");
    expect(release).toHaveBeenCalled();
  });

  it('never waits behind a rebuild: a lock timeout is set inside its own transaction', async () => {
    clientQuery.mockResolvedValue({ rowCount: 0 });
    await patchOilLossSnapshotSfalSfbd('0fafb4c7-b702-48da-883e-4ce6208d65ee');
    const texts = clientQuery.mock.calls.map((c) => String(c[0]).trim());
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toMatch(/SET LOCAL lock_timeout = '3s'/);
    expect(texts[texts.length - 1]).toBe('COMMIT');
  });

  it('a row it does not match (the edited shipment is not the primary one) reports false', async () => {
    clientQuery.mockResolvedValue({ rowCount: 0 });
    expect(await patchOilLossSnapshotSfalSfbd('0fafb4c7-b702-48da-883e-4ce6208d65ee')).toBe(false);
  });

  it('a lock timeout or any error rolls back, reports false and never throws (the rebuild brings the value)', async () => {
    clientQuery.mockImplementation(async (text: string) => {
      if (/UPDATE oil_loss_snapshot/.test(String(text))) throw new Error('canceling statement due to lock timeout');
      return { rowCount: 0 };
    });
    await expect(patchOilLossSnapshotSfalSfbd('0fafb4c7-b702-48da-883e-4ce6208d65ee')).resolves.toBe(false);
    expect(clientQuery.mock.calls.some((c) => String(c[0]).trim() === 'ROLLBACK')).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it('an empty id touches nothing', async () => {
    expect(await patchOilLossSnapshotSfalSfbd('  ')).toBe(false);
    expect(clientQuery).not.toHaveBeenCalled();
  });
});
