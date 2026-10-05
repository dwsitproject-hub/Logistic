import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));

import { applyDhmMasterRecord, markDhmMasterDeleted, NOT_NEWER_THAN_DELETE_SQL } from './applyMaster';
import { applyDhmVesselRecord } from './replica';
import { isStaleDhmVersion, shouldApplyDhmRecord, storedDhmVersion } from './versionGuard';
import type { DhmRecord } from './types';

const ID = '3f2b8c1e-5a4d-4c7e-9b1a-0d6e2f8a7c11';

const record = (version: number, data: Record<string, unknown> = { name: 'CPO', code: 'CMD-0006' }): DhmRecord => ({
  id: ID,
  version,
  isDeleted: false,
  data,
  updatedAt: '2026-10-05T02:00:00.000Z',
});

/** The version query answers `stored`; every other statement is recorded and answers an empty result. */
function mockStored(stored: number | null) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/SELECT MAX\(v\) AS v FROM/.test(sql)) return { rows: [{ v: stored }] };
    return { rows: [] };
  });
}
const writes = () =>
  queryMock.mock.calls.map((c) => String(c[0])).filter((sql) => /^\s*(UPDATE|INSERT)/i.test(sql));

describe('isStaleDhmVersion', () => {
  it('is stale only when the incoming version is LOWER than the stored one', () => {
    expect(isStaleDhmVersion(4, 3)).toBe(true);
    expect(isStaleDhmVersion(4, 4)).toBe(false); // the same record again
    expect(isStaleDhmVersion(4, 5)).toBe(false);
  });

  it('cannot order what it does not know, so it does not block', () => {
    for (const [stored, incoming] of [[null, 3], [4, null], [undefined, undefined], [NaN, 2], [2, NaN]] as const) {
      expect(isStaleDhmVersion(stored as never, incoming as never)).toBe(false);
    }
  });
});

describe('storedDhmVersion', () => {
  beforeEach(() => queryMock.mockReset());

  it('reads the highest version across the tables that replicate the slug', async () => {
    mockStored(7);
    expect(await storedDhmVersion('company', ID)).toBe(7);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain('FROM dhm_organizations');
    expect(sql).toContain('FROM master_companies');
  });

  it('separates the reference masters by kind, and maps each slug to its own table', async () => {
    mockStored(1);
    await storedDhmVersion('incoterm', ID);
    await storedDhmVersion('shipper', ID);
    await storedDhmVersion('commodity', ID);
    await storedDhmVersion('port_master', ID);
    await storedDhmVersion('vessel', ID);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain("FROM master_reference_items WHERE dhm_id = $1::uuid AND kind = 'incoterm'");
    expect(sqls[1]).toContain("AND kind = 'ext_company'");
    expect(sqls[2]).toContain('FROM products');
    expect(sqls[3]).toContain('FROM master_loading_ports');
    expect(sqls[4]).toContain('FROM master_vessels');
  });

  it('is null for a record never seen, an unknown slug or an id that is not a uuid, without asking the database', async () => {
    mockStored(null);
    expect(await storedDhmVersion('commodity', ID)).toBeNull();
    queryMock.mockClear();
    expect(await storedDhmVersion('nonsense', ID)).toBeNull();
    expect(await storedDhmVersion('commodity', 'not-a-uuid')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('shouldApplyDhmRecord', () => {
  beforeEach(() => queryMock.mockReset());

  it('skips an older record and lets an equal, newer or first-seen one through', async () => {
    mockStored(4);
    expect(await shouldApplyDhmRecord('commodity', record(3))).toBe(false);
    expect(await shouldApplyDhmRecord('commodity', record(4))).toBe(true);
    expect(await shouldApplyDhmRecord('commodity', record(5))).toBe(true);
    mockStored(null);
    expect(await shouldApplyDhmRecord('commodity', record(1))).toBe(true);
  });

  it('a snapshot (force) and an unversioned webhook body are never held back, and cost no query', async () => {
    mockStored(9);
    queryMock.mockClear();
    expect(await shouldApplyDhmRecord('commodity', record(1), { force: true })).toBe(true);
    expect(await shouldApplyDhmRecord('commodity', record(1), { versionKnown: false })).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('the guard in front of every write', () => {
  beforeEach(() => queryMock.mockReset());

  it('master: an older record writes nothing and says so', async () => {
    mockStored(4);
    expect(await applyDhmMasterRecord('commodity', record(3))).toBe(false);
    expect(writes()).toEqual([]);
  });

  it('master: a newer record is written', async () => {
    mockStored(4);
    expect(await applyDhmMasterRecord('commodity', record(5))).toBe(true);
    expect(writes().length).toBeGreaterThan(0);
  });

  it('master: a snapshot rebuild writes even a lower version (DHM restored from a backup)', async () => {
    mockStored(9);
    expect(await applyDhmMasterRecord('commodity', record(2), { force: true })).toBe(true);
    expect(writes().length).toBeGreaterThan(0);
  });

  it('master: an unknown slug is still refused', async () => {
    expect(await applyDhmMasterRecord('nonsense', record(1))).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('vessel: an older record writes nothing', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT MAX\(v\) AS v FROM/.test(sql)) return { rows: [{ v: 6 }] };
      if (/SELECT id FROM master_vessels WHERE dhm_id/.test(sql)) return { rows: [{ id: 'local-1' }] };
      return { rows: [] };
    });
    const result = await applyDhmVesselRecord(record(5, { Vessel_Name: 'BG. ALPHA' }));
    expect(result).toEqual({ id: 'local-1', created: false, skipped: 'stale' });
    expect(writes()).toEqual([]);
  });
});

describe('deletes: the guard is inside the UPDATE', () => {
  beforeEach(() => queryMock.mockReset());

  it('a tombstone only lands on a row whose version is not newer than the delivery', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await markDhmMasterDeleted('commodity', ID, 3);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain(NOT_NEWER_THAN_DELETE_SQL);
    expect(NOT_NEWER_THAN_DELETE_SQL).toContain('dhm_version <= $2::int');
    expect(queryMock.mock.calls[0][1]).toEqual([ID, 3]);
  });

  it('a delivery with no version still deletes (NULL on either side applies)', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await markDhmMasterDeleted('commodity', ID, null);
    expect(NOT_NEWER_THAN_DELETE_SQL).toContain('$2::int IS NULL');
    expect(NOT_NEWER_THAN_DELETE_SQL).toContain('dhm_version IS NULL');
    expect(queryMock.mock.calls[0][1]).toEqual([ID, null]);
  });

  it('company deletes carry it on both tables', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await markDhmMasterDeleted('company', ID, 3);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) expect(sql).toContain(NOT_NEWER_THAN_DELETE_SQL);
  });
});
