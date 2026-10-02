import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../jps/client', () => ({ jpsRequest: vi.fn() }));
vi.mock('../dhm/client', () => ({ verifyDhmCredentials: vi.fn() }));
vi.mock('../integrations/settingsStore', () => ({
  IntegrationSettingsError: class extends Error {},
  describeIntegrations: vi.fn(),
  saveIntegrationSettings: vi.fn(),
}));

import { query } from '../database/connection';
import { getApiCall, listApiCalls } from './integration.controller';

function run(handler: (req: any, res: any) => Promise<void>, req: Record<string, unknown>) {
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
  return handler(req, res).then(() => ({ status, body }));
}

describe('listApiCalls', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as any);
  });

  it('lists newest first without the bodies, 50 at a time', async () => {
    await run(listApiCalls, { params: { id: 'jps' }, query: {} });
    const [list, count] = vi.mocked(query).mock.calls;
    expect(String(list![0])).toContain('FROM jps_api_calls');
    expect(String(list![0])).toContain('ORDER BY created_at DESC');
    expect(String(list![0])).not.toContain('request_body');
    expect(String(list![0])).not.toContain('response_body');
    expect(list![1]).toEqual([50, 0]);
    expect(String(count![0])).not.toContain('WHERE');
  });

  it('reads the JPS table as STO key and external reference', async () => {
    await run(listApiCalls, { params: { id: 'jps' }, query: {} });
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain('sto_key AS subject');
    expect(sql).toContain('external_reference AS reference');
  });

  it('reads the DHM table as slug and record code', async () => {
    await run(listApiCalls, { params: { id: 'dhm' }, query: {} });
    const sql = String(vi.mocked(query).mock.calls[0]![0]);
    expect(sql).toContain('FROM dhm_api_calls');
    expect(sql).toContain('slug AS subject');
    expect(sql).toContain('code AS reference');
  });

  it('filters by kind, outcome and a search over subject, reference and request id', async () => {
    await run(listApiCalls, {
      params: { id: 'jps' },
      query: { kind: 'submit', ok: 'false', q: 'req_5ab', limit: '20', offset: '40' },
    });
    const [list, count] = vi.mocked(query).mock.calls;
    const sql = String(list![0]);
    expect(sql).toContain('kind = $1');
    expect(sql).toContain('ok = $2');
    expect(sql).toContain('sto_key ILIKE $3');
    expect(sql).toContain('external_reference ILIKE $3');
    expect(sql).toContain('request_id ILIKE $3');
    expect(list![1]).toEqual(['submit', false, '%req_5ab%', 20, 40]);
    expect(count![1]).toEqual(['submit', false, '%req_5ab%']);
  });

  it('knows each integration its own kinds', async () => {
    await run(listApiCalls, { params: { id: 'dhm' }, query: { kind: 'sync' } });
    expect(String(vi.mocked(query).mock.calls[0]![0])).toContain('kind = $1');

    vi.mocked(query).mockClear();
    await run(listApiCalls, { params: { id: 'dhm' }, query: { kind: 'submit' } });
    expect(String(vi.mocked(query).mock.calls[0]![0])).not.toContain('kind =');

    vi.mocked(query).mockClear();
    await run(listApiCalls, { params: { id: 'jps' }, query: { kind: 'sync' } });
    expect(String(vi.mocked(query).mock.calls[0]![0])).not.toContain('kind =');
  });

  it('ignores a kind it does not know and caps the page size', async () => {
    await run(listApiCalls, { params: { id: 'jps' }, query: { kind: 'drop table', limit: '9999' } });
    const [list] = vi.mocked(query).mock.calls;
    expect(String(list![0])).not.toContain('kind =');
    expect(list![1]).toEqual([200, 0]);
  });

  it('answers 404 for an integration that has no history, without touching the database', async () => {
    const { status } = await run(listApiCalls, { params: { id: 'jps_api_calls; DROP TABLE users' }, query: {} });
    expect(status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('answers with the rows and the total', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: 'a' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ count: '7' }], rowCount: 1 } as any);
    const { status, body } = await run(listApiCalls, { params: { id: 'jps' }, query: {} });
    expect(status).toBe(200);
    expect(body.data.items).toEqual([{ id: 'a' }]);
    expect(body.data.pagination.total).toBe(7);
  });
});

describe('getApiCall', () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it('does not query for an id that is not a uuid', async () => {
    const { status } = await run(getApiCall, { params: { id: 'jps', callId: "1'; DROP TABLE x;--" } });
    expect(status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns the whole row, bodies included, from the table of that integration', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 'x', request_body: { a: 1 } }], rowCount: 1 } as any);
    const { status, body } = await run(getApiCall, {
      params: { id: 'dhm', callId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    });
    expect(status).toBe(200);
    expect(body.data.request_body).toEqual({ a: 1 });
    expect(String(vi.mocked(query).mock.calls[0]![0])).toContain('FROM dhm_api_calls');
  });

  it('answers 404 for a call that is not there', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as any);
    const { status } = await run(getApiCall, {
      params: { id: 'jps', callId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    });
    expect(status).toBe(404);
  });
});
