import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/clamScan.service', () => ({ scanFileWithClamdIfConfigured: vi.fn() }));

import { listDocuments } from './document.controller';

function run(query: Record<string, string>) {
  const res: { body?: unknown; statusCode: number; json: (b: unknown) => unknown; status: (c: number) => unknown } = {
    statusCode: 200,
    json(b) {
      res.body = b;
      return res;
    },
    status(c) {
      res.statusCode = c;
      return res;
    },
  };
  return listDocuments({ query } as never, res as never).then(() => res);
}

describe('listDocuments', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [{ id: 'd1' }] });
  });

  // Reported 2026-10-29: a file uploaded from Trucking > Actions > Upload (trucking_operation_id, no contract_id) was listed by the Trucking page but the
  // Contract Details modal, which asks by contractId, said "No documents uploaded for this contract".
  it('a contract lists the documents filed on it AND those filed on its trucking operations', async () => {
    await run({ contractId: 'c-1' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('contract_id = $1');
    expect(sql).toContain('trucking_operation_id IN (SELECT t.id FROM trucking_operations t WHERE t.contract_id = $1)');
    expect(params).toEqual(['c-1']);
  });

  it('one parameter serves both arms, and the next filter takes the next index', async () => {
    await run({ contractId: 'c-1', shipmentId: 's-1' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('shipment_id = $2');
    expect(params).toEqual(['c-1', 's-1']);
  });

  it('a trucking operation is still listed by its own id, and with no filter everything is', async () => {
    await run({ truckingOperationId: 't-1' });
    expect(queryMock.mock.calls[0][0]).toContain('trucking_operation_id = $1');
    expect(queryMock.mock.calls[0][1]).toEqual(['t-1']);
    queryMock.mockClear();
    await run({});
    expect(queryMock.mock.calls[0][1]).toEqual([]);
  });

  it('answers with the rows', async () => {
    const res = await run({ contractId: 'c-1' });
    expect(res.body).toEqual({ success: true, data: [{ id: 'd1' }] });
  });
});
