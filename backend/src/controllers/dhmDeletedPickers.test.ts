import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('../dhm', () => ({}));
vi.mock('../dhm/pushCatalog', () => ({}));

import { listMasterLoadingPorts } from './masterLoadingPort.controller';
import { listMasterPlants } from './masterPlant.controller';
import { listProducts } from './product.controller';
import { listMasterVessels } from './masterVessel.controller';

function call(handler: (req: never, res: never) => Promise<void>, queryString: Record<string, unknown>) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  return handler({ query: queryString, body: {}, params: {} } as never, res as never);
}

const sqls = () => queryMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: '0' }] });
});

describe('pickers leave out masters deleted in DHM, tables do not', () => {
  it('Master Port: excludeDeleted filters the list and the count, and a deleted master hides the name from the other sources', async () => {
    await call(listMasterLoadingPorts, { search: 'bont', limit: 20, excludeDeleted: 'true' });
    const all = sqls();
    expect(all).toHaveLength(2);
    for (const sql of all) {
      // the master row (priority 0) carries the flag, and `ranked` keeps it because it wins DISTINCT ON (port)
      expect(sql).toContain('COALESCE(dhm_is_deleted, FALSE) AS dhm_is_deleted');
      expect(sql).toContain('AND dhm_is_deleted IS NOT TRUE');
    }
  });

  it('Master Port: without the flag nothing is filtered (the Master Port table still lists every row)', async () => {
    await call(listMasterLoadingPorts, { search: 'bont', limit: 20 });
    for (const sql of sqls()) {
      expect(sql).not.toContain('AND dhm_is_deleted IS NOT TRUE');
    }
  });

  it('Master Port: the catalog-only list is filtered too', async () => {
    await call(listMasterLoadingPorts, { masterOnly: 'true', excludeDeleted: '1' });
    for (const sql of sqls()) {
      expect(sql).toContain('COALESCE(p.dhm_is_deleted, FALSE) IS NOT TRUE');
    }
  });

  it('Master Plant: filtered only when asked', async () => {
    await call(listMasterPlants, { search: 'EUP', limit: 20, excludeDeleted: 'true' });
    for (const sql of sqls()) {
      expect(sql).toContain('COALESCE(master_plants.dhm_is_deleted, FALSE) IS NOT TRUE');
    }
    queryMock.mockClear();
    await call(listMasterPlants, { search: 'EUP', limit: 20 });
    for (const sql of sqls()) {
      expect(sql).not.toContain('dhm_is_deleted');
    }
  });

  it('Master Product: filtered only when asked', async () => {
    await call(listProducts, { limit: '200', excludeDeleted: 'true' });
    for (const sql of sqls()) {
      expect(sql).toContain('COALESCE(dhm_is_deleted, FALSE) IS NOT TRUE');
    }
    queryMock.mockClear();
    await call(listProducts, { limit: '200' });
    for (const sql of sqls()) {
      expect(sql).not.toContain('dhm_is_deleted');
    }
  });

  it('Master Vessel: filtered only when asked', async () => {
    await call(listMasterVessels, { search: 'AS', limit: 20, excludeDeleted: 'true' });
    for (const sql of sqls()) {
      expect(sql).toContain('COALESCE(dhm_is_deleted, FALSE) IS NOT TRUE');
    }
    queryMock.mockClear();
    await call(listMasterVessels, { search: 'AS', limit: 20 });
    for (const sql of sqls()) {
      expect(sql).not.toContain('IS NOT TRUE');
    }
  });
});
