import { describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const clientQuery = vi.fn(async () => ({ rows: [] }));
vi.mock('../database/connection', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  getClient: async () => ({ query: clientQuery, release: vi.fn() }),
}));

import { buildSapUsersListQuery, upsertSapUsers } from './sapUsers.service';

describe('buildSapUsersListQuery', () => {
  it('lists users with their POs, most POs first, then by name; no filter means every user', () => {
    const q = buildSapUsersListQuery({});
    expect(q.sql).toContain('COALESCE(pc.pos, 0)::int AS pos');
    expect(q.sql).toMatch(/ORDER BY COALESCE\(pc\.pos, 0\) DESC, u\.display_name ASC, u\.user_id ASC/);
    expect(q.sql).not.toContain('COALESCE(pc.pos, 0) > 0');
    expect(q.values).toEqual([25, 0]);
    expect(q.countValues).toEqual([]);
  });
  it('the has-data flag keeps only users who created POs of the report', () => {
    expect(buildSapUsersListQuery({ hasData: true }).sql).toContain('COALESCE(pc.pos, 0) > 0');
    expect(buildSapUsersListQuery({ hasData: true }).countSql).toContain('COALESCE(pc.pos, 0) > 0');
  });
  it('the search matches the NIK or the name, and % and _ are literal', () => {
    const q = buildSapUsersListQuery({ search: '  dewi_%  ', page: 3, limit: 10 });
    expect(q.sql).toContain('(u.user_id ILIKE $1 OR u.display_name ILIKE $1)');
    expect(q.values).toEqual(['%dewi\\_\\%%', 10, 20]);
    expect(q.countValues).toEqual(['%dewi\\_\\%%']);
  });
  it('caps the page size', () => {
    expect(buildSapUsersListQuery({ limit: 5000 }).values[0]).toBe(200);
  });
});

describe('upsertSapUsers', () => {
  it('builds the name in capitals in SQL, writes in one transaction, and never overwrites what PRC wrote', async () => {
    clientQuery.mockClear();
    const n = await upsertSapUsers([{ user_id: '0412', client: '300', first_name: 'Dewi', last_name: 'Siswanti' }], 'ZUSER', 'u1');
    expect(n).toBe(1);
    const sqls = clientQuery.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toContain("UPPER(TRIM(CONCAT_WS(' ', NULLIF(TRIM(t.first), ''), NULLIF(TRIM(t.last), ''))))");
    expect(sqls[1]).toContain("WHERE sap_users.source <> 'PRC' OR EXCLUDED.source = 'PRC'");
    expect(sqls[2]).toBe('COMMIT');
  });
  it('rolls back when a chunk fails', async () => {
    clientQuery.mockClear();
    clientQuery.mockImplementationOnce(async () => ({ rows: [] })).mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await expect(upsertSapUsers([{ user_id: 'a', client: '', first_name: 'A', last_name: '' }], 'ZUSER', null)).rejects.toThrow('boom');
    expect(clientQuery.mock.calls.map((c) => String((c as unknown[])[0])).includes('ROLLBACK')).toBe(true);
  });
});
