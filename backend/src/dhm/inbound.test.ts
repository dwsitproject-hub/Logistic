import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ dhmRequest: vi.fn() }));

import { dhmRequest } from './client';
import { INBOUND_SLUGS, parseInboundBody, postInbound, putInbound } from './inbound';

const record = {
  id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  isDeleted: false,
  data: { code: 'VSL-0001', Vessel_Name: 'ALPHA' },
  updatedAt: '2026-09-15T02:00:00.000Z',
};

describe('parseInboundBody', () => {
  it('treats 201 created as success', () => {
    const result = parseInboundBody(201, { status: 'created', code: 'VSL-0001', record });
    expect(result).toMatchObject({ ok: true, status: 'created', code: 'VSL-0001' });
  });

  it('treats 200 updated as success', () => {
    const result = parseInboundBody(200, { status: 'updated', code: 'VSL-0001', record });
    expect(result).toMatchObject({ ok: true, status: 'updated' });
  });

  it('treats 409 as conflict without inventing a new local row', () => {
    const result = parseInboundBody(409, { status: 'duplicate', inboundId: 'inb-1', record });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(true);
      expect(result.record.data.code).toBe('VSL-0001');
    }
  });

  it('surfaces 400 schema errors', () => {
    const result = parseInboundBody(400, { error: 'Unknown fields in record data', unknownKeys: ['owner'] });
    expect(result).toMatchObject({
      ok: false,
      conflict: false,
      httpStatus: 400,
      error: 'Unknown fields in record data (owner)',
    });
  });
});

describe('INBOUND_SLUGS', () => {
  const ok = (slug: string) => ({
    status: 201,
    data: { status: 'created', code: 'X-1', record },
    slug,
  });

  beforeEach(() => {
    vi.mocked(dhmRequest).mockReset();
  });

  // The Master Plant Sync button pushes 'plant'. It was missing from the set, so every row came
  // back "Unknown DHM slug" without a request ever leaving KLIP.
  it.each([...INBOUND_SLUGS])('lets %s through to DHM on POST and PUT', async (slug) => {
    vi.mocked(dhmRequest).mockResolvedValue(ok(slug) as never);
    const posted = await postInbound(slug, { name: 'A' });
    const put = await putInbound(slug, 'X-1', { name: 'A' });
    expect(posted.ok).toBe(true);
    expect(put.ok).toBe(true);
    expect(vi.mocked(dhmRequest).mock.calls[0]![0]).toMatchObject({ url: `/v1/inbound/${slug}` });
  });

  it('still refuses a slug KLIP never pushes, without calling DHM', async () => {
    const result = await postInbound('../admin', {});
    expect(result).toMatchObject({ ok: false, httpStatus: 400, error: 'Unknown DHM slug' });
    expect(dhmRequest).not.toHaveBeenCalled();
  });

  // Reads the push code itself, so the next master someone adds to Sync cannot be forgotten here.
  it('lists every slug the push code sends', () => {
    const found = new Set<string>();
    for (const file of ['pushMaster.ts', 'pushCatalog.ts', 'pushVessel.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      for (const m of src.matchAll(/pushNamedMasterToDhm\(\s*'[a-z_]+'\s*,\s*\w+\s*,\s*'([a-z_]+)'/g)) found.add(m[1]!);
      for (const m of src.matchAll(/resolveDhmSlug\('([a-z_]+)'\)/g)) found.add(m[1]!);
      for (const m of src.matchAll(/(?:postInbound|putInbound)\('([a-z_]+)'/g)) found.add(m[1]!);
    }
    // plant, port_master, commodity, incoterm, external_party, company, site: the scan must see them.
    expect(found.size).toBeGreaterThanOrEqual(6);
    expect([...found].filter((slug) => !INBOUND_SLUGS.has(slug))).toEqual([]);
  });
});
