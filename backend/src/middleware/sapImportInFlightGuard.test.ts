import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import {
  SAP_IMPORT_IN_PROGRESS_CODE,
  sapImportInFlightGuard,
} from './sapImportInFlightGuard';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

import { query } from '../database/connection';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('sapImportInFlightGuard', () => {
  const next = vi.fn() as NextFunction;
  const req = { originalUrl: '/trucking/wb-rekap/bulk-upload', method: 'POST', user: { id: 'u1' } } as AuthRequest;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 409 when an import is in flight', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as never);
    const res = mockRes();

    await sapImportInFlightGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: SAP_IMPORT_IN_PROGRESS_CODE }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when no import is running', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const res = mockRes();

    await sapImportInFlightGuard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fail-opens on DB error', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('db down'));
    const res = mockRes();

    await sapImportInFlightGuard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
