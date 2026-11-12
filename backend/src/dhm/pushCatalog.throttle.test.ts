import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());
const namedPush = vi.hoisted(() => vi.fn());
const enabledMock = vi.hoisted(() => vi.fn());

vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));
vi.mock('./config', () => ({ isDhmEnabled: enabledMock }));
vi.mock('./pushState', () => ({ recordPushOutcome: recordMock }));
vi.mock('./pushMaster', () => ({
  pushMasterPortToDhm: vi.fn(),
  pushMasterPlantToDhm: vi.fn(),
  pushMasterSiteToDhm: vi.fn(),
  pushMasterCompanyToDhm: vi.fn(),
  pushMasterExternalPartyToDhm: vi.fn(),
  pushNamedMasterToDhm: namedPush,
}));
vi.mock('./pushVessel', () => ({ pushMasterVesselToDhm: vi.fn() }));

import { pushMasterCatalogToDhm, readDhmThrottle, USED_OR_UNDELIVERED_PRODUCTS_SQL } from './pushCatalog';

describe('readDhmThrottle', () => {
  it('recognises DHM\'s rate limit and its wait', () => {
    expect(readDhmThrottle('Too many requests (integration API); retry in 40s')).toEqual({ throttled: true, retryAfterSeconds: 40 });
    expect(readDhmThrottle('Too many requests')).toEqual({ throttled: true, retryAfterSeconds: null });
  });
  it('leaves every other error alone', () => {
    expect(readDhmThrottle('DHM unavailable')).toEqual({ throttled: false, retryAfterSeconds: null });
    expect(readDhmThrottle(undefined)).toEqual({ throttled: false, retryAfterSeconds: null });
  });
});

describe('the bulk product Sync', () => {
  beforeEach(() => {
    queryMock.mockReset();
    recordMock.mockReset();
    namedPush.mockReset();
    enabledMock.mockReturnValue(true);
  });

  const products = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, product_name: `P${i}`, code_dhm: `CMD-${i}` }));

  it('sends only the products a contract uses or DHM never received, not the whole catalog', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes('FROM products p')) return { rows: products(2) };
      return { rows: [{ n: 3405 }] };
    });
    namedPush.mockResolvedValue({ dhmStatus: 'ok', dhmCode: 'CMD-1' });
    const result = await pushMasterCatalogToDhm('product', false);
    expect(result.total).toBe(2);
    expect(result.synced).toBe(2);
    expect(result.skippedUnused).toBe(3403);
    expect(USED_OR_UNDELIVERED_PRODUCTS_SQL).toContain('p.dhm_id IS NULL');
    expect(USED_OR_UNDELIVERED_PRODUCTS_SQL).toContain('FROM contracts');
  });

  it('stops at the first "too many requests" instead of sending the rest into the limit', async () => {
    queryMock.mockImplementation(async (sql: string) => (String(sql).includes('FROM products p') ? { rows: products(10) } : { rows: [{ n: 10 }] }));
    namedPush
      .mockResolvedValueOnce({ dhmStatus: 'ok', dhmCode: 'CMD-0' })
      .mockResolvedValueOnce({ dhmStatus: 'ok', dhmCode: 'CMD-1' })
      .mockResolvedValue({ dhmError: 'Too many requests (integration API); retry in 40s' });
    const result = await pushMasterCatalogToDhm('product', false);
    expect(namedPush).toHaveBeenCalledTimes(3); // the third is refused and nothing is sent after it
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.throttled).toBe(true);
    expect(result.retryAfterSeconds).toBe(40);
    expect(result.errors[0].error).toContain('Too many requests');
  });

  it('an ordinary error does not stop the run', async () => {
    queryMock.mockImplementation(async (sql: string) => (String(sql).includes('FROM products p') ? { rows: products(3) } : { rows: [{ n: 3 }] }));
    namedPush.mockResolvedValueOnce({ dhmError: 'DHM unavailable' }).mockResolvedValue({ dhmStatus: 'ok', dhmCode: 'CMD-1' });
    const result = await pushMasterCatalogToDhm('product', false);
    expect(namedPush).toHaveBeenCalledTimes(3);
    expect(result.throttled).toBeUndefined();
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(2);
  });
});
