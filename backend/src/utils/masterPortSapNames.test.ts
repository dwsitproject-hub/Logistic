import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  default: { connect: async () => ({ query: (...args: unknown[]) => clientQuery(...args), release }) },
}));
vi.mock('./logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import {
  assertSapNamesAvailable,
  attachSapNames,
  cleanSapName,
  dedupeSapNames,
  MasterPortSapNameConflictError,
  parseSapNamesInput,
  refreshMasterPortIds,
  replaceSapNamesForPort,
} from './masterPortSapNames';

const PORT = '11111111-2222-3333-4444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  queryMock.mockReset();
  clientQuery.mockReset();
  release.mockReset();
});

describe('names as they arrive', () => {
  it('cleans to upper-case, single-spaced', () => {
    expect(cleanSapName('  eup  edible oil bontang ')).toBe('EUP EDIBLE OIL BONTANG');
  });

  it('parseSapNamesInput: undefined means "not sent" (stored names are left alone), an empty list means "clear them"', () => {
    expect(parseSapNamesInput(undefined)).toBeUndefined();
    expect(parseSapNamesInput([])).toEqual([]);
    expect(parseSapNamesInput(null)).toEqual([]);
  });

  it('splits one string on ; | and new lines, but never on a comma (PORT KUMALINGON, LEOK has one)', () => {
    expect(parseSapNamesInput('pabrik wksm; pabrik ajp|PORT KUMALINGON, LEOK\nEUP BIOMASS BONTANG')).toEqual([
      'PABRIK WKSM',
      'PABRIK AJP',
      'PORT KUMALINGON, LEOK',
      'EUP BIOMASS BONTANG',
    ]);
  });

  it('dedupeSapNames keeps one per identity (PORT prefix and punctuation do not make a second port)', () => {
    expect(dedupeSapNames(['PABRIK AJP', 'PABRIK  AJP', 'PORT BONTANG', 'BONTANG', 'Port of Bontang'])).toEqual(['PABRIK AJP', 'PORT BONTANG']);
  });

  it('drops what names no port: blanks, numeric SAP codes, placeholders', () => {
    expect(dedupeSapNames(['', '22.03', '0.00', 'BLANK', 'DISCHARGE PORT', 'PABRIK AJP'])).toEqual(['PABRIK AJP']);
  });
});

describe('assertSapNamesAvailable', () => {
  it('passes with no names (no query)', async () => {
    await assertSapNamesAvailable([], { id: PORT, name: 'PORT BONTANG' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('passes when nothing conflicts', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(assertSapNamesAvailable(['PABRIK AJP'], { id: PORT, name: 'PORT BONTANG' })).resolves.toBeUndefined();
  });

  it('refuses a name another port already has (one SAP text, one port) and says which port', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ sap_name: 'PABRIK AJP', port: 'PORT MERAUKE' }] })
      .mockResolvedValueOnce({ rows: [] });
    const err = await assertSapNamesAvailable(['PABRIK AJP'], { id: PORT, name: 'PORT BONTANG' }).catch((e) => e);
    expect(err).toBeInstanceOf(MasterPortSapNameConflictError);
    expect((err as MasterPortSapNameConflictError).statusCode).toBe(409);
    expect((err as Error).message).toContain('PORT MERAUKE');
    expect((err as MasterPortSapNameConflictError).conflicts[0].name).toBe('PABRIK AJP');
  });

  it('refuses a name that is another Master Port itself (that port would always win)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ port: 'PORT DUMAI' }] });
    const err = await assertSapNamesAvailable(['DUMAI'], { id: PORT, name: 'PORT BONTANG' }).catch((e) => e);
    expect(err).toBeInstanceOf(MasterPortSapNameConflictError);
    expect((err as Error).message).toContain('is a Master Port itself');
  });

  it("a name equal to the port's OWN name is redundant, not a conflict", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ port: 'PORT BONTANG' }] });
    await expect(assertSapNamesAvailable(['BONTANG'], { name: 'PORT BONTANG' })).resolves.toBeUndefined();
  });

  it("excludes the saved port's own rows (a re-save must not conflict with itself) and compares identities in SQL", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await assertSapNamesAvailable(['PABRIK AJP'], { id: PORT, name: 'PORT BONTANG' });
    const [sqlOnPorts, paramsOnPorts] = queryMock.mock.calls[0];
    expect(String(sqlOnPorts)).toMatch(/klip_port_identity\(n\.sap_name\)/);
    expect(String(sqlOnPorts)).toMatch(/n\.port_id <> \$2::uuid/);
    expect(paramsOnPorts).toEqual([['PABRIK AJP'], PORT]);
  });

  it('a port that does not exist yet (create) is compared by name only: no id is passed', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await assertSapNamesAvailable(['PABRIK AJP'], { name: 'PORT NEW' });
    expect(queryMock.mock.calls[0][1]).toEqual([['PABRIK AJP'], null]);
  });
});

