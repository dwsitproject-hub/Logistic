import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: vi.fn(),
  default: { query: vi.fn() },
}));
vi.mock('../dhm', () => ({
  pushMasterVesselToDhm: vi.fn(async () => ({})),
  attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows),
}));

import { getMasterVesselSummary, listMasterVessels } from './masterVessel.controller';

function call(handler: (req: any, res: any) => Promise<void>, q: Record<string, string> = {}) {
  let status = 200;
  let body: any;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };
  return handler({ query: q } as any, res).then(() => ({ status, body }));
}

describe('getMasterVesselSummary', () => {
  beforeEach(() => queryMock.mockReset());

  it('answers the DHM counts and the vessels KLIP uses, over all vessels', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: 470, synced: 400, not_synced: 60, failed: 10, used_in_klip: 140 }] });
    const { status, body } = await call(getMasterVesselSummary);
    expect(status).toBe(200);
    expect(body.data).toEqual({ total: 470, synced: 400, notSynced: 60, failed: 10, usedInKlip: 140 });
  });

  it('"used in KLIP" is the In KLIP flag of the table (the used_vessels CTE), and the DHM test uses dhm_id / dhm_code', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{}] });
    await call(getMasterVesselSummary);
    const sql = String(queryMock.mock.calls[0]![0]);
    expect(sql).toMatch(/^WITH pair_use AS/);
    expect(sql).toContain('used_vessels AS');
    expect(sql).toContain('COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM used_vessels u WHERE u.id = master_vessels.id))::int AS used_in_klip');
    expect(sql).toContain("COALESCE(master_vessels.dhm_code::text, '') <> ''");
    expect(sql).toMatch(/FROM master_vessels$/);
  });

  it('fails with 500 and a plain message when the database does', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const { status, body } = await call(getMasterVesselSummary);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});

describe('listMasterVessels: dhm filter', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] });
  });

  it('puts the same status test in the list and in the count', async () => {
    await call(listMasterVessels, { dhm: 'failed' });
    const [list, count] = queryMock.mock.calls.map((c) => String(c[0]));
    for (const sql of [list, count]) expect(sql).toContain("ps.status IN ('FAILED', 'CONFLICT')");
  });

  it('adds no status test for All or an unknown value', async () => {
    await call(listMasterVessels, { dhm: 'bogus' });
    expect(queryMock.mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);
  });
});
