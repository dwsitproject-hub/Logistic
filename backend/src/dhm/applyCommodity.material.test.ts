import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('./versionGuard', async (importActual) => ({
  ...(await importActual<typeof import('./versionGuard')>()),
  shouldApplyDhmRecord: vi.fn().mockResolvedValue(true),
}));
vi.mock('./masterReplica', async (importActual) => ({
  ...(await importActual<typeof import('./masterReplica')>()),
  persistMasterReplica: vi.fn().mockResolvedValue(undefined),
  rememberDhmOrganization: vi.fn().mockResolvedValue(undefined),
}));

import { query } from '../database/connection';
import { persistMasterReplica } from './masterReplica';
import { applyDhmMasterRecord } from './applyMaster';
import type { DhmRecord } from './types';

/**
 * The Master Product table is the DHM commodity catalog: one row per commodity, carrying the SAP material_code DHM sent (unique there) and its own DataHub code. DHM allows several
 * commodities under one short_name; a second one must not take the first one's row (the two would swap dhm_id, code and material_code on every sync).
 */
const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const commodity = (id: string, code: string, material: string | null, name = 'CPO'): DhmRecord => ({
  id,
  version: 1,
  isDeleted: false,
  data: { code, short_name: name, long_name: `CRUDE PALM OIL ${material ?? ''}`.trim(), type: 'liquid', ...(material ? { material_code: material } : {}) },
  updatedAt: '2026-11-12T00:00:00.000Z',
});

/** What the lookups find. `byName` is the product row named 'CPO'; `siblingLinked` says it is linked to ANOTHER commodity; `holder` says another row already holds the material code. */
function mockDb(opts: { byDhmId?: boolean; byName?: boolean; siblingLinked?: boolean; holder?: boolean } = {}) {
  vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (s.includes('SELECT id FROM products WHERE dhm_id = $1::uuid')) return { rows: opts.byDhmId ? [{ id: 'product-cpo' }] : [], rowCount: opts.byDhmId ? 1 : 0 };
    if (s.includes('SELECT id FROM products WHERE code_dhm = $1')) return { rows: [], rowCount: 0 };
    if (s.includes('SELECT id FROM products WHERE upper(trim(material_code)) = upper(trim($1)) AND ($2::uuid IS NULL OR id <> $2::uuid)')) {
      return { rows: opts.holder ? [{ id: 'other-product' }] : [], rowCount: opts.holder ? 1 : 0 };
    }
    if (s.includes('SELECT id FROM products WHERE upper(trim(material_code)) = upper(trim($1)) LIMIT 1')) return { rows: [], rowCount: 0 };
    if (s.includes('AND dhm_id IS NOT NULL AND ($2::uuid IS NULL OR dhm_id <> $2::uuid)')) return { rows: opts.siblingLinked ? [{ id: 'product-cpo' }] : [], rowCount: opts.siblingLinked ? 1 : 0 };
    if (s.includes('SELECT id FROM products WHERE upper(trim(product_name)) = upper(trim($1))')) {
      const found = opts.byName && params?.[0] === 'CPO';
      return { rows: found ? [{ id: 'product-cpo' }] : [], rowCount: found ? 1 : 0 };
    }
    if (s.startsWith('INSERT INTO products')) return { rows: [{ id: 'product-new' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }) as never);
}
const sqls = () => vi.mocked(query).mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
const inserts = () => vi.mocked(query).mock.calls.filter((c) => String(c[0]).replace(/\s+/g, ' ').startsWith('INSERT INTO products'));
const updates = () => sqls().filter((s) => s.startsWith('UPDATE products'));

describe('applyDhmMasterRecord(commodity): one Master Product row per DHM commodity', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(persistMasterReplica).mockClear();
  });

  it('a new commodity becomes a row with its DataHub code, its dhm id and the material_code DHM sent', async () => {
    mockDb();
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0326', '8010-10.11102', 'CPO FFA 3.5-5'));
    const [call] = inserts();
    const params = call[1] as unknown[];
    expect(params[0]).toBe('CPO FFA 3.5-5'); // product_name
    expect(params[3]).toBe('CMD-0326'); // code_dhm
    expect(params[4]).toBe(ID_A); // dhm_id
    expect(params[9]).toBe('8010-10.11102'); // material_code
  });

  it('a commodity already known by its dhm id updates its row and copies the material_code (the case the 26 Oct rows never got)', async () => {
    mockDb({ byDhmId: true });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0326', '8010-10.11102', 'CPO FFA 3.5-5'));
    const [update] = vi.mocked(query).mock.calls.filter((c) => String(c[0]).replace(/\s+/g, ' ').startsWith('UPDATE products'));
    expect(String(update[0])).toContain('material_code = COALESCE($5, material_code)');
    expect((update[1] as unknown[])[4]).toBe('8010-10.11102');
    expect(inserts()).toHaveLength(0);
  });

  it('a SIBLING commodity (same short_name, the name\'s row is linked to another commodity) gets a row of its own, named with its material code', async () => {
    mockDb({ byDhmId: false, byName: true, siblingLinked: true });
    await applyDhmMasterRecord('commodity', commodity(ID_B, 'CMD-0100', '8010-10.11121'));
    expect(updates()).toEqual([]); // the first commodity's row is not touched
    const [call] = inserts();
    expect((call[1] as unknown[])[0]).toBe('CPO (8010-10.11121)');
    expect((call[1] as unknown[])[9]).toBe('8010-10.11121');
  });

  it('the FIRST commodity of a name, with no row linked to another commodity yet, links the row of that name as before', async () => {
    mockDb({ byDhmId: false, byName: true, siblingLinked: false });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', '8010-10.11102'));
    expect(updates().length).toBe(1);
    expect(inserts()).toHaveLength(0);
  });

  it('a material_code another row already holds is not copied, and the record still applies', async () => {
    mockDb({ byDhmId: true, holder: true });
    await expect(applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0326', '8010-10.11102', 'CPO FFA 3.5-5'))).resolves.toBe(true);
    const [update] = vi.mocked(query).mock.calls.filter((c) => String(c[0]).replace(/\s+/g, ' ').startsWith('UPDATE products'));
    expect((update[1] as unknown[])[4]).toBeNull();
  });

  it('a commodity without a material_code (the old product-level record) is applied as before', async () => {
    mockDb({ byName: true });
    await applyDhmMasterRecord('commodity', commodity(ID_A, 'CMD-0006', null));
    expect(updates().length).toBe(1);
  });
});
