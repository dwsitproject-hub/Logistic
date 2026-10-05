import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());
const portPush = vi.hoisted(() => vi.fn());
const enabledMock = vi.hoisted(() => vi.fn());

vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('./config', () => ({ isDhmEnabled: enabledMock }));
vi.mock('./pushState', () => ({ recordPushOutcome: recordMock }));
vi.mock('./pushMaster', () => ({
  pushMasterPortToDhm: portPush,
  pushMasterPlantToDhm: vi.fn(),
  pushMasterSiteToDhm: vi.fn(),
  pushMasterCompanyToDhm: vi.fn(),
  pushMasterExternalPartyToDhm: vi.fn(),
  pushNamedMasterToDhm: vi.fn(),
}));
vi.mock('./pushVessel', () => ({ pushMasterVesselToDhm: vi.fn() }));

import { loadRowsByIds, pushMasterCatalogToDhm, pushRow } from './pushCatalog';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('the bulk Sync button remembers how each row went', () => {
  beforeEach(() => {
    queryMock.mockReset();
    recordMock.mockReset();
    portPush.mockReset();
    enabledMock.mockReturnValue(true);
  });

  it('records every row, so a row that failed in a bulk Sync is shown and retried like any other', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { id: A, port: 'PORT BONTANG' },
        { id: B, port: 'PORT KUMAI' },
      ],
    });
    const ok = { dhmStatus: 'updated', dhmCode: 'PORT-0048' };
    const bad = { dhmError: 'DHM unavailable' };
    portPush.mockResolvedValueOnce(ok).mockResolvedValueOnce(bad);
    const result = await pushMasterCatalogToDhm('port', false);
    expect(result).toMatchObject({ total: 2, synced: 1, failed: 1, conflicts: 0 });
    expect(recordMock).toHaveBeenCalledTimes(2);
    expect(recordMock).toHaveBeenNthCalledWith(1, 'port', A, ok);
    expect(recordMock).toHaveBeenNthCalledWith(2, 'port', B, bad);
  });

  it('pushRow returns exactly what the push returned', async () => {
    const conflict = { dhmConflict: true, dhmStatus: 'duplicate', dhmCode: 'PORT-1' };
    portPush.mockResolvedValue(conflict);
    expect(await pushRow('port', { id: A, port: 'PORT BONTANG' }, true)).toBe(conflict);
    expect(portPush).toHaveBeenCalledWith(A, expect.anything(), { overwrite: true });
  });
});

describe('loadRowsByIds', () => {
  beforeEach(() => queryMock.mockReset());

  it('picks a master out of the shared reference table by its kind', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await loadRowsByIds('incoterm', [A]);
    await loadRowsByIds('ext_company', [A]);
    await loadRowsByIds('product', [A]);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain("FROM master_reference_items WHERE id = ANY($1::uuid[]) AND kind = 'incoterm'");
    expect(sqls[1]).toContain("AND kind = 'ext_company'");
    expect(sqls[2]).toContain('FROM products WHERE id = ANY($1::uuid[])');
    expect(sqls[2]).not.toContain('kind');
  });

  it('asks nothing for an empty list', async () => {
    expect(await loadRowsByIds('port', [])).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
