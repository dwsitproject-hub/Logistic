import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('./catalog', () => ({ getDhmCatalogEntity: vi.fn(), resolveDhmSlug: vi.fn() }));
vi.mock('./config', () => ({ isDhmEnabled: vi.fn(() => true) }));
vi.mock('./inbound', () => ({ postInbound: vi.fn(), putInbound: vi.fn() }));
vi.mock('./masterReplica', () => ({
  persistMasterReplica: vi.fn().mockResolvedValue(undefined),
  rememberDhmOrganization: vi.fn(),
  findSiblingOrgCode: vi.fn(),
}));

import { query } from '../database/connection';
import { getDhmCatalogEntity, resolveDhmSlug } from './catalog';
import { postInbound } from './inbound';
import { pushMasterPortToDhm } from './pushMaster';

const created = {
  ok: true as const,
  status: 'created' as const,
  code: 'PORT-0050',
  record: { id: '11111111-1111-1111-1111-111111111111', version: 1, isDeleted: false, data: { code: 'PORT-0050' }, updatedAt: '' },
};

const portEntity = (siteRequired: boolean) => ({
  slug: 'port_master',
  fields: [
    { key: 'name', required: true },
    { key: 'code', systemGenerated: true },
    { key: 'site_id', required: siteRequired },
  ],
});

describe('pushMasterPortToDhm', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(postInbound).mockReset().mockResolvedValue(created as never);
    vi.mocked(resolveDhmSlug).mockReset().mockResolvedValue('port_master');
    vi.mocked(getDhmCatalogEntity).mockReset().mockResolvedValue(portEntity(false) as never);
  });

  // DHM no longer requires a Site on a port. KLIP used to answer "Port needs a DHM site" itself, before asking
  // DHM anything, and dhm_site_code is empty on every port - so PORT BONTANG could never get its DHM code.
  it('pushes a port that has no Site at all, without site_id', async () => {
    const result = await pushMasterPortToDhm('port-1', { port: 'PORT BONTANG', code_dhm: null, site_id: null, dhm_site_code: null });
    expect(result).toMatchObject({ dhmStatus: 'created', dhmCode: 'PORT-0050' });
    expect(result.dhmError).toBeUndefined();
    expect(vi.mocked(postInbound)).toHaveBeenCalledTimes(1);
    const [slug, payload] = vi.mocked(postInbound).mock.calls[0]!;
    expect(slug).toBe('port_master');
    expect(payload).toEqual({ name: 'PORT BONTANG' });
    expect(query).not.toHaveBeenCalled();
  });

  it('sends site_id when the port is linked to a Master Site that has a DHM code', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ code_dhm: 'SITE-0007' }], rowCount: 1 } as never);
    await pushMasterPortToDhm('port-1', { port: 'PORT BONTANG', site_id: '22222222-2222-2222-2222-222222222222' });
    expect(vi.mocked(postInbound).mock.calls[0]![1]).toEqual({ name: 'PORT BONTANG', site_id: 'SITE-0007' });
  });

  it('prefers a stored dhm_site_code and does not look the Site up', async () => {
    await pushMasterPortToDhm('port-1', { port: 'PORT BATAM', dhm_site_code: 'SITE-0002', site_id: '22222222-2222-2222-2222-222222222222' });
    expect(vi.mocked(postInbound).mock.calls[0]![1]).toEqual({ name: 'PORT BATAM', site_id: 'SITE-0002' });
    expect(query).not.toHaveBeenCalled();
  });

  it('pushes without site_id when the linked Site has no DHM code yet', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ code_dhm: null }], rowCount: 1 } as never);
    const result = await pushMasterPortToDhm('port-1', { port: 'PORT BONTANG', site_id: '22222222-2222-2222-2222-222222222222' });
    expect(result.dhmError).toBeUndefined();
    expect(vi.mocked(postInbound).mock.calls[0]![1]).toEqual({ name: 'PORT BONTANG' });
  });

  // If the live catalog still says site_id is required, that is DHM's rule and it is reported as DHM's, not as a KLIP guess.
  it('reports DHM\'s own requirement when the catalog still marks site_id required', async () => {
    vi.mocked(getDhmCatalogEntity).mockResolvedValue(portEntity(true) as never);
    const result = await pushMasterPortToDhm('port-1', { port: 'PORT BONTANG' });
    expect(result.dhmError).toBe('DHM port_master needs site_id');
    expect(postInbound).not.toHaveBeenCalled();
  });
});
