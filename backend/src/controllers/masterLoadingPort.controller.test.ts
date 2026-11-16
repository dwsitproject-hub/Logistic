import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../dhm', () => ({
  pushMasterPortToDhm: vi.fn(),
  attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows),
}));
vi.mock('../utils/masterPortSapNames', () => ({
  assertSapNamesAvailable: vi.fn(),
  attachSapNames: vi.fn(async (rows: unknown[]) => rows),
  dedupeSapNames: vi.fn((v: unknown) => v),
  MasterPortSapNameConflictError: class extends Error {},
  parseSapNamesInput: vi.fn(),
  refreshMasterPortIds: vi.fn(),
  replaceSapNamesForPort: vi.fn(),
}));

import { query } from '../database/connection';
import { getMasterLoadingPortSummary, listMasterLoadingPorts } from './masterLoadingPort.controller';

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

const SITE = '11111111-2222-4333-8444-555555555555';

describe('listMasterLoadingPorts: the Master Port page (masterOnly) filters', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as any);
  });

  it('adds nothing for All', async () => {
    await call(listMasterLoadingPorts, { masterOnly: 'true' });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('dhm_push_state'))).toBe(true);
  });

  it('judges the DHM status of a catalog port in the list and in the count, with the port kind and the p alias', async () => {
    await call(listMasterLoadingPorts, { masterOnly: 'true', dhm: 'failed' });
    const [list, count] = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    for (const sql of [list, count]) {
      expect(sql).toContain("ps.entity_kind = 'port'");
      expect(sql).toContain('ps.entity_id = p.id');
      expect(sql).toContain("ps.status IN ('FAILED', 'CONFLICT')");
    }
    vi.mocked(query).mockClear();
    await call(listMasterLoadingPorts, { masterOnly: 'true', dhm: 'synced' });
    expect(String(vi.mocked(query).mock.calls[0]![0])).toContain("COALESCE(p.code_dhm::text, '') <> ''");
  });

  it('filters by a Site id as a parameter numbered before LIMIT and OFFSET, and ignores a value that is not an id', async () => {
    await call(listMasterLoadingPorts, { masterOnly: 'true', search: 'bon', site: SITE, limit: '500' });
    const [list, count] = vi.mocked(query).mock.calls;
    const listSql = String(list[0]);
    expect(listSql).toContain('p.site_id = $2::uuid');
    expect(listSql).toContain('LIMIT $3 OFFSET $4');
    expect(list[1]).toEqual(['%bon%', SITE, 500, 0]);
    expect(count[1]).toEqual(['%bon%', SITE]);
    expect(listSql).not.toContain(SITE);

    vi.mocked(query).mockClear();
    await call(listMasterLoadingPorts, { masterOnly: 'true', site: 'not-an-id' });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('p.site_id ='))).toBe(true);
  });

  it('ignores a filter value it does not know instead of putting it in the SQL', async () => {
    await call(listMasterLoadingPorts, { masterOnly: 'true', dhm: "x'; DROP TABLE master_loading_ports; --" });
    expect(vi.mocked(query).mock.calls.every((c) => !String(c[0]).includes('DROP TABLE'))).toBe(true);
  });

  it('leaves the picker list (not masterOnly) alone: no extra parameter that the SQL would not use', async () => {
    await call(listMasterLoadingPorts, { dhm: 'failed', site: SITE, search: 'bon' });
    for (const c of vi.mocked(query).mock.calls) {
      expect(String(c[0])).not.toContain('dhm_push_state');
      expect(String(c[0])).not.toContain('p.site_id =');
    }
    expect(vi.mocked(query).mock.calls[0]![1]).toEqual(['%bon%', 50, 0]);
  });
});

describe('getMasterLoadingPortSummary', () => {
  it('answers the four DHM counts, the ports shipments and vessel rotations use, and the Sites for the filter', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ total: 46, synced: 30, not_synced: 14, failed: 2, used_in_klip: 45 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 's1', name: 'BONTANG', ports: '4' }] } as any);
    const { status, body } = await call(getMasterLoadingPortSummary);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      total: 46,
      synced: 30,
      notSynced: 14,
      failed: 2,
      usedInKlip: 45,
      sites: [{ id: 's1', name: 'BONTANG', ports: 4 }],
    });
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain('FROM master_loading_ports');
    expect(sql).toContain('s.loading_master_port_id = master_loading_ports.id OR s.discharge_master_port_id = master_loading_ports.id');
    expect(sql).toContain('v.master_port_id = master_loading_ports.id');
    expect(sql).toContain("ps.entity_kind = 'port'");
    // the same rows as the list: numeric SAP port codes are not ports
    expect(sql).toMatch(/WHERE TRIM\(COALESCE\(master_loading_ports\.port/);
  });

  it('fails with 500 and a message, not a stack, when the database does', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockRejectedValue(new Error('db down'));
    const { status, body } = await call(getMasterLoadingPortSummary);
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});
