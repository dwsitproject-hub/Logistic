import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticateToken, authorize, AuthRequest } from './auth';
import type { Response, NextFunction } from 'express';

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
