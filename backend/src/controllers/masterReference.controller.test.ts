import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../dhm', () => ({
  pushMasterExternalPartyToDhm: vi.fn(),
  pushNamedMasterToDhm: vi.fn(),
  attachDhmPushState: vi.fn(async (_kind: string, rows: unknown[]) => rows),
}));

import { query } from '../database/connection';
import { getMasterReferenceSummary, listMasterReferences } from './masterReference.controller';

function call(handler: (req: any, res: any) => Promise<void>, kind: string, q: Record<string, string> = {}) {
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
  return handler({ params: { kind }, query: q } as any, res).then(() => ({ status, body }));
}

const sqls = () => vi.mocked(query).mock.calls.map((c) => String(c[0]));

describe('listMasterReferences: the DHM status filter', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 } as never);
  });

  it('adds nothing for All', async () => {
    await call(listMasterReferences, 'incoterm', {});
    expect(sqls().every((sql) => !sql.includes('dhm_push_state'))).toBe(true);
  });

  it('judges Failed in SQL, for this kind, the same in the list and in the count', async () => {
    await call(listMasterReferences, 'ext_company', { dhm: 'failed' });
    const [list, count] = sqls();
    for (const sql of [list, count]) {
      expect(sql).toContain("ps.entity_kind = 'ext_company'");
      expect(sql).toContain('ps.entity_id = master_reference_items.id');
      expect(sql).toContain("ps.status IN ('FAILED', 'CONFLICT')");
    }
  });

  it('Synced and Not synced both leave out a row whose last push failed, and read the DHM id and code columns', async () => {
    for (const dhm of ['synced', 'not_synced']) {
      vi.mocked(query).mockClear();
      await call(listMasterReferences, 'incoterm', { dhm });
      const sql = sqls()[0];
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM dhm_push_state');
      expect(sql).toContain("COALESCE(master_reference_items.dhm_id::text, '') <> ''");
      expect(sql).toContain("COALESCE(master_reference_items.code_dhm::text, '') <> ''");
    }
  });

  it('ignores the filter for Truck Transporter, which is never sent to DHM', async () => {
    await call(listMasterReferences, 'truck_transporter', { dhm: 'failed' });
    expect(sqls().every((sql) => !sql.includes('dhm_push_state'))).toBe(true);
  });

  it('ignores a value it does not know instead of putting it in the SQL', async () => {
    await call(listMasterReferences, 'incoterm', { dhm: "x'; DROP TABLE master_reference_items; --" });
    expect(sqls().every((sql) => !sql.includes('DROP TABLE') && !sql.includes('dhm_push_state'))).toBe(true);
  });

  it('still refuses an unknown kind', async () => {
    const { status } = await call(listMasterReferences, 'nope', { dhm: 'failed' });
    expect(status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('getMasterReferenceSummary', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('answers the DHM counts and the rows KLIP uses for a kind that goes to DHM', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: 6, synced: 2, not_synced: 3, failed: 1, used_in_klip: 5 }] } as never);
    const { status, body } = await call(getMasterReferenceSummary, 'incoterm');
    expect(status).toBe(200);
    expect(body.data).toEqual({ total: 6, synced: 2, notSynced: 3, failed: 1, usedInKlip: 5, dhm: true });
    const sql = sqls()[0];
    expect(sql).toContain('AS synced');
    expect(sql).toContain("ps.entity_kind = 'incoterm'");
    expect(sql).toContain('FROM master_reference_items');
    expect(sql).toContain('WHERE kind = $1');
    expect(vi.mocked(query).mock.calls[0]![1]).toEqual(['incoterm']);
  });

  it('uses a different "used" test per kind, each against the data KLIP runs on', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ total: 1, used_in_klip: 1 }] } as never);
    await call(getMasterReferenceSummary, 'incoterm');
    await call(getMasterReferenceSummary, 'ext_company');
    await call(getMasterReferenceSummary, 'truck_transporter');
    const [incoterm, ext, truck] = sqls();
    expect(incoterm).toContain('FROM contracts c WHERE COALESCE(c.incoterm');
    expect(incoterm).toContain('master_reference_items.value_1');
    expect(ext).toContain('FROM contracts c WHERE COALESCE(c.supplier');
    expect(ext).toContain('master_reference_items.value_3');
    expect(truck).toContain('FROM trucking_operations t WHERE COALESCE(t.trucking_owner');
  });

  it('has no DHM numbers for Truck Transporter (it is never sent to DHM)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: 89, used_in_klip: 77 }] } as never);
    const { body } = await call(getMasterReferenceSummary, 'truck_transporter');
    expect(body.data).toMatchObject({ total: 89, usedInKlip: 77, dhm: false });
    const sql = sqls()[0];
    expect(sql).not.toContain('dhm_push_state');
    expect(sql).not.toContain('AS synced');
  });

  it('refuses an unknown kind and answers 500 with a message, not a stack, when the database fails', async () => {
    expect((await call(getMasterReferenceSummary, 'nope')).status).toBe(400);
    vi.mocked(query).mockRejectedValueOnce(new Error('db down'));
    const { status, body } = await call(getMasterReferenceSummary, 'incoterm');
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});
