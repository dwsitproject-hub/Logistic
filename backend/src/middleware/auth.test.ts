import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticateToken, authorize, authorizeSapImportsUpload, AuthRequest } from './auth';
import type { Response, NextFunction } from 'express';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
}));

import { query } from '../database/connection';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(o: unknown) {
      this.body = o;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('authenticateToken', () => {
  const secret = process.env.JWT_SECRET!;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('401 when Authorization header missing (negative)', () => {
    const req = { headers: {} } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    authenticateToken(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when token invalid (negative)', () => {
    const req = { headers: { authorization: 'Bearer not-a-jwt' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    authenticateToken(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when token signed with wrong secret (negative)', () => {
    const evil = jwt.sign({ sub: '1', role: 'ADMIN' }, 'wrong-secret-at-least-32-chars-long!!');
    const req = { headers: { authorization: `Bearer ${evil}` } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    authenticateToken(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and sets user when token valid (positive)', () => {
    const payload = { id: 'u1', username: 'alice', email: 'a@x.com', role: 'ADMIN' };
    const token = jwt.sign(payload, secret, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    authenticateToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject(payload);
  });
});

describe('authorize', () => {
  it('401 when user missing (negative)', () => {
    const mid = authorize('ADMIN');
    const req = {} as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mid(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when role not allowed (negative)', () => {
    const mid = authorize('ADMIN');
    const req = { user: { id: '1', username: 'x', email: 'x', role: 'FINANCE' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mid(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  it('next when role matches (positive)', () => {
    const mid = authorize('ADMIN', 'MANAGEMENT');
    const req = { user: { id: '1', username: 'x', email: 'x', role: 'MANAGEMENT' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mid(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('authorizeSapImportsUpload', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('401 when user missing (negative)', async () => {
    const req = {} as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authorizeSapImportsUpload(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('next for ADMIN without DB lookup (positive)', async () => {
    const req = { user: { id: '1', username: 'admin', email: 'a@x.com', role: 'ADMIN' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authorizeSapImportsUpload(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('next for LOGISTICS when page.sap can_create is true (positive)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ allowed: true }] } as never);
    const req = { user: { id: 'u2', username: 'dinna', email: 'd@x.com', role: 'LOGISTICS' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authorizeSapImportsUpload(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('403 for LOGISTICS when page.sap can_create is false (negative)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ allowed: false }] } as never);
    const req = { user: { id: 'u2', username: 'dinna', email: 'd@x.com', role: 'LOGISTICS' } } as AuthRequest;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authorizeSapImportsUpload(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