describe('replaceSapNamesForPort', () => {
  it('replaces the whole list in one transaction, after the conflict check, and does not store the port\'s own name', async () => {
    clientQuery.mockResolvedValue({ rows: [] });
    const stored = await replaceSapNamesForPort(PORT, 'PORT BONTANG', ['pabrik ajp', 'PABRIK AJP', 'Bontang', 'EUP BIOMASS BONTANG']);
    expect(stored).toEqual(['PABRIK AJP', 'EUP BIOMASS BONTANG']);
    const texts = clientQuery.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0]);
    expect(texts[0]).toBe('BEGIN');
    expect(texts).toContain('DELETE');
    expect(texts).toContain('INSERT');
    expect(texts[texts.length - 1]).toBe('COMMIT');
    const insert = clientQuery.mock.calls.find((c) => /INSERT INTO master_port_sap_names/.test(String(c[0])))!;
    expect(insert[1]).toEqual([PORT, ['PABRIK AJP', 'EUP BIOMASS BONTANG']]);
    expect(release).toHaveBeenCalled();
  });

  it('clearing the list deletes and inserts nothing', async () => {
    clientQuery.mockResolvedValue({ rows: [] });
    expect(await replaceSapNamesForPort(PORT, 'PORT BONTANG', [])).toEqual([]);
    expect(clientQuery.mock.calls.some((c) => /INSERT INTO/.test(String(c[0])))).toBe(false);
    expect(clientQuery.mock.calls.some((c) => /DELETE FROM master_port_sap_names/.test(String(c[0])))).toBe(true);
  });

  it('a conflict rolls back and writes nothing', async () => {
    clientQuery.mockImplementation(async (text: string) => {
      if (/FROM master_port_sap_names n/.test(String(text))) return { rows: [{ sap_name: 'PABRIK AJP', port: 'PORT MERAUKE' }] };
      return { rows: [] };
    });
    const err = await replaceSapNamesForPort(PORT, 'PORT BONTANG', ['PABRIK AJP']).catch((e) => e);
    expect(err).toBeInstanceOf(MasterPortSapNameConflictError);
    const texts = clientQuery.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0]);
    expect(texts).toContain('ROLLBACK');
    expect(texts).not.toContain('DELETE');
    expect(texts).not.toContain('COMMIT');
    expect(release).toHaveBeenCalled();
  });
});

describe('attachSapNames', () => {
  it('adds the names to real Master Ports (uuid ids) and an empty list to the port texts that are not (one query)', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { port_id: PORT, sap_name: 'PABRIK AJP' },
        { port_id: PORT, sap_name: 'PABRIK WKSM' },
      ],
    });
    const rows = await attachSapNames([{ id: PORT, port: 'PORT BONTANG' }, { id: OTHER, port: 'PORT DUMAI' }, { id: 'vlp-PORT X', port: 'PORT X' }]);
    expect(rows.map((r) => r.vessel_port_sap)).toEqual([['PABRIK AJP', 'PABRIK WKSM'], [], []]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([[PORT, OTHER]]);
  });

  it('asks nothing when no row is a Master Port', async () => {
    const rows = await attachSapNames([{ id: 'vlp-PORT X', port: 'PORT X' }]);
    expect(rows[0].vessel_port_sap).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('refreshMasterPortIds', () => {
  it('returns how many rows changed', async () => {
    queryMock.mockResolvedValue({ rows: [{ changed: 12 }] });
    expect(await refreshMasterPortIds()).toBe(12);
  });

  it('never throws: the master change is saved already, a failed refresh is only a stale id until the next one', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    expect(await refreshMasterPortIds()).toBeNull();
  });
});
