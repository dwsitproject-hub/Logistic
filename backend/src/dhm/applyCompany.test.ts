import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('./masterReplica', async (importActual) => ({
  ...(await importActual<typeof import('./masterReplica')>()),
  persistMasterReplica: vi.fn().mockResolvedValue(undefined),
  rememberDhmOrganization: vi.fn().mockResolvedValue(undefined),
}));

import { query } from '../database/connection';
import { persistMasterReplica } from './masterReplica';
import { applyDhmMasterRecord } from './applyMaster';
import type { DhmRecord } from './types';

const ORG_0003 = '33333333-3333-3333-3333-333333333333';

const record = (id: string, code: string): DhmRecord => ({
  id,
  version: 1,
  isDeleted: false,
  data: { code, name: 'PT. ENERGI OLEO PERSADA' },
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('applyDhmMasterRecord(company): a name or code match must not take another organisation\'s row', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(persistMasterReplica).mockClear();
  });

  // DHM holds PT. ENERGI OLEO PERSADA twice (ORG-0003 and ORG-0028). When the local row of ORG-0003 is removed, its
  // record used to be matched to the other row by name and overwrite that row's dhm_id and code.
  it('guards the code and name fallbacks with the record\'s own dhm_id', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await applyDhmMasterRecord('company', record(ORG_0003, 'ORG-0003'));
    const sqls = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    const name = sqls.find((s) => s.includes('upper(trim(company_name))'));
    expect(name).toBeDefined();
    expect(name).toMatch(/dhm_id IS NULL OR dhm_id IS NOT DISTINCT FROM \$2::uuid OR dhm_is_deleted/);
    const nameCall = vi.mocked(query).mock.calls.find((c) => String(c[0]).includes('upper(trim(company_name))'))!;
    expect(nameCall[1]).toEqual(['PT. ENERGI OLEO PERSADA', ORG_0003]);
  });

  it('inserts a new local row instead of overwriting one that belongs to another organisation', async () => {
    // lookups by dhm_id, code, short_name and name all find nothing (the guard hides the other organisation's row)
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT INTO master_companies')) return { rows: [{ id: 'new-row' }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });
    await applyDhmMasterRecord('company', record(ORG_0003, 'ORG-0003'));
    const inserted = vi.mocked(query).mock.calls.some((c) => String(c[0]).includes('INSERT INTO master_companies'));
    expect(inserted).toBe(true);
    expect(persistMasterReplica).not.toHaveBeenCalledWith('master_companies', expect.not.stringMatching(/^new-row$/), expect.anything(), expect.anything());
  });

  it('still relinks a row of the same record by its dhm_id', async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (String(sql).includes('WHERE dhm_id = $1::uuid')) return { rows: [{ id: 'row-eo' }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });
    await applyDhmMasterRecord('company', record(ORG_0003, 'ORG-0003'));
    expect(persistMasterReplica).toHaveBeenCalledWith('master_companies', 'row-eo', expect.anything(), expect.anything());
  });
});

describe('applyDhmMasterRecord(company): the SAP Company Code is company_code_sap, and a code another row holds is not taken', () => {
  const ORG_0006 = '66666666-6666-6666-6666-666666666666';
  const legal = (data: Record<string, unknown>): DhmRecord => ({ id: ORG_0006, version: 1, isDeleted: false, data: { code: 'ORG-0006', name: 'PT Prima Makmur Cakrawala', ...data }, updatedAt: '2026-10-15T00:00:00.000Z' });

  function run(holder: boolean) {
    vi.mocked(query).mockReset();
    vi.mocked(persistMasterReplica).mockClear();
    vi.mocked(query).mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('WHERE dhm_id = $1::uuid')) return { rows: [{ id: 'row-pmc' }], rowCount: 1 } as never;
      if (s.includes('id <> $2::uuid')) return { rows: holder ? [{ id: 'row-legacy-pm' }] : [], rowCount: holder ? 1 : 0 } as never;
      return { rows: [], rowCount: 0 } as never;
    });
  }
  const updateParams = () => vi.mocked(query).mock.calls.find((c) => String(c[0]).includes('UPDATE master_companies'))?.[1];

  it('takes company_code_sap (PM), not short_name (PMC), when the organisation has one', async () => {
    run(false);
    await applyDhmMasterRecord('company', legal({ short_name: 'PMC', company_code_sap: 'PM' }));
    expect(updateParams()).toEqual(['row-pmc', 'PT Prima Makmur Cakrawala', 'PM']);
  });

  it('falls back to short_name for an organisation with no company_code_sap (the older ones)', async () => {
    run(false);
    await applyDhmMasterRecord('company', legal({ short_name: 'EO' }));
    expect(updateParams()).toEqual(['row-pmc', 'PT Prima Makmur Cakrawala', 'EO']);
  });

  it('does not take a code another row holds: the current code stays (the repair plan releases it), the name still follows DHM', async () => {
    run(true);
    await applyDhmMasterRecord('company', legal({ short_name: 'PMC', company_code_sap: 'PM' }));
    expect(updateParams()).toEqual(['row-pmc', 'PT Prima Makmur Cakrawala', null]);
    expect(persistMasterReplica).toHaveBeenCalledWith('master_companies', 'row-pmc', expect.anything(), 'ORG-0006');
  });

  it('a NEW row whose SAP code is already held is filed under its DHM code instead of failing on the unique index', async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('INSERT INTO master_companies')) return { rows: [{ id: 'new-row' }], rowCount: 1 } as never;
      if (s.includes('WHERE upper(trim(company_code)) = upper(trim($1)) LIMIT 1')) return { rows: [{ id: 'legacy' }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });
    await applyDhmMasterRecord('company', legal({ short_name: 'PMC', company_code_sap: 'PM' }));
    const insert = vi.mocked(query).mock.calls.find((c) => String(c[0]).includes('INSERT INTO master_companies'))!;
    expect((insert[1] as unknown[])[0]).toBe('ORG-0006');
  });
});
